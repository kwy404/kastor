<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/banner-dark.svg">
  <img src="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/banner.svg" alt="kastor banner: Kas the beaver engineer next to the wordmark, the TypeScript ORM for almost every database" width="100%">
</picture>

# kastor: the TypeScript ORM for almost every database

**Schema in plain TypeScript. Types inferred as you type. No generate step, no binary engine.**

[![npm version](https://img.shields.io/npm/v/kastor-orm.svg)](https://www.npmjs.com/package/kastor-orm)
[![CI](https://github.com/kwy404/kastor/actions/workflows/ci.yml/badge.svg)](https://github.com/kwy404/kastor/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/kwy404/kastor/blob/main/LICENSE)
[![core size: 22 kB gzip](https://img.shields.io/badge/core-22%20kB%20gzip-e2601e)](https://www.npmjs.com/package/kastor-orm)

English | [Português (Brasil)](https://github.com/kwy404/kastor/blob/main/i18n/README.pt-BR.md)

[Website and live playground](https://kwy404.github.io/kastor/) · [API reference](https://kwy404.github.io/kastor/api.html) · [Guides](https://kwy404.github.io/kastor/guides.html) · [Migrate to kastor](https://kwy404.github.io/kastor/migrate-to-kastor.html) · [Frameworks](https://kwy404.github.io/kastor/frameworks.html) · [npm](https://www.npmjs.com/package/kastor-orm)

</div>

kastor is an open source TypeScript ORM for PostgreSQL, CockroachDB, MySQL, MariaDB, SQLite (better-sqlite3, node:sqlite, bun:sqlite), libSQL and Turso, Cloudflare D1, SQL Server, Oracle and MongoDB. You write your schema as ordinary TypeScript values, and the TypeScript compiler infers every row type as you type: no schema language, no codegen, no engine to download. Queries are familiar objects (`where`, `include`, `select`), nested includes load in one query with JSON aggregation, migrations are diffed from your schema into readable SQL files, and `npx kastor studio` opens a local data browser.

The name comes from *castor*, Latin for beaver. Beavers build strong structures from logs; kastor builds strong data layers from rows. Meet Kas, the site engineer:

<div align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/mascot-dark.svg">
  <img src="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/mascot.svg" alt="Kas, the kastor beaver engineer, in a yellow hard hat with a blueprint roll under one arm and a pencil behind the ear" width="200">
</picture>
</div>

## Table of contents

- [Features](#features)
- [Quick start](#quick-start)
- [Supported databases](#supported-databases)
- [Schema](#schema)
- [Queries](#queries)
- [Writes and transactions](#writes-and-transactions)
- [Raw SQL](#raw-sql)
- [Errors](#errors)
- [Migrations and the CLI](#migrations-and-the-cli)
- [Studio](#studio)
- [Migrate from Prisma and other ORMs](#migrate-from-prisma-and-other-orms)
- [Use with your framework](#use-with-your-framework)
- [API reference](#api-reference)
- [FAQ](#faq)
- [Comparison](#comparison)
- [More from kwy404](#more-from-kwy404)
- [Author](#author)
- [License](#license)

## Features

| | | |
| --- | --- | --- |
| <picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/icons/dark/schema.svg"><img src="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/icons/light/schema.svg" width="40" alt="Schema icon"></picture><br>**Schema in TypeScript**<br>Tables, columns, indexes and relations are plain values. | <picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/icons/dark/no-codegen.svg"><img src="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/icons/light/no-codegen.svg" width="40" alt="No codegen icon"></picture><br>**No generate step**<br>Types are inferred on the next keystroke. | <picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/icons/dark/one-query.svg"><img src="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/icons/light/one-query.svg" width="40" alt="One query icon"></picture><br>**Includes in one query**<br>JSON aggregation, never N+1. |
| <picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/icons/dark/migrations.svg"><img src="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/icons/light/migrations.svg" width="40" alt="Migrations icon"></picture><br>**Automatic migrations**<br>Readable SQL files, rename detection asks first. | <picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/icons/dark/studio.svg"><img src="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/icons/light/studio.svg" width="40" alt="Studio icon"></picture><br>**Studio**<br>Browse and edit data, read the ER diagram. | <picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/icons/dark/errors.svg"><img src="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/icons/light/errors.svg" width="40" alt="Errors icon"></picture><br>**Errors with a hint**<br>A stable code, a plain message and the fix. |
| <picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/icons/dark/raw-sql.svg"><img src="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/icons/light/raw-sql.svg" width="40" alt="Raw SQL icon"></picture><br>**Typed raw SQL**<br>Tagged templates, values become parameters. | <picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/icons/dark/adapters.svg"><img src="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/icons/light/adapters.svg" width="40" alt="Adapters icon"></picture><br>**Bring your own driver**<br>Zero bundled drivers, zero runtime bloat. | <picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/icons/dark/edge.svg"><img src="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/icons/light/edge.svg" width="40" alt="Edge icon"></picture><br>**Serverless and edge**<br>Workers with D1, Turso, Neon, Bun and Deno. |

## Quick start

```bash
npx kastor-orm init
```

The wizard asks for your database, writes `kastor.config.ts`, a sample schema, a seed and `.env`, installs the packages, then creates the tables and runs a first query. Pick SQLite to need no server at all. Without a terminal, pass the answers as flags: `npx kastor-orm init --db postgres --yes`.

The npm package is `kastor-orm`; the project and the CLI are called kastor. Run `npx kastor-orm init` before the package is installed; once it is, the same CLI also answers to the short name, as in `npx kastor migrate dev`.

Declare the schema in `src/db/schema.ts`:

```ts
import { table, t, one, many, index } from 'kastor-orm'

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
  published: t.boolean().default(false),
  authorId: t.int().references(() => users.id, { onDelete: 'cascade' }),
}, { indexes: (p) => [index(p.authorId)] })

export const schema = { users, posts }

export const relations = ({ users, posts }: typeof schema) => ({
  users: { posts: many(posts) },
  posts: { author: one(users, { fields: ['authorId'], references: ['id'] }) },
})
```

Create the client in `src/db/index.ts`:

```ts
import pg from 'pg'
import { kastor } from 'kastor-orm'
import { postgres } from 'kastor-orm/postgres'
import { schema, relations } from './schema'

export const db = kastor({
  adapter: postgres(new pg.Pool({ connectionString: process.env.DATABASE_URL })),
  schema,
  relations,
})
```

Create the tables and query:

```bash
npx kastor migrate dev --name init
```

```ts
const authors = await db.users.findMany({
  where: { email: { endsWith: '@example.com' } },
  include: { posts: { where: { published: true }, take: 3 } },
})
// authors: { id: number; email: string; name: string | null; role: 'user' | 'admin';
//            createdAt: Date; posts: { id: number; title: string; ... }[] }[]
```

Try all of this without installing anything in the [live playground](https://kwy404.github.io/kastor/#playground): it runs the real kastor compiler in your browser, shows the inferred type and the SQL for every database side by side, and runs the query on SQLite.

### CDN

The script tag build exposes the whole core as the global `Kastor`, plus the shared SQL compiler, so a page can build queries and compile them to SQL with no database, like the playground on the website does. Running queries needs a server runtime (Node.js, Bun, Deno or Workers) and a driver.

```html
<script src="https://cdn.jsdelivr.net/npm/kastor-orm@0.1.0/dist/kastor.js"></script>
<script>
  const { kastor, table, t, compileOnlyDialect, defineHooks, placeholderDollar, jsonPostgres } = Kastor
  const users = table('users', { id: t.id(), email: t.string(255).unique() })
  const dialect = compileOnlyDialect('postgres', defineHooks({ placeholder: placeholderDollar, json: jsonPostgres, returning: 'returning' }))
  const db = kastor({ adapter: { dialect, executor: {} }, schema: { users } })
  console.log(db.users.findMany({ where: { email: { endsWith: '@example.com' } } }).toSQL())
  // [{ sql: 'SELECT "t0"."id" AS "id", ... WHERE "t0"."email" LIKE $1 ESCAPE \'!\'', params: ['%@example.com'] }]
</script>
```

ES module build: `https://cdn.jsdelivr.net/npm/kastor-orm@0.1.0/dist/kastor.browser.js`.

## Supported databases

kastor ships no drivers. Install the one you use and pass its instance to the adapter.

| Database | Import | Pass | Includes compile to |
| --- | --- | --- | --- |
| PostgreSQL (also Neon, Supabase, Vercel Postgres) | `kastor-orm/postgres` | `postgres(new pg.Pool(...))` | `json_agg` + `json_build_object` |
| CockroachDB | `kastor-orm/cockroach` | `cockroach(new pg.Pool(...))` | `json_agg` + `json_build_object` |
| MySQL (also PlanetScale) | `kastor-orm/mysql` | `mysql(mysql2.createPool(...))` | `JSON_ARRAYAGG` + `JSON_OBJECT` |
| MariaDB | `kastor-orm/mariadb` | `mariadb(mariadb.createPool(...))` | `JSON_ARRAYAGG` + `JSON_OBJECT` |
| SQLite (better-sqlite3, node:sqlite, bun:sqlite) | `kastor-orm/sqlite` | `sqlite(new Database('app.db'))` | `json_group_array` + `json_object` |
| libSQL and Turso | `kastor-orm/libsql` | `libsql(createClient({ url, authToken }))` | `json_group_array` + `json_object` |
| Cloudflare D1 | `kastor-orm/d1` | `d1(env.DB)` | `json_group_array` + `json_object` |
| SQL Server and Azure SQL | `kastor-orm/mssql` | `mssql(await new sql.ConnectionPool(...).connect())` | `FOR JSON PATH` |
| Oracle | `kastor-orm/oracle` | `oracle(await oracledb.createPool(...))` | `JSON_ARRAYAGG` + `JSON_OBJECT` |
| MongoDB | `kastor-orm/mongodb` | `mongodb(client.db('app'))` | `$lookup` pipelines (keys are ObjectId strings by default, `{ ids: 'int' }` for numbers) |

The adapters share one conformance suite, run against real databases in CI. See the [support matrix](https://kwy404.github.io/kastor/#databases) for returning, upsert and paging syntax per database, and [Get started in 60 seconds](https://kwy404.github.io/kastor/#start) for each one.

## Schema

```ts
import { table, t, index, uniqueIndex } from 'kastor-orm'
import type { InferSelect, InferInsert } from 'kastor-orm'

export const posts = table('posts', {
  id: t.uuid().primaryKey().defaultRandom(),
  slug: t.string(120),
  siteId: t.int(),
  body: t.text().nullable(),
  meta: t.json<{ tags: string[] }>().nullable(),
  price: t.decimal(10, 2).default('0.00'),
  publishedAt: t.datetime().map('published_at').nullable(),
}, {
  indexes: (p) => [uniqueIndex(p.siteId, p.slug), index(p.publishedAt)],
})

type Post = InferSelect<typeof posts>     // what queries return
type NewPost = InferInsert<typeof posts>  // what create accepts
```

| Builder | TypeScript type | Builder | TypeScript type |
| --- | --- | --- | --- |
| `t.id()` | `number` (auto increment key) | `t.boolean()` | `boolean` |
| `t.bigId()` | `bigint` (auto increment key) | `t.datetime()` | `Date` |
| `t.uuid()` | `string` | `t.date()` | `string` (`YYYY-MM-DD`) |
| `t.string(len?)` | `string` | `t.time()` | `string` (`HH:MM:SS`) |
| `t.text()` | `string` | `t.json<T>()` | `T` |
| `t.int()` | `number` | `t.bytes()` | `Uint8Array` |
| `t.bigint()` | `bigint` | `t.enum(['a', 'b'])` | `'a' \| 'b'` |
| `t.float()` | `number` | `t.decimal(p, s)` | `string` (exact) |

Modifiers: `.nullable()`, `.default(value)`, `.defaultNow()`, `.defaultRandom()`, `.defaultSql('...')`, `.unique()`, `.primaryKey()`, `.references(() => other.col, { onDelete, onUpdate })`, `.map('db_column')`, `.nativeType('varchar(64)')`. Table options: `indexes`, `primaryKey` (composite keys) and `softDelete: 'deletedAt'`.

Relations are declared next to the client, so tables never import each other in a cycle: `one(target, { fields, references })`, `many(target)` and `many(target, { through: joinTable })` for many to many.

## Queries

Every model has `findMany`, `findFirst`, `findFirstOrThrow`, `findUnique`, `findUniqueOrThrow`, `findPage`, `count`, `aggregate` and `groupBy`, with `where`, `select`, `include`, `orderBy`, `take`, `skip`, `cursor` and `distinct`.

```ts
const page = await db.posts.findMany({
  where: {
    published: true,
    OR: [{ title: { contains: 'orm', mode: 'insensitive' } }, { views: { gte: 100 } }],
    author: { is: { role: 'admin' } },
    tags: { some: { name: 'typescript' } },
  },
  include: {
    author: { select: { name: true } },
    tags: true,
    _count: { select: { comments: true } },
  },
  orderBy: { createdAt: 'desc' },
  take: 20,
})
```

Filters: `equals`, `not`, `in`, `notIn`, `lt`, `lte`, `gt`, `gte`, `contains`, `startsWith`, `endsWith`, `mode: 'insensitive'`, `AND`, `OR`, `NOT`, relation filters `some`, `every`, `none`, `is`, `isNot`, and null checks. Queries are lazy: nothing runs until you `await`, and `query.toSQL()` returns the statements without running them.

## Writes and transactions

```ts
const user = await db.users.create({
  data: { email: 'kas@example.com', posts: { create: [{ title: 'First log' }] } },
  include: { posts: true },
})

await db.posts.update({ where: { id: 1 }, data: { views: { increment: 1 } } })
await db.users.upsert({ where: { email }, create: { email, name }, update: { name } })
await db.posts.deleteMany({ where: { published: false } })

await db.$transaction(async (tx) => {
  const order = await tx.orders.create({ data: { userId, total } })
  await tx.stock.update({ where: { sku }, data: { count: { decrement: 1 } } })
  return order
})

await db.$transaction([db.sessions.deleteMany({ where: { userId } }), db.users.delete({ where: { id: userId } })])
```

Also `createMany`, `createManyAndReturn`, `updateMany`, `delete`, and on soft delete tables `restore`, `hardDelete` and `hardDeleteMany`.

## Raw SQL

```ts
import { sql } from 'kastor-orm'

const rows = await db.$sql<{ day: string; signups: number }>`
  select date(created_at) as day, count(*) as signups
  from users where created_at >= ${since} group by day order by day
`
const changed = await db.$execute`update posts set views = 0 where author_id = ${id}`
const recent = await db.posts.findMany({ where: { AND: [sql`length(title) > ${10}`] } })
```

Template values always become parameters. `sql.raw`, `sql.join` and `sql.ident` build fragments.

## Errors

Every failure is a `KastorError` with a stable `code`, a plain English `message`, a `hint` with the fix, `meta` and the driver error as `cause`.

```ts
import { isKastorError } from 'kastor-orm'

try {
  await db.users.create({ data: { email } })
} catch (e) {
  if (isKastorError(e) && e.code === 'UNIQUE_VIOLATION') console.log(e.message, e.hint)
}
```

Codes: `UNIQUE_VIOLATION`, `FOREIGN_KEY_VIOLATION`, `NOT_NULL_VIOLATION`, `CHECK_VIOLATION`, `SERIALIZATION_FAILURE`, `DEADLOCK`, `CONNECTION_FAILED`, `TIMEOUT`, `NOT_FOUND` and more, the same on every database.

## Migrations and the CLI

`kastor.config.ts`:

```ts
import pg from 'pg'
import { defineConfig } from 'kastor-orm'
import { postgres } from 'kastor-orm/postgres'

export default defineConfig({
  schema: './src/db/schema.ts',
  adapter: () => postgres(new pg.Pool({ connectionString: process.env.DATABASE_URL })),
  migrations: './kastor/migrations',
  seed: './src/db/seed.ts',
})
```

| Command | What it does |
| --- | --- |
| `npx kastor-orm init` | Asks for your database, writes `kastor.config.ts`, a sample schema and a seed, installs the packages and runs a first query (`--db`, `--yes`, `--no-install`, `--no-run`) |
| `npx kastor migrate dev --name <name>` | Diffs the schema against the database, writes `kastor/migrations/<timestamp>_<name>/migration.sql` and applies it. A possible rename is a question, never a silent drop. `--create-only`, `--rename users.name:fullName`, `--accept-data-loss` |
| `npx kastor migrate baseline` | Adopts an existing database: records its schema as the first migration without running it (`--name init`, `--from-prisma prisma/migrations`) |
| `npx kastor migrate deploy` | Applies pending migrations (CI and production) |
| `npx kastor migrate status` | Lists applied and pending migrations |
| `npx kastor migrate reset` | Drops everything, applies every migration again and runs the seed |
| `npx kastor db push` | Syncs the schema without a migration file, for prototypes |
| `npx kastor db pull` | Writes a TypeScript schema from an existing database (`--out`, `--print`) |
| `npx kastor db seed` | Runs the seed file |
| `npx kastor import prisma` | Converts schema.prisma into a kastor schema for the same database and prints a report (`--schema`, `--out`, `--config`) |
| `npx kastor studio` | Opens the local studio |
| `npx kastor doctor` | Checks the config, the connection, drift and pending migrations |

Read [database migrations explained](https://kwy404.github.io/kastor/database-migrations-explained.html) for the full workflow.

## Studio

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/docs/assets/studio-data-dark.png">
  <img src="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/docs/assets/studio-data-light.png" alt="The kastor studio browsing the posts table: filters, rows, foreign keys and actions" width="100%">
</picture>

`npx kastor studio` opens a local web UI: browse every table, filter and search, add, edit and delete rows, follow foreign keys and read the diagram of the whole database. The Queries page lists the SQL of recent queries with their parameters and timing. It runs on 127.0.0.1 behind a private session token, and `--read-only` keeps data you must not touch safe.

## Migrate from Prisma and other ORMs

Your database and your data stay where they are. kastor reads the schema you already have, records the database as its first migration without running anything, and takes over from there.

```bash
npm i kastor-orm pg
npx kastor import prisma --config                               # schema.prisma to src/db/schema.ts, plus a report
npx kastor migrate baseline --from-prisma prisma/migrations     # adopt the database, keep Prisma's history
npx kastor migrate dev                                          # should say: Already in sync
```

The import keeps model names, so most Prisma Client calls only change their first word:

```ts
// Before: prisma.post.findMany({ where: { published: true }, include: { author: true }, take: 20 })
const posts = await db.post.findMany({ where: { published: true }, include: { author: true }, take: 20 })

// Before: prisma.$queryRaw`select count(*) from "Post"`
const [row] = await db.$sql<{ n: number }>`select count(*)::int as n from "Post"`
```

From any other ORM or language, `npx kastor db pull` writes the TypeScript schema from the live database and `npx kastor migrate baseline --name init` adopts it. Step by step guides with API mapping tables and pitfalls:

| Coming from | Guide | How it starts |
| --- | --- | --- |
| Prisma | [Migrate from Prisma](https://kwy404.github.io/kastor/migrate-from-prisma.html) | `npx kastor import prisma`, then `migrate baseline --from-prisma` keeps the history |
| Drizzle ORM | [Migrate from Drizzle ORM](https://kwy404.github.io/kastor/migrate-from-drizzle.html) | `db pull`, then `migrate baseline` |
| TypeORM | [Migrate from TypeORM](https://kwy404.github.io/kastor/migrate-from-typeorm.html) | entities and repositories to `table()` and the client |
| Sequelize | [Migrate from Sequelize](https://kwy404.github.io/kastor/migrate-from-sequelize.html) | models and `Op` to inferred types and `where` objects |
| Knex | [Migrate from Knex](https://kwy404.github.io/kastor/migrate-from-knex.html) | builder chains to typed queries, raw SQL with `$sql` |
| Mongoose | [Migrate from Mongoose](https://kwy404.github.io/kastor/migrate-from-mongoose.html) | schemas and `populate` to `table()` and `include` on MongoDB |
| Laravel Eloquent (PHP) | [Migrate from Laravel Eloquent](https://kwy404.github.io/kastor/migrate-from-laravel-eloquent.html) | move a service to TypeScript, or share the database with Laravel |
| Django ORM (Python) | [Migrate from Django ORM](https://kwy404.github.io/kastor/migrate-from-django-orm.html) | move a service to TypeScript, or share the database with Django |
| Rails Active Record (Ruby) | [Migrate from Rails Active Record](https://kwy404.github.io/kastor/migrate-from-rails-active-record.html) | move a service to TypeScript, or share the database with Rails |

All of them, plus the commands in one place: [Migrate to kastor](https://kwy404.github.io/kastor/migrate-to-kastor.html).

## Use with your framework

kastor runs on the server. Create one client per process (or per request on Workers), import it from server code only, and reuse it across hot reloads.

**Next.js (App Router)**: reuse the client across hot reloads and query from server components and server actions. A complete starter on SQLite lives in [examples/nextjs](https://github.com/kwy404/kastor/tree/main/examples/nextjs).

```ts
// src/db/index.ts
const create = () => kastor({ adapter: postgres(new pg.Pool({ connectionString: process.env.DATABASE_URL })), schema, relations })
const g = globalThis as unknown as { db?: ReturnType<typeof create> }
export const db = g.db ?? create()
if (process.env.NODE_ENV !== 'production') g.db = db
```

```tsx
// app/posts/page.tsx (a React server component)
import { db } from '@/db'

export default async function Posts() {
  const posts = await db.posts.findMany({ include: { author: true }, take: 20 })
  return <ul>{posts.map((p) => <li key={p.id}>{p.title} by {p.author.email}</li>)}</ul>
}
```

**Cloudflare Workers and Hono**: bindings arrive with each request, so build the client there. Wrapping a binding opens nothing.

```ts
app.get('/posts', async (c) => {
  const db = kastor({ adapter: d1(c.env.DB), schema, relations })
  return c.json(await db.posts.findMany({ where: { published: true }, take: 20 }))
})
```

**NestJS**: register the client as a provider in a global module and inject it.

```ts
@Global()
@Module({ providers: [{ provide: KASTOR, useFactory: () => createDb(process.env.DATABASE_URL!) }], exports: [KASTOR] })
export class DbModule {}
```

Each guide covers the project structure, connection reuse for hot reload and serverless, environment variables and migrations in CI and deploy:

| Framework | Guide | Highlights |
| --- | --- | --- |
| Next.js App Router | [kastor with Next.js App Router](https://kwy404.github.io/kastor/nextjs-app-router-orm.html) | server components, server actions, route handlers, edge with Neon, Turso or D1 |
| Nuxt | [kastor with Nuxt](https://kwy404.github.io/kastor/nuxt-orm.html) | Nitro server routes, runtimeConfig |
| SvelteKit | [kastor with SvelteKit](https://kwy404.github.io/kastor/sveltekit-orm.html) | load functions, form actions, $lib/server |
| Remix and React Router | [kastor with Remix and React Router](https://kwy404.github.io/kastor/remix-react-router-orm.html) | loaders and actions in a .server module |
| Astro | [kastor with Astro](https://kwy404.github.io/kastor/astro-orm.html) | on-demand pages, endpoints, actions |
| NestJS | [kastor with NestJS](https://kwy404.github.io/kastor/nestjs-orm.html) | a global module and a provider |
| Express | [kastor with Express](https://kwy404.github.io/kastor/express-orm.html) | error middleware, graceful shutdown |
| Fastify | [kastor with Fastify](https://kwy404.github.io/kastor/fastify-orm.html) | a plugin with a typed decorator |
| Hono | [kastor with Hono](https://kwy404.github.io/kastor/hono-orm.html) | Node, Bun, Deno and Workers |
| AdonisJS | [kastor with AdonisJS](https://kwy404.github.io/kastor/adonisjs-orm.html) | a service module next to or instead of Lucid |
| Bun | [kastor with Bun](https://kwy404.github.io/kastor/bun-orm.html) | bun:sqlite, Bun.serve |
| Deno | [kastor with Deno](https://kwy404.github.io/kastor/deno-orm.html) | npm specifiers, Deno.serve |
| Cloudflare Workers | [kastor with Cloudflare Workers](https://kwy404.github.io/kastor/cloudflare-workers-orm.html) | D1, Hyperdrive, Turso |
| Electron | [kastor with Electron](https://kwy404.github.io/kastor/electron-sqlite-orm.html) | SQLite in the main process, typed IPC |
| AWS Lambda | [kastor with AWS Lambda](https://kwy404.github.io/kastor/aws-lambda-orm.html) | connection reuse, RDS Proxy |

**React** with Vite SSR, **Vue** and **Angular** with SSR follow the same rule: query from server code (loaders, server routes, the Express server that `@angular/ssr` generates) and send plain data to the components. Short setups for every framework are on the [frameworks page](https://kwy404.github.io/kastor/frameworks.html).

## API reference

| Export | What it is |
| --- | --- |
| `kastor({ adapter, schema, relations?, log? })` | Creates the client |
| `table(name, columns, options?)` | Declares a table |
| `t` | Column builders |
| `index(...cols)`, `uniqueIndex(...cols)` | Index builders for `table(..., { indexes })` |
| `one(target, config?)`, `many(target, config?)` | Relations |
| `sql` | Tagged template for raw SQL fragments |
| `KastorError`, `isKastorError(e)` | Errors with `code`, `message`, `hint` |
| `toSchemaIR(schema)` | The schema as plain JSON |
| `defineConfig(config)` | Typed `kastor.config.ts` |
| `defineSeed<Db>(fn)`, `factory(db.users, ({ seq }) => data)` | Seeds and test factories |
| `InferSelect`, `InferInsert`, `KastorClient` | Types |

Client: `db.<model>.<method>(...)`, `db.$transaction`, `db.$sql`, `db.$execute`, `db.$schema`, `db.$dialect`, `db.$disconnect()`. The full reference with every option is at [kwy404.github.io/kastor/api.html](https://kwy404.github.io/kastor/api.html).

## FAQ

### Can one project use PostgreSQL, MySQL and SQLite?
Yes. The schema and the query API are the same on every database. kastor compiles the same queries to each dialect, so moving from SQLite in tests to PostgreSQL in production is a change of adapter, not of code.

### Is there a generate step?
No. kastor infers every type from the schema with the TypeScript compiler, so there is no `generate` command and no generated client to keep in sync. Try it in the [playground](https://kwy404.github.io/kastor/#playground).

### How are relations loaded?
Use `include`. kastor loads nested relations in one statement per call: JSON aggregation on every SQL database, `$lookup` stages in one pipeline on MongoDB. Read [avoid N+1 queries](https://kwy404.github.io/kastor/avoid-n-plus-1-queries.html).

### Does it support SQL Server and Oracle?
kastor supports both with the `mssql` and `oracledb` drivers: OUTPUT and MERGE on SQL Server, FETCH FIRST and MERGE on Oracle. See the [database support matrix](https://kwy404.github.io/kastor/#databases).

### Does it run on Cloudflare D1 and Turso?
Yes: `d1(env.DB)` inside a Worker and `libsql(createClient(...))` for Turso. See [kastor with Cloudflare Workers](https://kwy404.github.io/kastor/cloudflare-workers-orm.html).

### Does MongoDB use the same API?
Yes. kastor's MongoDB adapter takes the same schema and query API and compiles includes to `$lookup` pipelines. See the [database support matrix](https://kwy404.github.io/kastor/#databases).

### Does it work with an existing database?
Yes. `npx kastor db pull` writes the TypeScript schema from the live database, relations included, and `npx kastor migrate baseline` records the database as the first migration without changing it. Coming from Prisma, `npx kastor import prisma` converts schema.prisma directly. See [Migrate to kastor](https://kwy404.github.io/kastor/migrate-to-kastor.html).

## Comparison

ORMs make different trade-offs, so this compares approaches rather than products. Check each tool's docs for current details.

| | kastor | Generated client ORMs | SQL first query builders | Decorator ORMs |
| --- | --- | --- | --- | --- |
| Where the schema lives | TypeScript | A schema file in its own language | TypeScript | Classes with decorators |
| Types after a schema change | Inferred on the next keystroke | After a generate command | Inferred | Declared by hand |
| Nested relations | One query per root call | Varies | Varies by API | Joins or extra queries |
| Migrations from the schema | Built in, rename detection asks first | Usually built in | Usually a separate kit | Usually built in |
| Same API on SQL and MongoDB | Yes | Varies | Usually SQL only | Varies |
| Runtime dependencies | Zero (bring your driver) | Varies | Small | Several |

## More from kwy404

- [Monsoon](https://kwy404.github.io/monsoon/): utility-first CSS with no build step
- [Voodoo.js](https://kwy404.github.io/Voodoo.js/): reactive attributes for plain HTML
- [breakhound](https://kwy404.github.io/breakhound/): find bugs in any JavaScript library automatically
- [vueleap](https://kwy404.github.io/vueleap/): Vue 2 to Vue 3 migration
- [graphemely](https://kwy404.github.io/graphemely/): grapheme aware string utilities
- [numberparrot](https://kwy404.github.io/numberparrot/): parse localized numbers
- [edgegoat](https://kwy404.github.io/edgegoat/): edge case inputs for JavaScript testing
- [cookieowl](https://kwy404.github.io/cookieowl/): a cookie consent banner that blocks trackers before consent
- [installkite](https://kwy404.github.io/installkite/): make any website an installable, offline capable PWA
- [a11ymedic](https://kwy404.github.io/a11ymedic/): accessibility checks with the exact fix
- [fontsketch](https://kwy404.github.io/fontsketch/): create your own font in the browser

## Author

Created by **Alexandre Kohler** ([GitHub](https://github.com/kwy404) and [LinkedIn](https://www.linkedin.com/in/alexandre-silva-173687256/)).

Contributions are welcome: read [CONTRIBUTING.md](https://github.com/kwy404/kastor/blob/main/CONTRIBUTING.md) and the [security policy](https://github.com/kwy404/kastor/blob/main/SECURITY.md). Release notes are in [CHANGELOG.md](https://github.com/kwy404/kastor/blob/main/CHANGELOG.md).

## License

[MIT](https://github.com/kwy404/kastor/blob/main/LICENSE) © 2026 Alexandre Kohler
