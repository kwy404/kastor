// Framework guides: how to wire one kastor client into each runtime.
// Every entry: the db module, then one idiomatic read and write.

const PG_DB = `import pg from 'pg'
import { kastor } from 'kastor'
import { postgres } from 'kastor/postgres'
import * as schema from './schema'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

export const db = kastor({ adapter: postgres(pool), schema, relations: schema.relations })`;

export const FRAMEWORKS = [
  {
    id: 'nextjs',
    name: 'Next.js',
    tag: 'App Router, server components, server actions',
    intro: 'Create the client once and reuse it across hot reloads in development, then query it from server components, server actions and route handlers. Never import the db module from a client component: the driver and your credentials must stay on the server.',
    files: [
      ['src/db/index.ts', 'ts', `import pg from 'pg'
import { kastor } from 'kastor'
import { postgres } from 'kastor/postgres'
import * as schema from './schema'

const create = () => kastor({
  adapter: postgres(new pg.Pool({ connectionString: process.env.DATABASE_URL })),
  schema,
  relations: schema.relations,
})

const g = globalThis as unknown as { db?: ReturnType<typeof create> }
export const db = g.db ?? create()
if (process.env.NODE_ENV !== 'production') g.db = db`],
      ['app/posts/page.tsx', 'tsx', `import { revalidatePath } from 'next/cache'
import { db } from '@/db'

export default async function Posts() {
  const posts = await db.posts.findMany({ include: { author: true }, take: 20 })

  async function publish(formData: FormData) {
    'use server'
    await db.posts.update({ where: { id: Number(formData.get('id')) }, data: { published: true } })
    revalidatePath('/posts')
  }

  return (
    <ul>
      {posts.map((p) => (
        <li key={p.id}>
          {p.title} by {p.author.email}
          <form action={publish}><input type="hidden" name="id" value={p.id} /><button>Publish</button></form>
        </li>
      ))}
    </ul>
  )
}`],
    ],
    guide: 'nextjs-postgres-orm.html',
  },
  {
    id: 'nuxt',
    name: 'Nuxt',
    tag: 'Nitro server routes',
    intro: 'Put the client in server/utils so Nitro auto imports it in every server route. Pages fetch through useFetch, so the database never reaches the browser bundle.',
    files: [
      ['server/utils/db.ts', 'ts', PG_DB.replace("'./schema'", "'../db/schema'")],
      ['server/api/posts.get.ts', 'ts', `export default defineEventHandler(async (event) => {
  const { take } = getQuery(event)
  return db.posts.findMany({
    where: { published: true },
    include: { author: { select: { name: true } } },
    take: Number(take ?? 20),
  })
})`],
    ],
  },
  {
    id: 'sveltekit',
    name: 'SvelteKit',
    tag: 'load functions and form actions',
    intro: 'Keep the client in $lib/server so SvelteKit refuses to ship it to the browser, then read in load functions and write in form actions.',
    files: [
      ['src/lib/server/db.ts', 'ts', PG_DB.replace("process.env.DATABASE_URL", 'env.DATABASE_URL').replace("import pg from 'pg'", "import pg from 'pg'\nimport { env } from '$env/dynamic/private'")],
      ['src/routes/posts/+page.server.ts', 'ts', `import { db } from '$lib/server/db'

export const load = async () => ({
  posts: await db.posts.findMany({ orderBy: { id: 'desc' }, take: 20 }),
})

export const actions = {
  create: async ({ request }) => {
    const form = await request.formData()
    await db.posts.create({ data: { title: String(form.get('title')), authorId: 1 } })
  },
}`],
    ],
  },
  {
    id: 'express',
    name: 'Express',
    tag: 'one client per process',
    intro: 'Create the client at startup and share it. Map KastorError codes to HTTP status codes in one error middleware.',
    files: [
      ['src/server.ts', 'ts', `import express from 'express'
import { isKastorError } from 'kastor'
import { db } from './db'

const app = express()
app.use(express.json())

app.get('/users/:id', async (req, res, next) => {
  try {
    const user = await db.users.findUnique({ where: { id: Number(req.params.id) }, include: { posts: true } })
    user ? res.json(user) : res.sendStatus(404)
  } catch (e) { next(e) }
})

app.use((err, req, res, next) => {
  if (isKastorError(err) && err.code === 'UNIQUE_VIOLATION') return res.status(409).json({ error: err.message })
  next(err)
})

app.listen(3000)`],
    ],
  },
  {
    id: 'fastify',
    name: 'Fastify',
    tag: 'decorate the instance',
    intro: 'Decorate the Fastify instance with the client and close the pool in the onClose hook so tests and graceful shutdowns finish cleanly.',
    files: [
      ['src/app.ts', 'ts', `import Fastify from 'fastify'
import { db } from './db'

const app = Fastify({ logger: true })
app.decorate('db', db)
app.addHook('onClose', async () => { await db.$disconnect() })

app.get('/posts', async () => app.db.posts.findMany({ where: { published: true }, take: 50 }))

app.post<{ Body: { title: string; authorId: number } }>('/posts', async (req, reply) => {
  const post = await app.db.posts.create({ data: req.body })
  return reply.code(201).send(post)
})

await app.listen({ port: 3000 })`],
    ],
  },
  {
    id: 'nestjs',
    name: 'NestJS',
    tag: 'a provider and dependency injection',
    intro: 'Wrap the client in an injectable service. Because kastor infers types from the schema, the service exposes fully typed models without any extra classes.',
    files: [
      ['src/db/db.service.ts', 'ts', `import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { db } from './index'

@Injectable()
export class DbService implements OnModuleDestroy {
  readonly client = db
  async onModuleDestroy() {
    await db.$disconnect()
  }
}`],
      ['src/users/users.controller.ts', 'ts', `import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common'
import { DbService } from '../db/db.service'

@Controller('users')
export class UsersController {
  constructor(private readonly db: DbService) {}

  @Get(':id')
  find(@Param('id', ParseIntPipe) id: number) {
    return this.db.client.users.findUniqueOrThrow({ where: { id }, include: { posts: true } })
  }
}`],
    ],
  },
  {
    id: 'hono',
    name: 'Hono',
    tag: 'Node, Bun, Deno and Workers',
    intro: 'Hono runs everywhere, and so does kastor. On Node use the Postgres module above; on Cloudflare Workers build the client from the D1 binding inside the request.',
    files: [
      ['src/index.ts', 'ts', `import { Hono } from 'hono'
import { kastor } from 'kastor'
import { d1 } from 'kastor/d1'
import * as schema from './db/schema'

type Env = { Bindings: { DB: D1Database } }
const app = new Hono<Env>()

app.get('/users', async (c) => {
  const db = kastor({ adapter: d1(c.env.DB), schema, relations: schema.relations })
  return c.json(await db.users.findMany({ take: 20, include: { posts: true } }))
})

export default app`],
    ],
  },
  {
    id: 'bun',
    name: 'Bun',
    tag: 'bun:sqlite, no driver to install',
    intro: 'Bun ships SQLite in the runtime. Pass a bun:sqlite Database to the sqlite adapter and you have a typed database with zero extra dependencies.',
    files: [
      ['server.ts', 'ts', `import { Database } from 'bun:sqlite'
import { kastor } from 'kastor'
import { sqlite } from 'kastor/sqlite'
import * as schema from './db/schema'

const db = kastor({ adapter: sqlite(new Database('app.db')), schema, relations: schema.relations })

Bun.serve({
  port: 3000,
  async fetch() {
    return Response.json(await db.posts.findMany({ include: { author: true }, take: 10 }))
  },
})`],
    ],
  },
  {
    id: 'deno',
    name: 'Deno',
    tag: 'npm specifiers',
    intro: 'Deno imports kastor and the driver with npm: specifiers. Grant network and env access when you run it.',
    files: [
      ['main.ts', 'ts', `import pg from 'npm:pg'
import { kastor } from 'npm:kastor'
import { postgres } from 'npm:kastor/postgres'
import * as schema from './db/schema.ts'

const db = kastor({
  adapter: postgres(new pg.Pool({ connectionString: Deno.env.get('DATABASE_URL') })),
  schema,
  relations: schema.relations,
})

Deno.serve(async () => Response.json(await db.users.count()))`],
      ['Terminal', 'bash', 'deno run --allow-net --allow-env main.ts'],
    ],
  },
  {
    id: 'workers',
    name: 'Cloudflare Workers',
    tag: 'D1, or Postgres through a pooler',
    intro: 'Bind a D1 database in wrangler.toml and build the client per request from env.DB. D1 runs batches, not interactive transactions, so use the array form of $transaction there.',
    files: [
      ['wrangler.toml', 'toml', `name = "app"
main = "src/worker.ts"
compatibility_date = "2026-10-01"

[[d1_databases]]
binding = "DB"
database_name = "app"
database_id = "<your database id>"`],
      ['src/worker.ts', 'ts', `import { kastor } from 'kastor'
import { d1 } from 'kastor/d1'
import * as schema from './db/schema'

export default {
  async fetch(request: Request, env: { DB: D1Database }) {
    const db = kastor({ adapter: d1(env.DB), schema, relations: schema.relations })
    const url = new URL(request.url)
    if (request.method === 'POST') {
      const body = await request.json<{ email: string }>()
      return Response.json(await db.users.create({ data: { email: body.email } }), { status: 201 })
    }
    return Response.json(await db.users.findMany({ take: Number(url.searchParams.get('take') ?? 20) }))
  },
}`],
    ],
    guide: 'cloudflare-d1-orm.html',
  },
];
