// The MongoDB dialect against a real server, driven with QueryIR directly.
import { MongoClient, ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { QueryIR, Row, WhereIR } from '../src/core/ir';
import { createMongoDialect, mongoExecutor, type IdMode, type MongoExecutor } from '../src/mongodb';
import { read, rel, schema, sel } from './mongo-fixture';

const url = process.env.KASTOR_MONGO_URL;

// Creating collections is slow on a replica set, so they are created once and emptied between tests.
async function createCollections(exec: MongoExecutor, ids: IdMode): Promise<void> {
  const dialect = createMongoDialect({ ids });
  for (const name of ['users', 'posts', 'tags', 'post_tags', 'profiles', '_kastor_counters']) {
    await exec.db.collection(name).drop().catch(() => undefined);
  }
  for (const table of schema.tables) {
    for (const cmd of dialect.ddl({ kind: 'createTable', table }, schema)) await exec.query(cmd, []);
  }
}

async function emptyCollections(exec: MongoExecutor): Promise<void> {
  for (const name of ['users', 'posts', 'tags', 'post_tags', 'profiles', '_kastor_counters']) await exec.db.collection(name).deleteMany({});
}

for (const ids of ['objectId', 'int', 'uuid'] as const) {
  describe.skipIf(!url)(`mongodb dialect (${ids} ids)`, () => {
    let client: MongoClient;
    let exec: MongoExecutor;
    const dialect = createMongoDialect({ ids });
    const run = <T = unknown>(q: QueryIR, e: MongoExecutor = exec) => dialect.execute(q, schema, e) as Promise<T>;
    const createUser = (data: Record<string, unknown>) => run<Row>({ kind: 'create', table: 'users', data, returning: sel('id', 'email', 'name', 'role', 'score', 'big', 'createdAt') });
    const createPost = (data: Record<string, unknown>) => run<Row>({ kind: 'create', table: 'posts', data, returning: sel('id', 'title', 'published', 'views', 'authorId') });

    beforeAll(async () => {
      client = new MongoClient(url as string);
      await client.connect();
      exec = mongoExecutor(client.db(`kastor_dialect_${ids.toLowerCase()}`));
      await createCollections(exec, ids);
    });
    afterAll(async () => {
      await exec.db.dropDatabase().catch(() => undefined);
      await client.close();
    });
    beforeEach(() => emptyCollections(exec));

    it('creates rows with defaults, generated ids and decoded values', async () => {
      const u = await createUser({ email: 'ada@acme.com', score: '12.5', big: 9007199254740993n });
      if (ids === 'objectId') expect(u.id).toMatch(/^[0-9a-f]{24}$/);
      if (ids === 'int') expect(u.id).toBe(1);
      if (ids === 'uuid') expect(u.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(u).toMatchObject({ email: 'ada@acme.com', name: null, role: 'user', score: '12.50', big: 9007199254740993n });
      expect(u.createdAt).toBeInstanceOf(Date);
      const raw = await exec.db.collection('users').findOne({});
      if (ids === 'objectId') expect(raw?._id).toBeInstanceOf(ObjectId);
      expect(raw?.score?._bsontype).toBe('Decimal128');
    });

    it('rejects duplicates and missing required values with kastor errors', async () => {
      await createUser({ email: 'a@x.com' });
      await expect(createUser({ email: 'a@x.com' })).rejects.toMatchObject({ code: 'UNIQUE_VIOLATION' });
      await expect(run({ kind: 'create', table: 'posts', data: { title: 'x' }, returning: sel('id') })).rejects.toMatchObject({ code: 'NOT_NULL_VIOLATION' });
    });

    it('filters with every operator, insensitive matching and escaping', async () => {
      await createUser({ email: 'Ada@Acme.com', name: 'Ada' });
      await createUser({ email: 'bob@acme.com', name: null });
      await createUser({ email: 'c.d+e@other.org', name: 'C' });
      const find = async (where: WhereIR) => (await run<Row[]>({ kind: 'findMany', table: 'users', read: read('users', ['email'], { where, orderBy: [{ kind: 'column', column: 'email', direction: 'asc' }] }) })).map((r) => r.email);
      expect(await find({ kind: 'like', column: 'email', mode: 'endsWith', value: '@acme.com', insensitive: false, negate: false })).toEqual(['bob@acme.com']);
      expect(await find({ kind: 'like', column: 'email', mode: 'endsWith', value: '@ACME.com', insensitive: true, negate: false })).toEqual(['Ada@Acme.com', 'bob@acme.com']);
      expect(await find({ kind: 'like', column: 'email', mode: 'contains', value: '.d+e', insensitive: false, negate: false })).toEqual(['c.d+e@other.org']);
      expect(await find({ kind: 'like', column: 'email', mode: 'contains', value: '.*', insensitive: false, negate: false })).toEqual([]);
      expect(await find({ kind: 'compare', column: 'email', op: 'eq', value: 'ada@acme.com', insensitive: true })).toEqual(['Ada@Acme.com']);
      expect(await find({ kind: 'compare', column: 'name', op: 'ne', value: 'Ada' })).toEqual(['c.d+e@other.org']);
      expect(await find({ kind: 'not', item: { kind: 'compare', column: 'name', op: 'eq', value: 'Ada' } })).toEqual(['c.d+e@other.org']);
      expect(await find({ kind: 'null', column: 'name', negate: false })).toEqual(['bob@acme.com']);
      expect(await find({ kind: 'in', column: 'name', values: ['Ada', 'C', null], negate: false })).toEqual(['Ada@Acme.com', 'c.d+e@other.org']);
      expect(await find({ kind: 'in', column: 'name', values: ['Ada'], negate: true })).toEqual(['c.d+e@other.org']);
      expect(
        await find({
          kind: 'or',
          items: [
            { kind: 'compare', column: 'name', op: 'gte', value: 'B' },
            { kind: 'and', items: [{ kind: 'null', column: 'name', negate: false }, { kind: 'const', value: true }] },
          ],
        }),
      ).toEqual(['bob@acme.com', 'c.d+e@other.org']);
    });

    it('loads nested includes, n:m through a join table and relation counts in one aggregate', async () => {
      const ada = await createUser({ email: 'ada@acme.com' });
      await createUser({ email: 'bob@acme.com' });
      const p1 = await createPost({ title: 'one', authorId: ada.id, published: true });
      const p2 = await createPost({ title: 'two', authorId: ada.id });
      const t1 = await run<Row>({ kind: 'create', table: 'tags', data: { label: 'db' }, returning: sel('id') });
      const t2 = await run<Row>({ kind: 'create', table: 'tags', data: { label: 'orm' }, returning: sel('id') });
      await run({ kind: 'createMany', table: 'post_tags', data: [{ postId: p1.id, tagId: t1.id }, { postId: p1.id, tagId: t2.id }, { postId: p2.id, tagId: t2.id }], skipDuplicates: false });

      const rows = await run<Row[]>({
        kind: 'findMany',
        table: 'users',
        read: read('users', ['email'], {
          orderBy: [{ kind: 'column', column: 'email', direction: 'asc' }],
          include: [
            {
              relation: rel.userPosts,
              read: read('posts', ['title'], {
                orderBy: [{ kind: 'column', column: 'title', direction: 'desc' }],
                take: 5,
                include: [
                  { relation: rel.postTags, read: read('tags', ['label'], { orderBy: [{ kind: 'column', column: 'label', direction: 'asc' }] }) },
                  { relation: rel.postAuthor, read: read('users', ['email']) },
                ],
              }),
            },
          ],
          counts: [{ relation: rel.userPosts, as: 'posts', where: { kind: 'compare', column: 'published', op: 'eq', value: true } }],
        }),
      });
      expect(rows).toEqual([
        {
          email: 'ada@acme.com',
          posts: [
            { title: 'two', tags: [{ label: 'orm' }], author: { email: 'ada@acme.com' } },
            { title: 'one', tags: [{ label: 'db' }, { label: 'orm' }], author: { email: 'ada@acme.com' } },
          ],
          _count: { posts: 1 },
        },
        { email: 'bob@acme.com', posts: [], _count: { posts: 0 } },
      ]);
    });

    it('filters on relations with some, every, none, is and isNot', async () => {
      const ada = await createUser({ email: 'ada@acme.com' });
      const bob = await createUser({ email: 'bob@acme.com' });
      await createUser({ email: 'cy@acme.com' });
      await createPost({ title: 'a1', authorId: ada.id, published: true });
      await createPost({ title: 'a2', authorId: ada.id, published: false });
      await createPost({ title: 'b1', authorId: bob.id, published: true });
      const published: WhereIR = { kind: 'compare', column: 'published', op: 'eq', value: true };
      const users = async (op: 'some' | 'every' | 'none', where: WhereIR | null) =>
        (
          await run<Row[]>({
            kind: 'findMany',
            table: 'users',
            read: read('users', ['email'], { where: { kind: 'relation', relation: rel.userPosts, op, where }, orderBy: [{ kind: 'column', column: 'email', direction: 'asc' }] }),
          })
        ).map((r) => r.email);
      expect(await users('some', published)).toEqual(['ada@acme.com', 'bob@acme.com']);
      expect(await users('every', published)).toEqual(['bob@acme.com', 'cy@acme.com']);
      expect(await users('none', published)).toEqual(['cy@acme.com']);
      expect(await users('some', null)).toEqual(['ada@acme.com', 'bob@acme.com']);
      const posts = async (op: 'is' | 'isNot', where: WhereIR | null) =>
        (
          await run<Row[]>({
            kind: 'findMany',
            table: 'posts',
            read: read('posts', ['title'], { where: { kind: 'relation', relation: rel.postAuthor, op, where }, orderBy: [{ kind: 'column', column: 'title', direction: 'asc' }] }),
          })
        ).map((r) => r.title);
      expect(await posts('is', { kind: 'compare', column: 'email', op: 'eq', value: 'bob@acme.com' })).toEqual(['b1']);
      expect(await posts('isNot', { kind: 'compare', column: 'email', op: 'eq', value: 'bob@acme.com' })).toEqual(['a1', 'a2']);
      expect(await posts('isNot', null)).toEqual(['a1', 'a2', 'b1']);
      // relation filters also drive writes
      const res = await run<{ count: number }>({
        kind: 'updateMany',
        table: 'posts',
        where: { kind: 'relation', relation: rel.postAuthor, op: 'is', where: { kind: 'compare', column: 'email', op: 'eq', value: 'ada@acme.com' } },
        data: { views: { op: 'increment', value: 2 } },
      });
      expect(res).toEqual({ count: 2 });
    });

    it('updates with arithmetic, upserts, and returns null when nothing matched', async () => {
      const u = await createUser({ email: 'a@x.com' });
      const p = await createPost({ title: 't', authorId: u.id });
      const byId: WhereIR = { kind: 'compare', column: 'id', op: 'eq', value: p.id };
      const updated = await run<Row>({ kind: 'update', table: 'posts', where: byId, data: { views: { op: 'increment', value: 5 }, title: { op: 'set', value: '$not an operator' } }, returning: sel('title', 'views') });
      expect(updated).toEqual({ title: '$not an operator', views: 5 });
      const divided = await run<Row>({ kind: 'update', table: 'posts', where: byId, data: { views: { op: 'divide', value: 2 } }, returning: sel('views') });
      expect(divided).toEqual({ views: 2 });
      const none = await run({ kind: 'update', table: 'posts', where: { kind: 'compare', column: 'title', op: 'eq', value: 'zzz' }, data: { views: { op: 'set', value: 1 } }, returning: sel('id') });
      expect(none).toBeNull();
      const where: WhereIR = { kind: 'compare', column: 'email', op: 'eq', value: 'new@x.com' };
      const created = await run<Row>({ kind: 'upsert', table: 'users', conflict: { email: 'new@x.com' }, where, create: { email: 'new@x.com', name: 'New' }, update: { name: { op: 'set', value: 'Again' } }, returning: sel('email', 'name') });
      expect(created).toEqual({ email: 'new@x.com', name: 'New' });
      const again = await run<Row>({ kind: 'upsert', table: 'users', conflict: { email: 'new@x.com' }, where, create: { email: 'new@x.com', name: 'New' }, update: { name: { op: 'set', value: 'Again' } }, returning: sel('email', 'name') });
      expect(again).toEqual({ email: 'new@x.com', name: 'Again' });
    });

    it('emulates onDelete cascade and restrict', async () => {
      const u = await createUser({ email: 'a@x.com' });
      const p = await createPost({ title: 't', authorId: u.id });
      const tag = await run<Row>({ kind: 'create', table: 'tags', data: { label: 'x' }, returning: sel('id') });
      await run({ kind: 'create', table: 'post_tags', data: { postId: p.id, tagId: tag.id }, returning: [] });
      const prof = await run<Row>({ kind: 'create', table: 'profiles', data: { userId: u.id, avatar: new Uint8Array([1, 2, 3]) }, returning: sel('id', 'avatar') });
      expect(prof.avatar).toEqual(new Uint8Array([1, 2, 3]));
      const byId: WhereIR = { kind: 'compare', column: 'id', op: 'eq', value: u.id };
      await expect(run({ kind: 'delete', table: 'users', where: byId, returning: sel('id') })).rejects.toMatchObject({ code: 'FOREIGN_KEY_VIOLATION' });
      expect(await run({ kind: 'count', table: 'posts' })).toBe(1);
      await run({ kind: 'deleteMany', table: 'profiles' });
      const deleted = await run<Row>({ kind: 'delete', table: 'users', where: byId, returning: sel('email') });
      expect(deleted).toEqual({ email: 'a@x.com' });
      expect(await run({ kind: 'count', table: 'posts' })).toBe(0);
      expect(await run({ kind: 'count', table: 'post_tags' })).toBe(0);
      expect(await run({ kind: 'count', table: 'tags' })).toBe(1);
    });

    it('counts, aggregates, groups and picks distinct rows', async () => {
      const a = await createUser({ email: 'a@x.com' });
      const b = await createUser({ email: 'b@x.com' });
      await createPost({ title: 'x', authorId: a.id, views: 10, published: true });
      await createPost({ title: 'x', authorId: a.id, views: 20 });
      await createPost({ title: 'y', authorId: b.id, views: 5 });
      expect(await run({ kind: 'count', table: 'posts', where: { kind: 'compare', column: 'views', op: 'gt', value: 6 } })).toBe(2);
      const agg = await run<Row>({
        kind: 'aggregate',
        table: 'posts',
        aggregates: [
          { fn: 'count', column: null, as: 'a0' },
          { fn: 'sum', column: 'views', as: 'a1' },
          { fn: 'avg', column: 'views', as: 'a2' },
          { fn: 'min', column: 'title', as: 'a3' },
          { fn: 'max', column: 'views', as: 'a4' },
        ],
      });
      expect(agg).toEqual({ a0: 3, a1: 35, a2: 35 / 3, a3: 'x', a4: 20 });
      const empty = await run<Row>({ kind: 'aggregate', table: 'posts', where: { kind: 'const', value: false }, aggregates: [{ fn: 'count', column: null, as: 'a0' }, { fn: 'sum', column: 'views', as: 'a1' }] });
      expect(empty).toEqual({ a0: 0, a1: null });
      const groups = await run<Row[]>({
        kind: 'groupBy',
        table: 'posts',
        by: sel('title'),
        aggregates: [{ fn: 'count', column: null, as: 'n' }, { fn: 'sum', column: 'views', as: 's' }],
        having: { kind: 'compare', column: 'views', op: 'gt', value: 6, aggregate: 'sum' },
        orderBy: [{ kind: 'aggregate', fn: 'sum', column: 'views', direction: 'desc' }],
      });
      expect(groups).toEqual([{ title: 'x', n: 2, s: 30 }]);
      const distinct = await run<Row[]>({ kind: 'findMany', table: 'posts', read: read('posts', ['title', 'views'], { distinct: ['title'], orderBy: [{ kind: 'column', column: 'views', direction: 'desc' }] }) });
      expect(distinct).toEqual([{ title: 'x', views: 20 }, { title: 'y', views: 5 }]);
    });

    it('commits and rolls back transactions on the replica set', async () => {
      await expect(
        exec.transaction(async (tx) => {
          await run({ kind: 'create', table: 'users', data: { email: 'tx@x.com' }, returning: [] }, tx as MongoExecutor);
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(await run({ kind: 'count', table: 'users' })).toBe(0);
      await exec.transaction(async (tx) => {
        await run({ kind: 'create', table: 'users', data: { email: 'tx@x.com' }, returning: [] }, tx as MongoExecutor);
      });
      expect(await run({ kind: 'count', table: 'users' })).toBe(1);
    });

    it('skips duplicates in createMany, also inside a transaction', async () => {
      await createUser({ email: 'a@x.com' });
      const res = await exec.transaction((tx) =>
        run({ kind: 'createMany', table: 'users', data: [{ email: 'a@x.com' }, { email: 'b@x.com' }, { email: 'b@x.com' }], skipDuplicates: true }, tx as MongoExecutor),
      );
      expect(res).toEqual({ count: 1 });
      expect(await run({ kind: 'count', table: 'users' })).toBe(2);
    });
  });
}
