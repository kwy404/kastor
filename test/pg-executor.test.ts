import { describe, expect, it } from 'vitest';
import { isKastorError } from '../src/core/errors';
import { cockroach } from '../src/cockroach';
import { decodePg, encodePg } from '../src/dialects/postgres/dialect';
import { mapPgError } from '../src/dialects/postgres/errors';
import { Lock, beginStatement } from '../src/dialects/postgres/lock';
import { JsonParam, normalizeRows } from '../src/dialects/postgres/values';
import { postgres, postgresJs } from '../src/postgres';

/** A fake pg connection that records statements. */
function fakeConnection(log: string[], fail?: (sql: string) => boolean) {
  return {
    async query(text: string, values?: unknown[]) {
      log.push(values && values.length ? `${text} ${JSON.stringify(values)}` : text);
      if (fail?.(text)) throw Object.assign(new Error('boom'), { code: '23505', detail: 'Key (email)=(a) already exists.' });
      return { rows: [{ ok: 1 }], rowCount: 1, fields: [{ name: 'ok', dataTypeID: 23 }] };
    },
  };
}

function fakePool(log: string[], fail?: (sql: string) => boolean) {
  const released: unknown[] = [];
  const pool = {
    totalCount: 0,
    idleCount: 0,
    ...fakeConnection(log, fail),
    async connect() {
      log.push('connect');
      return { ...fakeConnection(log, fail), release: (err?: unknown) => released.push(err ?? 'ok') };
    },
    async end() {
      log.push('end');
    },
  };
  return { pool, released };
}

describe('pg executor', () => {
  it('runs a transaction on one pooled client and releases it', async () => {
    const log: string[] = [];
    const { pool, released } = fakePool(log);
    const { executor } = postgres(pool);
    const value = await executor.transaction(async (tx) => {
      expect(tx.inTransaction).toBe(true);
      await tx.query('SELECT $1', [1]);
      await tx.transaction(async (inner) => inner.query('SELECT 2', []));
      return 'done';
    }, { isolationLevel: 'serializable' });
    expect(value).toBe('done');
    expect(log).toEqual([
      'connect',
      'BEGIN ISOLATION LEVEL SERIALIZABLE',
      'SELECT $1 [1]',
      'SAVEPOINT kastor_sp_1',
      'SELECT 2',
      'RELEASE SAVEPOINT kastor_sp_1',
      'COMMIT',
    ]);
    expect(released).toEqual(['ok']);
    await executor.close?.();
    expect(log.at(-1)).toBe('end');
  });

  it('rolls back when the callback throws', async () => {
    const log: string[] = [];
    const { pool, released } = fakePool(log);
    const { executor } = postgres(pool);
    await expect(
      executor.transaction(async (tx) => {
        await tx.query('INSERT 1', []);
        throw new Error('nope');
      }),
    ).rejects.toThrow('nope');
    expect(log).toEqual(['connect', 'BEGIN', 'INSERT 1', 'ROLLBACK']);
    expect(released).toEqual(['ok']);
  });

  it('queues statements behind a transaction on a single Client', async () => {
    const log: string[] = [];
    const { executor } = postgres(fakeConnection(log));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const tx = executor.transaction(async (t) => {
      await t.query('A', []);
      await gate;
      await t.query('B', []);
    });
    const outside = executor.query('OUTSIDE', []);
    await new Promise((r) => setTimeout(r, 10));
    release();
    await Promise.all([tx, outside]);
    expect(log).toEqual(['BEGIN', 'A', 'B', 'COMMIT', 'OUTSIDE']);
  });

  it('sends json as text, bigint as text and Uint8Array as Buffer', async () => {
    const seen: unknown[][] = [];
    const conn = {
      async query(_text: string, values?: unknown[]) {
        seen.push(values ?? []);
        return { rows: [], rowCount: 0 };
      },
    };
    const { executor } = postgres(conn);
    await executor.query('X', [new JsonParam('{"a":1}'), 5n, new Uint8Array([1, 2])]);
    expect(seen[0]![0]).toBe('{"a":1}');
    expect(seen[0]![1]).toBe('5');
    expect(Buffer.isBuffer(seen[0]![2])).toBe(true);
  });

  it('rejects things that are not a Postgres driver', () => {
    expect(() => postgres({} as never)).toThrow(/did not receive a supported Postgres driver/);
  });
});

describe('postgres.js executor', () => {
  function fakeSql(log: string[]) {
    const unsafe = async (text: string, params?: unknown[]) => {
      log.push(params && params.length ? `${text} ${JSON.stringify(params)}` : text);
      return Object.assign([{ d: new Date(Date.UTC(2024, 0, 2)) }], { count: 1, columns: [{ name: 'd', type: 1082 }] });
    };
    const makeTx = (): any => ({
      unsafe,
      json: (v: unknown) => ({ json: v }),
      savepoint: async (fn: (tx: unknown) => unknown) => {
        log.push('savepoint');
        return fn(makeTx());
      },
    });
    const sql = Object.assign(() => undefined, {
      unsafe,
      json: (v: unknown) => ({ json: v }),
      begin: async (...args: unknown[]) => {
        const fn = args.at(-1) as (tx: unknown) => unknown;
        log.push(args.length === 2 ? `begin ${String(args[0])}` : 'begin');
        return fn(makeTx());
      },
      end: async () => {
        log.push('end');
      },
    });
    return sql;
  }

  it('maps rows, counts and parsed json parameters', async () => {
    const log: string[] = [];
    const { executor } = postgresJs(fakeSql(log) as never);
    const res = await executor.query('SELECT $1', [new JsonParam('{"a":1}')]);
    expect(res).toEqual({ rows: [{ d: '2024-01-02' }], rowsAffected: 1 });
    expect(log[0]).toBe('SELECT $1 [{"json":{"a":1}}]');
  });

  it('uses sql.begin with the isolation level and savepoints when nested', async () => {
    const log: string[] = [];
    const { executor } = postgres(fakeSql(log) as never);
    await executor.transaction(async (tx) => {
      await tx.transaction(async (inner) => inner.query('Q', []));
    }, { isolationLevel: 'repeatable read' });
    expect(log).toEqual(['begin isolation level repeatable read', 'savepoint', 'Q']);
    const { executor: crdb } = cockroach(fakeSql(log) as never);
    await crdb.close?.();
    expect(log.at(-1)).toBe('end');
  });
});

describe('pg values', () => {
  it('turns driver dates into plain strings and naive timestamps into UTC', () => {
    const local = new Date(2024, 0, 2);
    const naive = new Date(2024, 0, 2, 3, 4, 5, 678);
    const rows = normalizeRows([{ d: local, ts: naive, n: 1 }], [
      { name: 'd', dataTypeID: 1082 },
      { name: 'ts', dataTypeID: 1114 },
      { name: 'n', dataTypeID: 23 },
    ]);
    expect(rows[0]).toEqual({ d: '2024-01-02', ts: new Date('2024-01-02T03:04:05.678Z'), n: 1 });
  });

  it('encodes per column type', () => {
    expect(encodePg({ a: 1 }, { name: 'j', type: 'json', nullable: false })).toEqual(new JsonParam('{"a":1}'));
    expect(encodePg(10n, { name: 'b', type: 'bigint', nullable: false })).toBe('10');
    expect(encodePg(true, { name: 'b', type: 'boolean', nullable: false })).toBe(true);
    expect(encodePg(new Date('2024-01-02T10:00:00Z'), { name: 'd', type: 'date', nullable: false })).toMatch(/^2024-01-0[12]$/);
    expect(encodePg(null, undefined)).toBeNull();
  });

  it('decodes rows and aggregated json', () => {
    const bytes = decodePg(Buffer.from([1, 2]), { name: 'b', type: 'bytes', nullable: false }, 'row');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect((bytes as Uint8Array).constructor).toBe(Uint8Array);
    expect(decodePg('0102', { name: 'b', type: 'bytes', nullable: false }, 'json')).toEqual(new Uint8Array([1, 2]));
    expect(decodePg('9007199254740993', { name: 'b', type: 'bigint', nullable: false }, 'json')).toBe(9007199254740993n);
    expect(decodePg('2024-01-02T03:04:05.678+00:00', { name: 'd', type: 'datetime', nullable: false }, 'json')).toEqual(new Date('2024-01-02T03:04:05.678Z'));
    expect(decodePg('7', { name: 'i', type: 'int', nullable: false }, 'row')).toBe(7);
    expect(decodePg({ a: 1 }, { name: 'j', type: 'json', nullable: false }, 'row')).toEqual({ a: 1 });
  });
});

describe('pg errors', () => {
  it('maps SQLSTATE codes', () => {
    const unique = mapPgError({ code: '23505', constraint: 'users_email_key', detail: 'Key (email)=(a@x.io) already exists.' });
    expect(isKastorError(unique, 'UNIQUE_VIOLATION')).toBe(true);
    expect(unique!.message).toContain('email');
    expect(isKastorError(mapPgError({ code: '23503', constraint: 'fk' }), 'FOREIGN_KEY_VIOLATION')).toBe(true);
    expect(isKastorError(mapPgError({ code: '23502', column: 'name' }), 'NOT_NULL_VIOLATION')).toBe(true);
    expect(isKastorError(mapPgError({ code: '23514', constraint: 'chk' }), 'CHECK_VIOLATION')).toBe(true);
    expect(isKastorError(mapPgError({ code: '40001' }), 'SERIALIZATION_FAILURE')).toBe(true);
    expect(isKastorError(mapPgError({ code: '40P01' }), 'DEADLOCK')).toBe(true);
    expect(isKastorError(mapPgError({ code: '57014' }), 'TIMEOUT')).toBe(true);
    expect(isKastorError(mapPgError({ code: '08006' }), 'CONNECTION_FAILED')).toBe(true);
    expect(isKastorError(mapPgError({ code: 'ECONNREFUSED' }), 'CONNECTION_FAILED')).toBe(true);
    expect(mapPgError({ code: '42P01' })).toBeNull();
    expect(mapPgError(new Error('plain'))).toBeNull();
    expect(mapPgError(null)).toBeNull();
  });
});

describe('lock', () => {
  it('runs holders one after another, even after a failure', async () => {
    const lock = new Lock();
    const order: string[] = [];
    const a = lock.run(async () => {
      await new Promise((r) => setTimeout(r, 5));
      order.push('a');
      throw new Error('a failed');
    });
    const b = lock.run(() => {
      order.push('b');
      return 'b';
    });
    await expect(a).rejects.toThrow('a failed');
    await expect(b).resolves.toBe('b');
    expect(order).toEqual(['a', 'b']);
  });

  it('validates isolation levels', () => {
    expect(beginStatement()).toBe('BEGIN');
    expect(beginStatement('read committed')).toBe('BEGIN ISOLATION LEVEL READ COMMITTED');
    expect(() => beginStatement('chaos; DROP TABLE x')).toThrow(/Unknown isolation level/);
  });
});
