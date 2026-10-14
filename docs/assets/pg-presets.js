// Examples for the live playground. Every preset shares the default schema
// unless it brings its own.
export const SCHEMA = `import { table, t, one, many, index } from 'kastor'

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
