/**
 * `$transaction([...])` on executors with an atomic `batch` (Cloudflare D1):
 * single statement queries go out as one batch; anything else falls back to
 * `executor.transaction`, unchanged for every other dialect.
 */
import { describe, expect, it } from 'vitest';
import { isKastorError, KastorError, kastor, type Adapter, type BatchExecutor, type CompiledQuery } from '../src/index';
import { fixture, resetWithDdl } from './helpers/conformance';
import { memorySqlite } from './helpers/sqlite-memory';

async function setup() {
  const mem = memorySqlite();
  await resetWithDdl(mem.adapter);
  const batches: CompiledQuery[][] = [];
  const base = mem.adapter.executor;
  const executor: BatchExecutor = {
    query: (sql, params) => base.query(sql, params),
    async transaction() {
      throw new KastorError('UNSUPPORTED', 'No interactive transactions here.', { hint: 'Use a batch.' });
    },
    async batch(statements) {
      batches.push(statements);
      // Atomic like D1: all statements in one SQLite transaction.
      mem.db.exec('BEGIN');
      try {
        const out = [];
        for (const s of statements) out.push(await base.query(s.sql, s.params));
        mem.db.exec('COMMIT');
        return out;
      } catch (error) {
        mem.db.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const adapter: Adapter = { dialect: mem.adapter.dialect, executor };
  const db = kastor({ adapter, schema: fixture.schema, relations: fixture.relations });
  return { db, batches, mem };
}

describe('$transaction([...]) with executor.batch', () => {
  it('sends single statement queries as one atomic batch and shapes the results', async () => {
    const { db, batches } = await setup();
    const ada = await db.users.create({ data: { email: 'ada@acme.com' } }).then((u) => u.id);
    const [tag, user, many, counted, list, first, stats, groups, upserted, gone] = await db.$transaction([
      db.tags.create({ data: { name: 'math' }, select: { name: true } }),
      db.users.findUnique({ where: { id: ada }, select: { email: true } }),
      db.tags.createMany({ data: [{ name: 'a' }, { name: 'b' }] }),
      db.tags.count(),
      db.tags.findMany({ orderBy: { name: 'desc' }, take: -2, select: { name: true } }),
      db.tags.findFirst({ where: { name: 'zzz' } }),
      db.users.aggregate({ _count: true, _max: { id: true } }),
      db.users.groupBy({ by: ['role'], _count: { _all: true } }),
      db.users.upsert({ where: { email: 'ada@acme.com' }, create: { email: 'ada@acme.com' }, update: { name: 'Ada' }, select: { name: true } }),
      db.tags.deleteMany({ where: { name: 'b' } }),
    ]);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(10);
    expect(tag).toEqual({ name: 'math' });
    expect(user).toEqual({ email: 'ada@acme.com' });
    expect(many).toEqual({ count: 2 });
    expect(counted).toBe(3);
    expect(list).toEqual([{ name: 'b' }, { name: 'a' }]);
    expect(first).toBeNull();
    expect(stats).toEqual({ _count: 1, _max: { id: ada } });
    expect(groups).toEqual([{ role: 'user', _count: { _all: 1 } }]);
    expect(upserted).toEqual({ name: 'Ada' });
    expect(gone).toEqual({ count: 1 });
    expect(await db.tags.count()).toBe(2);
  });

  it('rolls the whole batch back when one statement fails', async () => {
    const { db, batches } = await setup();
    const error = await db
      .$transaction([db.tags.create({ data: { name: 'once' } }), db.tags.count(), db.tags.create({ data: { name: 'once' } })])
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(batches).toHaveLength(1);
    expect(isKastorError(error, 'UNIQUE_VIOLATION')).toBe(true);
    expect(await db.tags.count()).toBe(0);
  });

  it('falls back to executor.transaction when a query needs several statements', async () => {
    const { db, batches } = await setup();
    const nested = db.users.create({ data: { email: 'n@x.y', posts: { create: { title: 'p' } } } });
    const error = await db.$transaction([db.tags.count(), nested]).then(
      () => null,
      (e: unknown) => e,
    );
    expect(batches).toHaveLength(0);
    expect(isKastorError(error, 'UNSUPPORTED')).toBe(true);
    const single = await db.$transaction([db.users.update({ where: { id: 1 }, data: { name: 'x' } })]).catch((e: unknown) => e);
    expect(isKastorError(single, 'UNSUPPORTED')).toBe(true);
    expect(batches).toHaveLength(0);
  });

  it('keeps executors without batch on the transaction path', async () => {
    const mem = memorySqlite();
    await resetWithDdl(mem.adapter);
    const db = kastor({ adapter: mem.adapter, schema: fixture.schema });
    const [a, n] = await db.$transaction([db.tags.create({ data: { name: 't' } }), db.tags.count()]);
    expect(a.name).toBe('t');
    expect(n).toBe(1);
  });
});
