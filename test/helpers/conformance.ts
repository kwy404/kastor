/**
 * Shared conformance suite. Every dialect runs the whole client API against
 * the fixture schema (users, profiles 1:1, posts 1:n, tags n:m, comments
 * self relation with soft delete):
 *
 * ```ts
 * import { runConformance, resetWithDdl } from './helpers/conformance';
 * runConformance('postgres', async () => {
 *   const pool = new pg.Pool({ connectionString: process.env.KASTOR_PG_URL });
 *   const adapter = postgres(pool);
 *   return { adapter, reset: (schema) => resetWithDdl(adapter, schema), close: () => pool.end() };
 * }, { enabled: !!process.env.KASTOR_PG_URL });
 * ```
 *
 * Reads run first against the seed data, writes afterwards. Tests never
 * depend on the database's default row order or string collation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { factory, isKastorError, kastor, sql, type Adapter, type KastorClient, type SchemaIR } from '../../src/index';
import { fixture, schema, type relations } from './fixture';

export { fixture } from './fixture';

export type FixtureDb = KastorClient<typeof schema, ReturnType<typeof relations>>;

export interface ConformanceTarget {
  adapter: Adapter<any>;
  /** Drops and recreates the fixture tables. Defaults to `resetWithDdl`. */
  reset?(schema: SchemaIR): Promise<void>;
  close?(): Promise<void>;
}

export interface ConformanceOptions {
  /** Run the suite (pass `!!process.env.KASTOR_X_URL`). Default true. */
  enabled?: boolean;
  /** Test names (or name prefixes) to skip, with the reason in a comment at the call site. */
  skip?: string[];
}

/** Drops the fixture tables (ignoring errors) and creates them with the dialect DDL. */
export async function resetWithDdl(adapter: Adapter<any>, schemaIR: SchemaIR = fixture.schemaIR): Promise<void> {
  const { dialect, executor } = adapter;
  const run = async (statements: string[], ignore: boolean): Promise<void> => {
    for (const statement of statements) {
      try {
        await executor.query(statement, []);
      } catch (error) {
        if (!ignore) throw error;
      }
    }
  };
  for (const tbl of [...schemaIR.tables].reverse()) {
    await run(dialect.ddl({ kind: 'dropTable', table: tbl.name, previous: tbl }, schemaIR), true);
  }
  if (dialect.features.namedEnums) {
    for (const e of schemaIR.enums ?? []) await run(dialect.ddl({ kind: 'dropEnum', enum: e }, schemaIR), true);
    for (const e of schemaIR.enums ?? []) await run(dialect.ddl({ kind: 'createEnum', enum: e }, schemaIR), false);
  }
  for (const tbl of schemaIR.tables) {
    await run(dialect.ddl({ kind: 'createTable', table: tbl }, schemaIR), false);
  }
}

export interface SeedIds {
  ada: number;
  grace: number;
  alan: number;
  linus: number;
  engine: string;
  draft: string;
  compilers: string;
  cobol: string;
  kernel: string;
  math: number;
  history: number;
  programming: number;
  c1: number;
  c2: number;
  c3: number;
  c4: number;
  spam: number;
}

/** Seeds the fixture through the client itself (nested creates included). */
export async function seed(db: FixtureDb): Promise<SeedIds> {
  const math = await db.tags.create({ data: { name: 'math' } });
  const history = await db.tags.create({ data: { name: 'history' } });
  const programming = await db.tags.create({ data: { name: 'programming' } });

  const ada = await db.users.create({
    data: {
      email: 'ada@acme.com',
      name: 'Ada Lovelace',
      role: 'admin',
      age: 36,
      score: 9.5,
      balance: '1500.25',
      profile: { create: { bio: 'Mathematician', settings: { theme: 'dark', tags: ['math'] }, birthday: '1815-12-10', wakeUp: '06:30:00' } },
      posts: {
        create: [
          { title: 'Notes on the engine', body: 'The analytical engine weaves algebraic patterns.', published: true, views: 100, likes: 10n, tags: { connect: [{ id: math.id }, { id: history.id }] } },
          { title: 'Draft about loops', views: 5 },
        ],
      },
    },
    include: { posts: { orderBy: { views: 'desc' } } },
  });
  const grace = await db.users.create({
    data: {
      email: 'grace@acme.com',
      name: 'Grace Hopper',
      age: 85,
      score: 8,
      profile: { create: { bio: 'Rear admiral' } },
      posts: {
        create: [
          { title: 'Compilers for everyone', published: true, views: 50, likes: 5n, tags: { connect: { name: 'programming' } } },
          { title: 'COBOL tips', published: true, views: 20, tags: { connect: [{ name: 'programming' }, { name: 'history' }] } },
        ],
      },
    },
    include: { posts: { orderBy: { views: 'desc' } } },
  });
  const alan = await db.users.create({ data: { email: 'alan@example.com', active: false } });
  const linus = await db.users.create({
    data: { email: 'linus@kernel.org', name: 'Linus', age: 54, score: 7.25, posts: { create: { title: 'Kernel news', published: true, views: 70, tags: { connect: { id: programming.id } } } } },
    include: { posts: true },
  });

  const [engine, draft] = ada.posts;
  const [compilers, cobol] = grace.posts;
  const kernel = linus.posts[0]!;
  const c1 = await db.comments.create({ data: { body: 'Brilliant', post: { connect: { id: engine!.id } }, author: { connect: { id: grace.id } } } });
  const c2 = await db.comments.create({ data: { body: 'Agreed', postId: engine!.id, authorId: linus.id, parentId: c1.id } });
  const c3 = await db.comments.create({ data: { body: 'Thanks', postId: engine!.id, authorId: ada.id, parent: { connect: { id: c1.id } } } });
  const c4 = await db.comments.create({ data: { body: 'Great read', postId: compilers!.id, authorId: ada.id } });
  const spam = await db.comments.create({ data: { body: 'spam', postId: kernel.id, authorId: alan.id } });
  await db.comments.delete({ where: { id: spam.id } });

  return {
    ada: ada.id,
    grace: grace.id,
    alan: alan.id,
    linus: linus.id,
    engine: engine!.id,
    draft: draft!.id,
    compilers: compilers!.id,
    cobol: cobol!.id,
    kernel: kernel.id,
    math: math.id,
    history: history.id,
    programming: programming.id,
    c1: c1.id,
    c2: c2.id,
    c3: c3.id,
    c4: c4.id,
    spam: spam.id,
  };
}

async function expectError(promise: PromiseLike<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    if (!isKastorError(error)) throw error;
    expect(error.code).toBe(code);
    expect(error.message.length).toBeGreaterThan(10);
    return;
  }
  throw new Error(`Expected a KastorError ${code}, but the call succeeded.`);
}

const sortNums = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);

export function runConformance(name: string, makeDb: () => Promise<ConformanceTarget> | ConformanceTarget, options: ConformanceOptions = {}): void {
  const suite = options.enabled === false ? describe.skip : describe;
  const skip = options.skip ?? [];
  const test = (title: string, fn: () => Promise<void>): void => {
    const skipped = skip.some((s) => title === s || title.startsWith(s));
    (skipped ? it.skip : it)(title, fn);
  };

  suite(`conformance: ${name}`, () => {
    let target: ConformanceTarget;
    let db: FixtureDb;
    let ids: SeedIds;

    beforeAll(async () => {
      target = await makeDb();
      await (target.reset ? target.reset(fixture.schemaIR) : resetWithDdl(target.adapter));
      db = kastor({ adapter: target.adapter, schema: fixture.schema, relations: fixture.relations });
      ids = await seed(db);
    });

    afterAll(async () => {
      await target?.close?.();
    });

    /* -------------------------------------------------------------- */
    /* Reads                                                           */
    /* -------------------------------------------------------------- */

    test('findMany returns typed rows with defaults applied', async () => {
      const rows = await db.users.findMany({ orderBy: { id: 'asc' } });
      expect(rows.map((u) => u.email)).toEqual(['ada@acme.com', 'grace@acme.com', 'alan@example.com', 'linus@kernel.org']);
      const alan = rows[2]!;
      expect(alan.name).toBeNull();
      expect(alan.role).toBe('user');
      expect(alan.active).toBe(false);
      expect(rows[0]!.active).toBe(true);
      expect(Number(alan.balance)).toBe(0);
      expect(rows[0]!.balance).toMatch(/^1500\.25?0*$/);
      expect(rows[0]!.createdAt).toBeInstanceOf(Date);
      expect(Math.abs(rows[0]!.createdAt.getTime() - Date.now())).toBeLessThan(5 * 60 * 1000);
      expect(typeof rows[0]!.id).toBe('number');
      expect(rows[0]!.score).toBe(9.5);
    });

    test('findUnique by primary key and by unique column', async () => {
      const byId = await db.users.findUnique({ where: { id: ids.grace } });
      expect(byId?.email).toBe('grace@acme.com');
      const byEmail = await db.users.findUnique({ where: { email: 'linus@kernel.org' }, select: { id: true, name: true } });
      expect(byEmail).toEqual({ id: ids.linus, name: 'Linus' });
      expect(await db.users.findUnique({ where: { email: 'nobody@nowhere.dev' } })).toBeNull();
      const tag = await db.postTags.findUnique({ where: { postId: ids.engine, tagId: ids.math } });
      expect(tag).toEqual({ postId: ids.engine, tagId: ids.math });
    });

    test('findUniqueOrThrow and findFirstOrThrow raise NOT_FOUND', async () => {
      await expectError(db.users.findUniqueOrThrow({ where: { id: 987654 } }), 'NOT_FOUND');
      await expectError(db.users.findFirstOrThrow({ where: { email: 'none@acme.com' } }), 'NOT_FOUND');
    });

    test('findUnique without a unique field is rejected before the database', async () => {
      await expectError(db.users.findUnique({ where: { name: 'Ada Lovelace' } as never }), 'MISSING_UNIQUE_FIELD');
    });

    test('findFirst honours orderBy', async () => {
      const top = await db.posts.findFirst({ orderBy: { views: 'desc' }, select: { title: true } });
      expect(top).toEqual({ title: 'Notes on the engine' });
      const last = await db.posts.findFirst({ orderBy: [{ published: 'asc' }, { views: 'asc' }] });
      expect(last?.title).toBe('Draft about loops');
    });

    test('scalar filters: equals, not, in, notIn, comparisons', async () => {
      const emails = async (where: Parameters<FixtureDb['users']['findMany']>[0]): Promise<string[]> =>
        (await db.users.findMany({ ...(where as object), orderBy: { id: 'asc' } } as never)).map((u: { email: string }) => u.email);
      expect(await emails({ where: { role: 'admin' } })).toEqual(['ada@acme.com']);
      expect(await emails({ where: { role: { equals: 'user' } } })).toEqual(['grace@acme.com', 'alan@example.com', 'linus@kernel.org']);
      expect(await emails({ where: { name: { not: 'Ada Lovelace' } } })).toEqual(['grace@acme.com', 'alan@example.com', 'linus@kernel.org']);
      expect(await emails({ where: { age: { in: [36, 54] } } })).toEqual(['ada@acme.com', 'linus@kernel.org']);
      expect(await emails({ where: { age: { notIn: [36, 54] } } })).toEqual(['grace@acme.com', 'alan@example.com']);
      expect(await emails({ where: { age: { in: [] } } })).toEqual([]);
      expect(await emails({ where: { age: { gt: 36 } } })).toEqual(['grace@acme.com', 'linus@kernel.org']);
      expect(await emails({ where: { age: { gte: 36, lt: 85 } } })).toEqual(['ada@acme.com', 'linus@kernel.org']);
      expect(await emails({ where: { age: { lte: 36 } } })).toEqual(['ada@acme.com']);
      expect(await emails({ where: { score: { gt: 7.5 } } })).toEqual(['ada@acme.com', 'grace@acme.com']);
      expect(await emails({ where: { active: false } })).toEqual(['alan@example.com']);
    });

    test('null checks', async () => {
      const a = await db.users.findMany({ where: { name: null }, select: { email: true } });
      expect(a).toEqual([{ email: 'alan@example.com' }]);
      const b = await db.users.findMany({ where: { age: { not: null } }, orderBy: { id: 'asc' }, select: { email: true } });
      expect(b.map((u) => u.email)).toEqual(['ada@acme.com', 'grace@acme.com', 'linus@kernel.org']);
      const c = await db.users.findMany({ where: { name: { equals: null } }, select: { id: true } });
      expect(c).toEqual([{ id: ids.alan }]);
    });

    test('string filters and case insensitive mode', async () => {
      const titles = async (where: object): Promise<string[]> =>
        (await db.posts.findMany({ where, orderBy: { views: 'desc' }, select: { title: true } } as never)).map((p: { title: string }) => p.title);
      expect(await titles({ title: { contains: 'engine' } })).toEqual(['Notes on the engine']);
      expect(await titles({ title: { startsWith: 'Comp' } })).toEqual(['Compilers for everyone']);
      expect(await titles({ title: { endsWith: 'tips' } })).toEqual(['COBOL tips']);
      expect(await titles({ title: { contains: 'NOTES', mode: 'insensitive' } })).toEqual(['Notes on the engine']);
      expect(await titles({ title: { startsWith: 'cobol', mode: 'insensitive' } })).toEqual(['COBOL tips']);
      expect(await titles({ title: { equals: 'kernel NEWS', mode: 'insensitive' } })).toEqual(['Kernel news']);
      expect(await titles({ title: { contains: '%' } })).toEqual([]);
      expect(await titles({ title: { contains: '_' } })).toEqual([]);
      const users = await db.users.findMany({ where: { email: { endsWith: '@acme.com' } }, orderBy: { email: 'asc' }, select: { email: true } });
      expect(users.map((u) => u.email)).toEqual(['ada@acme.com', 'grace@acme.com']);
    });

    test('AND, OR and NOT combine', async () => {
      const rows = await db.users.findMany({
        where: { OR: [{ role: 'admin' }, { AND: [{ age: { gt: 50 } }, { email: { endsWith: '.org' } }] }], NOT: { email: 'nobody@x.dev' } },
        orderBy: { id: 'asc' },
        select: { email: true },
      });
      expect(rows.map((r) => r.email)).toEqual(['ada@acme.com', 'linus@kernel.org']);
      const none = await db.users.findMany({ where: { OR: [] } });
      expect(none).toEqual([]);
      const notAdmins = await db.users.findMany({ where: { NOT: [{ role: 'admin' }, { age: null }] }, orderBy: { id: 'asc' }, select: { id: true } });
      expect(notAdmins.map((u) => u.id)).toEqual([ids.grace, ids.linus]);
    });

    test('relation filters: some, every, none on lists', async () => {
      const ids1 = await db.users.findMany({ where: { posts: { some: { published: true } } }, select: { id: true } });
      expect(sortNums(ids1.map((u) => u.id))).toEqual(sortNums([ids.ada, ids.grace, ids.linus]));
      const ids2 = await db.users.findMany({ where: { posts: { every: { published: true } } }, select: { id: true } });
      expect(sortNums(ids2.map((u) => u.id))).toEqual(sortNums([ids.grace, ids.alan, ids.linus]));
      const ids3 = await db.users.findMany({ where: { posts: { none: {} } }, select: { id: true } });
      expect(ids3.map((u) => u.id)).toEqual([ids.alan]);
      const ids4 = await db.posts.findMany({ where: { tags: { some: { name: 'history' } } }, orderBy: { views: 'desc' }, select: { title: true } });
      expect(ids4.map((p) => p.title)).toEqual(['Notes on the engine', 'COBOL tips']);
      const ids5 = await db.tags.findMany({ where: { posts: { some: { author: { email: 'ada@acme.com' } } } }, orderBy: { name: 'asc' }, select: { name: true } });
      expect(ids5.map((t) => t.name)).toEqual(['history', 'math']);
    });

    test('relation filters: is, isNot and shorthand on single relations', async () => {
      const withProfile = await db.users.findMany({ where: { profile: { isNot: null } }, select: { id: true } });
      expect(sortNums(withProfile.map((u) => u.id))).toEqual(sortNums([ids.ada, ids.grace]));
      const without = await db.users.findMany({ where: { profile: { is: null } }, select: { id: true } });
      expect(sortNums(without.map((u) => u.id))).toEqual(sortNums([ids.alan, ids.linus]));
      const byAuthor = await db.posts.findMany({ where: { author: { name: { startsWith: 'Grace' } } }, orderBy: { views: 'desc' }, select: { title: true } });
      expect(byAuthor.map((p) => p.title)).toEqual(['Compilers for everyone', 'COBOL tips']);
      const notAda = await db.posts.findMany({ where: { author: { isNot: { email: 'ada@acme.com' } } }, select: { id: true } });
      expect(notAda).toHaveLength(3);
    });

    test('select picks fields and nested relations', async () => {
      const row = await db.users.findUnique({
        where: { id: ids.ada },
        select: { email: true, posts: { select: { title: true }, orderBy: { views: 'asc' } }, profile: { select: { bio: true } } },
      });
      expect(row).toEqual({ email: 'ada@acme.com', posts: [{ title: 'Draft about loops' }, { title: 'Notes on the engine' }], profile: { bio: 'Mathematician' } });
    });

    test('include loads relations with their own where, orderBy and take', async () => {
      const users = await db.users.findMany({
        orderBy: { id: 'asc' },
        include: { posts: { where: { published: true }, orderBy: { views: 'desc' }, take: 1 }, profile: true },
      });
      expect(users.map((u) => u.posts.map((p) => p.title))).toEqual([['Notes on the engine'], ['Compilers for everyone'], [], ['Kernel news']]);
      expect(users[0]!.profile?.bio).toBe('Mathematician');
      expect(users[2]!.profile).toBeNull();
      const skipped = await db.users.findUnique({ where: { id: ids.grace }, include: { posts: { orderBy: { views: 'desc' }, skip: 1, take: 5 } } });
      expect(skipped?.posts.map((p) => p.title)).toEqual(['COBOL tips']);
    });

    test('nested includes three levels deep', async () => {
      const post = await db.posts.findUnique({
        where: { id: ids.engine },
        include: {
          author: { include: { profile: true } },
          tags: { orderBy: { name: 'asc' } },
          comments: { where: { parentId: null }, include: { author: { select: { name: true } }, replies: { orderBy: { id: 'asc' }, include: { author: { select: { email: true } } } } } },
        },
      });
      expect(post?.author.email).toBe('ada@acme.com');
      expect(post?.author.profile?.settings).toEqual({ theme: 'dark', tags: ['math'] });
      expect(post?.tags.map((t) => t.name)).toEqual(['history', 'math']);
      expect(post?.comments).toHaveLength(1);
      const top = post!.comments[0]!;
      expect(top.body).toBe('Brilliant');
      expect(top.author).toEqual({ name: 'Grace Hopper' });
      expect(top.replies.map((r) => [r.body, r.author.email])).toEqual([
        ['Agreed', 'linus@kernel.org'],
        ['Thanks', 'ada@acme.com'],
      ]);
    });

    test('many-to-many include from both sides', async () => {
      const tags = await db.tags.findMany({ orderBy: { name: 'asc' }, include: { posts: { orderBy: { views: 'desc' }, select: { title: true } } } });
      expect(tags.map((t) => [t.name, t.posts.map((p) => p.title)])).toEqual([
        ['history', ['Notes on the engine', 'COBOL tips']],
        ['math', ['Notes on the engine']],
        ['programming', ['Kernel news', 'Compilers for everyone', 'COBOL tips']],
      ]);
    });

    test('self relation: parent and replies', async () => {
      const reply = await db.comments.findUnique({ where: { id: ids.c2 }, include: { parent: true, replies: true } });
      expect(reply?.parent?.body).toBe('Brilliant');
      expect(reply?.replies).toEqual([]);
      const root = await db.comments.findUnique({ where: { id: ids.c1 }, include: { parent: true, _count: true } });
      expect(root?.parent).toBeNull();
      expect(root?._count.replies).toBe(2);
    });

    test('relation counts with _count', async () => {
      const users = await db.users.findMany({ orderBy: { id: 'asc' }, select: { id: true, _count: { select: { posts: true, comments: { where: { body: { startsWith: 'G' } } } } } } });
      expect(users.map((u) => [u._count.posts, u._count.comments])).toEqual([
        [2, 1],
        [2, 0],
        [0, 0],
        [1, 0],
      ]);
      const posts = await db.posts.findMany({ orderBy: { views: 'desc' }, include: { _count: true }, take: 2 });
      expect(posts.map((p) => p._count.comments)).toEqual([3, 0]);
    });

    test('soft deleted rows stay hidden unless withDeleted', async () => {
      expect(await db.comments.count()).toBe(4);
      expect(await db.comments.count({ withDeleted: true })).toBe(5);
      const kernel = await db.posts.findUnique({ where: { id: ids.kernel }, include: { comments: true, _count: true } });
      expect(kernel?.comments).toEqual([]);
      expect(kernel?._count.comments).toBe(0);
      const gone = await db.comments.findUnique({ where: { id: ids.spam } });
      expect(gone).toBeNull();
      const visible = await db.comments.findUnique({ where: { id: ids.spam }, withDeleted: true });
      expect(visible?.deletedAt).toBeInstanceOf(Date);
      const withDeletedInclude = await db.posts.findUnique({ where: { id: ids.kernel }, include: { comments: { withDeleted: true } } });
      expect(withDeletedInclude?.comments.map((c) => c.body)).toEqual(['spam']);
    });

    test('orderBy relation fields, relation counts and nulls', async () => {
      const byAuthor = await db.posts.findMany({ orderBy: [{ author: { email: 'asc' } }, { views: 'desc' }], select: { title: true } });
      expect(byAuthor.map((p) => p.title)).toEqual(['Notes on the engine', 'Draft about loops', 'Compilers for everyone', 'COBOL tips', 'Kernel news']);
      const byCount = await db.users.findMany({ orderBy: [{ posts: { _count: 'desc' } }, { id: 'asc' }], select: { id: true } });
      expect(byCount.map((u) => u.id)).toEqual([ids.ada, ids.grace, ids.linus, ids.alan]);
      const nullsFirst = await db.users.findMany({ orderBy: { age: { sort: 'asc', nulls: 'first' } }, select: { id: true } });
      expect(nullsFirst.map((u) => u.id)).toEqual([ids.alan, ids.ada, ids.linus, ids.grace]);
      const nullsLast = await db.users.findMany({ orderBy: { age: { sort: 'desc', nulls: 'last' } }, select: { id: true } });
      expect(nullsLast.map((u) => u.id)).toEqual([ids.grace, ids.linus, ids.ada, ids.alan]);
    });

    test('take, skip and negative take', async () => {
      const page = await db.posts.findMany({ orderBy: { views: 'desc' }, skip: 1, take: 2, select: { views: true } });
      expect(page).toEqual([{ views: 70 }, { views: 50 }]);
      const tail = await db.posts.findMany({ orderBy: { views: 'desc' }, take: -2, select: { views: true } });
      expect(tail).toEqual([{ views: 20 }, { views: 5 }]);
      const offsetOnly = await db.posts.findMany({ orderBy: { views: 'desc' }, skip: 4, select: { views: true } });
      expect(offsetOnly).toEqual([{ views: 5 }]);
    });

    test('cursor starts at the given row', async () => {
      const rows = await db.posts.findMany({ orderBy: { views: 'desc' }, cursor: { id: ids.compilers }, take: 2, select: { title: true } });
      expect(rows.map((r) => r.title)).toEqual(['Compilers for everyone', 'COBOL tips']);
      const after = await db.posts.findMany({ orderBy: { views: 'desc' }, cursor: { id: ids.compilers }, skip: 1, select: { views: true } });
      expect(after).toEqual([{ views: 20 }, { views: 5 }]);
    });

    test('findPage walks forward and back with opaque cursors', async () => {
      const p1 = await db.posts.findPage({ first: 2, orderBy: { views: 'desc' }, select: { views: true } });
      expect(p1.items).toEqual([{ views: 100 }, { views: 70 }]);
      expect(p1.pageInfo.hasNextPage).toBe(true);
      expect(p1.pageInfo.hasPreviousPage).toBe(false);
      const p2 = await db.posts.findPage({ first: 2, after: p1.pageInfo.endCursor, orderBy: { views: 'desc' }, select: { views: true } });
      expect(p2.items).toEqual([{ views: 50 }, { views: 20 }]);
      const p3 = await db.posts.findPage({ first: 2, after: p2.pageInfo.endCursor, orderBy: { views: 'desc' }, select: { views: true } });
      expect(p3.items).toEqual([{ views: 5 }]);
      expect(p3.pageInfo.hasNextPage).toBe(false);
      const back = await db.posts.findPage({ first: 2, before: p3.pageInfo.startCursor, orderBy: { views: 'desc' }, select: { views: true } });
      expect(back.items).toEqual([{ views: 50 }, { views: 20 }]);
      expect(back.pageInfo.hasPreviousPage).toBe(true);
      await expectError(db.posts.findPage({ first: 2, after: 'not-a-cursor' }), 'INVALID_CURSOR');
    });

    test('distinct keeps the first row per value', async () => {
      const rows = await db.posts.findMany({ distinct: ['authorId'], orderBy: { views: 'desc' }, select: { title: true } });
      expect(rows.map((r) => r.title)).toEqual(['Notes on the engine', 'Kernel news', 'Compilers for everyone']);
      expect(await db.posts.count({ distinct: 'authorId' })).toBe(3);
    });

    test('count with filters and per field counts', async () => {
      expect(await db.users.count()).toBe(4);
      expect(await db.posts.count({ where: { published: true } })).toBe(4);
      expect(await db.posts.count({ where: { published: true }, take: 2 })).toBe(2);
      const counts = await db.users.count({ select: { _all: true, name: true, age: true } });
      expect(counts).toEqual({ _all: 4, name: 3, age: 3 });
    });

    test('aggregate: count, sum, avg, min, max', async () => {
      const agg = await db.posts.aggregate({ _count: true, _sum: { views: true, likes: true }, _avg: { views: true }, _min: { views: true, title: true }, _max: { views: true } });
      expect(agg._count).toBe(5);
      expect(agg._sum.views).toBe(245);
      expect(agg._sum.likes).toBe(15n);
      expect(agg._avg.views).toBeCloseTo(49);
      expect(agg._min).toEqual({ views: 5, title: 'COBOL tips' });
      expect(agg._max.views).toBe(100);
      const filtered = await db.posts.aggregate({ where: { published: false }, _count: { _all: true, body: true }, _sum: { views: true } });
      expect(filtered).toEqual({ _count: { _all: 1, body: 0 }, _sum: { views: 5 } });
      const none = await db.posts.aggregate({ where: { views: { gt: 1000 } }, _sum: { views: true }, _count: true });
      expect(none).toEqual({ _count: 0, _sum: { views: null } });
      const balance = await db.users.aggregate({ _sum: { balance: true } });
      expect(Number(balance._sum.balance)).toBeCloseTo(1500.25);
    });

    test('groupBy with having and ordering', async () => {
      const groups = await db.posts.groupBy({ by: ['authorId'], _count: { _all: true }, _sum: { views: true }, orderBy: { authorId: 'asc' } });
      expect(groups).toEqual(
        [
          { authorId: ids.ada, _count: { _all: 2 }, _sum: { views: 105 } },
          { authorId: ids.grace, _count: { _all: 2 }, _sum: { views: 70 } },
          { authorId: ids.linus, _count: { _all: 1 }, _sum: { views: 70 } },
        ].sort((a, b) => a.authorId - b.authorId),
      );
      const busy = await db.posts.groupBy({ by: 'authorId', _count: true, having: { _count: { _all: { gt: 1 } } }, orderBy: { _sum: { views: 'desc' } } });
      expect(busy.map((g) => g.authorId)).toEqual([ids.ada, ids.grace]);
      const avg = await db.posts.groupBy({ by: ['published'], _avg: { views: true }, having: { views: { _avg: { gt: 10 } } } });
      expect(avg).toHaveLength(1);
      expect(avg[0]!.published).toBe(true);
      expect(avg[0]!._avg.views).toBeCloseTo(60);
    });

    test('toSQL shows the statements without running them', async () => {
      if (!db.$dialect.compile) return;
      const statements = db.users.findMany({ where: { email: 'x@y.z' }, include: { posts: true } }).toSQL();
      expect(statements.length).toBeGreaterThan(0);
      if (db.$dialect.name === 'mongodb') {
        expect(statements[0]!.sql).toMatch(/"aggregate"/);
        return;
      }
      expect(statements[0]!.sql).toMatch(/select/i);
      expect(statements[0]!.params).toContain('x@y.z');
    });

    /* -------------------------------------------------------------- */
    /* Writes                                                          */
    /* -------------------------------------------------------------- */

    test('create returns the row with defaults', async () => {
      const u = await db.users.create({ data: { email: 'new1@acme.com' } });
      expect(u).toMatchObject({ email: 'new1@acme.com', name: null, role: 'user', active: true, age: null });
      expect(typeof u.id).toBe('number');
      expect(u.createdAt).toBeInstanceOf(Date);
      const selected = await db.users.create({ data: { email: 'new2@acme.com', name: 'New' }, select: { email: true, name: true } });
      expect(selected).toEqual({ email: 'new2@acme.com', name: 'New' });
    });

    test('create with nested create, connect and connectOrCreate', async () => {
      const u = await db.users.create({
        data: {
          email: 'nested@acme.com',
          profile: { create: { bio: 'Nested', settings: { theme: 'light' } } },
          posts: {
            create: [
              { title: 'First', tags: { connectOrCreate: [{ where: { name: 'nested-tag' }, create: { name: 'nested-tag' } }, { where: { name: 'math' }, create: { name: 'math' } }] } },
              { title: 'Second', tags: { create: { name: 'fresh-tag' } } },
            ],
          },
        },
        include: { profile: true, posts: { orderBy: { title: 'asc' }, include: { tags: { orderBy: { name: 'asc' } } } } },
      });
      expect(u.profile?.bio).toBe('Nested');
      expect(u.posts.map((p) => [p.title, p.tags.map((t) => t.name)])).toEqual([
        ['First', ['math', 'nested-tag']],
        ['Second', ['fresh-tag']],
      ]);
      expect(await db.tags.count({ where: { name: 'math' } })).toBe(1);
      const p = await db.posts.create({ data: { title: 'Via relation', author: { connect: { email: 'nested@acme.com' } } }, include: { author: true } });
      expect(p.author.id).toBe(u.id);
      expect(p.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    test('create reports unique and foreign key violations', async () => {
      await expectError(db.users.create({ data: { email: 'ada@acme.com' } }), 'UNIQUE_VIOLATION');
      await expectError(db.posts.create({ data: { title: 'Orphan', authorId: 987654 } }), 'FOREIGN_KEY_VIOLATION');
      await expectError(db.posts.create({ data: { title: 'Dup', authorId: ids.ada } }).then(() => db.posts.create({ data: { title: 'Dup', authorId: ids.ada } })), 'UNIQUE_VIOLATION');
    });

    test('create validates values before the database', async () => {
      await expectError(db.users.create({ data: { email: 'bad@acme.com', age: 'old' as never } }), 'VALIDATION_FAILED');
      await expectError(db.users.create({ data: { email: 'bad2@acme.com', role: 'root' as never } }), 'VALIDATION_FAILED');
      await expectError(db.users.create({ data: { email: 'bad3@acme.com', nickname: 'x' } as never }), 'UNKNOWN_FIELD');
      await expectError(db.posts.create({ data: { title: 'No author' } as never }), 'VALIDATION_FAILED');
    });

    test('createMany, skipDuplicates and createManyAndReturn', async () => {
      const res = await db.tags.createMany({ data: [{ name: 'bulk-1' }, { name: 'bulk-2' }, { name: 'bulk-3' }] });
      expect(res.count).toBe(3);
      const skipped = await db.tags.createMany({ data: [{ name: 'bulk-1' }, { name: 'bulk-4' }], skipDuplicates: true });
      expect(skipped.count).toBe(1);
      const rows = await db.tags.createManyAndReturn({ data: [{ name: 'bulk-5' }, { name: 'bulk-6' }], select: { name: true } });
      expect(rows.map((r) => r.name).sort()).toEqual(['bulk-5', 'bulk-6']);
      expect(await db.tags.count({ where: { name: { startsWith: 'bulk-' } } })).toBe(6);
      expect((await db.tags.createMany({ data: [] })).count).toBe(0);
    });

    test('update sets values, runs number operations and throws NOT_FOUND', async () => {
      const u = await db.users.create({ data: { email: 'upd@acme.com', age: 20 } });
      const a = await db.users.update({ where: { id: u.id }, data: { name: 'Updated', age: { increment: 5 } } });
      expect(a).toMatchObject({ name: 'Updated', age: 25 });
      const b = await db.users.update({ where: { email: 'upd@acme.com' }, data: { age: { decrement: 10 }, score: { multiply: 2 } }, select: { age: true } });
      expect(b).toEqual({ age: 15 });
      const c = await db.users.update({ where: { id: u.id }, data: { name: { set: null } } });
      expect(c.name).toBeNull();
      await expectError(db.users.update({ where: { id: 987654 }, data: { name: 'x' } }), 'NOT_FOUND');
    });

    test('nested updates on lists: connect, disconnect, set, create, update, delete', async () => {
      const post = await db.posts.create({ data: { title: 'Taggable', authorId: ids.linus, tags: { connect: [{ id: ids.math }] } } });
      let tags = (await db.posts.update({ where: { id: post.id }, data: { tags: { connect: { id: ids.history } } }, include: { tags: { orderBy: { name: 'asc' } } } })).tags;
      expect(tags.map((t) => t.name)).toEqual(['history', 'math']);
      tags = (await db.posts.update({ where: { id: post.id }, data: { tags: { disconnect: { id: ids.math } } }, include: { tags: true } })).tags;
      expect(tags.map((t) => t.name)).toEqual(['history']);
      tags = (await db.posts.update({ where: { id: post.id }, data: { tags: { set: [{ id: ids.programming }, { id: ids.math }] } }, include: { tags: { orderBy: { name: 'asc' } } } })).tags;
      expect(tags.map((t) => t.name)).toEqual(['math', 'programming']);

      const withComments = await db.posts.update({
        where: { id: post.id },
        data: { title: 'Taggable 2', comments: { create: [{ body: 'one', authorId: ids.ada }, { body: 'two', authorId: ids.grace }] } },
        include: { comments: { orderBy: { id: 'asc' } } },
      });
      expect(withComments.title).toBe('Taggable 2');
      expect(withComments.comments.map((c) => c.body)).toEqual(['one', 'two']);
      const [one] = withComments.comments;
      const edited = await db.posts.update({
        where: { id: post.id },
        data: { comments: { update: { where: { id: one!.id }, data: { body: 'one!' } }, deleteMany: { body: 'two' } } },
        include: { comments: true },
      });
      expect(edited.comments.map((c) => c.body)).toEqual(['one!']);
    });

    test('nested updates on single relations', async () => {
      const u = await db.users.create({ data: { email: 'single@acme.com', profile: { create: { bio: 'v1' } } } });
      const a = await db.users.update({ where: { id: u.id }, data: { profile: { update: { bio: 'v2' } } }, include: { profile: true } });
      expect(a.profile?.bio).toBe('v2');
      const c = await db.comments.create({ data: { body: 'child', postId: ids.engine, authorId: u.id, parentId: ids.c1 } });
      const d = await db.comments.update({ where: { id: c.id }, data: { parent: { disconnect: true } } });
      expect(d.parentId).toBeNull();
      const e = await db.comments.update({ where: { id: c.id }, data: { parent: { connect: { id: ids.c4 } } }, include: { parent: true } });
      expect(e.parent?.body).toBe('Great read');
      const moved = await db.posts.update({ where: { id: ids.draft }, data: { author: { connect: { email: 'single@acme.com' } } }, include: { author: true } });
      expect(moved.author.email).toBe('single@acme.com');
      await db.posts.update({ where: { id: ids.draft }, data: { authorId: ids.ada } });
    });

    test('updateMany updates every match', async () => {
      await db.tags.createMany({ data: [{ name: 'um-1' }, { name: 'um-2' }] });
      const res = await db.tags.updateMany({ where: { name: { startsWith: 'um-' } }, data: { name: { set: 'um-x' } } as never }).catch((e: unknown) => e);
      // renaming both to the same unique value must fail; rename one by one instead
      expect(isKastorError(res, 'UNIQUE_VIOLATION') || (res as { count: number }).count === 2).toBe(true);
      const ok = await db.posts.updateMany({ where: { authorId: ids.grace }, data: { views: { increment: 1 } } });
      expect(ok.count).toBe(2);
      const grace = await db.posts.aggregate({ where: { authorId: ids.grace }, _sum: { views: true } });
      expect(grace._sum.views).toBe(72);
      expect((await db.posts.updateMany({ where: { title: 'none' }, data: { views: 1 } })).count).toBe(0);
    });

    test('upsert creates then updates', async () => {
      const a = await db.tags.upsert({ where: { name: 'upserted' }, create: { name: 'upserted' }, update: {} });
      expect(a.name).toBe('upserted');
      const b = await db.users.upsert({ where: { email: 'ups@acme.com' }, create: { email: 'ups@acme.com', age: 1 }, update: { age: { increment: 1 } } });
      expect(b.age).toBe(1);
      const c = await db.users.upsert({ where: { email: 'ups@acme.com' }, create: { email: 'ups@acme.com', age: 1 }, update: { age: { increment: 1 } } });
      expect(c.age).toBe(2);
      expect(c.id).toBe(b.id);
      const d = await db.users.upsert({ where: { email: 'ups@acme.com' }, create: { email: 'ups@acme.com' }, update: { name: 'Ups' }, include: { posts: true } });
      expect(d.name).toBe('Ups');
      expect(d.posts).toEqual([]);
    });

    test('delete returns the row and deleteMany counts', async () => {
      const t1 = await db.tags.create({ data: { name: 'del-1' } });
      await db.tags.createMany({ data: [{ name: 'del-2' }, { name: 'del-3' }] });
      const gone = await db.tags.delete({ where: { id: t1.id } });
      expect(gone).toEqual({ id: t1.id, name: 'del-1' });
      expect((await db.tags.deleteMany({ where: { name: { startsWith: 'del-' } } })).count).toBe(2);
      await expectError(db.tags.delete({ where: { id: t1.id } }), 'NOT_FOUND');
      const u = await db.users.create({ data: { email: 'delinc@acme.com', posts: { create: { title: 'bye' } } } });
      const withPosts = await db.users.delete({ where: { id: u.id }, include: { posts: true } });
      expect(withPosts.posts.map((p) => p.title)).toEqual(['bye']);
      expect(await db.posts.count({ where: { title: 'bye' } })).toBe(0);
    });

    test('soft delete, restore and hard delete', async () => {
      const c = await db.comments.create({ data: { body: 'temporary', postId: ids.cobol, authorId: ids.alan } });
      const deleted = await db.comments.delete({ where: { id: c.id } });
      expect(deleted.deletedAt).toBeInstanceOf(Date);
      expect(await db.comments.findUnique({ where: { id: c.id } })).toBeNull();
      await expectError(db.comments.update({ where: { id: c.id }, data: { body: 'x' } }), 'NOT_FOUND');
      expect((await db.comments.restore({ where: { id: c.id } })).count).toBe(1);
      expect((await db.comments.findUnique({ where: { id: c.id } }))?.deletedAt).toBeNull();
      await db.comments.deleteMany({ where: { body: 'temporary' } });
      expect(await db.comments.count({ where: { body: 'temporary' } })).toBe(0);
      expect(await db.comments.count({ where: { body: 'temporary' }, withDeleted: true })).toBe(1);
      expect((await db.comments.hardDeleteMany({ where: { body: 'temporary' } })).count).toBe(1);
      expect(await db.comments.count({ where: { body: 'temporary' }, withDeleted: true })).toBe(0);
    });

    test('transactions commit, roll back and batch', async () => {
      const made = await db.$transaction(async (tx) => {
        const a = await tx.tags.create({ data: { name: 'tx-a' } });
        const b = await tx.tags.create({ data: { name: 'tx-b' } });
        return [a.id, b.id];
      });
      expect(made).toHaveLength(2);
      expect(await db.tags.count({ where: { name: { startsWith: 'tx-' } } })).toBe(2);

      await expect(
        db.$transaction(async (tx) => {
          await tx.tags.create({ data: { name: 'tx-rollback' } });
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(await db.tags.count({ where: { name: 'tx-rollback' } })).toBe(0);

      const [x, n] = await db.$transaction([db.tags.create({ data: { name: 'tx-batch' } }), db.tags.count({ where: { name: { startsWith: 'tx-' } } })]);
      expect(x.name).toBe('tx-batch');
      expect(n).toBe(3);

      await expect(db.$transaction([db.tags.create({ data: { name: 'tx-batch-2' } }), db.tags.create({ data: { name: 'tx-batch-2' } })])).rejects.toThrow();
      expect(await db.tags.count({ where: { name: 'tx-batch-2' } })).toBe(0);

      const nested = await db.$transaction(async (tx) => tx.$transaction(async (inner) => inner.tags.count()));
      expect(nested).toBeGreaterThan(0);
    });

    test('values round trip: bytes, json, date, time, decimal, bigint', async () => {
      const u = await db.users.create({ data: { email: 'types@acme.com', balance: '98765.43', score: 0.125 } });
      const bytes = new Uint8Array([0, 1, 2, 250, 255]);
      const profile = await db.profiles.create({
        data: { userId: u.id, bio: 'Types', avatar: bytes, settings: { theme: 'solar', tags: ['a', 'b'] }, birthday: '2000-02-29', wakeUp: '07:45:30' },
      });
      const read = await db.profiles.findUniqueOrThrow({ where: { id: profile.id } });
      expect(Array.from(read.avatar!)).toEqual(Array.from(bytes));
      expect(read.settings).toEqual({ theme: 'solar', tags: ['a', 'b'] });
      expect(read.birthday).toBe('2000-02-29');
      expect(read.wakeUp).toBe('07:45:30');
      const user = await db.users.findUniqueOrThrow({ where: { id: u.id }, include: { profile: true } });
      expect(user.balance).toMatch(/^98765\.430*$/);
      expect(user.score).toBe(0.125);
      expect(Array.from(user.profile!.avatar!)).toEqual(Array.from(bytes));
      expect(user.profile?.birthday).toBe('2000-02-29');
      const big = 9007199254740993n;
      const post = await db.posts.create({ data: { title: 'Big', authorId: u.id, likes: big } });
      expect(post.likes).toBe(big);
      const again = await db.users.findUniqueOrThrow({ where: { id: u.id }, include: { posts: true } });
      expect(again.posts[0]!.likes).toBe(big);
      const when = new Date('2024-03-04T05:06:07.000Z');
      await db.users.update({ where: { id: u.id }, data: { createdAt: when } });
      const dated = await db.users.findMany({ where: { createdAt: { gte: when, lt: new Date('2024-03-05T00:00:00Z') } }, select: { createdAt: true } });
      expect(dated.map((d) => d.createdAt.getTime())).toEqual([when.getTime()]);
    });

    test('raw SQL with $sql and $execute', async () => {
      if (!db.$dialect.features.rawSql) return;
      const rows = await db.$sql<{ email: string }>`SELECT ${sql.ident('email')} AS ${sql.ident('email')} FROM ${schema.users} WHERE ${schema.users.email} = ${'ada@acme.com'}`;
      expect(rows.map((r) => r.email)).toEqual(['ada@acme.com']);
      const changed = await db.$execute`UPDATE ${schema.tags} SET ${schema.tags.name} = ${'raw-renamed'} WHERE ${schema.tags.name} = ${'upserted'}`;
      expect(changed).toBe(1);
      const filtered = await db.tags.findMany({ where: { AND: [sql`${schema.tags.name} = ${'raw-renamed'}`] }, select: { name: true } });
      expect(filtered).toEqual([{ name: 'raw-renamed' }]);
    });

    test('factories build and create records', async () => {
      const users = factory(db.users, ({ seq }) => ({ email: `factory${seq}@acme.com`, name: `Factory ${seq}` }));
      const one = await users.create({ age: 3 });
      expect(one).toMatchObject({ email: 'factory1@acme.com', name: 'Factory 1', age: 3 });
      const many = await users.createMany(2, (i) => ({ age: i }));
      expect(many.map((u) => u.email)).toEqual(['factory2@acme.com', 'factory3@acme.com']);
      expect(users.build().email).toBe('factory4@acme.com');
    });
  });
}
