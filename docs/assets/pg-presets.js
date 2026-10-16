// Examples for the live playground. Every preset shares the default schema
// unless it brings its own.
export const SCHEMA = `import { table, t, one, many, index } from 'kastor-orm'

export const users = table('users', {
  id: t.id(),
  email: t.string(255).unique(),
  name: t.string().nullable(),
  role: t.enum(['user', 'admin']).default('user'),
  createdAt: t.datetime().defaultNow(),
})

export const posts = table('posts', {
  id: t.id(),
  title: t.string(200),
  body: t.text().nullable(),
  published: t.boolean().default(false),
  views: t.int().default(0),
  authorId: t.int().references(() => users.id, { onDelete: 'cascade' }),
}, { indexes: (p) => [index(p.authorId)] })

export const tags = table('tags', {
  id: t.id(),
  name: t.string(50).unique(),
})

export const postTags = table('post_tags', {
  postId: t.int().references(() => posts.id, { onDelete: 'cascade' }),
  tagId: t.int().references(() => tags.id, { onDelete: 'cascade' }),
}, { primaryKey: (c) => [c.postId, c.tagId] })

export const schema = { users, posts, tags, postTags }

export const relations = ({ users, posts, tags, postTags }: typeof schema) => ({
  users: { posts: many(posts) },
  posts: {
    author: one(users, { fields: ['authorId'], references: ['id'] }),
    tags: many(tags, { through: postTags }),
  },
})
`;

export const PRESETS = [
  {
    label: 'Users with posts',
    query: `db.users.findMany({
  where: { email: { endsWith: '@example.com' } },
  include: {
    posts: {
      where: { published: true },
      orderBy: { views: 'desc' },
      take: 3,
    },
  },
  orderBy: { id: 'asc' },
  take: 10,
})`,
  },
  {
    label: 'Filters',
    query: `db.posts.findMany({
  where: {
    OR: [
      { title: { contains: 'orm', mode: 'insensitive' } },
      { views: { gte: 100 } },
    ],
    author: { is: { role: 'admin' } },
    NOT: { body: null },
  },
  select: { id: true, title: true, views: true },
})`,
  },
  {
    label: 'Many to many',
    query: `db.posts.findFirst({
  where: { tags: { some: { name: 'typescript' } } },
  include: {
    author: { select: { name: true, email: true } },
    tags: true,
  },
})`,
  },
  {
    label: 'Relation counts',
    query: `db.users.findMany({
  select: {
    id: true,
    email: true,
    _count: { select: { posts: true } },
  },
  orderBy: { posts: { _count: 'desc' } },
  take: 5,
})`,
  },
  {
    label: 'Nested create',
    query: `db.users.create({
  data: {
    email: 'kas@example.com',
    name: 'Kas',
    posts: {
      create: [{ title: 'Logs all the way down' }],
    },
  },
})`,
  },
  {
    label: 'Upsert',
    query: `db.users.upsert({
  where: { email: 'ada@example.com' },
  create: { email: 'ada@example.com', name: 'Ada' },
  update: { name: 'Ada Lovelace' },
})`,
  },
  {
    label: 'Group by',
    query: `db.posts.groupBy({
  by: ['authorId'],
  _count: { _all: true },
  _sum: { views: true },
  having: { views: { _sum: { gt: 100 } } },
  orderBy: { _sum: { views: 'desc' } },
})`,
  },
  {
    label: 'Update many',
    query: `db.posts.updateMany({
  where: { published: false, views: { lt: 100 } },
  data: { views: { increment: 1 } },
})`,
  },
];

// The five step tutorial: each step starts from the code below, asks for one
// small edit, and checks the edit on the parsed schema or the query text.
const T1 = `import { table, t } from 'kastor-orm'

export const users = table('users', {
  id: t.id(),
  email: t.string(255).unique(),
})
`;

const T2 = `import { table, t } from 'kastor-orm'

export const users = table('users', {
  id: t.id(),
  email: t.string(255).unique(),
  name: t.string().nullable(),
})

export const posts = table('posts', {
  id: t.id(),
  title: t.string(200),
})
`;

const T3 = `import { table, t, one, many } from 'kastor-orm'

export const users = table('users', {
  id: t.id(),
  email: t.string(255).unique(),
  name: t.string().nullable(),
})

export const posts = table('posts', {
  id: t.id(),
  title: t.string(200),
  authorId: t.int().references(() => users.id),
})

export const schema = { users, posts }

export const relations = ({ users, posts }: typeof schema) => ({
  users: { posts: many(posts) },
  posts: { author: one(users, { fields: ['authorId'], references: ['id'] }) },
})
`;

const T4 = T3.replace("  title: t.string(200),\n", "  title: t.string(200),\n  views: t.int().default(0),\n");

export const TUTORIAL = [
  {
    title: 'Create a table',
    text: 'A table is a plain TypeScript value. Add a <code>name</code> column to <code>users</code>, for example <code>name: t.string().nullable(),</code> and watch the CREATE TABLE statement follow.',
    schema: T1,
    query: 'db.users.findMany()',
    out: 'migration',
    file: 'schema',
    check: 'users.name',
    solution: { schema: T2.replace(/\n\nexport const posts[\s\S]*$/, '\n') },
  },
  {
    title: 'Add a relation',
    text: 'Every post needs an author. Add <code>authorId: t.int().references(() =&gt; users.id),</code> to <code>posts</code>. The migration gains a foreign key.',
    schema: T2,
    query: 'db.posts.findMany()',
    out: 'migration',
    file: 'schema',
    check: 'posts.authorId.references',
    solution: { schema: T3 },
  },
  {
    title: 'Include related rows',
    text: 'The schema now declares <code>relations</code>. In query.ts, add <code>include: { posts: true }</code>. The result type gains <code>posts</code>, and the SQL is still one statement.',
    schema: T3,
    query: `db.users.findMany({
  where: { email: { endsWith: '@example.com' } },
})`,
    out: 'type',
    file: 'query',
    check: 'query.include.posts',
    solution: { query: `db.users.findMany({
  where: { email: { endsWith: '@example.com' } },
  include: { posts: true },
})` },
  },
  {
    title: 'Change the schema, read the migration',
    text: 'Add <code>views: t.int().default(0),</code> to <code>posts</code>. The Migration tab shows the SQL that <code>npx kastor migrate dev</code> writes for a new database; on an existing one it writes only the change.',
    schema: T3,
    query: `db.users.findMany({
  include: { posts: true },
})`,
    out: 'migration',
    file: 'schema',
    check: 'posts.views',
    solution: { schema: T4 },
  },
  {
    title: 'Run it',
    text: 'Open the Rows tab to run the query on a real SQLite database in this page, seeded with sample rows. Then pick another database: the SQL follows.',
    schema: T4,
    query: `db.users.findMany({
  include: { posts: { orderBy: { views: 'desc' } } },
  take: 3,
})`,
    out: 'sql',
    file: 'query',
    check: 'rows',
    solution: {},
  },
];
