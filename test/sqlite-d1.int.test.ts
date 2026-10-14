/**
 * Cloudflare D1 through a local stand-in: a binding with D1's API
 * (prepare, bind, all, batch) over better-sqlite3 that mimics what D1 hands
 * back (plain JS numbers for every INTEGER, BLOBs as arrays of numbers,
 * `meta.changes` and `meta.last_row_id`, atomic batches, no BEGIN).
 */
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { d1, type D1DatabaseLike, type D1PreparedStatementLike, type D1ResultLike } from '../src/d1';
import { kastor, isKastorError } from '../src/index';
import { fixture, runConformance } from './helpers/conformance';

function fakeD1(): D1DatabaseLike & { db: Database.Database } {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const toD1Value = (value: unknown) => (Buffer.isBuffer(value) ? Array.from(value) : value);
  const execute = (sql: string, params: unknown[]): D1ResultLike => {
    if (/^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(sql)) throw new Error('D1_ERROR: transactions are not supported, use batch()');
    for (const p of params) if (typeof p === 'bigint' || p === undefined) throw new Error(`D1_TYPE_ERROR: Type '${typeof p}' not supported for value`);
    const values = params.map((p) => (p instanceof ArrayBuffer ? Buffer.from(p) : p));
    const stmt = db.prepare(sql);
    if (stmt.reader) {
      const rows = stmt.all(...values) as Record<string, unknown>[];
      return { results: rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, toD1Value(v)]))), success: true, meta: { changes: 0 } };
    }
    const info = stmt.run(...values);
    return { results: [], success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } };
  };
  const statement = (sql: string, params: unknown[] = []): D1PreparedStatementLike & { sql: string; params: unknown[] } => ({
    sql,
    params,
    bind: (...values: unknown[]) => statement(sql, values),
    all: async () => execute(sql, params),
  });
  return {
    db,
    prepare: (sql) => statement(sql),
    async batch(list) {
      const run = db.transaction(() => list.map((s) => execute((s as never as { sql: string }).sql, (s as never as { params: unknown[] }).params)));
      return run();
    },
  };
}

runConformance(
  'sqlite (Cloudflare D1 stand-in)',
  () => ({ adapter: d1(fakeD1(), { transactions: 'sequential' }) }),
  // D1 cannot roll back a callback transaction: that test needs real BEGIN/ROLLBACK.
  { skip: ['transactions commit, roll back and batch'] },
);

describe('d1 adapter', () => {
  it('refuses callback transactions by default and points at batches', async () => {
    const adapter = d1(fakeD1());
    const db = kastor({ adapter, schema: fixture.schema, relations: fixture.relations });
    const error = await db.$transaction(async (tx) => tx.users.count()).catch((e: unknown) => e);
    expect(isKastorError(error, 'UNSUPPORTED')).toBe(true);
  });

  it('keeps 64 bit integers exact although D1 returns doubles', async () => {
    const binding = fakeD1();
    const { executor, dialect } = d1(binding);
    binding.db.exec('CREATE TABLE big (id INTEGER PRIMARY KEY AUTOINCREMENT, n BIGINT NOT NULL)');
    const schema = { tables: [{ name: 'big', columns: [{ name: 'id', type: 'int' as const, nullable: false, default: { kind: 'autoincrement' as const } }, { name: 'n', type: 'bigint' as const, nullable: false }], primaryKey: ['id'], indexes: [], foreignKeys: [] }] };
    const created = await dialect.execute({ kind: 'create', table: 'big', data: { n: 9007199254740993n }, returning: [{ column: 'id', as: 'id' }, { column: 'n', as: 'n' }] }, schema, executor);
    expect(created).toEqual({ id: 1, n: 9007199254740993n });
  });

  it('runs batches atomically', async () => {
    const binding = fakeD1();
    const { executor } = d1(binding);
    binding.db.exec('CREATE TABLE t (v TEXT UNIQUE)');
    await expect(
      executor.batch([
        { sql: 'INSERT INTO t (v) VALUES (?)', params: ['a'] },
        { sql: 'INSERT INTO t (v) VALUES (?)', params: ['a'] },
      ]),
    ).rejects.toThrow(/UNIQUE/);
    expect(binding.db.prepare('SELECT count(*) AS n FROM t').get()).toEqual({ n: 0 });
  });
});
