import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineConfig, defineSeed, isKastorError, kastor, KastorQuery, sql, type QueryEvent } from '../src/index';
import { fixture, type FixtureDb, resetWithDdl, seed } from './helpers/conformance';
import { memorySqlite, type MemoryDb } from './helpers/sqlite-memory';

async function codeOf(p: PromiseLike<unknown> | (() => unknown)): Promise<string> {
  try {
    await (typeof p === 'function' ? (p as () => unknown)() : p);
  } catch (e) {
    if (isKastorError(e)) return e.code;
    throw e;
  }
  return 'NO_ERROR';
}

describe('client', () => {
  let mem: MemoryDb;
  let db: FixtureDb;
  let events: QueryEvent[];

  beforeEach(async () => {
    mem = memorySqlite();
    await resetWithDdl(mem.adapter);
    events = [];
    db = kastor({ adapter: mem.adapter, schema: fixture.schema, relations: fixture.relations, log: (e) => events.push(e) });
  });

  afterEach(async () => {
    await db.$disconnect();
  });

  it('runs queries lazily, once, when awaited', async () => {
    const query = db.users.count();
    expect(query).toBeInstanceOf(KastorQuery);
    expect(String(query)).toBe('[object KastorQuery]');
    expect(events).toHaveLength(0);
    expect(await query).toBe(0);
    expect(await query).toBe(0);
    expect(events).toHaveLength(1);
    await query.then(
      (n) => expect(n).toBe(0),
      () => undefined,
    );
    await db.users
      .findUniqueOrThrow({ where: { id: 1 } })
      .catch((e: unknown) => expect(isKastorError(e, 'NOT_FOUND')).toBe(true))
      .finally(() => undefined);
  });

  it('logs statements with timings and errors', async () => {
    await db.users.findMany({ where: { email: 'x@y.z' } });
    expect(events[0]).toMatchObject({ params: ['x@y.z'] });
    expect(events[0]!.sql).toMatch(/^SELECT/);
    expect(typeof events[0]!.durationMs).toBe('number');
    await db.$execute`DELETE FROM no_such_table`.catch(() => undefined);
    expect(events.at(-1)!.error).toBeDefined();
  });

  it('logs to the console with log: true', async () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (line: string) => lines.push(line);
    try {
      const loud = kastor({ adapter: mem.adapter, schema: fixture.schema, log: true });
      await loud.tags.findMany({ where: { id: 5n as never } }).catch(() => undefined);
      await loud.tags.count();
    } finally {
      console.log = original;
    }
    expect(lines.some((l) => l.startsWith('[kastor] SELECT COUNT(*)'))).toBe(true);
  });

  it('exposes the schema, the dialect and the IR of a query', () => {
    expect(db.$schema.tables.map((tb) => tb.name)).toContain('users');
    expect(db.$dialect.name).toBe('sqlite');
    const [ir] = db.users.findMany({ where: { id: 1 } }).toIR();
    expect(ir).toMatchObject({ kind: 'findMany', table: 'users', read: { where: { kind: 'compare', column: 'id', op: 'eq', value: 1 } } });
    expect(db.users.count({ select: { _all: true } }).toIR()[0]!.kind).toBe('aggregate');
    expect(db.users.upsert({ where: { email: 'a@b.c' }, create: { email: 'a@b.c' }, update: {}, include: { posts: true } }).toIR()[0]!.kind).toBe('findUnique');
    expect(db.comments.delete({ where: { id: 1 } }).toIR()[0]!.kind).toBe('update');
    expect(db.comments.deleteMany().toIR()[0]!.kind).toBe('updateMany');
    expect(db.comments.hardDelete({ where: { id: 1 } }).toIR()[0]!.kind).toBe('delete');
    expect(db.comments.hardDeleteMany().toIR()[0]!.kind).toBe('deleteMany');
    expect(db.comments.restore().toIR()[0]!.kind).toBe('updateMany');
    expect(db.tags.delete({ where: { id: 1 } }).toIR()[0]!.kind).toBe('delete');
    expect(db.tags.deleteMany().toIR()[0]!.kind).toBe('deleteMany');
    expect(db.tags.createMany({ data: [{ name: 'a' }] }).toIR()[0]!.kind).toBe('createMany');
    expect(db.tags.createManyAndReturn({ data: [{ name: 'a' }] }).toIR()[0]!.kind).toBe('createMany');
    expect(db.tags.updateMany({ data: { name: 'b' } }).toIR()[0]!.kind).toBe('updateMany');
    expect(db.tags.update({ where: { id: 1 }, data: { name: 'b' } }).toIR()[0]!.kind).toBe('update');
    expect(db.posts.groupBy({ by: 'authorId', _count: true }).toIR()[0]!.kind).toBe('groupBy');
    expect(db.posts.aggregate({ _count: true }).toIR()[0]!.kind).toBe('aggregate');
    expect(db.posts.findPage({ first: 2 }).toIR()[0]!.kind).toBe('findMany');
    expect(db.posts.findFirstOrThrow().toIR()[0]!.kind).toBe('findFirst');
    expect(db.posts.findUniqueOrThrow({ where: { id: '00000000-0000-4000-8000-000000000000' } }).toIR()[0]!.kind).toBe('findUnique');
    expect(db.users.create({ data: { email: 'q@q.q' } }).toSQL()[0]!.sql).toMatch(/^INSERT INTO "users"/);
    expect(db.$sql`SELECT 1`.toSQL()).toEqual([]);
  });

  it('rejects bad arguments with clear errors', async () => {
    expect(await codeOf(db.users.findMany({ select: { id: true }, include: { posts: true } } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.findMany({ wher: {} } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.findMany({ where: { emial: 'x' } } as never))).toBe('UNKNOWN_FIELD');
    expect(await codeOf(db.users.findMany({ where: { email: { like: 'x' } } } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.findMany({ where: { age: { contains: 'x' } } } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.findMany({ where: { posts: { published: true } } } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.findMany({ where: { age: { in: 3 } } } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.findMany({ where: { age: { gt: null } } } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.findMany({ where: { email: { contains: 'x', mode: 'loud' } } } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.findMany({ where: { OR: { id: 1 } } } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.findMany({ where: 'x' } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.findMany({ include: { postz: true } } as never))).toBe('UNKNOWN_RELATION');
    expect(await codeOf(db.users.findMany({ include: { posts: { cursor: {} } } } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.findMany({ include: { profile: { take: 1 } } } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.findMany({ select: { id: 1 } } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.findMany({ take: 1.5 }))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.findMany({ skip: -1 }))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.findMany({ orderBy: { id: 'up' } } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.findMany({ orderBy: { posts: 'asc' } } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.findMany({ orderBy: { age: { sort: 'asc', nulls: 'middle' } } } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.findMany({ distinct: ['nope'] } as never))).toBe('UNKNOWN_FIELD');
    expect(await codeOf(db.users.findMany({ include: { _count: { select: { profile: true } } } } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.findMany({ include: { _count: 'all' } } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.findMany({ cursor: { id: 1 }, orderBy: { posts: { _count: 'asc' } } }))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.findPage({ first: 0 }))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.findPage({ first: 1, after: 'a', before: 'b' }))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.findPage({ first: 1, after: 3 as never }))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.findUnique(undefined as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.findUnique({ where: 'x' } as never))).toBe('MISSING_UNIQUE_FIELD');
    expect(await codeOf(db.users.create({ data: 'x' } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.create({ data: { email: 'a@b.c', posts: 'x' } } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.create({ data: { email: 'a@b.c', posts: { attach: {} } } } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.create({ data: { email: null } } as never))).toBe('VALIDATION_FAILED');
    expect(await codeOf(db.users.createMany({ data: { email: 'x' } } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.createMany({ data: [{ email: 'x', posts: { create: [] } }] } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.createManyAndReturn({ data: [], select: { posts: true } } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.createManyAndReturn({ data: 'x' } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.update({ where: { id: 1 }, data: { email: { increment: 1 } } } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.update({ where: { id: 1 }, data: { age: { increment: 'x' } } } as never))).toBe('VALIDATION_FAILED');
    expect(await codeOf(db.users.update({ where: { id: 1 }, data: { email: null } } as never))).toBe('VALIDATION_FAILED');
    expect(await codeOf(db.users.update({ where: { id: 1 }, data: { email: { set: null } } } as never))).toBe('VALIDATION_FAILED');
    expect(await codeOf(db.users.updateMany({ data: { posts: { create: {} } } } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.aggregate({ _sum: { email: true } } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.aggregate({ _sum: { nope: true } } as never))).toBe('UNKNOWN_FIELD');
    expect(await codeOf(db.users.aggregate({ _min: true } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.aggregate({}))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.count({ select: 'x' } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.count({ select: { nope: true } } as never))).toBe('UNKNOWN_FIELD');
    expect(await codeOf(db.users.groupBy({ by: [] } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.groupBy({ by: ['nope'] } as never))).toBe('UNKNOWN_FIELD');
    expect(await codeOf(db.users.groupBy({ by: ['role'], orderBy: { email: 'asc' } } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.groupBy({ by: ['role'], orderBy: { _count: { _all: 'up' } } } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.groupBy({ by: ['role'], having: { _count: {} } } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.groupBy({ by: ['role'], having: { age: { _median: { gt: 1 } } } } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.groupBy({ by: ['role'], having: { age: { _avg: { near: 1 } } } } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.groupBy({ by: ['role'], having: { age: { _avg: { equals: null } } } } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.restore())).toBe('UNSUPPORTED');
    expect(await codeOf(db.users.hardDelete({ where: { id: 1 } }))).toBe('UNSUPPORTED');
    expect(await codeOf(db.users.hardDeleteMany())).toBe('UNSUPPORTED');
    expect(await codeOf(() => db.users.restore().toSQL())).toBe('UNSUPPORTED');
    expect(await codeOf(db.$transaction('x' as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.$transaction([Promise.resolve(1)] as never))).toBe('INVALID_ARGUMENT');
  });

  it('rejects bad nested writes', async () => {
    const ids = await seed(db);
    expect(await codeOf(db.posts.update({ where: { id: ids.engine }, data: { tags: { push: [] } } } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.update({ where: { id: ids.ada }, data: { profile: { set: [] } } } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.posts.update({ where: { id: ids.engine }, data: { author: { disconnect: true } } }))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.posts.update({ where: { id: ids.engine }, data: { comments: { update: { data: {} } } } } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.posts.update({ where: { id: ids.engine }, data: { comments: { updateMany: { where: {} } } } } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.update({ where: { id: ids.ada }, data: { posts: { disconnect: { id: ids.engine } } } }))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.update({ where: { id: ids.ada }, data: { posts: { connect: { id: '00000000-0000-4000-8000-000000000000' } } } }))).toBe('NOT_FOUND');
    expect(await codeOf(db.users.update({ where: { id: ids.ada }, data: { posts: { delete: { id: ids.kernel } } } }))).toBe('NOT_FOUND');
    expect(await codeOf(db.users.update({ where: { id: ids.ada }, data: { posts: { update: { where: { id: ids.kernel }, data: { views: 1 } } } } }))).toBe('NOT_FOUND');
    expect(await codeOf(db.users.update({ where: { id: ids.alan }, data: { profile: { update: { bio: 'x' } } } }))).toBe('NOT_FOUND');
    expect(await codeOf(db.users.update({ where: { id: ids.alan }, data: { profile: { delete: true } } }))).toBe('NOT_FOUND');
    expect(await codeOf(db.posts.create({ data: { title: 'x', author: { connectOrCreate: { where: { email: 'q@q.q' } } } } } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(db.users.create({ data: { email: 'w@w.w', posts: { connectOrCreate: { create: {} } } } } as never))).toBe('INVALID_ARGUMENT');
    // the failed nested writes rolled back
    expect(await db.users.count({ where: { email: 'w@w.w' } })).toBe(0);
  });

  it('covers the remaining nested write paths', async () => {
    const ids = await seed(db);
    const p = await db.posts.update({ where: { id: ids.cobol }, data: { tags: { connectOrCreate: [{ where: { name: 'cobol' }, create: { name: 'cobol' } }, { where: { name: 'math' }, create: { name: 'math' } }] } }, include: { tags: true } });
    expect(p.tags.map((t) => t.name).sort()).toEqual(['cobol', 'history', 'math', 'programming']);
    const q = await db.posts.update({ where: { id: ids.cobol }, data: { tags: { delete: { name: 'cobol' }, updateMany: { where: { name: 'math' }, data: { name: 'maths' } } } }, include: { tags: true } });
    expect(q.tags.map((t) => t.name).sort()).toEqual(['history', 'maths', 'programming']);
    const u = await db.users.update({ where: { id: ids.alan }, data: { profile: { create: { bio: 'one' } } }, include: { profile: true } });
    expect(u.profile?.bio).toBe('one');
    const v = await db.users.update({ where: { id: ids.alan }, data: { profile: { delete: true } }, include: { profile: true } });
    expect(v.profile).toBeNull();
    const w = await db.users.update({ where: { id: ids.alan }, data: { posts: { connectOrCreate: { where: { id: ids.kernel }, create: { title: 'never' } } } }, include: { posts: true } });
    expect(w.posts.map((x) => x.id)).toEqual([ids.kernel]);
    const x = await db.users.update({ where: { id: ids.alan }, data: { posts: { connectOrCreate: { where: { id: '00000000-0000-4000-8000-000000000001' }, create: { title: 'made' } } } }, include: { posts: { orderBy: { title: 'asc' } } } });
    expect(x.posts.map((y) => y.title)).toEqual(['Kernel news', 'made']);
    const c = await db.comments.update({ where: { id: ids.c3 }, data: { parent: { update: { body: 'Brilliant!' } }, post: { connectOrCreate: { where: { id: ids.kernel }, create: { title: 'x', authorId: ids.ada } } } }, include: { parent: true } });
    expect(c.parent?.body).toBe('Brilliant!');
    expect(c.postId).toBe(ids.kernel);
    const d = await db.comments.update({ where: { id: ids.c3 }, data: { parent: { create: { body: 'new root', postId: ids.kernel, authorId: ids.ada } } }, include: { parent: true } });
    expect(d.parent?.body).toBe('new root');
    const e = await db.comments.update({ where: { id: ids.c3 }, data: { parent: { delete: true } } });
    expect(e.parentId).toBeNull();
    const f = await db.comments.update({ where: { id: ids.c3 }, data: {} });
    expect(f.id).toBe(ids.c3);
    const t1 = await db.tags.create({ data: { name: 'lonely', posts: { connectOrCreate: { where: { id: ids.kernel }, create: { title: 'x', authorId: ids.ada } } } }, include: { posts: true } });
    expect(t1.posts.map((y) => y.id)).toEqual([ids.kernel]);
    const t2 = await db.tags.create({ data: { name: 'lonely2', posts: { connectOrCreate: { where: { id: '00000000-0000-4000-8000-000000000002' }, create: { title: 'via tag', authorId: ids.ada } } } }, include: { posts: true } });
    expect(t2.posts.map((y) => y.title)).toEqual(['via tag']);
    const t3 = await db.tags.update({ where: { id: t2.id }, data: { posts: { disconnect: { id: t2.posts[0]!.id } } }, include: { posts: true } });
    expect(t3.posts).toEqual([]);
    const reply = await db.comments.update({ where: { id: ids.c1 }, data: { replies: { set: [{ id: ids.c2 }] } }, include: { replies: true } });
    expect(reply.replies.map((r) => r.id)).toEqual([ids.c2]);
  });

  it('maps unknown database errors to QUERY_FAILED with context', async () => {
    mem.db.exec('DROP TABLE comments');
    const error = await db.comments.count().then(
      () => null,
      (e: unknown) => e,
    );
    expect(isKastorError(error, 'QUERY_FAILED')).toBe(true);
    expect((error as { meta: Record<string, unknown> }).meta).toMatchObject({ model: 'comments', operation: 'count' });
    expect(await codeOf(db.$sql`SELECT * FROM ${sql.ident('nothing_here')}`)).toBe('QUERY_FAILED');
  });

  it('validates the kastor() options', async () => {
    expect(await codeOf(() => kastor(undefined as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(() => kastor({ schema: fixture.schema } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(() => kastor({ adapter: mem.adapter } as never))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(() => kastor({ adapter: mem.adapter, schema: {} }))).toBe('SCHEMA_INVALID');
    expect(await codeOf(() => kastor({ adapter: mem.adapter, schema: { $users: fixture.schema.users } }))).toBe('SCHEMA_INVALID');
    expect(await codeOf(() => kastor({ adapter: mem.adapter, schema: fixture.schema, relations: () => 3 as never }))).toBe('SCHEMA_INVALID');
    expect(await codeOf(() => kastor({ adapter: mem.adapter, schema: fixture.schema, relations: () => ({ users: { email: fixture.relations(fixture.schema).users.posts } }) }))).toBe('SCHEMA_INVALID');
    const noRaw = kastor({ adapter: { ...mem.adapter, dialect: { ...mem.adapter.dialect, features: { ...mem.adapter.dialect.features, rawSql: false } } }, schema: fixture.schema });
    expect(await codeOf(noRaw.$sql`SELECT 1`)).toBe('UNSUPPORTED');
    const noCompile = kastor({ adapter: { ...mem.adapter, dialect: { ...mem.adapter.dialect, compile: undefined } }, schema: fixture.schema });
    expect(await codeOf(() => noCompile.users.findMany().toSQL())).toBe('UNSUPPORTED');
    const noQuery = kastor({ adapter: { dialect: mem.adapter.dialect, executor: { transaction: mem.adapter.executor.transaction } as never }, schema: fixture.schema });
    expect(await codeOf(noQuery.$execute`SELECT 1`)).toBe('UNSUPPORTED');
  });

  it('types the config and seed helpers', async () => {
    const config = defineConfig({ schema: './schema.ts', adapter: () => mem.adapter });
    expect(config.schema).toBe('./schema.ts');
    const s = defineSeed(async (client: FixtureDb) => {
      await client.tags.create({ data: { name: 'seeded' } });
    });
    await s(db);
    expect(await db.tags.count()).toBe(1);
    expect(await codeOf(() => defineSeed(3 as never))).toBe('INVALID_ARGUMENT');
  });
});
