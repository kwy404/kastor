<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://cdn.jsdelivr.net/gh/kwy404/kastor@main/assets/banner-dark.svg">
  <img src="https://cdn.jsdelivr.net/gh/kwy404/kastor@main/assets/banner.svg" alt="Banner do kastor: Kas, o castor engenheiro, ao lado do logotipo, o ORM para TypeScript para quase todos os bancos de dados" width="100%">
</picture>

# kastor: o ORM para TypeScript para quase todos os bancos de dados

**Schema em TypeScript puro. Tipos inferidos enquanto você digita. Sem etapa de geração, sem engine binária.**

[![versão no npm](https://img.shields.io/npm/v/kastor.svg)](https://www.npmjs.com/package/kastor)
[![downloads no npm por mês](https://img.shields.io/npm/dm/kastor.svg)](https://www.npmjs.com/package/kastor)
[![downloads no npm no total](https://img.shields.io/npm/dt/kastor.svg)](https://www.npmjs.com/package/kastor)
[![CI](https://github.com/kwy404/kastor/actions/workflows/ci.yml/badge.svg)](https://github.com/kwy404/kastor/actions/workflows/ci.yml)
[![Licença: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/kwy404/kastor/blob/main/LICENSE)
[![Tamanho da instalação](https://packagephobia.com/badge?p=kastor)](https://packagephobia.com/result?p=kastor)
[![Tamanho do bundle](https://img.shields.io/bundlephobia/minzip/kastor)](https://bundlephobia.com/package/kastor)

[English](https://github.com/kwy404/kastor/blob/main/README.md) | Português (Brasil)

[Site e playground ao vivo](https://kwy404.github.io/kastor/) · [Referência da API](https://kwy404.github.io/kastor/api.html) · [Guias](https://kwy404.github.io/kastor/guides.html) · [Guias em português](https://kwy404.github.io/kastor/pt-br/) · [npm](https://www.npmjs.com/package/kastor)

</div>

kastor é um ORM open source para TypeScript que funciona com PostgreSQL, CockroachDB, MySQL, MariaDB, SQLite (better-sqlite3, node:sqlite, bun:sqlite), libSQL e Turso, Cloudflare D1, SQL Server, Oracle e MongoDB. Você escreve o schema como valores comuns de TypeScript, e o compilador do TypeScript infere o tipo de cada linha enquanto você digita: sem linguagem de schema, sem geração de código, sem engine para baixar. As consultas são objetos conhecidos (`where`, `include`, `select`), os includes aninhados carregam em uma única consulta com agregação JSON, as migrações são calculadas a partir do schema em arquivos SQL legíveis, e `npx kastor studio` abre um navegador de dados local.

O nome vem de *castor*, palavra latina para o animal de mesmo nome. Castores constroem estruturas fortes com troncos; o kastor constrói camadas de dados fortes com linhas. Conheça Kas, o engenheiro da obra:

<div align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://cdn.jsdelivr.net/gh/kwy404/kastor@main/assets/mascot-dark.svg">
  <img src="https://cdn.jsdelivr.net/gh/kwy404/kastor@main/assets/mascot.svg" alt="Kas, o castor engenheiro do kastor, com capacete amarelo, um rolo de planta debaixo do braço e um lápis atrás da orelha" width="200">
</picture>
</div>

## Sumário

- [Recursos](#recursos)
- [Início rápido](#início-rápido)
- [Bancos de dados suportados](#bancos-de-dados-suportados)
- [Schema](#schema)
- [Consultas](#consultas)
- [Escritas e transações](#escritas-e-transações)
- [SQL puro](#sql-puro)
- [Erros](#erros)
- [Migrações e a CLI](#migrações-e-a-cli)
- [Studio](#studio)
- [Uso com frameworks: Next.js, React, Vue, Angular, HTML puro](#uso-com-frameworks)
- [Referência da API](#referência-da-api)
- [Perguntas frequentes](#perguntas-frequentes)
- [Comparação](#comparação)
- [Mais projetos de kwy404](#mais-projetos-de-kwy404)
- [Autor](#autor)
- [Licença](#licença)

## Recursos

| | | |
| --- | --- | --- |
| <picture><source media="(prefers-color-scheme: dark)" srcset="https://cdn.jsdelivr.net/gh/kwy404/kastor@main/assets/icons/dark/schema.svg"><img src="https://cdn.jsdelivr.net/gh/kwy404/kastor@main/assets/icons/light/schema.svg" width="40" alt="Ícone de schema"></picture><br>**Schema em TypeScript**<br>Tabelas, colunas, índices e relações são valores comuns. | <picture><source media="(prefers-color-scheme: dark)" srcset="https://cdn.jsdelivr.net/gh/kwy404/kastor@main/assets/icons/dark/no-codegen.svg"><img src="https://cdn.jsdelivr.net/gh/kwy404/kastor@main/assets/icons/light/no-codegen.svg" width="40" alt="Ícone de sem geração de código"></picture><br>**Sem etapa de geração**<br>Os tipos são inferidos na próxima tecla. | <picture><source media="(prefers-color-scheme: dark)" srcset="https://cdn.jsdelivr.net/gh/kwy404/kastor@main/assets/icons/dark/one-query.svg"><img src="https://cdn.jsdelivr.net/gh/kwy404/kastor@main/assets/icons/light/one-query.svg" width="40" alt="Ícone de consulta única"></picture><br>**Includes em uma consulta**<br>Agregação JSON, nunca N+1. |
| <picture><source media="(prefers-color-scheme: dark)" srcset="https://cdn.jsdelivr.net/gh/kwy404/kastor@main/assets/icons/dark/migrations.svg"><img src="https://cdn.jsdelivr.net/gh/kwy404/kastor@main/assets/icons/light/migrations.svg" width="40" alt="Ícone de migrações"></picture><br>**Migrações automáticas**<br>Arquivos SQL legíveis, e a detecção de renomeação pergunta antes. | <picture><source media="(prefers-color-scheme: dark)" srcset="https://cdn.jsdelivr.net/gh/kwy404/kastor@main/assets/icons/dark/studio.svg"><img src="https://cdn.jsdelivr.net/gh/kwy404/kastor@main/assets/icons/light/studio.svg" width="40" alt="Ícone do Studio"></picture><br>**Studio**<br>Navegue e edite dados, veja o diagrama ER. | <picture><source media="(prefers-color-scheme: dark)" srcset="https://cdn.jsdelivr.net/gh/kwy404/kastor@main/assets/icons/dark/errors.svg"><img src="https://cdn.jsdelivr.net/gh/kwy404/kastor@main/assets/icons/light/errors.svg" width="40" alt="Ícone de erros"></picture><br>**Erros com dica**<br>Um código estável, uma mensagem clara e a correção. |
| <picture><source media="(prefers-color-scheme: dark)" srcset="https://cdn.jsdelivr.net/gh/kwy404/kastor@main/assets/icons/dark/raw-sql.svg"><img src="https://cdn.jsdelivr.net/gh/kwy404/kastor@main/assets/icons/light/raw-sql.svg" width="40" alt="Ícone de SQL puro"></picture><br>**SQL puro tipado**<br>Tagged templates, os valores viram parâmetros. | <picture><source media="(prefers-color-scheme: dark)" srcset="https://cdn.jsdelivr.net/gh/kwy404/kastor@main/assets/icons/dark/adapters.svg"><img src="https://cdn.jsdelivr.net/gh/kwy404/kastor@main/assets/icons/light/adapters.svg" width="40" alt="Ícone de adaptadores"></picture><br>**Use o seu próprio driver**<br>Nenhum driver embutido, nenhum peso extra em tempo de execução. | <picture><source media="(prefers-color-scheme: dark)" srcset="https://cdn.jsdelivr.net/gh/kwy404/kastor@main/assets/icons/dark/edge.svg"><img src="https://cdn.jsdelivr.net/gh/kwy404/kastor@main/assets/icons/light/edge.svg" width="40" alt="Ícone de edge"></picture><br>**Serverless e edge**<br>Workers com D1, Turso, Neon, Bun e Deno. |

## Início rápido

```bash
npm i kastor pg          # or mysql2, mariadb, better-sqlite3, @libsql/client, mssql, oracledb, mongodb
npx kastor init --db postgres   # writes kastor.config.ts, a starter schema, a seed and .env
```

Declare o schema em `src/db/schema.ts`:

```ts
import { table, t, one, many, index } from 'kastor'

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

Crie o client em `src/db/index.ts`:

```ts
import pg from 'pg'
import { kastor } from 'kastor'
import { postgres } from 'kastor/postgres'
import { schema, relations } from './schema'

export const db = kastor({
  adapter: postgres(new pg.Pool({ connectionString: process.env.DATABASE_URL })),
  schema,
  relations,
})
```

Crie as tabelas e faça a consulta:

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

Teste tudo isso sem instalar nada no [playground ao vivo](https://kwy404.github.io/kastor/#playground): ele roda o compilador real do kastor no seu navegador, mostra o tipo inferido e o SQL de cada banco de dados lado a lado, e executa a consulta no SQLite.

### CDN

O build para tag script expõe o núcleo inteiro como a variável global `Kastor`, junto com o compilador SQL compartilhado, então uma página consegue montar consultas e compilar para SQL sem banco de dados, como faz o playground do site. As consultas precisam de um runtime de servidor (Node.js, Bun, Deno ou Workers) e de um driver.

```html
<script src="https://cdn.jsdelivr.net/npm/kastor@0.1.0/dist/kastor.js"></script>
<script>
  const { kastor, table, t, compileOnlyDialect, defineHooks, placeholderDollar, jsonPostgres } = Kastor
  const users = table('users', { id: t.id(), email: t.string(255).unique() })
  const dialect = compileOnlyDialect('postgres', defineHooks({ placeholder: placeholderDollar, json: jsonPostgres, returning: 'returning' }))
  const db = kastor({ adapter: { dialect, executor: {} }, schema: { users } })
  console.log(db.users.findMany({ where: { email: { endsWith: '@example.com' } } }).toSQL())
  // [{ sql: 'SELECT "t0"."id" AS "id", ... WHERE "t0"."email" LIKE $1 ESCAPE \'!\'', params: ['%@example.com'] }]
</script>
```

Build como módulo ES: `https://cdn.jsdelivr.net/npm/kastor@0.1.0/dist/kastor.browser.js`.

## Bancos de dados suportados

O kastor não vem com nenhum driver. Instale o que você usa e passe a instância dele para o adaptador.

| Banco de dados | Import | O que passar | Includes compilam para |
| --- | --- | --- | --- |
| PostgreSQL (também Neon, Supabase, Vercel Postgres) | `kastor/postgres` | `postgres(new pg.Pool(...))` | `json_agg` + `json_build_object` |
| CockroachDB | `kastor/cockroach` | `cockroach(new pg.Pool(...))` | `json_agg` + `json_build_object` |
| MySQL (também PlanetScale) | `kastor/mysql` | `mysql(mysql2.createPool(...))` | `JSON_ARRAYAGG` + `JSON_OBJECT` |
| MariaDB | `kastor/mariadb` | `mariadb(mariadb.createPool(...))` | `JSON_ARRAYAGG` + `JSON_OBJECT` |
| SQLite (better-sqlite3, node:sqlite, bun:sqlite) | `kastor/sqlite` | `sqlite(new Database('app.db'))` | `json_group_array` + `json_object` |
| libSQL e Turso | `kastor/libsql` | `libsql(createClient({ url, authToken }))` | `json_group_array` + `json_object` |
| Cloudflare D1 | `kastor/d1` | `d1(env.DB)` | `json_group_array` + `json_object` |
| SQL Server e Azure SQL | `kastor/mssql` | `mssql(await new sql.ConnectionPool(...).connect())` | `FOR JSON PATH` |
| Oracle | `kastor/oracle` | `oracle(await oracledb.createPool(...))` | `JSON_ARRAYAGG` + `JSON_OBJECT` |
| MongoDB | `kastor/mongodb` | `mongodb(client.db('app'))` | pipelines com `$lookup` (chaves são strings de ObjectId por padrão, `{ ids: 'int' }` para números) |

Os adaptadores compartilham uma suíte de conformidade, executada contra bancos reais no CI. Veja a [matriz de suporte](https://kwy404.github.io/kastor/#databases) para a sintaxe de returning, upsert e paginação em cada banco de dados, e [Comece em 60 segundos](https://kwy404.github.io/kastor/#start) para cada um deles.

## Schema

```ts
import { table, t, index, uniqueIndex } from 'kastor'
import type { InferSelect, InferInsert } from 'kastor'

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

| Builder | Tipo TypeScript | Builder | Tipo TypeScript |
| --- | --- | --- | --- |
| `t.id()` | `number` (chave com auto incremento) | `t.boolean()` | `boolean` |
| `t.bigId()` | `bigint` (chave com auto incremento) | `t.datetime()` | `Date` |
| `t.uuid()` | `string` | `t.date()` | `string` (`YYYY-MM-DD`) |
| `t.string(len?)` | `string` | `t.time()` | `string` (`HH:MM:SS`) |
| `t.text()` | `string` | `t.json<T>()` | `T` |
| `t.int()` | `number` | `t.bytes()` | `Uint8Array` |
| `t.bigint()` | `bigint` | `t.enum(['a', 'b'])` | `'a' \| 'b'` |
| `t.float()` | `number` | `t.decimal(p, s)` | `string` (exato) |

Modificadores: `.nullable()`, `.default(value)`, `.defaultNow()`, `.defaultRandom()`, `.defaultSql('...')`, `.unique()`, `.primaryKey()`, `.references(() => other.col, { onDelete, onUpdate })`, `.map('db_column')`, `.nativeType('varchar(64)')`. Opções de tabela: `indexes`, `primaryKey` (chaves compostas) e `softDelete: 'deletedAt'`.

As relações são declaradas junto do client, então as tabelas nunca importam umas às outras em ciclo: `one(target, { fields, references })`, `many(target)` e `many(target, { through: joinTable })` para muitos para muitos.

## Consultas

Todo model tem `findMany`, `findFirst`, `findFirstOrThrow`, `findUnique`, `findUniqueOrThrow`, `findPage`, `count`, `aggregate` e `groupBy`, com `where`, `select`, `include`, `orderBy`, `take`, `skip`, `cursor` e `distinct`.

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

Filtros: `equals`, `not`, `in`, `notIn`, `lt`, `lte`, `gt`, `gte`, `contains`, `startsWith`, `endsWith`, `mode: 'insensitive'`, `AND`, `OR`, `NOT`, filtros de relação `some`, `every`, `none`, `is`, `isNot`, e verificações de nulo. As consultas são preguiçosas: nada executa até você usar `await`, e `query.toSQL()` retorna os comandos sem executá-los.

## Escritas e transações

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

Também há `createMany`, `createManyAndReturn`, `updateMany`, `delete` e, em tabelas com soft delete, `restore`, `hardDelete` e `hardDeleteMany`.

## SQL puro

```ts
import { sql } from 'kastor'

const rows = await db.$sql<{ day: string; signups: number }>`
  select date(created_at) as day, count(*) as signups
  from users where created_at >= ${since} group by day order by day
`
const changed = await db.$execute`update posts set views = 0 where author_id = ${id}`
const recent = await db.posts.findMany({ where: { AND: [sql`length(title) > ${10}`] } })
```

Os valores do template sempre viram parâmetros. `sql.raw`, `sql.join` e `sql.ident` montam fragmentos.

## Erros

Toda falha é um `KastorError` com um `code` estável, uma `message` em inglês claro, uma `hint` com a correção, `meta` e o erro do driver como `cause`.

```ts
import { isKastorError } from 'kastor'

try {
  await db.users.create({ data: { email } })
} catch (e) {
  if (isKastorError(e) && e.code === 'UNIQUE_VIOLATION') console.log(e.message, e.hint)
}
```

Códigos: `UNIQUE_VIOLATION`, `FOREIGN_KEY_VIOLATION`, `NOT_NULL_VIOLATION`, `CHECK_VIOLATION`, `SERIALIZATION_FAILURE`, `DEADLOCK`, `CONNECTION_FAILED`, `TIMEOUT`, `NOT_FOUND` e outros, os mesmos em todos os bancos de dados.

## Migrações e a CLI

`kastor.config.ts`:

```ts
import pg from 'pg'
import { defineConfig } from 'kastor'
import { postgres } from 'kastor/postgres'

export default defineConfig({
  schema: './src/db/schema.ts',
  adapter: () => postgres(new pg.Pool({ connectionString: process.env.DATABASE_URL })),
  migrations: './kastor/migrations',
  seed: './src/db/seed.ts',
})
```

| Comando | O que faz |
| --- | --- |
| `npx kastor init --db postgres` | Cria o `kastor.config.ts`, um schema inicial e um arquivo de seed para o seu banco |
| `npx kastor migrate dev --name <name>` | Compara o schema com o banco de dados, grava `kastor/migrations/<timestamp>_<name>/migration.sql` e aplica a migração. Uma possível renomeação vira uma pergunta, nunca um drop silencioso. `--create-only`, `--rename users.name:fullName`, `--accept-data-loss` |
| `npx kastor migrate deploy` | Aplica as migrações pendentes (CI e produção) |
| `npx kastor migrate status` | Lista as migrações aplicadas e pendentes |
| `npx kastor migrate reset` | Apaga tudo, aplica todas as migrações de novo e roda o seed |
| `npx kastor db push` | Sincroniza o schema sem arquivo de migração, para protótipos |
| `npx kastor db pull` | Gera um schema TypeScript a partir de um banco de dados existente (`--out`, `--print`) |
| `npx kastor db seed` | Executa o arquivo de seed |
| `npx kastor studio` | Abre o studio local |
| `npx kastor doctor` | Verifica a configuração, a conexão, o drift e as migrações pendentes |

Leia [migrações de banco de dados explicadas](https://kwy404.github.io/kastor/pt-br/migracoes-banco-de-dados.html) para ver o fluxo completo.

## Studio

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://cdn.jsdelivr.net/gh/kwy404/kastor@main/docs/assets/studio-data-dark.png">
  <img src="https://cdn.jsdelivr.net/gh/kwy404/kastor@main/docs/assets/studio-data-light.png" alt="O studio do kastor navegando pela tabela posts: filtros, linhas, chaves estrangeiras e ações" width="100%">
</picture>

`npx kastor studio` abre uma interface web local: navegue por todas as tabelas, filtre e busque, crie, edite e apague linhas, siga as chaves estrangeiras e veja o diagrama do banco de dados inteiro. Ele roda em 127.0.0.1 protegido por um token de sessão privado, e `--read-only` protege dados que não podem ser alterados.

## Uso com frameworks

O kastor roda no servidor. Crie um client por processo e importe ele apenas em código de servidor.

**Next.js (App Router)**: reaproveite o client entre os hot reloads e faça consultas em server components e server actions. Veja também o guia [Next.js com PostgreSQL e ORM](https://kwy404.github.io/kastor/pt-br/nextjs-postgres-orm.html).

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

**React** (Remix, React Router, Vite SSR): chame o kastor em loaders e actions, nunca em client components. **Vue** com Nuxt: coloque o client em `server/utils/db.ts` e faça as consultas nas rotas `server/api/*.ts`. **Angular** com SSR: consulte a partir do servidor Express que o `@angular/ssr` gera, ou a partir da sua API. **HTML puro**: sirva o HTML a partir de qualquer rota de servidor que consulte o kastor, ou use o build da CDN acima para ferramentas de schema no navegador.

Configurações completas para Next.js, Nuxt, SvelteKit, Express, Fastify, NestJS, Hono, Bun, Deno e Cloudflare Workers estão na [página de guias de frameworks](https://kwy404.github.io/kastor/frameworks.html).

## Referência da API

| Export | O que é |
| --- | --- |
| `kastor({ adapter, schema, relations?, log? })` | Cria o client |
| `table(name, columns, options?)` | Declara uma tabela |
| `t` | Builders de coluna |
| `index(...cols)`, `uniqueIndex(...cols)` | Builders de índice para `table(..., { indexes })` |
| `one(target, config?)`, `many(target, config?)` | Relações |
| `sql` | Tagged template para fragmentos de SQL puro |
| `KastorError`, `isKastorError(e)` | Erros com `code`, `message`, `hint` |
| `toSchemaIR(schema)` | O schema como JSON simples |
| `defineConfig(config)` | `kastor.config.ts` tipado |
| `defineSeed<Db>(fn)`, `factory(db.users, ({ seq }) => data)` | Seeds e factories para testes |
| `InferSelect`, `InferInsert`, `KastorClient` | Tipos |

Client: `db.<model>.<method>(...)`, `db.$transaction`, `db.$sql`, `db.$execute`, `db.$schema`, `db.$dialect`, `db.$disconnect()`. A referência completa com todas as opções está em [kwy404.github.io/kastor/api.html](https://kwy404.github.io/kastor/api.html).

## Perguntas frequentes

### Qual o melhor ORM para TypeScript com PostgreSQL, MySQL e SQLite ao mesmo tempo?
Um que infira os tipos a partir de um schema em TypeScript e mantenha a mesma API em todos os bancos de dados. O kastor compila as mesmas consultas para cada dialeto, então sair do SQLite nos testes para o PostgreSQL em produção é uma troca de adaptador, não de código. Saiba mais no guia [ORM para TypeScript](https://kwy404.github.io/kastor/pt-br/orm-typescript.html).

### Existe ORM para TypeScript sem geração de código?
Sim. O kastor infere todos os tipos a partir do schema com o compilador do TypeScript, então não existe comando `generate` nem client gerado para manter sincronizado. Veja [o guia sobre como sair de um client gerado](https://kwy404.github.io/kastor/prisma-alternative-without-codegen.html).

### Como evitar consultas N+1 no Node.js?
Use `include`. O kastor carrega relações aninhadas em um único comando por chamada: agregação JSON em todos os bancos SQL e estágios `$lookup` em um único pipeline no MongoDB. Leia [como evitar consultas N+1](https://kwy404.github.io/kastor/pt-br/evitar-consultas-n-mais-1.html).

### Qual ORM funciona com SQL Server e Oracle no Node.js?
O kastor suporta os dois com os drivers `mssql` e `oracledb`: OUTPUT e MERGE no SQL Server, FETCH FIRST e MERGE no Oracle. Veja os guias de [SQL Server](https://kwy404.github.io/kastor/sql-server-orm-nodejs.html) e [Oracle](https://kwy404.github.io/kastor/oracle-orm-nodejs.html).

### Dá para usar ORM com Cloudflare D1 e Turso?
Sim: `d1(env.DB)` dentro de um Worker e `libsql(createClient(...))` para o Turso. Veja os guias de [D1](https://kwy404.github.io/kastor/cloudflare-d1-orm.html) e [Turso](https://kwy404.github.io/kastor/turso-libsql-orm.html).

### Existe ORM para MongoDB em TypeScript com a mesma API do SQL?
O adaptador de MongoDB do kastor usa o mesmo schema e a mesma API de consultas, e compila os includes para pipelines com `$lookup`. Veja [ORM para MongoDB em TypeScript](https://kwy404.github.io/kastor/mongodb-orm-typescript.html).

### Funciona com um banco de dados que já existe?
Sim. `npx kastor db pull` gera o schema TypeScript a partir do banco de dados em uso, com as relações incluídas.

## Comparação

Cada ORM faz escolhas diferentes, então esta tabela compara abordagens, não produtos. Consulte a documentação de cada ferramenta para ver os detalhes atuais.

| | kastor | ORMs com client gerado | Query builders SQL first | ORMs com decorators |
| --- | --- | --- | --- | --- |
| Onde fica o schema | TypeScript | Um arquivo de schema em linguagem própria | TypeScript | Classes com decorators |
| Tipos depois de mudar o schema | Inferidos na próxima tecla | Depois de um comando de geração | Inferidos | Declarados à mão |
| Relações aninhadas | Uma consulta por chamada raiz | Depende | Depende da API | Joins ou consultas extras |
| Migrações a partir do schema | Embutidas, a detecção de renomeação pergunta antes | Geralmente embutidas | Geralmente um kit separado | Geralmente embutidas |
| Mesma API em SQL e MongoDB | Sim | Depende | Geralmente só SQL | Depende |
| Dependências em tempo de execução | Zero (traga o seu driver) | Depende | Poucas | Várias |

## Mais projetos de kwy404

- [Monsoon](https://kwy404.github.io/monsoon/): CSS utility-first sem etapa de build
- [Voodoo.js](https://kwy404.github.io/Voodoo.js/): atributos reativos para HTML puro
- [breakhound](https://kwy404.github.io/breakhound/): encontre bugs em qualquer biblioteca JavaScript automaticamente
- [vueleap](https://kwy404.github.io/vueleap/): migração do Vue 2 para o Vue 3
- [graphemely](https://kwy404.github.io/graphemely/): utilitários de string que respeitam grafemas
- [numberparrot](https://kwy404.github.io/numberparrot/): leia números em formatos locais
- [edgegoat](https://kwy404.github.io/edgegoat/): entradas de casos extremos para testes em JavaScript
- [cookieowl](https://kwy404.github.io/cookieowl/): um banner de consentimento de cookies que bloqueia rastreadores antes do consentimento
- [installkite](https://kwy404.github.io/installkite/): transforme qualquer site em um PWA instalável e que funciona offline
- [a11ymedic](https://kwy404.github.io/a11ymedic/): verificações de acessibilidade com a correção exata
- [fontsketch](https://kwy404.github.io/fontsketch/): crie a sua própria fonte no navegador

## Autor

Criado por **Alexandre Kohler** ([GitHub](https://github.com/kwy404) e [LinkedIn](https://www.linkedin.com/in/alexandre-silva-173687256/)).

Contribuições são bem-vindas: leia o [CONTRIBUTING.md](https://github.com/kwy404/kastor/blob/main/CONTRIBUTING.md) e a [política de segurança](https://github.com/kwy404/kastor/blob/main/SECURITY.md). As notas de versão estão no [CHANGELOG.md](https://github.com/kwy404/kastor/blob/main/CHANGELOG.md).

## Licença

[MIT](https://github.com/kwy404/kastor/blob/main/LICENSE) © 2026 Alexandre Kohler
