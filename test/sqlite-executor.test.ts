import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { isKastorError } from '../src/core/errors';
import { q, text } from '../src/core/sql';
import { d1 } from '../src/d1';
import { decodeSqlite, encodeSqlite, sqliteTextMatch } from '../src/dialects/sqlite/dialect';
import { detectSyncDriver } from '../src/dialects/sqlite/drivers';
import { mapSqliteError } from '../src/dialects/sqlite/errors';
import { looksLikeReader, smallInt, toSqliteParams } from '../src/dialects/sqlite/executor-sync';
import { libsql } from '../src/libsql';
import { sqlite } from '../src/sqlite';

describe('sqlite driver detection', () => {
  it('tells the synchronous drivers apart', () => {
    expect(detectSyncDriver(new Database(':memory:'))).toBe('better-sqlite3');
    expect(detectSyncDriver({ prepare() {}, exec() {} })).toBe('node:sqlite');
    expect(detectSyncDriver({ prepare() {}, query() {}, run() {}, exec() {} })).toBe('bun:sqlite');
    expect(detectSyncDriver({})).toBeNull();
    expect(detectSyncDriver(null)).toBeNull();
    expect(() => sqlite({} as never)).toThrow(/did not receive a supported SQLite driver/);
  });

  it('guesses readers for old node:sqlite builds without columns()', () => {
    expect(looksLikeReader('select 1')).toBe(true);
    expect(looksLikeReader('  WITH x AS (select 1) select * from x')).toBe(true);
    expect(looksLikeReader('INSERT INTO t VALUES (1) RETURNING id')).toBe(true);
    expect(looksLikeReader('PRAGMA table_info("t")')).toBe(true);
    expect(looksLikeReader('UPDATE t SET a = 1')).toBe(false);
  });
});

describe('sqlite executor (better-sqlite3)', () => {
  const setup = () => {
    const adapter = sqlite(new Database(':memory:'));
    return adapter.executor;
  };

  it('reports affected rows, insert ids and exact 64 bit integers', async () => {
    const exec = setup();
    await exec.query('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, n BIGINT, b BLOB, f BOOLEAN)', []);
    const ins = await exec.query('INSERT INTO t (n, b, f) VALUES (?, ?, ?)', [9007199254740993n, new Uint8Array([1, 2]), true]);
    expect(ins).toEqual({ rows: [], rowsAffected: 1, insertId: 1 });
    const rows = await exec.query('SELECT id, n, b, f FROM t', []);
    expect(rows.rows[0]!.id).toBe(1);
    expect(rows.rows[0]!.n).toBe(9007199254740993n);
    expect(rows.rows[0]!.f).toBe(1);
    expect(Array.from(rows.rows[0]!.b as Uint8Array)).toEqual([1, 2]);
    const ret = await exec.query('UPDATE t SET n = n + 1 RETURNING n', []);
    expect(ret.rows).toEqual([{ n: 9007199254740994n }]);
  });

  it('commits, rolls back and nests with savepoints', async () => {
    const exec = setup();
    await exec.query('CREATE TABLE t (v TEXT)', []);
    await exec.transaction(async (tx) => {
      await tx.query(`INSERT INTO t VALUES ('kept')`, []);
      await tx
        .transaction(async (inner) => {
          await inner.query(`INSERT INTO t VALUES ('inner')`, []);
          throw new Error('undo inner');
        })
        .catch(() => undefined);
    });
    await expect(
      exec.transaction(async (tx) => {
        await tx.query(`INSERT INTO t VALUES ('lost')`, []);
        throw new Error('undo all');
      }),
    ).rejects.toThrow('undo all');
    const rows = await exec.query('SELECT v FROM t', []);
    expect(rows.rows).toEqual([{ v: 'kept' }]);
  });

  it('keeps outside statements out of an open transaction', async () => {
    const exec = setup();
    await exec.query('CREATE TABLE t (v TEXT)', []);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const tx = exec
      .transaction(async (t) => {
        await t.query(`INSERT INTO t VALUES ('tx')`, []);
        await gate;
        throw new Error('rollback');
      })
      .catch(() => undefined);
    const outside = exec.query(`INSERT INTO t VALUES ('outside')`, []);
    await new Promise((r) => setTimeout(r, 10));
    release();
    await Promise.all([tx, outside]);
    const rows = await exec.query('SELECT v FROM t', []);
    expect(rows.rows).toEqual([{ v: 'outside' }]);
  });

  it('enforces foreign keys by default and can leave them off', async () => {
    const on = sqlite(new Database(':memory:')).executor;
    const off = sqlite(new Database(':memory:'), { foreignKeys: false }).executor;
    expect((await on.query('PRAGMA foreign_keys', [])).rows[0]!.foreign_keys).toBe(1);
    expect((await off.query('PRAGMA foreign_keys', [])).rows[0]!.foreign_keys).toBe(0);
  });

  it('converts parameters', () => {
    const out = toSqliteParams([undefined, false, new Date('2024-01-02T00:00:00Z'), { a: 1 }, new Uint8Array([1])], true);
    expect(out.slice(0, 4)).toEqual([null, 0, '2024-01-02T00:00:00.000Z', '{"a":1}']);
    expect(Buffer.isBuffer(out[4])).toBe(true);
    expect(smallInt(5n)).toBe(5);
    expect(smallInt(2n ** 60n)).toBe(2n ** 60n);
  });
});

describe('libsql executor', () => {
  it('runs queries and transactions on a local database', async () => {
    const { createClient } = await import('@libsql/client');
    const { executor } = libsql(createClient({ url: ':memory:' }));
    await executor.query('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT, b BLOB)', []);
    const ins = await executor.query('INSERT INTO t (v, b) VALUES (?, ?)', ['a', new Uint8Array([7])]);
    expect(ins.rowsAffected).toBe(1);
    expect(ins.insertId).toBe(1);
    await expect(
      executor.transaction(async (tx) => {
        await tx.query(`INSERT INTO t (v) VALUES ('lost')`, []);
        throw new Error('nope');
      }),
    ).rejects.toThrow('nope');
    const rows = await executor.query('SELECT id, v, b FROM t', []);
    expect(rows.rows).toEqual([{ id: 1, v: 'a', b: new Uint8Array([7]) }]);
    await executor.close?.();
  });
});

describe('d1 executor', () => {
  function fakeD1() {
    const calls: { sql: string; params: unknown[] }[] = [];
    const statement = (sql: string, params: unknown[] = []): any => ({
      bind: (...values: unknown[]) => statement(sql, values),
      all: async () => {
        calls.push({ sql, params });
        return { results: [{ v: new Uint8Array([1]).buffer }], success: true, meta: { changes: 2, last_row_id: 9 } };
      },
      sql,
      params,
    });
    const db = {
      prepare: (sql: string) => statement(sql),
      batch: async (list: any[]) => {
        calls.push({ sql: `batch:${list.map((s) => s.sql).join(';')}`, params: list.flatMap((s) => s.params) });
        return list.map(() => ({ results: [], meta: { changes: 1 } }));
      },
    };
    return { db, calls };
  }

  it('binds converted parameters and reads meta', async () => {
    const { db, calls } = fakeD1();
    const { executor } = d1(db);
    const res = await executor.query('INSERT INTO t VALUES (?, ?, ?)', [true, 2n ** 60n, 3n]);
    expect(calls[0]!.params).toEqual([1, '1152921504606846976', 3]);
    expect(res.rowsAffected).toBe(2);
    expect(res.insertId).toBe(9);
    expect(res.rows[0]!.v).toEqual(new Uint8Array([1]));
  });

  it('runs batches atomically and refuses callback transactions by default', async () => {
    const { db, calls } = fakeD1();
    const { executor } = d1(db);
    const results = await executor.batch([
      { sql: 'A', params: [1] },
      { sql: 'B', params: [] },
    ]);
    expect(results).toHaveLength(2);
    expect(calls[0]!.sql).toBe('batch:A;B');
    const error = await executor.transaction(async () => 1).catch((e: unknown) => e);
    expect(isKastorError(error, 'UNSUPPORTED')).toBe(true);
    expect((error as { hint: string }).hint).toContain('$transaction([q1, q2])');
  });

  it('runs callbacks without atomicity when asked to', async () => {
    const { db, calls } = fakeD1();
    const { executor } = d1(db, { transactions: 'sequential' });
    const value = await executor.transaction(async (tx) => {
      expect(tx.inTransaction).toBe(true);
      await tx.query('X', []);
      return tx.transaction(async (inner) => (await inner.query('Y', [])).rowsAffected);
    });
    expect(value).toBe(2);
    expect(calls.map((c) => c.sql)).toEqual(['X', 'Y']);
  });
});

describe('sqlite values', () => {
  const column = (type: string, extra: object = {}) => ({ name: 'c', type, nullable: true, ...extra }) as never;

  it('encodes for SQLite storage', () => {
    expect(encodeSqlite(true, column('boolean'))).toBe(1);
    expect(encodeSqlite(new Date('2024-01-02T03:04:05.678Z'), column('datetime'))).toBe('2024-01-02T03:04:05.678Z');
    expect(encodeSqlite({ a: 1 }, column('json'))).toBe('{"a":1}');
    expect(encodeSqlite(5n, column('bigint'))).toBe(5n);
  });

  it('decodes, restoring decimal scale', () => {
    expect(decodeSqlite(1.5, column('decimal', { scale: 2 }), 'row')).toBe('1.50');
    expect(decodeSqlite(2, column('decimal', { scale: 2 }), 'row')).toBe('2.00');
    expect(decodeSqlite('1.5', column('decimal', { scale: 2 }), 'json')).toBe('1.50');
    expect(decodeSqlite(3, column('decimal', { scale: 0 }), 'row')).toBe('3');
    expect(decodeSqlite(1.123, column('decimal'), 'row')).toBe('1.123');
    expect(decodeSqlite(1, column('boolean'), 'json')).toBe(true);
    expect(decodeSqlite('{"a":1}', column('json'), 'row')).toEqual({ a: 1 });
    expect(decodeSqlite(42, column('json'), 'row')).toBe(42);
    expect(decodeSqlite('2024-01-02 03:04:05', column('datetime'), 'row')).toEqual(new Date('2024-01-02T03:04:05Z'));
    expect(decodeSqlite('01ff', column('bytes'), 'json')).toEqual(new Uint8Array([1, 255]));
    const bytes = decodeSqlite(Buffer.from([1]), column('bytes'), 'row') as Uint8Array;
    expect(bytes.constructor).toBe(Uint8Array);
    expect(decodeSqlite(null, column('int'), 'row')).toBeNull();
  });

  it('matches text case sensitively without LIKE', () => {
    const render = (mode: 'contains' | 'startsWith' | 'endsWith', raw: string) =>
      sqliteTextMatch(text('"c"'), mode, q`${{ value: raw }}`, false, raw)!.render(() => '?');
    expect(render('contains', 'a%')).toEqual({ sql: 'instr("c", ?) > 0', params: ['a%'] });
    expect(render('startsWith', 'ab')).toEqual({ sql: 'substr("c", 1, length(?)) = ?', params: ['ab', 'ab'] });
    expect(render('endsWith', 'ab')).toEqual({ sql: 'substr("c", -length(?)) = ?', params: ['ab', 'ab'] });
    expect(render('endsWith', '')).toEqual({ sql: '"c" IS NOT NULL', params: [] });
    expect(sqliteTextMatch(text('"c"'), 'contains', q`${{ value: 'x' }}`, true, 'x')).toBeNull();
  });
});

describe('sqlite errors', () => {
  it('maps the messages every driver shares', () => {
    const unique = mapSqliteError(Object.assign(new Error('UNIQUE constraint failed: users.email, users.org'), { code: 'SQLITE_CONSTRAINT_UNIQUE' }));
    expect(isKastorError(unique, 'UNIQUE_VIOLATION')).toBe(true);
    expect(unique!.message).toContain('email, org');
    expect(isKastorError(mapSqliteError(new Error('D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT')), 'FOREIGN_KEY_VIOLATION')).toBe(true);
    expect(isKastorError(mapSqliteError(new Error('NOT NULL constraint failed: users.name')), 'NOT_NULL_VIOLATION')).toBe(true);
    expect(isKastorError(mapSqliteError(new Error('CHECK constraint failed: users_role')), 'CHECK_VIOLATION')).toBe(true);
    expect(isKastorError(mapSqliteError(new Error('database is locked')), 'TIMEOUT')).toBe(true);
    expect(isKastorError(mapSqliteError(new Error('unable to open database file')), 'CONNECTION_FAILED')).toBe(true);
    expect(mapSqliteError(new Error('no such table: x'))).toBeNull();
    expect(mapSqliteError('nope')).toBeNull();
  });

  it('maps real better-sqlite3 errors', async () => {
    const { executor } = sqlite(new Database(':memory:'));
    await executor.query('CREATE TABLE t (id INTEGER PRIMARY KEY, e TEXT UNIQUE NOT NULL)', []);
    await executor.query(`INSERT INTO t (e) VALUES ('a')`, []);
    const error = await executor.query(`INSERT INTO t (e) VALUES ('a')`, []).catch((e: unknown) => e);
    expect(isKastorError(mapSqliteError(error), 'UNIQUE_VIOLATION')).toBe(true);
  });
});
