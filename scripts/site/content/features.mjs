// The feature tour on the home page: one drawing per feature.
export const FEATURES = [
  {
    id: 'schema',
    icon: 'schema',
    title: 'Schema in plain TypeScript',
    text: 'Tables, columns, indexes and relations are ordinary TypeScript values. No schema language to learn, no extension to install, and your editor already understands every line.',
    file: 'src/db/schema.ts',
    code: `import { table, t, index } from 'kastor-orm'

export const users = table('users', {
  id: t.id(),
  email: t.string(255).unique(),
  name: t.string().nullable(),
  role: t.enum(['user', 'admin']).default('user'),
  createdAt: t.datetime().defaultNow(),
})

export const posts = table('posts', {
  id: t.uuid().primaryKey().defaultRandom(),
  title: t.string(200),
  published: t.boolean().default(false),
  authorId: t.int().references(() => users.id, { onDelete: 'cascade' }),
}, { indexes: (p) => [index(p.authorId)] })`,
  },
  {
    id: 'types',
    icon: 'no-codegen',
    title: 'Types inferred as you type',
    text: 'There is no generate step. Change a column and every query that touches it is checked again on the next keystroke, in the editor and in CI, with nothing to regenerate.',
    file: 'src/types.ts',
    code: `import type { InferSelect, InferInsert } from 'kastor-orm'
import { users } from './db/schema'

type User = InferSelect<typeof users>
// { id: number; email: string; name: string | null;
//   role: 'user' | 'admin'; createdAt: Date }

type NewUser = InferInsert<typeof users>
// { email: string; name?: string | null; role?: 'user' | 'admin'; ... }`,
  },
  {
    id: 'queries',
    icon: 'query',
    title: 'Friendly, familiar queries',
    text: 'findMany, findUnique, create, update, upsert, count, aggregate and groupBy with where, select, orderBy, take, skip, cursor and distinct. Filters read like the sentence you would say out loud.',
    file: 'src/routes/users.ts',
    code: `const admins = await db.users.findMany({
  where: {
    role: 'admin',
    email: { endsWith: '@acme.com', mode: 'insensitive' },
    OR: [{ name: { startsWith: 'A' } }, { name: null }],
  },
  orderBy: { createdAt: 'desc' },
  take: 20,
})`,
  },
  {
    id: 'includes',
    icon: 'one-query',
    title: 'Nested includes in one query',
    text: 'Relations load with JSON aggregation inside a single statement on every SQL database, and as $lookup stages of one pipeline on MongoDB. Never one query per row.',
    file: 'src/routes/feed.ts',
    code: `const feed = await db.users.findMany({
  include: {
    posts: {
      where: { published: true },
      orderBy: { title: 'asc' },
      take: 3,
      include: { tags: true },
    },
    _count: { select: { posts: true } },
  },
})`,
  },
  {
    id: 'writes',
    icon: 'relations',
    title: 'Nested writes',
    text: 'Create a row with its children, or connect it to existing ones, in one call. kastor splits the work into single table writes inside one transaction.',
    file: 'src/signup.ts',
    code: `const user = await db.users.create({
  data: {
    email: 'ada@example.com',
    name: 'Ada',
    posts: {
      create: [{ title: 'Hello, rows' }, { title: 'Logs all the way down' }],
    },
  },
  include: { posts: true },
})`,
  },
  {
    id: 'transactions',
    icon: 'transactions',
    title: 'Transactions, both ways',
    text: 'An interactive callback when one step depends on the last, or an array of queries that run together. Errors roll everything back.',
    file: 'src/transfer.ts',
    code: `await db.$transaction(async (tx) => {
  const order = await tx.orders.create({ data: { userId, total } })
  await tx.stock.update({ where: { sku }, data: { count: { decrement: 1 } } })
  return order
})

await db.$transaction([
  db.sessions.deleteMany({ where: { userId } }),
  db.users.delete({ where: { id: userId } }),
])`,
  },
  {
    id: 'raw-sql',
    icon: 'raw-sql',
    title: 'Typed raw SQL',
    text: 'When a query is easier in SQL, write SQL. Template values become parameters, never string concatenation, and the row type is yours to declare.',
    file: 'src/reports.ts',
    code: `const since = new Date('2026-01-01')

const rows = await db.$sql<{ day: string; signups: number }>\`
  select date(created_at) as day, count(*) as signups
  from users
  where created_at >= \${since}
  group by day
  order by day
\``,
  },
  {
    id: 'errors',
    icon: 'errors',
    title: 'Errors that tell you the fix',
    text: 'Driver errors become a KastorError with a stable code, a plain English message and a hint, the same on every database.',
    file: 'src/signup.ts',
    code: `import { isKastorError } from 'kastor-orm'

try {
  await db.users.create({ data: { email } })
} catch (e) {
  if (isKastorError(e) && e.code === 'UNIQUE_VIOLATION') {
    console.log(e.message) // what went wrong, in plain English
    console.log(e.hint)    // how to fix it
  }
}`,
  },
  {
    id: 'migrations',
    icon: 'migrations',
    title: 'Automatic migrations',
    text: 'kastor diffs your TypeScript schema against the live database and writes a readable SQL file you can review and edit. A renamed column is a question, never a silent drop.',
    file: 'Terminal',
    lang: 'bash',
    kind: 'terminal',
    code: `npx kastor migrate dev --name add_posts
npx kastor migrate status
npx kastor migrate deploy`,
  },
  {
    id: 'pull',
    icon: 'logs',
    title: 'Existing database? Pull it',
    text: 'Point kastor at a database you already have and it writes the TypeScript schema for you, relations included, so you can start querying in minutes.',
    file: 'Terminal',
    lang: 'bash',
    kind: 'terminal',
    code: `npx kastor db pull`,
  },
  {
    id: 'soft-delete',
    icon: 'soft-delete',
    title: 'Soft delete and cursor pages',
    text: 'Mark a table with softDelete and deletes set a timestamp instead, filtered out everywhere, includes too. findPage returns opaque cursors for stable infinite scroll.',
    file: 'src/db/schema.ts',
    code: `export const notes = table('notes', {
  id: t.id(),
  body: t.text(),
  deletedAt: t.datetime().nullable(),
}, { softDelete: 'deletedAt' })

await db.notes.delete({ where: { id: 1 } })   // sets deletedAt
await db.notes.restore({ where: { id: 1 } })  // brings it back

const page = await db.notes.findPage({ first: 20, orderBy: { id: 'desc' } })
const next = await db.notes.findPage({ first: 20, orderBy: { id: 'desc' }, after: page.pageInfo.endCursor })`,
  },
  {
    id: 'seed',
    icon: 'seed',
    title: 'Seeds and test factories',
    text: 'A typed seed file for every environment, and factories that build valid, unique rows for tests in one line each.',
    file: 'src/db/seed.ts and factories',
    code: `import { defineSeed, factory } from 'kastor-orm'
import { db as client, type Db } from './index'

// tests: one line per row, unique by sequence
export const userFactory = factory(client.users, ({ seq }) => ({
  email: \`user\${seq}@example.com\`,
  name: \`User \${seq}\`,
}))
const ada = await userFactory.create({ name: 'Ada' })

// npx kastor db seed
export default defineSeed<Db>(async (db) => {
  await db.users.upsert({
    where: { email: 'admin@example.com' },
    create: { email: 'admin@example.com', role: 'admin' },
    update: {},
  })
})`,
  },
];
