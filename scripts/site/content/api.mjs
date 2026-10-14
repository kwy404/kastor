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
import { kastor, one, many } from 'kastor-orm'
import { postgres } from 'kastor-orm/postgres'
import { users, posts } from './schema'

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
        text: 'Each adapter lives in its own entry point so your bundle only carries the dialect you use. On MongoDB, ' + c('t.id()') + ' keys are ObjectIds exposed as strings (and so are the columns that reference them); pass ' + c("mongodb(db, { ids: 'int' })") + ' for numeric keys like on SQL, or ' + c("ids: 'uuid'") + ' for UUID strings.',
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
        code: `import { table, t, index, uniqueIndex } from 'kastor-orm'

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
      { id: 'findPage', name: 'findPage', sig: 'findPage({ first, after?, before?, where?, orderBy?, select?, include? })', text: `Cursor pagination with opaque cursors. Returns ${c('{ items, pageInfo }')}, where ${c('pageInfo')} holds ${c('startCursor')}, ${c('endCursor')} and ${c('hasNextPage')}. Pass ${c('after: pageInfo.endCursor')} for the next page, ${c('before')} for the previous one. ${c('first')} is the page size, 1 to 1000.`, code: `const page = await db.posts.findPage({ first: 20, orderBy: { id: 'desc' } })
const next = await db.posts.findPage({ first: 20, orderBy: { id: 'desc' }, after: page.pageInfo.endCursor })` },
      { id: 'include', name: 'include', text: `Loads relations, nested as deep as you like, each level with its own ${c('where')}, ${c('orderBy')}, ${c('take')}, ${c('skip')}, ${c('select')} and ${c('include')}. ${c('_count')} counts related rows. One query per root call: JSON aggregation on SQL databases, $lookup stages on MongoDB.`, code: `await db.users.findMany({
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
import { defineConfig } from 'kastor-orm'
import { postgres } from 'kastor-orm/postgres'

export default defineConfig({
  schema: './src/db/schema.ts',
  adapter: () => postgres(new pg.Pool({ connectionString: process.env.DATABASE_URL })),
  migrations: './kastor/migrations',
  seed: './src/db/seed.ts',
})` },
      { id: 'seed', name: 'defineSeed and factory', sig: 'defineSeed<Db>(fn)  factory(db.model, ({ seq }) => data)', text: `${c('defineSeed')} types the default export of your seed file, which ${c('npx kastor db seed')} calls with the client. ${c('factory')} takes a model of the client and a defaults function that receives a sequence number, and returns ${c('build')}, ${c('buildMany')}, ${c('create')}, ${c('createMany')} and ${c('reset')}.`, file: 'test/factories.ts', code: `import { factory } from 'kastor-orm'
import { db } from '../src/db'

export const users = factory(db.users, ({ seq }) => ({ email: \`user\${seq}@example.com\` }))

const ada = await users.create({ name: 'Ada' })
const ten = await users.createMany(10)` },
      {
        id: 'cli',
        name: 'npx kastor',
        text: 'The command line. Every command takes ' + c('--config') + ' and ' + c('--help') + '. The npm package is ' + c('kastor-orm') + ' and the command is ' + c('kastor') + ': run ' + c('npx kastor-orm init') + ' before the package is installed, and ' + c('npx kastor migrate dev') + ' and the other commands once it is.',
        table: [
          ['Command', 'What it does'],
          [c('init --db postgres'), 'Writes kastor.config.ts, a starter schema and a seed file for the database you pick'],
          [c('migrate dev --name &lt;name&gt;'), 'Diffs the schema against the database, writes kastor/migrations/&lt;timestamp&gt;_&lt;name&gt;/migration.sql and applies it. ' + c('--create-only') + ' writes without applying, ' + c('--rename users.name:fullName') + ' answers a rename question up front, ' + c('--accept-data-loss') + ' allows destructive changes without asking'],
          [c('migrate baseline'), 'Adopts an existing database: writes its current schema as the first migration and records it as applied without running it. ' + c('--name init') + ' names the file, ' + c('--from-prisma prisma/migrations') + ' also records the Prisma migrations that ran as history. See ' + '<a href="migrate-to-kastor.html">Migrate to kastor</a>'],
          [c('migrate deploy'), 'Applies pending migrations, for CI and production'],
          [c('migrate status'), 'Lists applied and pending migrations'],
          [c('migrate reset'), 'Drops everything, applies every migration again and runs the seed'],
          [c('db push'), 'Syncs the schema without a migration file, for prototypes'],
          [c('db pull'), 'Writes a TypeScript schema from an existing database (' + c('--out') + ' for another file, ' + c('--print') + ' for stdout)'],
          [c('db seed'), 'Runs the seed file'],
          [c('import prisma'), 'Converts schema.prisma into a kastor schema for the same database and prints a report of anything that behaves differently. ' + c('--schema') + ' picks the Prisma file or folder, ' + c('--out') + ' the output file, ' + c('--config') + ' also writes kastor.config.ts. See ' + '<a href="migrate-from-prisma.html">Migrate from Prisma</a>'],
          [c('studio'), 'Opens the local studio on port 5555 (' + c('--port') + ', ' + c('--read-only') + ', ' + c('--no-open') + ')'],
          [c('doctor'), 'Checks the config, the connection, drift and pending migrations (' + c('--json') + ' for machine readable output)'],
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
