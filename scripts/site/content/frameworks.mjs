// Framework guides: how to wire one kastor client into each runtime.
// Every entry: the db module, then one idiomatic read and write.

const PG_DB = `import pg from 'pg'
import { kastor } from 'kastor-orm'
import { postgres } from 'kastor-orm/postgres'
import { schema, relations } from './schema'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

export const db = kastor({ adapter: postgres(pool), schema, relations })`;

export const FRAMEWORKS = [
  {
    id: 'nextjs',
    name: 'Next.js',
    tag: 'App Router, server components, server actions',
    intro: 'Create the client once and reuse it across hot reloads in development, then query it from server components, server actions and route handlers. Never import the db module from a client component: the driver and your credentials must stay on the server.',
    files: [
      ['src/db/index.ts', 'ts', `import pg from 'pg'
import { kastor } from 'kastor-orm'
import { postgres } from 'kastor-orm/postgres'
import { schema, relations } from './schema'

const create = () => kastor({
  adapter: postgres(new pg.Pool({ connectionString: process.env.DATABASE_URL })),
  schema,
  relations,
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
    guides: [['nextjs-app-router-orm.html', 'Read the full Next.js App Router guide'], ['nextjs-postgres-orm.html', 'Next.js with PostgreSQL providers']],
  },
  {
    id: 'nuxt',
    name: 'Nuxt',
    tag: 'Nitro server routes',
    intro: 'Put the client in server/utils so Nitro auto imports it in every server route. Pages fetch through useFetch, so the database never reaches the browser bundle.',
    files: [
      ['server/utils/db.ts', 'ts', PG_DB.replace("'./schema'", "'../db/schema'")],
      ['server/api/posts.get.ts', 'ts', `import { db } from '../utils/db'

export default defineEventHandler(async (event) => {
  const { take } = getQuery(event)
  return db.posts.findMany({
    where: { published: true },
    include: { author: { select: { name: true } } },
    take: Number(take ?? 20),
  })
})`],
    ],
    guides: [['nuxt-orm.html', 'Read the full Nuxt guide']],
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
    guides: [['sveltekit-orm.html', 'Read the full SvelteKit guide']],
  },
  {
    id: 'remix',
    name: 'Remix and React Router',
    tag: 'loaders and actions in framework mode',
    intro: 'Keep the client in a .server module so the bundler never ships it, read in loaders and write in actions. The same code works in React Router 7 framework mode and in Remix 2.',
    files: [
      ['app/db.server.ts', 'ts', PG_DB.replace("'./schema'", "'./db/schema'")],
      ['app/routes/posts.tsx', 'tsx', `import { redirect, useLoaderData, type ActionFunctionArgs } from 'react-router'
import { db } from '../db.server'

export async function loader() {
  return { posts: await db.posts.findMany({ where: { published: true }, include: { author: true }, take: 20 }) }
}

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData()
  const post = await db.posts.create({ data: { title: String(form.get('title')), authorId: 1 } })
  return redirect('/posts/' + post.id)
}

export default function Posts() {
  const { posts } = useLoaderData<typeof loader>()
  return <ul>{posts.map((p) => <li key={p.id}>{p.title} by {p.author.email}</li>)}</ul>
}`],
    ],
    guides: [['remix-react-router-orm.html', 'Read the full Remix and React Router guide']],
  },
  {
    id: 'astro',
    name: 'Astro',
    tag: 'on-demand pages and endpoints',
    intro: 'With a server adapter, pages marked prerender = false and API endpoints run per request. Query kastor in the frontmatter or the endpoint; secrets without the PUBLIC_ prefix stay on the server.',
    files: [
      ['src/pages/api/posts.ts', 'ts', `import type { APIRoute } from 'astro'
import { db } from '../../db'

export const prerender = false

export const GET: APIRoute = async ({ url }) => {
  const take = Number(url.searchParams.get('take') ?? 20)
  return Response.json(await db.posts.findMany({ where: { published: true }, include: { tags: true }, take }))
}`],
    ],
    guides: [['astro-orm.html', 'Read the full Astro guide']],
  },
  {
    id: 'express',
    name: 'Express',
    tag: 'one client per process',
    intro: 'Create the client at startup and share it. Map KastorError codes to HTTP status codes in one error middleware.',
    files: [
      ['src/server.ts', 'ts', `import express from 'express'
import { isKastorError } from 'kastor-orm'
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
    guides: [['express-orm.html', 'Read the full Express guide']],
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
    guides: [['fastify-orm.html', 'Read the full Fastify guide']],
  },
  {
    id: 'nestjs',
    name: 'NestJS',
    tag: 'a global module and a provider',
    intro: 'Register the client as a provider under a token in a global module, close the pool on shutdown, and inject it into services. Types come from the schema, so there are no entity classes or repositories to write.',
    files: [
      ['src/db/db.module.ts', 'ts', `import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common'
import pg from 'pg'
import { kastor } from 'kastor-orm'
import { postgres } from 'kastor-orm/postgres'
import { schema, relations } from './schema'

export const KASTOR = Symbol('KASTOR')
export const createDb = (url: string) =>
  kastor({ adapter: postgres(new pg.Pool({ connectionString: url, max: 10 })), schema, relations })
export type Db = ReturnType<typeof createDb>

@Global()
@Module({
  providers: [{ provide: KASTOR, useFactory: () => createDb(process.env.DATABASE_URL!) }],
  exports: [KASTOR],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(KASTOR) private readonly db: Db) {}
  async onApplicationShutdown() {
    await this.db.$disconnect()
  }
}`],
      ['src/users/users.service.ts', 'ts', `import { Inject, Injectable } from '@nestjs/common'
import { KASTOR, type Db } from '../db/db.module'

@Injectable()
export class UsersService {
  constructor(@Inject(KASTOR) private readonly db: Db) {}

  find(id: number) {
    return this.db.users.findUniqueOrThrow({ where: { id }, include: { posts: true } })
  }
}`],
    ],
    guides: [['nestjs-orm.html', 'Read the full NestJS guide']],
  },
  {
    id: 'hono',
    name: 'Hono',
    tag: 'Node, Bun, Deno and Workers',
    intro: 'Hono runs everywhere, and so does kastor. On Node use the Postgres module above; on Cloudflare Workers build the client from the D1 binding inside the request.',
    files: [
      ['src/index.ts', 'ts', `import { Hono } from 'hono'
import { kastor } from 'kastor-orm'
import { d1 } from 'kastor-orm/d1'
import { schema, relations } from './db/schema'

type Env = { Bindings: { DB: D1Database } }
const app = new Hono<Env>()

app.get('/users', async (c) => {
  const db = kastor({ adapter: d1(c.env.DB), schema, relations })
  return c.json(await db.users.findMany({ take: 20, include: { posts: true } }))
})

export default app`],
    ],
    guides: [['hono-orm.html', 'Read the full Hono guide']],
  },
  {
    id: 'adonisjs',
    name: 'AdonisJS',
    tag: 'a service module next to or instead of Lucid',
    intro: 'Validate DATABASE_URL in start/env.ts, export the client from app/services/db.ts and import it through the #services alias in controllers. A provider closes the pool on shutdown.',
    files: [
      ['app/services/db.ts', 'ts', `import pg from 'pg'
import { kastor } from 'kastor-orm'
import { postgres } from 'kastor-orm/postgres'
import env from '#start/env'
import { schema, relations } from '../../database/schema'

export default kastor({
  adapter: postgres(new pg.Pool({ connectionString: env.get('DATABASE_URL') })),
  schema,
  relations,
})`],
      ['app/controllers/posts_controller.ts', 'ts', `import type { HttpContext } from '@adonisjs/core/http'
import db from '#services/db'

export default class PostsController {
  async index({ request }: HttpContext) {
    const take = Number(request.input('take', 20))
    return db.posts.findMany({ where: { published: true }, include: { author: true }, take })
  }
}`],
    ],
    guides: [['adonisjs-orm.html', 'Read the full AdonisJS guide']],
  },
  {
    id: 'bun',
    name: 'Bun',
    tag: 'bun:sqlite, no driver to install',
    intro: 'Bun ships SQLite in the runtime. Pass a bun:sqlite Database to the sqlite adapter and you have a typed database with zero extra dependencies.',
    files: [
      ['server.ts', 'ts', `import { Database } from 'bun:sqlite'
import { kastor } from 'kastor-orm'
import { sqlite } from 'kastor-orm/sqlite'
import { schema, relations } from './db/schema'

const db = kastor({ adapter: sqlite(new Database('app.db')), schema, relations })

Bun.serve({
  port: 3000,
  async fetch() {
    return Response.json(await db.posts.findMany({ include: { author: true }, take: 10 }))
  },
})`],
    ],
    guides: [['bun-orm.html', 'Read the full Bun guide']],
  },
  {
    id: 'deno',
    name: 'Deno',
    tag: 'npm specifiers',
    intro: 'Deno imports kastor and the driver with npm: specifiers. Grant network and env access when you run it.',
    files: [
      ['main.ts', 'ts', `import pg from 'npm:pg'
import { kastor } from 'npm:kastor-orm'
import { postgres } from 'npm:kastor-orm/postgres'
import { schema, relations } from './db/schema.ts'

const db = kastor({
  adapter: postgres(new pg.Pool({ connectionString: Deno.env.get('DATABASE_URL') })),
  schema,
  relations,
})

Deno.serve(async () => Response.json(await db.users.count()))`],
      ['Terminal', 'bash', 'deno run --allow-net --allow-env main.ts'],
    ],
    guides: [['deno-orm.html', 'Read the full Deno guide']],
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
      ['src/worker.ts', 'ts', `import { kastor } from 'kastor-orm'
import { d1 } from 'kastor-orm/d1'
import { schema, relations } from './db/schema'

export default {
  async fetch(request: Request, env: { DB: D1Database }) {
    const db = kastor({ adapter: d1(env.DB), schema, relations })
    const url = new URL(request.url)
    if (request.method === 'POST') {
      const body = (await request.json()) as { email: string }
      return Response.json(await db.users.create({ data: { email: body.email } }), { status: 201 })
    }
    return Response.json(await db.users.findMany({ take: Number(url.searchParams.get('take') ?? 20) }))
  },
}`],
    ],
    guides: [['cloudflare-workers-orm.html', 'Read the full Cloudflare Workers guide'], ['cloudflare-d1-orm.html', 'Cloudflare D1 in depth']],
  },
  {
    id: 'electron',
    name: 'Electron',
    tag: 'SQLite in the main process, typed IPC',
    intro: 'Open the SQLite file in the user data folder from the main process, apply the migrations shipped with the app, and expose a few IPC channels to the renderer through a preload bridge.',
    files: [
      ['src/main/db.ts', 'ts', `import { join } from 'node:path'
import Database from 'better-sqlite3'
import { app, ipcMain } from 'electron'
import { kastor } from 'kastor-orm'
import { sqlite } from 'kastor-orm/sqlite'
import { deploy } from 'kastor-orm/migrate'
import { schema, relations } from './db/schema'

export async function startDatabase() {
  const adapter = sqlite(new Database(join(app.getPath('userData'), 'app.db')))
  await deploy(adapter, join(process.resourcesPath, 'migrations'))
  const db = kastor({ adapter, schema, relations })
  ipcMain.handle('posts:list', () => db.posts.findMany({ orderBy: { id: 'desc' }, take: 100 }))
  return db
}`],
    ],
    guides: [['electron-sqlite-orm.html', 'Read the full Electron guide']],
  },
  {
    id: 'lambda',
    name: 'AWS Lambda',
    tag: 'reuse across warm invocations',
    intro: 'Create the client at module scope so warm invocations reuse its connection, keep the pool at one connection per environment, and put RDS Proxy or another pooler in front of the database.',
    files: [
      ['src/handler.ts', 'ts', `import pg from 'pg'
import { kastor } from 'kastor-orm'
import { postgres } from 'kastor-orm/postgres'
import { schema, relations } from './db/schema'

// Module scope: created at cold start, reused by warm invocations.
const db = kastor({ adapter: postgres(new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 })), schema, relations })

export async function handler() {
  const posts = await db.posts.findMany({ where: { published: true }, take: 20 })
  return { statusCode: 200, body: JSON.stringify(posts) }
}`],
    ],
    guides: [['aws-lambda-orm.html', 'Read the full AWS Lambda guide']],
  },
];
