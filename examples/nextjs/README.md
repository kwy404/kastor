# kastor Next.js starter

A Next.js App Router app that reads and writes SQLite through kastor: a page that lists posts with their authors, a form that adds a post with a server action, and a delete button. No database server is needed.

## Start

```bash
npx create-next-app@latest my-app --example https://github.com/kwy404/kastor/tree/main/examples/nextjs
cd my-app
npm run dev
```

Or copy this folder and run `npm install`, then `npm run dev`.

`npm run dev` first applies the migrations in `kastor/migrations` and adds two sample authors and posts to an empty database, then starts Next.js on http://localhost:3000.

## Where things are

| File | What it does |
| --- | --- |
| `src/db/schema.ts` | The tables and relations, in TypeScript |
| `src/db/index.ts` | The kastor client, one per server process |
| `src/db/posts.ts` | The queries the page and the actions use |
| `src/db/seed.ts` | Sample rows for an empty database |
| `src/app/page.tsx` | The page, a server component |
| `src/app/actions.ts` | Server actions that add and delete posts |
| `kastor.config.ts` | Schema, adapter, migrations and seed for the kastor command line |

## Change the schema

1. Edit `src/db/schema.ts`, for example add `published: t.boolean().default(false)` to `posts`.
2. Run `npm run db:migrate -- --name add_published`. It writes a migration file and applies it.
3. Use the new column in `src/db/posts.ts`. The types follow the schema with no generate step.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Apply migrations, seed an empty database, start Next.js |
| `npm run build` | Apply migrations, then build for production |
| `npm run db:migrate` | Write and apply a migration after a schema change |
| `npm run db:seed` | Run `src/db/seed.ts` |
| `npm run studio` | Browse and edit the data, and see the SQL of each query |
| `npm run typecheck` | Check the types |

## Another database

Swap the adapter in `kastor.config.ts` and `src/db/index.ts`, install the driver, delete `kastor/migrations` and run `npm run db:migrate -- --name init`. For PostgreSQL:

```ts
import pg from 'pg';
import { postgres } from 'kastor-orm/postgres';

const adapter = postgres(new pg.Pool({ connectionString: process.env.DATABASE_URL }));
```

On a serverless host, use a hosted database instead of a SQLite file: the file does not survive between requests there.
