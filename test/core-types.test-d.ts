/**
 * Type level tests: result types follow select / include, nullable columns
 * read as `T | null`, create inputs require only columns without defaults,
 * and mistakes fail to compile.
 */
import { describe, expectTypeOf, it } from 'vitest';
import { kastor, one, many, t, table, type Adapter, type Executor, type InferInsert, type InferSelect } from '../src/index';
import { fixture, users, posts, comments } from './helpers/fixture';

declare const adapter: Adapter;
const db = kastor({ adapter, schema: fixture.schema, relations: fixture.relations });

describe('column inference', () => {
  it('maps column builders to TypeScript types', () => {
    type User = InferSelect<typeof users>;
    expectTypeOf<User>().toEqualTypeOf<{
      id: number;
      email: string;
      name: string | null;
      role: 'user' | 'admin';
      age: number | null;
      score: number;
      balance: string;
      active: boolean;
      createdAt: Date;
    }>();
    type Post = InferSelect<typeof posts>;
    expectTypeOf<Post['likes']>().toEqualTypeOf<bigint>();
    expectTypeOf<Post['id']>().toEqualTypeOf<string>();
    type Profile = InferSelect<typeof fixture.schema.profiles>;
    expectTypeOf<Profile['avatar']>().toEqualTypeOf<Uint8Array | null>();
    expectTypeOf<Profile['settings']>().toEqualTypeOf<{ theme: string; tags?: string[] } | null>();
    expectTypeOf<Profile['birthday']>().toEqualTypeOf<string | null>();
  });

  it('requires only columns without a default on insert', () => {
    type NewUser = InferInsert<typeof users>;
    expectTypeOf<NewUser>().toEqualTypeOf<{
      email: string;
      id?: number;
      name?: string | null;
      role?: 'user' | 'admin';
      age?: number | null;
      score?: number;
      balance?: string;
      active?: boolean;
      createdAt?: Date;
    }>();
  });

  it('narrows with $type and keeps map() transparent', () => {
    const _things = table('things', { status: t.string().$type<'draft' | 'live'>(), legacy: t.int().map('legacy_col').nullable() });
    expectTypeOf<InferSelect<typeof _things>>().toEqualTypeOf<{ status: 'draft' | 'live'; legacy: number | null }>();
  });
});

describe('query results', () => {
  it('returns full rows by default', async () => {
    const rows = await db.users.findMany();
    expectTypeOf(rows).toEqualTypeOf<InferSelect<typeof users>[]>();
    const first = await db.users.findFirst();
    expectTypeOf(first).toEqualTypeOf<InferSelect<typeof users> | null>();
    const sure = await db.users.findUniqueOrThrow({ where: { id: 1 } });
    expectTypeOf(sure).toEqualTypeOf<InferSelect<typeof users>>();
  });

  it('select picks exactly the chosen fields', async () => {
    const rows = await db.users.findMany({ select: { id: true, name: true } });
    expectTypeOf(rows).toEqualTypeOf<{ id: number; name: string | null }[]>();
  });

  it('include adds relations with the right cardinality and nullability', async () => {
    const user = await db.users.findUniqueOrThrow({ where: { email: 'a@b.c' }, include: { posts: true, profile: true } });
    expectTypeOf(user.posts).toEqualTypeOf<InferSelect<typeof posts>[]>();
    expectTypeOf(user.profile).toEqualTypeOf<InferSelect<typeof fixture.schema.profiles> | null>();
    const post = await db.posts.findFirstOrThrow({ include: { author: true } });
    expectTypeOf(post.author).toEqualTypeOf<InferSelect<typeof users>>();
    const comment = await db.comments.findFirstOrThrow({ include: { parent: true, replies: true } });
    expectTypeOf(comment.parent).toEqualTypeOf<InferSelect<typeof comments> | null>();
    expectTypeOf(comment.replies).toEqualTypeOf<InferSelect<typeof comments>[]>();
  });

  it('nested include and select follow their own arguments', async () => {
    const post = await db.posts.findFirstOrThrow({
      select: {
        title: true,
        author: { select: { email: true } },
        tags: { where: { name: 'x' }, take: 2, select: { name: true } },
        comments: { orderBy: { id: 'desc' }, include: { author: { select: { name: true } } } },
        _count: { select: { comments: true } },
      },
    });
    expectTypeOf(post.title).toEqualTypeOf<string>();
    expectTypeOf(post.author).toEqualTypeOf<{ email: string }>();
    expectTypeOf(post.tags).toEqualTypeOf<{ name: string }[]>();
    expectTypeOf(post.comments[0]!.author).toEqualTypeOf<{ name: string | null }>();
    expectTypeOf(post.comments[0]!.body).toEqualTypeOf<string>();
    expectTypeOf(post._count).toEqualTypeOf<{ comments: number }>();
  });

  it('count, aggregate and groupBy results', async () => {
    expectTypeOf(await db.users.count()).toEqualTypeOf<number>();
    expectTypeOf(await db.users.count({ select: { _all: true, name: true } })).toEqualTypeOf<{ _all: number; name: number }>();
    const agg = await db.posts.aggregate({ _count: true, _sum: { views: true, likes: true }, _avg: { views: true }, _max: { createdAt: true } });
    expectTypeOf(agg).toEqualTypeOf<{ _count: number; _sum: { views: number | null; likes: bigint | null }; _avg: { views: number | null }; _max: { createdAt: Date | null } }>();
    const groups = await db.posts.groupBy({ by: ['authorId', 'published'], _count: { _all: true } });
    expectTypeOf(groups).toEqualTypeOf<{ authorId: number; published: boolean; _count: { _all: number } }[]>();
  });

  it('writes return the shaped row', async () => {
    const created = await db.users.create({ data: { email: 'x@y.z' }, select: { id: true } });
    expectTypeOf(created).toEqualTypeOf<{ id: number }>();
    const updated = await db.posts.update({ where: { id: 'p' }, data: { views: { increment: 1 } }, include: { tags: true } });
    expectTypeOf(updated.tags[0]!.name).toEqualTypeOf<string>();
    const page = await db.posts.findPage({ first: 10, select: { id: true } });
    expectTypeOf(page.items).toEqualTypeOf<{ id: string }[]>();
    expectTypeOf(page.pageInfo.endCursor).toEqualTypeOf<string | null>();
    const many = await db.tags.createMany({ data: [{ name: 'a' }] });
    expectTypeOf(many).toEqualTypeOf<{ count: number }>();
  });

  it('transactions keep the client type', async () => {
    const result = await db.$transaction(async (tx) => {
      expectTypeOf(tx.users.findMany).toEqualTypeOf(db.users.findMany);
      return 42;
    });
    expectTypeOf(result).toEqualTypeOf<number>();
    const [a, b] = await db.$transaction([db.users.count(), db.tags.findFirst()]);
    expectTypeOf(a).toEqualTypeOf<number>();
    expectTypeOf(b).toEqualTypeOf<{ id: number; name: string } | null>();
    const raw = await db.$sql<{ n: number }>`SELECT 1 AS n`;
    expectTypeOf(raw).toEqualTypeOf<{ n: number }[]>();
  });
});

describe('inputs', () => {
  it('accepts a foreign key or its relation in create data', () => {
    db.posts.create({ data: { title: 'a', authorId: 1 } });
    db.posts.create({ data: { title: 'a', author: { connect: { id: 1 } } } });
    db.posts.create({ data: { title: 'a', author: { create: { email: 'n@x.y' } } } });
    // @ts-expect-error the author is required
    db.posts.create({ data: { title: 'a' } });
    // @ts-expect-error both the key and the relation
    db.posts.create({ data: { title: 'a', authorId: 1, author: { connect: { id: 1 } } } });
  });

  it('nested creates leave the parent key to kastor', () => {
    db.users.create({ data: { email: 'a@b.c', posts: { create: [{ title: 'x' }, { title: 'y', tags: { connect: { name: 'z' } } }] } } });
    db.users.create({ data: { email: 'a@b.c', profile: { create: { bio: 'b' } } } });
  });

  it('rejects unknown fields, wrong value types and bad operators', () => {
    // @ts-expect-error unknown field in where
    db.users.findMany({ where: { emial: 'x' } });
    // @ts-expect-error wrong value type
    db.users.findMany({ where: { age: 'old' } });
    // @ts-expect-error contains only exists on strings
    db.users.findMany({ where: { age: { contains: '1' } } });
    // @ts-expect-error unknown relation in include
    db.users.findMany({ include: { postz: true } });
    // @ts-expect-error unknown top level argument
    db.users.findMany({ wher: {} });
    // @ts-expect-error select and include together
    db.users.findMany({ select: { id: true }, include: { posts: true } });
    // @ts-expect-error findUnique needs a unique field
    db.users.findUnique({ where: { name: 'x' } });
    // @ts-expect-error enum values are checked
    db.users.create({ data: { email: 'a@b.c', role: 'root' } });
    // @ts-expect-error increment only on numbers
    db.users.update({ where: { id: 1 }, data: { email: { increment: 1 } } });
  });

  it('relation filters take some / every / none or is / isNot', () => {
    db.users.findMany({ where: { posts: { some: { published: true } }, profile: { is: { bio: 'x' } } } });
    db.posts.findMany({ where: { author: { email: { endsWith: '@acme.com' } } } });
    // @ts-expect-error list relations need some, every or none
    db.users.findMany({ where: { posts: { published: true } } });
  });

  it('types string ids when the adapter declares them', async () => {
    const mongo = kastor({ adapter: {} as Adapter<Executor, 'string'>, schema: fixture.schema, relations: fixture.relations });
    const u = await mongo.users.findUniqueOrThrow({ where: { id: '65f0c0ffee' }, include: { posts: true } });
    expectTypeOf(u.id).toEqualTypeOf<string>();
    expectTypeOf(u.posts[0]!.authorId).toEqualTypeOf<string>();
    expectTypeOf(u.age).toEqualTypeOf<number | null>();
  });

  it('types back sides, composite links and updatedAt', async () => {
    const user = await db.users.findUniqueOrThrow({ where: { id: 1 }, include: { mentee: true, profile: true } });
    expectTypeOf(user.mentee).toEqualTypeOf<InferSelect<typeof fixture.schema.profiles> | null>();
    expectTypeOf(user.profile).toEqualTypeOf<InferSelect<typeof fixture.schema.profiles> | null>();
    const vote = await db.tagVotes.findFirstOrThrow({ include: { postTag: true } });
    expectTypeOf(vote.postTag).toEqualTypeOf<{ postId: string; tagId: number }>();
    type NewPost = InferInsert<typeof posts>;
    expectTypeOf<NewPost['updatedAt']>().toEqualTypeOf<Date | undefined>();
    expectTypeOf<InferSelect<typeof posts>['updatedAt']>().toEqualTypeOf<Date>();
    db.users.create({ data: { email: 'a@b.c', mentee: { connect: { id: 1 } } } });
    db.tagVotes.create({ data: { postTag: { connect: { postId: 'p', tagId: 1 } } } });
    db.postTags.create({ data: { postId: 'p', tagId: 1, votes: { create: [{ value: 2 }] } } });
  });

  it('works without relations', async () => {
    const simple = kastor({ adapter, schema: { users } });
    const rows = await simple.users.findMany({ where: { email: { contains: 'a' } } });
    expectTypeOf(rows).toEqualTypeOf<InferSelect<typeof users>[]>();
    void one;
    void many;
  });
});
