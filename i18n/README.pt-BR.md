<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/banner-dark.svg">
  <img src="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/banner.svg" alt="Banner do kastor: Kas, o castor engenheiro, ao lado do logotipo, o ORM para TypeScript para quase todos os bancos de dados" width="100%">
</picture>

# kastor: o ORM para TypeScript para quase todos os bancos de dados

**Schema em TypeScript puro. Tipos inferidos enquanto você digita. Sem etapa de geração, sem engine binária.**

[![versão no npm](https://img.shields.io/npm/v/kastor-orm.svg)](https://www.npmjs.com/package/kastor-orm)
[![CI](https://github.com/kwy404/kastor/actions/workflows/ci.yml/badge.svg)](https://github.com/kwy404/kastor/actions/workflows/ci.yml)
[![Licença: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/kwy404/kastor/blob/main/LICENSE)
[![tamanho do core: 22 kB gzip](https://img.shields.io/badge/core-22%20kB%20gzip-e2601e)](https://www.npmjs.com/package/kastor-orm)

[English](https://github.com/kwy404/kastor/blob/main/README.md) | Português (Brasil)

[Site e playground ao vivo](https://kwy404.github.io/kastor/) · [Referência da API](https://kwy404.github.io/kastor/api.html) · [Guias](https://kwy404.github.io/kastor/guides.html) · [Guias em português](https://kwy404.github.io/kastor/pt-br/) · [Migrar para o kastor](https://kwy404.github.io/kastor/migrate-to-kastor.html) · [Frameworks](https://kwy404.github.io/kastor/frameworks.html) · [npm](https://www.npmjs.com/package/kastor-orm)

</div>

kastor é um ORM open source para TypeScript que funciona com PostgreSQL, CockroachDB, MySQL, MariaDB, SQLite (better-sqlite3, node:sqlite, bun:sqlite), libSQL e Turso, Cloudflare D1, SQL Server, Oracle e MongoDB. Você escreve o schema como valores comuns de TypeScript, e o compilador do TypeScript infere o tipo de cada linha enquanto você digita: sem linguagem de schema, sem geração de código, sem engine para baixar. As consultas são objetos conhecidos (`where`, `include`, `select`), os includes aninhados carregam em uma única consulta com agregação JSON, as migrações são calculadas a partir do schema em arquivos SQL legíveis, e `npx kastor studio` abre um navegador de dados local.

O nome vem de *castor*, palavra latina para o animal de mesmo nome. Castores constroem estruturas fortes com troncos; o kastor constrói camadas de dados fortes com linhas. Conheça Kas, o engenheiro da obra:

<div align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/mascot-dark.svg">
  <img src="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/mascot.svg" alt="Kas, o castor engenheiro do kastor, com capacete amarelo, um rolo de planta debaixo do braço e um lápis atrás da orelha" width="200">
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
- [Migre do Prisma e de outros ORMs](#migre-do-prisma-e-de-outros-orms)
- [Use com o seu framework](#use-com-o-seu-framework)
- [Referência da API](#referência-da-api)
- [Perguntas frequentes](#perguntas-frequentes)
- [Comparação](#comparação)
- [Mais projetos de kwy404](#mais-projetos-de-kwy404)
- [Autor](#autor)
- [Licença](#licença)

## Recursos

| | | |
| --- | --- | --- |
| <picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/icons/dark/schema.svg"><img src="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/icons/light/schema.svg" width="40" alt="Ícone de schema"></picture><br>**Schema em TypeScript**<br>Tabelas, colunas, índices e relações são valores comuns. | <picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/icons/dark/no-codegen.svg"><img src="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/icons/light/no-codegen.svg" width="40" alt="Ícone de sem geração de código"></picture><br>**Sem etapa de geração**<br>Os tipos são inferidos na próxima tecla. | <picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/icons/dark/one-query.svg"><img src="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/icons/light/one-query.svg" width="40" alt="Ícone de consulta única"></picture><br>**Includes em uma consulta**<br>Agregação JSON, nunca N+1. |
| <picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/icons/dark/migrations.svg"><img src="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/icons/light/migrations.svg" width="40" alt="Ícone de migrações"></picture><br>**Migrações automáticas**<br>Arquivos SQL legíveis, e a detecção de renomeação pergunta antes. | <picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/icons/dark/studio.svg"><img src="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/icons/light/studio.svg" width="40" alt="Ícone do Studio"></picture><br>**Studio**<br>Navegue e edite dados, veja o diagrama ER. | <picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/icons/dark/errors.svg"><img src="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/icons/light/errors.svg" width="40" alt="Ícone de erros"></picture><br>**Erros com dica**<br>Um código estável, uma mensagem clara e a correção. |
| <picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/icons/dark/raw-sql.svg"><img src="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/icons/light/raw-sql.svg" width="40" alt="Ícone de SQL puro"></picture><br>**SQL puro tipado**<br>Tagged templates, os valores viram parâmetros. | <picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/icons/dark/adapters.svg"><img src="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/icons/light/adapters.svg" width="40" alt="Ícone de adaptadores"></picture><br>**Use o seu próprio driver**<br>Nenhum driver embutido, nenhum peso extra em tempo de execução. | <picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/icons/dark/edge.svg"><img src="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/assets/icons/light/edge.svg" width="40" alt="Ícone de edge"></picture><br>**Serverless e edge**<br>Workers com D1, Turso, Neon, Bun e Deno. |

## Início rápido

```bash
npx kastor-orm init
```

O assistente pergunta qual é o seu banco, cria o `kastor.config.ts`, um schema de exemplo, um seed e o `.env`, instala os pacotes e então cria as tabelas e roda uma primeira consulta. Escolha SQLite para não precisar de servidor nenhum. Sem um terminal interativo, passe as respostas como opções: `npx kastor-orm init --db postgres --yes`.

O pacote no npm é `kastor-orm`; o projeto e a CLI se chamam kastor. Rode `npx kastor-orm init` antes de instalar o pacote; depois de instalado, a mesma CLI também responde pelo nome curto, como em `npx kastor migrate dev`.

Declare o schema em `src/db/schema.ts`:

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

Crie o client em `src/db/index.ts`:

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

Build como módulo ES: `https://cdn.jsdelivr.net/npm/kastor-orm@0.1.0/dist/kastor.browser.js`.

## Bancos de dados suportados

O kastor não vem com nenhum driver. Instale o que você usa e passe a instância dele para o adaptador.

| Banco de dados | Import | O que passar | Includes compilam para |
| --- | --- | --- | --- |
| PostgreSQL (também Neon, Supabase, Vercel Postgres) | `kastor-orm/postgres` | `postgres(new pg.Pool(...))` | `json_agg` + `json_build_object` |
| CockroachDB | `kastor-orm/cockroach` | `cockroach(new pg.Pool(...))` | `json_agg` + `json_build_object` |
| MySQL (também PlanetScale) | `kastor-orm/mysql` | `mysql(mysql2.createPool(...))` | `JSON_ARRAYAGG` + `JSON_OBJECT` |
| MariaDB | `kastor-orm/mariadb` | `mariadb(mariadb.createPool(...))` | `JSON_ARRAYAGG` + `JSON_OBJECT` |
| SQLite (better-sqlite3, node:sqlite, bun:sqlite) | `kastor-orm/sqlite` | `sqlite(new Database('app.db'))` | `json_group_array` + `json_object` |
| libSQL e Turso | `kastor-orm/libsql` | `libsql(createClient({ url, authToken }))` | `json_group_array` + `json_object` |
| Cloudflare D1 | `kastor-orm/d1` | `d1(env.DB)` | `json_group_array` + `json_object` |
| SQL Server e Azure SQL | `kastor-orm/mssql` | `mssql(await new sql.ConnectionPool(...).connect())` | `FOR JSON PATH` |
| Oracle | `kastor-orm/oracle` | `oracle(await oracledb.createPool(...))` | `JSON_ARRAYAGG` + `JSON_OBJECT` |
| MongoDB | `kastor-orm/mongodb` | `mongodb(client.db('app'))` | pipelines com `$lookup` (chaves são strings de ObjectId por padrão, `{ ids: 'int' }` para números) |

Os adaptadores compartilham uma suíte de conformidade, executada contra bancos reais no CI. Veja a [matriz de suporte](https://kwy404.github.io/kastor/#databases) para a sintaxe de returning, upsert e paginação em cada banco de dados, e [Comece em 60 segundos](https://kwy404.github.io/kastor/#start) para cada um deles.

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
import { sql } from 'kastor-orm'

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
import { isKastorError } from 'kastor-orm'

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
import { defineConfig } from 'kastor-orm'
import { postgres } from 'kastor-orm/postgres'

export default defineConfig({
  schema: './src/db/schema.ts',
  adapter: () => postgres(new pg.Pool({ connectionString: process.env.DATABASE_URL })),
  migrations: './kastor/migrations',
  seed: './src/db/seed.ts',
})
```

| Comando | O que faz |
| --- | --- |
| `npx kastor-orm init` | Pergunta qual é o seu banco, cria o `kastor.config.ts`, um schema de exemplo e um seed, instala os pacotes e roda uma primeira consulta (`--db`, `--yes`, `--no-install`, `--no-run`) |
| `npx kastor migrate dev --name <name>` | Compara o schema com o banco de dados, grava `kastor/migrations/<timestamp>_<name>/migration.sql` e aplica a migração. Uma possível renomeação vira uma pergunta, nunca um drop silencioso. `--create-only`, `--rename users.name:fullName`, `--accept-data-loss` |
| `npx kastor migrate baseline` | Adota um banco existente: registra o schema atual como a primeira migração sem executá-la (`--name init`, `--from-prisma prisma/migrations`) |
| `npx kastor migrate deploy` | Aplica as migrações pendentes (CI e produção) |
| `npx kastor migrate status` | Lista as migrações aplicadas e pendentes |
| `npx kastor migrate reset` | Apaga tudo, aplica todas as migrações de novo e roda o seed |
| `npx kastor db push` | Sincroniza o schema sem arquivo de migração, para protótipos |
| `npx kastor db pull` | Gera um schema TypeScript a partir de um banco de dados existente (`--out`, `--print`) |
| `npx kastor db seed` | Executa o arquivo de seed |
| `npx kastor import prisma` | Converte o schema.prisma em um schema do kastor para o mesmo banco e imprime um relatório (`--schema`, `--out`, `--config`) |
| `npx kastor studio` | Abre o studio local |
| `npx kastor doctor` | Verifica a configuração, a conexão, o drift e as migrações pendentes |

Leia [migrações de banco de dados explicadas](https://kwy404.github.io/kastor/pt-br/migracoes-banco-de-dados.html) para ver o fluxo completo.

## Studio

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/docs/assets/studio-data-dark.png">
  <img src="https://raw.githubusercontent.com/kwy404/kastor/1da873e30e031ca462b1f5cb2a41334aa8eceb9e/docs/assets/studio-data-light.png" alt="O studio do kastor navegando pela tabela posts: filtros, linhas, chaves estrangeiras e ações" width="100%">
</picture>

`npx kastor studio` abre uma interface web local: navegue por todas as tabelas, filtre e busque, crie, edite e apague linhas, siga as chaves estrangeiras e veja o diagrama do banco de dados inteiro. A página Queries lista o SQL das consultas recentes, com os parâmetros e o tempo de cada uma. Ele roda em 127.0.0.1 protegido por um token de sessão privado, e `--read-only` protege dados que não podem ser alterados.

## Migre do Prisma e de outros ORMs

O banco e os dados continuam onde estão. O kastor lê o schema que você já tem, registra o banco como a primeira migração sem executar nada e assume dali em diante.

```bash
npm i kastor-orm pg
npx kastor import prisma --config                               # schema.prisma para src/db/schema.ts, com relatório
npx kastor migrate baseline --from-prisma prisma/migrations     # adota o banco e preserva o histórico do Prisma
npx kastor migrate dev                                          # deve responder: Already in sync
```

O import mantém os nomes dos models, então a maioria das chamadas do Prisma Client só troca a primeira palavra:

```ts
// Antes: prisma.post.findMany({ where: { published: true }, include: { author: true }, take: 20 })
const posts = await db.post.findMany({ where: { published: true }, include: { author: true }, take: 20 })
```

Vindo de outro ORM ou de outra linguagem, `npx kastor db pull` gera o schema TypeScript a partir do banco e `npx kastor migrate baseline --name init` adota o banco. Guias passo a passo com tabelas de equivalência e cuidados:

| Vindo de | Guia | Como começa |
| --- | --- | --- |
| Prisma | [Guia em português](https://kwy404.github.io/kastor/pt-br/migrar-do-prisma.html) · [English](https://kwy404.github.io/kastor/migrate-from-prisma.html) | `npx kastor import prisma` e depois `migrate baseline --from-prisma`, que preserva o histórico |
| Drizzle ORM | [Guia em inglês](https://kwy404.github.io/kastor/migrate-from-drizzle.html) | `db pull` e depois `migrate baseline` |
| TypeORM | [Guia em inglês](https://kwy404.github.io/kastor/migrate-from-typeorm.html) | entities e repositories viram `table()` e o client |
| Sequelize | [Guia em inglês](https://kwy404.github.io/kastor/migrate-from-sequelize.html) | models e `Op` viram tipos inferidos e objetos `where` |
| Knex | [Guia em inglês](https://kwy404.github.io/kastor/migrate-from-knex.html) | query builder vira consultas tipadas, SQL puro com `$sql` |
| Mongoose | [Guia em inglês](https://kwy404.github.io/kastor/migrate-from-mongoose.html) | schemas e `populate` viram `table()` e `include` no MongoDB |
| Laravel Eloquent (PHP) | [Guia em português](https://kwy404.github.io/kastor/pt-br/migrar-do-laravel-eloquent.html) · [English](https://kwy404.github.io/kastor/migrate-from-laravel-eloquent.html) | leve um serviço para TypeScript ou divida o banco com o Laravel |
| Django ORM (Python) | [Guia em inglês](https://kwy404.github.io/kastor/migrate-from-django-orm.html) | leve um serviço para TypeScript ou divida o banco com o Django |
| Rails Active Record (Ruby) | [Guia em inglês](https://kwy404.github.io/kastor/migrate-from-rails-active-record.html) | leve um serviço para TypeScript ou divida o banco com o Rails |

Todos os caminhos e comandos em um só lugar: [Migrate to kastor](https://kwy404.github.io/kastor/migrate-to-kastor.html).

## Use com o seu framework

O kastor roda no servidor. Crie um client por processo (ou por requisição no Workers), importe ele apenas em código de servidor e reaproveite entre os hot reloads.

**Next.js (App Router)**: reaproveite o client entre os hot reloads e faça consultas em server components e server actions. Um projeto inicial completo com SQLite está em [examples/nextjs](https://github.com/kwy404/kastor/tree/main/examples/nextjs).

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

**Cloudflare Workers e Hono**: os bindings chegam em cada requisição, então crie o client ali. Envolver um binding não abre conexão nenhuma.

```ts
app.get('/posts', async (c) => {
  const db = kastor({ adapter: d1(c.env.DB), schema, relations })
  return c.json(await db.posts.findMany({ where: { published: true }, take: 20 }))
})
```

Cada guia (em inglês) cobre a estrutura do projeto, o reaproveitamento de conexões em hot reload e serverless, as variáveis de ambiente e as migrações no CI e no deploy:

| Framework | Guia | Destaques |
| --- | --- | --- |
| Next.js App Router | [kastor com Next.js App Router](https://kwy404.github.io/kastor/nextjs-app-router-orm.html) | server components, server actions, route handlers, edge com Neon, Turso ou D1 |
| Nuxt | [kastor com Nuxt](https://kwy404.github.io/kastor/nuxt-orm.html) | rotas do Nitro, runtimeConfig |
| SvelteKit | [kastor com SvelteKit](https://kwy404.github.io/kastor/sveltekit-orm.html) | load functions, form actions, $lib/server |
| Remix e React Router | [kastor com Remix e React Router](https://kwy404.github.io/kastor/remix-react-router-orm.html) | loaders e actions em um módulo .server |
| Astro | [kastor com Astro](https://kwy404.github.io/kastor/astro-orm.html) | páginas sob demanda, endpoints, actions |
| NestJS | [kastor com NestJS](https://kwy404.github.io/kastor/nestjs-orm.html) | um módulo global e um provider |
| Express | [kastor com Express](https://kwy404.github.io/kastor/express-orm.html) | middleware de erros, desligamento gracioso |
| Fastify | [kastor com Fastify](https://kwy404.github.io/kastor/fastify-orm.html) | um plugin com decorator tipado |
| Hono | [kastor com Hono](https://kwy404.github.io/kastor/hono-orm.html) | Node, Bun, Deno e Workers |
| AdonisJS | [kastor com AdonisJS](https://kwy404.github.io/kastor/adonisjs-orm.html) | um service ao lado ou no lugar do Lucid |
| Bun | [kastor com Bun](https://kwy404.github.io/kastor/bun-orm.html) | bun:sqlite, Bun.serve |
| Deno | [kastor com Deno](https://kwy404.github.io/kastor/deno-orm.html) | npm specifiers, Deno.serve |
| Cloudflare Workers | [kastor com Cloudflare Workers](https://kwy404.github.io/kastor/cloudflare-workers-orm.html) | D1, Hyperdrive, Turso |
| Electron | [kastor com Electron](https://kwy404.github.io/kastor/electron-sqlite-orm.html) | SQLite no processo principal, IPC tipado |
| AWS Lambda | [kastor com AWS Lambda](https://kwy404.github.io/kastor/aws-lambda-orm.html) | reaproveitamento de conexão, RDS Proxy |

**React** com Vite SSR, **Vue** e **Angular** com SSR seguem a mesma regra: consulte em código de servidor (loaders, rotas de servidor, o servidor Express que o `@angular/ssr` gera) e envie dados simples para os componentes. Configurações curtas de cada framework estão na [página de frameworks](https://kwy404.github.io/kastor/frameworks.html).

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

### Um projeto pode usar PostgreSQL, MySQL e SQLite?
Sim. O schema e a API de consultas são os mesmos em todos os bancos de dados. O kastor compila as mesmas consultas para cada dialeto, então sair do SQLite nos testes para o PostgreSQL em produção é uma troca de adaptador, não de código. Experimente no [playground](https://kwy404.github.io/kastor/#playground).

### Existe uma etapa de geração de código?
Não. O kastor infere todos os tipos a partir do schema com o compilador do TypeScript, então não existe comando `generate` nem client gerado para manter sincronizado. Experimente no [playground](https://kwy404.github.io/kastor/#playground).

### Como as relações são carregadas?
Use `include`. O kastor carrega relações aninhadas em um único comando por chamada: agregação JSON em todos os bancos SQL e estágios `$lookup` em um único pipeline no MongoDB. Leia [como evitar consultas N+1](https://kwy404.github.io/kastor/pt-br/evitar-consultas-n-mais-1.html).

### Funciona com SQL Server e Oracle?
O kastor suporta os dois com os drivers `mssql` e `oracledb`: OUTPUT e MERGE no SQL Server, FETCH FIRST e MERGE no Oracle. Veja a [tabela de suporte por banco](https://kwy404.github.io/kastor/#databases).

### Funciona no Cloudflare D1 e no Turso?
Sim: `d1(env.DB)` dentro de um Worker e `libsql(createClient(...))` para o Turso. Veja [kastor com Cloudflare Workers](https://kwy404.github.io/kastor/cloudflare-workers-orm.html).

### O MongoDB usa a mesma API?
Sim. O adaptador de MongoDB do kastor usa o mesmo schema e a mesma API de consultas, e compila os includes para pipelines com `$lookup`. Veja a [tabela de suporte por banco](https://kwy404.github.io/kastor/#databases).

### Funciona com um banco de dados que já existe?
Sim. `npx kastor db pull` gera o schema TypeScript a partir do banco de dados em uso, com as relações incluídas. O `npx kastor migrate baseline` registra o banco como a primeira migração sem alterá-lo, e quem vem do Prisma pode converter o schema.prisma direto com `npx kastor import prisma`. Veja o [guia de migração do Prisma](https://kwy404.github.io/kastor/pt-br/migrar-do-prisma.html).

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
