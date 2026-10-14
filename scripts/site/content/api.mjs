// The API reference page. Checked against the real exports by
// test/site-api.test.ts, so a renamed export fails the tests.
import { DATABASES } from '../art/icons.mjs';
import { DB_INFO } from './databases.mjs';

const c = (s) => `<code>${s}</code>`;

export const API = [
  {
    id: 'client',
    title: 'Client',
    intro: `Create one client per process and reuse it. kastor ships no drivers: install the one you want and pass its instance to the adapter.`,
    items: [
      {
        id: 'kastor',
        name: 'kastor(config)',
        sig: 'kastor({ adapter, schema, relations?, log? }): KastorClient',
        text: `Creates the client. ${c('schema')} is an object of tables, ${c('relations')} a function that receives the tables and returns the relations of each one, ${c('log')} prints every statement when set to ${c('true')} or calls your function with it.`,
        file: 'src/db/index.ts',
        code: `import pg from 'pg'
import { kastor } from 'kastor'
import { postgres } from 'kastor/postgres'
import { users, posts } from './schema'
import { one, many } from 'kastor'

export const db = kastor({
  adapter: postgres(new pg.Pool({ connectionString: process.env.DATABASE_URL })),
  schema: { users, posts },
  relations: ({ users, posts }) => ({
    users: { posts: many(posts) },
    posts: { author: one(users, { fields: ['authorId'], references: ['id'] }) },
  }),
})`,
      },
      {
        id: 'adapters',
        name: 'Adapters',
        text: 'Each adapter lives in its own entry point so your bundle only carries the dialect you use.',
        table: [['Database', 'Import', 'Pass', 'Driver']].concat(
          DATABASES.map((d) => [d.name, c(`import { ${DB_INFO[d.id].adapter} } from '${d.entry}'`), c(adapterArg(d.id)), c(DB_INFO[d.id].driver)]),
        ),
      },
      {
        id: 'client-extras',
        name: 'Client members',
        text: `${c('$transaction')}, ${c('$sql')}, ${c('$execute')}, ${c('$schema')} (the schema as plain JSON), ${c('$dialect')} and ${c('$disconnect()')} which closes the pool you passed in.`,
      },
    ],
  },
  {
    id: 'schema',
    title: 'Schema',
    intro: `Tables are plain TypeScript values. Columns are database neutral and every adapter maps them to native types.`,
    items: [
      {
        id: 'table',
        name: 'table(name, columns, options?)',
        sig: "table('users', { ... }, { indexes?, primaryKey?, softDelete? })",
        text: `Declares a table. ${c('indexes: (cols) => [index(cols.a), uniqueIndex(cols.a, cols.b)]')} adds indexes, ${c('primaryKey: (cols) => [cols.a, cols.b]')} sets a composite key and ${c("softDelete: 'deletedAt'")} turns deletes into updates of that column. Columns are available as properties, ${c('users.email')}.`,
        file: 'src/db/schema.ts',
        code: `import { table, t, index, uniqueIndex } from 'kastor'

export const memberships = table('memberships', {
  userId: t.int().references(() => users.id, { onDelete: 'cascade' }),
  teamId: t.int().references(() => teams.id, { onDelete: 'cascade' }),
  role: t.enum(['member', 'owner']).default('member'),
  joinedAt: t.datetime().defaultNow(),
}, {
  primaryKey: (m) => [m.userId, m.teamId],
  indexes: (m) => [index(m.teamId)],
})`,
      },
      {
        id: 'columns',
        name: 't',
        text: 'Column builders and the TypeScript type each one infers.',
        table: [
          ['Builder', 'TypeScript type', 'Notes'],
          [c('t.id()'), c('number'), 'Auto increment integer primary key'],
          [c('t.bigId()'), c('bigint'), 'Auto increment 64 bit primary key'],
          [c('t.uuid()'), c('string'), 'Use with .defaultRandom()'],
          [c('t.string(len?)'), c('string'), 'varchar, nvarchar or varchar2'],
          [c('t.text()'), c('string'), 'Long text'],
          [c('t.int()'), c('number'), '32 bit integer'],
          [c('t.bigint()'), c('bigint'), '64 bit integer'],
          [c('t.float()'), c('number'), 'Double precision'],
          [c('t.decimal(p, s)'), c('string'), 'Exact, kept as a string'],
          [c('t.boolean()'), c('boolean'), 'Native or 0 and 1'],
          [c('t.datetime()'), c('Date'), 'Timestamp'],
          [c('t.date()'), c('string'), 'YYYY-MM-DD'],
          [c('t.time()'), c('string'), 'HH:MM:SS'],
          [c('t.json&lt;T&gt;()'), c('T'), 'Parsed JSON'],
          [c('t.bytes()'), c('Uint8Array'), 'Binary'],
          [c("t.enum(['a', 'b'])"), c("'a' | 'b'"), 'Native enum or a check'],
        ],
      },
      {
        id: 'modifiers',
        name: 'Column modifiers',
        text: `${c('.nullable()')} adds ${c('| null')}, ${c('.default(value)')}, ${c('.defaultNow()')}, ${c('.defaultRandom()')}, ${c(".defaultSql('...')")}, ${c('.unique()')}, ${c('.primaryKey()')}, ${c('.references(() => other.col, { onDelete, onUpdate })')}, ${c(".map('db_column')")} for a different column name in the database and ${c(".nativeType('varchar(64)')")} to pick the exact native type.`,
      },
      {
        id: 'relations',
        name: 'one() and many()',
        sig: "one(target, { fields, references }?)  many(target, { through }?)",
        text: `Relations are declared next to the client, not in the tables, so tables never import each other in a cycle. Leave the config out of the side without the foreign key. For many to many, pass the join table with ${c('through')}.`,
        code: `relations: ({ users, posts, tags, postTags }) => ({
  users: { posts: many(posts) },
  posts: {
    author: one(users, { fields: ['authorId'], references: ['id'] }),
    tags: many(tags, { through: postTags }),
  },
})`,
      },
      {
        id: 'infer',
        name: 'InferSelect and InferInsert',
        text: `Row types for your own functions: ${c('type User = InferSelect&lt;typeof users&gt;')} is what queries return, ${c('InferInsert')} what ${c('create')} accepts (defaults and nullable columns are optional).`,
      },
    ],
  },
  {
    id: 'queries',
    title: 'Reading',
    intro: `Every model on the client (${c('db.users')}) has the same methods. Calls return a lazy query: nothing runs until you await it, and ${c('query.toSQL()')} returns the statements without running them.`,
    items: [
      { id: 'findMany', name: 'findMany', sig: 'findMany({ where?, select?, include?, orderBy?, take?, skip?, cursor?, distinct? })', text: 'All matching rows, as an array.', code: `await db.posts.findMany({ where: { published: true }, orderBy: { id: 'desc' }, take: 20, skip: 40 })` },
      { id: 'findFirst', name: 'findFirst and findFirstOrThrow', text: `The first matching row or ${c('null')}. The OrThrow version throws a ${c('KastorError')} with code ${c('NOT_FOUND')}.` },
      { id: 'findUnique', name: 'findUnique and findUniqueOrThrow', text: 'One row by a primary key or unique column.', code: `await db.users.findUnique({ where: { email: 'ada@example.com' } })` },
      { id: 'findPage', name: 'findPage', text: 'Cursor pagination with opaque cursors: returns the rows and the cursor for the next page.' },
      { id: 'include', name: 'include', text: `Loads relations, nested as deep as you like, each level with its own ${c('where')}, ${c('orderBy')}, ${c('take')}, ${c('skip')}, ${c('select')} and ${c('include')}. ${c('_count')} counts related rows. One query per root call where the database has JSON aggregation, one query per level otherwise.`, code: `await db.users.findMany({
  include: {
    posts: { where: { published: true }, take: 3, include: { tags: true } },
    _count: { select: { posts: true } },
  },
})` },
      { id: 'select', name: 'select', text: `Picks columns and relations. The result type keeps only what you selected.`, code: `await db.users.findMany({ select: { id: true, email: true, posts: { select: { title: true } } } })` },
      { id: 'count', name: 'count, aggregate and groupBy', text: `${c('count')} returns a number. ${c('aggregate')} computes ${c('_count')}, ${c('_sum')}, ${c('_avg')}, ${c('_min')} and ${c('_max')}. ${c('groupBy')} groups by columns with the same aggregates, ${c('having')} and ordering by aggregates.` },
    ],
  },
  {
    id: 'filters',
    title: 'Filters',
    intro: 'Where trees combine column filters, logic and relation filters.',
    items: [
      {
        id: 'filter-ops',
        name: 'Operators',
        table: [
          ['Operator', 'Meaning'],
          [`${c('equals')}, ${c('not')}`, 'Equal, not equal (a plain value means equals)'],
          [`${c('in')}, ${c('notIn')}`, 'In a list'],
          [`${c('lt')}, ${c('lte')}, ${c('gt')}, ${c('gte')}`, 'Comparisons'],
          [`${c('contains')}, ${c('startsWith')}, ${c('endsWith')}`, `Text matching, wildcards escaped for you; add ${c("mode: 'insensitive'")}`],
          [`${c('AND')}, ${c('OR')}, ${c('NOT')}`, 'Logic'],
          [`${c('some')}, ${c('every')}, ${c('none')}`, 'To-many relation filters'],
          [`${c('is')}, ${c('isNot')}`, 'To-one relation filters'],
          [`${c('null')}, ${c('not: null')}`, 'Null checks'],
        ],
        text: 'Every operator works on every database.',
      },
    ],
  },
  {
    id: 'writes',
    title: 'Writing',
    items: [
      { id: 'create', name: 'create, createMany and createManyAndReturn', text: `Insert one row (returned, with ${c('select')} or ${c('include')} if you like), many rows (returns ${c('{ count }')}) or many rows and get them back. Nested ${c('create')} and ${c('connect')} write related rows in the same transaction.`, code: `await db.users.create({
  data: { email: 'kas@example.com', posts: { create: [{ title: 'First log' }] } },
})` },
      { id: 'update', name: 'update, updateMany and upsert', text: `Numbers accept ${c('{ increment }')}, ${c('{ decrement }')}, ${c('{ multiply }')} and ${c('{ divide }')}. ${c('upsert')} uses the native syntax of each database.`, code: `await db.posts.update({ where: { id: 1 }, data: { views: { increment: 1 } } })
await db.users.upsert({ where: { email }, create: { email }, update: { name } })` },
      { id: 'delete', name: 'delete and deleteMany', text: `On soft delete tables they set the column instead; ${c('restore')}, ${c('hardDelete')} and ${c('hardDeleteMany')} are there too.` },
    ],
  },
  {
    id: 'transactions',
    title: 'Transactions and raw SQL',
    items: [
      { id: 'transaction', name: '$transaction', text: 'A callback that receives a transaction client, or an array of queries that run together. A nested call reuses the open transaction.', code: `await db.$transaction(async (tx) => {
  const user = await tx.users.create({ data: { email } })
  await tx.posts.create({ data: { title: 'Welcome', authorId: user.id } })
})` },
      { id: 'sql', name: '$sql, $execute and sql', text: `Tagged templates: values become parameters. ${c('$sql')} returns rows typed by the generic you pass, ${c('$execute')} the affected row count. The ${c('sql')} tag builds fragments for ${c('where')} with ${c('sql.raw')}, ${c('sql.join')} and ${c('sql.ident')}.`, code: `const rows = await db.$sql<{ id: number; total: number }>\`
  select author_id as id, count(*) as total from posts where views > \${min} group by author_id
\`` },
    ],
  },
  {
    id: 'errors',
    title: 'Errors',
    items: [
      {
        id: 'kastor-error',
        name: 'KastorError and isKastorError',
        text: `Every failure is a ${c('KastorError')} with a stable ${c('code')}, a plain English ${c('message')}, a ${c('hint')} with the fix, ${c('meta')} and the driver error as ${c('cause')}.`,
        table: [
          ['Code', 'When'],
          [c('UNIQUE_VIOLATION'), 'A unique column or index already has the value'],
          [c('FOREIGN_KEY_VIOLATION'), 'The referenced row does not exist, or rows still point to it'],
          [c('NOT_NULL_VIOLATION'), 'A required column got no value'],
          [c('CHECK_VIOLATION'), 'A check constraint failed'],
          [c('SERIALIZATION_FAILURE'), 'Retry the transaction'],
          [c('DEADLOCK'), 'Two transactions waited on each other'],
          [c('CONNECTION_FAILED'), 'The database could not be reached'],
          [c('TIMEOUT'), 'The query or the connection timed out'],
        ],
      },
    ],
  },
  {
    id: 'config',
    title: 'Config, seeds and CLI',
    items: [
      { id: 'define-config', name: 'defineConfig', text: `${c('kastor.config.ts')} tells the CLI where the schema is, how to connect, where migrations live and which seed to run.`, file: 'kastor.config.ts', code: `import pg from 'pg'
import { defineConfig } from 'kastor'
import { postgres } from 'kastor/postgres'

export default defineConfig({
  schema: './src/db/schema.ts',
  adapter: () => postgres(new pg.Pool({ connectionString: process.env.DATABASE_URL })),
  migrations: './kastor/migrations',
  seed: './src/db/seed.ts',
})` },
      { id: 'seed', name: 'defineSeed and factory', text: `${c('defineSeed')} types your seed file. ${c('factory(table, build)')} builds valid rows for tests.` },
      {
        id: 'cli',
        name: 'npx kastor',
        text: 'The command line.',
        table: [
          ['Command', 'What it does'],
          [c('init'), 'Writes kastor.config.ts and a starter schema'],
          [c('migrate dev --name &lt;name&gt;'), 'Diffs the schema against the database, writes kastor/migrations/&lt;timestamp&gt;_&lt;name&gt;/migration.sql and applies it'],
          [c('migrate deploy'), 'Applies pending migrations, for CI and production'],
          [c('migrate status'), 'Lists applied and pending migrations'],
          [c('migrate reset'), 'Drops everything and applies all migrations again'],
          [c('db push'), 'Syncs the schema without a migration file, for prototypes'],
          [c('db pull'), 'Writes a TypeScript schema from an existing database'],
          [c('db seed'), 'Runs the seed file'],
          [c('studio'), 'Opens the local studio'],
          [c('doctor'), 'Checks the config, the driver and the connection'],
        ],
      },
    ],
  },
];

function adapterArg(id) {
  return {
    postgres: 'new pg.Pool(...)',
    cockroach: 'new pg.Pool(...)',
    mysql: "mysql2.createPool(...)",
    mariadb: 'mariadb.createPool(...)',
    sqlite: "new Database('app.db')",
    libsql: 'createClient({ url, authToken })',
    d1: 'env.DB',
    mssql: 'await pool.connect()',
    oracle: 'await oracledb.createPool(...)',
    mongodb: "client.db('app')",
  }[id];
}
