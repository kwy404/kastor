// The full client on MongoDB with the default ObjectId ids: keys are strings end to end.
import { MongoClient, ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from 'vitest';
import { isKastorError, kastor } from '../src/index';
import { mongodb } from '../src/mongodb';
import { fixture } from './helpers/fixture';

const url = process.env.KASTOR_MONGO_URL;

describe.skipIf(!url)('mongodb client with ObjectId ids', () => {
  let client: MongoClient;
  let mongo: ReturnType<MongoClient['db']>;
  const make = () => kastor({ adapter: mongodb(mongo), schema: fixture.schema, relations: fixture.relations });
  let db: ReturnType<typeof make>;

  beforeAll(async () => {
    client = new MongoClient(url as string);
    await client.connect();
    mongo = client.db('kastor_client_objectid');
    await mongo.dropDatabase();
    const adapter = mongodb(mongo);
    expect(adapter.dialect.features.idType).toBe('string');
    for (const table of fixture.schemaIR.tables) {
      for (const command of adapter.dialect.ddl({ kind: 'createTable', table }, fixture.schemaIR)) await adapter.executor.query(command, []);
    }
    db = make();
  });
  afterAll(async () => {
    await mongo?.dropDatabase().catch(() => undefined);
    await client?.close();
  });

  it('types and returns t.id() keys and their references as strings', async () => {
    const ada = await db.users.create({ data: { email: 'ada@acme.com', name: 'Ada', posts: { create: { title: 'Engine', views: 3 } } }, include: { posts: true } });
    expectTypeOf(ada.id).toEqualTypeOf<string>();
    expectTypeOf(ada.posts[0]!.authorId).toEqualTypeOf<string>();
    expect(ada.id).toMatch(/^[0-9a-f]{24}$/);
    expect(ada.posts[0]!.authorId).toBe(ada.id);
    const raw = await mongo.collection('posts').findOne({});
    expect(raw?.author_id).toBeInstanceOf(ObjectId);
  });

  it('finds, updates and deletes by string id', async () => {
    const grace = await db.users.create({ data: { email: 'grace@acme.com', name: 'Grace' } });
    const found = await db.users.findUnique({ where: { id: grace.id }, select: { id: true, email: true } });
    expect(found).toEqual({ id: grace.id, email: 'grace@acme.com' });
    expect(await db.users.findUnique({ where: { id: new ObjectId().toHexString() } })).toBeNull();
    const many = await db.users.findMany({ where: { id: { in: [grace.id] } }, select: { email: true } });
    expect(many).toEqual([{ email: 'grace@acme.com' }]);
    const updated = await db.users.update({ where: { id: grace.id }, data: { name: 'Grace Hopper' } });
    expect(updated.name).toBe('Grace Hopper');
    const post = await db.posts.create({ data: { title: 'Compilers', author: { connect: { id: grace.id } } }, include: { author: true } });
    expect(post.author.id).toBe(grace.id);
    const byAuthor = await db.posts.findMany({ where: { authorId: grace.id }, select: { title: true } });
    expect(byAuthor).toEqual([{ title: 'Compilers' }]);
    const gone = await db.users.delete({ where: { id: grace.id } });
    expect(gone.email).toBe('grace@acme.com');
    expect(await db.posts.count({ where: { authorId: grace.id } })).toBe(0);
  });

  it('pages with cursors and loads relations by string keys', async () => {
    const u = await db.users.create({ data: { email: 'pager@acme.com', posts: { create: [{ title: 'p1', views: 30 }, { title: 'p2', views: 20 }, { title: 'p3', views: 10 }] } }, include: { posts: { orderBy: { views: 'desc' } } } });
    const after = await db.posts.findMany({ where: { authorId: u.id }, orderBy: { views: 'desc' }, cursor: { id: u.posts[1]!.id }, select: { title: true } });
    expect(after.map((p) => p.title)).toEqual(['p2', 'p3']);
    const withAuthor = await db.posts.findUniqueOrThrow({ where: { id: u.posts[0]!.id }, include: { author: { select: { email: true } } } });
    expect(withAuthor.author).toEqual({ email: 'pager@acme.com' });
  });

  it('rejects references to missing rows and keeps non id integers strict', async () => {
    try {
      await db.posts.create({ data: { title: 'Orphan', authorId: new ObjectId().toHexString() } });
      expect.unreachable();
    } catch (error) {
      expect(isKastorError(error, 'FOREIGN_KEY_VIOLATION')).toBe(true);
    }
    try {
      await db.users.create({ data: { email: 'strict@acme.com', age: 'old' as never } });
      expect.unreachable();
    } catch (error) {
      expect(isKastorError(error, 'VALIDATION_FAILED')).toBe(true);
    }
  });
});
