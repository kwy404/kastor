/**
 * Moving a Prisma project to kastor, end to end, on PostgreSQL, MySQL,
 * MariaDB and SQLite:
 *
 * 1. create the database from the SQL Prisma Migrate writes for the fixture
 *    schema (test/migrate-prisma/*.sql), with a filled `_prisma_migrations`;
 * 2. `kastor import prisma` writes the TypeScript schema;
 * 3. `kastor migrate baseline --from-prisma prisma/migrations` records the
 *    database as it is, plus the Prisma history;
 * 4. `kastor migrate dev` finds nothing to do;
 * 5. the client runs conformance style queries on the imported schema,
 *    including rows written the way Prisma writes them;
 * 6. `kastor migrate deploy` on an empty database recreates the same schema
 *    from the baseline file.
 */
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { main } from '../src/cli/index';
import { MemoryStream } from '../src/cli/ui';
import type { Adapter } from '../src/core/ir';
import { kastor } from '../src/index';
import { importModule } from '../src/migrate/config';
import { diffSchemas } from '../src/migrate/diff';
import { deploy, introspect, status } from '../src/migrate/engine';
import { splitStatements } from '../src/migrate/sql-split';
import { postgres } from '../src/postgres';
import { sqlite } from '../src/sqlite';
import { connectMariadb, connectMysql } from './mysql-connect';

const root = resolve('.');
const posix = (p: string): string => p.replace(/\\/g, '/');
const fixtureDir = join(root, 'test', 'migrate-prisma');
const PRISMA_FOLDER = '20240101000000_init';

interface Target {
  name: string;
  provider: 'postgresql' | 'mysql' | 'sqlite';
  sqlFile: string;
  enabled: boolean;
  /** An empty database: url (or file) plus the adapter on it. */
  fresh(label: string, dir: string): Promise<{ adapter: Adapter; close(): Promise<void>; configAdapter: string; configImports: string }>;
  /** DDL of `_prisma_migrations` as Prisma creates it. */
  prismaTable: string;
}

async function freshPg(url: string, name: string): Promise<string> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${name}`);
  } finally {
    await client.end();
  }
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

async function freshMysql(url: string, name: string, connect: typeof connectMysql): Promise<string> {
  const base = await connect(url);
  try {
    await base.adapter.executor.query(`DROP DATABASE IF EXISTS ${name}`, []);
    await base.adapter.executor.query(`CREATE DATABASE ${name}`, []);
  } finally {
    await base.close();
  }
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

const pgUrl = process.env.KASTOR_PG_URL;
const mysqlUrl = process.env.KASTOR_MYSQL_URL;
const mariadbUrl = process.env.KASTOR_MARIADB_URL;

const mysqlPrismaTable = `CREATE TABLE _prisma_migrations (
  id VARCHAR(36) PRIMARY KEY NOT NULL,
  checksum VARCHAR(64) NOT NULL,
  finished_at DATETIME(3),
  migration_name VARCHAR(255) NOT NULL,
  logs TEXT,
  rolled_back_at DATETIME(3),
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  applied_steps_count INTEGER UNSIGNED NOT NULL DEFAULT 0
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`;

const targets: Target[] = [
  {
    name: 'postgres',
    provider: 'postgresql',
    sqlFile: 'postgres.sql',
    enabled: !!pgUrl,
    prismaTable: `CREATE TABLE "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY NOT NULL,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )`,
    async fresh(label) {
      const url = await freshPg(pgUrl!, `kastor_prisma_${label}`);
      const pool = new pg.Pool({ connectionString: url, max: 4 });
      return {
        adapter: postgres(pool),
        close: () => pool.end(),
        configImports: `import pg from 'pg';\nimport { postgres } from '${posix(join(root, 'src/postgres'))}';`,
        configAdapter: `adapter: () => postgres(new pg.Pool({ connectionString: ${JSON.stringify(url)}, max: 2 })),`,
      };
    },
  },
  {
    name: 'mysql',
    provider: 'mysql',
    sqlFile: 'mysql.sql',
    enabled: !!mysqlUrl,
    prismaTable: mysqlPrismaTable,
    async fresh(label) {
      const url = await freshMysql(mysqlUrl!, `kastor_prisma_${label}`, connectMysql);
      const conn = await connectMysql(url);
      return {
        ...conn,
        configImports: `import { createPool } from 'mysql2/promise';\nimport { mysql } from '${posix(join(root, 'src/mysql'))}';`,
        configAdapter: `adapter: () => mysql(createPool({ uri: ${JSON.stringify(url)}, connectionLimit: 2 })),`,
      };
    },
  },
  {
    name: 'mariadb',
    provider: 'mysql',
    sqlFile: 'mysql.sql',
    enabled: !!mariadbUrl,
    prismaTable: mysqlPrismaTable,
    async fresh(label) {
      const url = await freshMysql(mariadbUrl!, `kastor_prisma_${label}`, (u) => connectMariadb(u));
      const conn = await connectMariadb(url);
      const u = new URL(url);
      const opts = { host: u.hostname, port: Number(u.port), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1), connectionLimit: 2 };
      return {
        ...conn,
        configImports: `import { createPool } from 'mariadb';\nimport { mariadb } from '${posix(join(root, 'src/mariadb'))}';`,
        configAdapter: `adapter: () => mariadb(createPool(${JSON.stringify(opts)})),`,
      };
    },
  },
  {
    name: 'sqlite',
    provider: 'sqlite',
    sqlFile: 'sqlite.sql',
    enabled: true,
    prismaTable: `CREATE TABLE "_prisma_migrations" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "checksum" TEXT NOT NULL,
      "finished_at" DATETIME,
      "migration_name" TEXT NOT NULL,
      "logs" TEXT,
      "rolled_back_at" DATETIME,
      "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
      "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0
    )`,
    async fresh(label, dir) {
      const file = join(dir, `${label}.db`);
      rmSync(file, { force: true });
      const db = new Database(file);
      db.pragma('foreign_keys = ON');
      return {
        adapter: sqlite(db),
        close: async () => {
          db.close();
        },
        configImports: `import Database from 'better-sqlite3';\nimport { sqlite } from '${posix(join(root, 'src/sqlite'))}';`,
        configAdapter: `adapter: () => sqlite(new Database(${JSON.stringify(posix(file))})),`,
      };
    },
  },
];

async function run(dir: string, argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const stdout = new MemoryStream();
  const stderr = new MemoryStream();
  const code = await main(argv, { cwd: dir, stdout, stderr, env: { NO_COLOR: '1' }, prompt: null });
  return { code, out: stdout.text, err: stderr.text };
}

for (const target of targets) {
  describe.skipIf(!target.enabled)(`Prisma project moved to kastor on ${target.name}${target.enabled ? '' : ' (skipped: no database URL)'}`, () => {
    let dir: string;
    let conn: Awaited<ReturnType<Target['fresh']>>;
    let db: any;
    let schemaModule: Record<string, unknown>;

    beforeAll(async () => {
      mkdirSync(join(root, '.kastor'), { recursive: true });
      dir = mkdtempSync(join(root, '.kastor', `prisma-${target.name}-`));
      conn = await target.fresh('live', dir);
      // 1. The database exactly as Prisma Migrate leaves it.
      const sql = readFileSync(join(fixtureDir, target.sqlFile), 'utf8');
      for (const statement of splitStatements(sql)) await conn.adapter.executor.query(statement, []);
      await conn.adapter.executor.query(target.prismaTable, []);
      await conn.adapter.executor.query(
        `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, applied_steps_count) VALUES ('0b9a6f8e-2f5e-4b7c-9d43-6c1f0e2a7d11', 'abc', ${target.provider === 'sqlite' ? "'2024-01-01 00:00:00'" : "'2024-01-01 00:00:00'"}, '${PRISMA_FOLDER}', 1)`,
        [],
      );
      mkdirSync(join(dir, 'prisma', 'migrations', PRISMA_FOLDER), { recursive: true });
      writeFileSync(join(dir, 'prisma', 'migrations', PRISMA_FOLDER, 'migration.sql'), sql);
      mkdirSync(join(dir, 'prisma', 'migrations', '20240301000000_never_applied'), { recursive: true });
      writeFileSync(join(dir, 'prisma', 'migrations', '20240301000000_never_applied', 'migration.sql'), '-- not applied\n');
      writeFileSync(join(dir, 'prisma', 'migrations', 'migration_lock.toml'), `provider = "${target.provider}"\n`);
      const schema = readFileSync(join(fixtureDir, 'schema.prisma'), 'utf8').replace('provider = "postgresql"', `provider = "${target.provider}"`);
      writeFileSync(join(dir, 'prisma', 'schema.prisma'), schema);
      writeFileSync(
        join(dir, 'kastor.config.ts'),
        `${conn.configImports}\nexport default {\n  schema: './src/db/schema.ts',\n  ${conn.configAdapter}\n  migrations: './kastor/migrations',\n};\n`,
      );
    });

    afterAll(async () => {
      await conn?.close();
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows may still hold the SQLite file for a moment.
      }
    });

    it('import prisma writes the schema and reports what it could not map exactly', async () => {
      const r = await run(dir, ['import', 'prisma', '--schema', 'prisma/schema.prisma', '--out', 'src/db/schema.ts']);
      expect(r.err).toBe('');
      expect(r.code).toBe(0);
      expect(r.out).toContain('Wrote src/db/schema.ts: 8 models, 3 join tables, 2 enums');
      expect(r.out).toContain('kastor migrate baseline --from-prisma prisma/migrations');
      expect(r.out).toContain('@updatedAt');
      const file = join(dir, 'src', 'db', 'schema.ts');
      // The test project has no node_modules/kastor: point the import at the sources.
      writeFileSync(file, readFileSync(file, 'utf8').replace(/from 'kastor'/g, `from '${posix(join(root, 'src/index'))}'`));
      schemaModule = await importModule(file);
      expect(Object.keys(schemaModule.schema as object)).toEqual(expect.arrayContaining(['user', 'post', 'orderItem', 'postToTag', 'categoryToPost', 'follows']));
    });

    it('migrate baseline records the database and the Prisma history without changing anything', async () => {
      const before = await introspect(conn.adapter);
      const r = await run(dir, ['migrate', 'baseline', '--name', 'init', '--from-prisma', 'prisma/migrations']);
      expect(r.err).toBe('');
      expect(r.code).toBe(0);
      expect(r.out).toContain('Recorded 1 Prisma migration as history');
      expect(r.out).toContain('20240301000000_never_applied');
      expect(r.out).toContain('The schema file matches the database');
      const folders = readdirSync(join(dir, 'kastor', 'migrations')).filter((f) => /^\d{14}_init$/.test(f));
      expect(folders).toHaveLength(1);
      const file = readFileSync(join(dir, 'kastor', 'migrations', folders[0]!, 'migration.sql'), 'utf8');
      expect(file).toContain('Baseline');
      expect(file).not.toContain('_prisma_migrations');
      expect(existsSync(join(dir, 'prisma', 'migrations', PRISMA_FOLDER, 'migration.sql'))).toBe(true);
      const st = await status(conn.adapter, join(dir, 'kastor', 'migrations'));
      expect(st.applied.map((a) => a.id)).toEqual([folders[0]]);
      expect(st.history.map((a) => a.id)).toEqual([`prisma/${PRISMA_FOLDER}`]);
      expect(st.pending).toEqual([]);
      expect(st.missing).toEqual([]);
      // Nothing in the database changed, and Prisma's own table is still there.
      expect(diffSchemas(before, await introspect(conn.adapter), { dialect: conn.adapter.dialect }).ops).toEqual([]);
      const prismaRows = await conn.adapter.executor.query('SELECT migration_name FROM _prisma_migrations', []);
      expect(prismaRows.rows).toHaveLength(1);
    });

    it('migrate dev then finds no difference, and status is clean', async () => {
      const r = await run(dir, ['migrate', 'dev']);
      expect(r.err).toBe('');
      expect(r.out).toContain('Already in sync');
      expect(r.code).toBe(0);
      expect(readdirSync(join(dir, 'kastor', 'migrations')).filter((f) => /^\d{14}_/.test(f))).toHaveLength(1);
      const st = await run(dir, ['migrate', 'status']);
      expect(st.code).toBe(0);
      expect(st.out).toContain('1 Prisma migration');
      expect(st.out).toContain('Database is up to date');
      const again = await run(dir, ['migrate', 'baseline']);
      expect(again.code).not.toBe(0);
      expect(again.err).toContain('needs no baseline');
    });

    it('runs conformance style queries on the imported schema', async () => {
      db = kastor({ adapter: conn.adapter, schema: schemaModule.schema as never, relations: schemaModule.relations as never });

      // Rows written the way Prisma Client writes them, read back by kastor.
      const prismaDate = target.provider === 'sqlite' ? String(Date.UTC(2024, 0, 2)) : "'2024-01-02 00:00:00'";
      const q = (s: string): string => (target.provider === 'mysql' ? s.replace(/"/g, '`') : s);
      await conn.adapter.executor.query(q(`INSERT INTO "User" ("email", "name", "role", "updated_at") VALUES ('legacy@acme.com', 'Legacy', 'EDITOR', ${prismaDate})`), []);
      const legacy = await db.user.findUniqueOrThrow({ where: { email: 'legacy@acme.com' } });
      expect(legacy.role).toBe('EDITOR');
      expect(legacy.updatedAt).toBeInstanceOf(Date);
      expect(legacy.updatedAt.toISOString().slice(0, 10)).toBe('2024-01-02');
      expect(legacy.createdAt).toBeInstanceOf(Date);

      // Nested create through the side of a one-to-one without the foreign key.
      const ada = await db.user.create({
        data: { email: 'ada@acme.com', name: 'Ada', role: 'ADMIN', profile: { create: { bio: 'Math', settings: { theme: 'dark' }, avatar: new Uint8Array([1, 2, 3]) } } },
        include: { profile: true },
      });
      expect(ada.updatedAt).toBeInstanceOf(Date);
      expect(ada.profile.bio).toBe('Math');
      expect(ada.profile.settings).toEqual({ theme: 'dark' });
      expect(Array.from(ada.profile.avatar)).toEqual([1, 2, 3]);
      const bob = await db.user.create({ data: { email: 'bob@acme.com', name: 'Bob' } });
      expect(bob.role).toBe('USER');

      // Self relation many-to-many (_Follows).
      await db.user.update({ where: { id: bob.id }, data: { following: { connect: [{ id: ada.id }, { id: legacy.id }] } } });
      const adaFollowers = await db.user.findUnique({ where: { id: ada.id }, include: { followers: true, following: true } });
      expect(adaFollowers.followers.map((u: { email: string }) => u.email)).toEqual(['bob@acme.com']);
      expect(adaFollowers.following).toEqual([]);
      const bobFollows = await db.user.findUnique({ where: { id: bob.id }, include: { following: { orderBy: { email: 'asc' } } } });
      expect(bobFollows.following.map((u: { email: string }) => u.email)).toEqual(['ada@acme.com', 'legacy@acme.com']);

      // Self relation tree with a cuid key made in JS.
      const root = await db.category.create({ data: { name: 'Root' } });
      expect(root.id).toMatch(/^c[0-9a-z]{24}$/);
      const child = await db.category.create({ data: { name: 'Books', parentId: root.id } });
      const tree = await db.category.findUnique({ where: { id: root.id }, include: { children: true } });
      expect(tree.children.map((c: { name: string }) => c.name)).toEqual(['Books']);
      const withParent = await db.category.findFirst({ where: { parent: { is: { name: 'Root' } } }, include: { parent: true } });
      expect(withParent.parent.id).toBe(root.id);

      // Posts with implicit many-to-many tags and categories.
      const post = await db.post.create({
        data: {
          title: 'Hello',
          slug: 'hello',
          authorId: ada.id,
          published: true,
          views: 12345678901234n,
          tags: { create: [{ name: 'intro' }, { name: 'news' }] },
          categories: { connect: [{ id: child.id }] },
        },
        include: { tags: { orderBy: { name: 'asc' } }, categories: true, author: true },
      });
      expect(post.views).toBe(12345678901234n);
      expect(post.tags.map((t: { name: string }) => t.name)).toEqual(['intro', 'news']);
      expect(post.categories.map((c: { name: string }) => c.name)).toEqual(['Books']);
      expect(post.author.email).toBe('ada@acme.com');
      await db.post.create({ data: { title: 'Draft', slug: 'draft', authorId: ada.id } });

      // A join row written by Prisma: A is the Post, B is the Tag in _PostToTag.
      const tag = await db.tag.create({ data: { name: 'legacy' } });
      await conn.adapter.executor.query(q(`INSERT INTO "_PostToTag" ("A", "B") VALUES (${post.id}, ${tag.id})`), []);
      const tagged = await db.tag.findUnique({ where: { name: 'legacy' }, include: { posts: true } });
      expect(tagged.posts.map((p: { slug: string }) => p.slug)).toEqual(['hello']);

      const authors = await db.user.findMany({
        where: { posts: { some: { published: true } } },
        include: { posts: { where: { published: true }, include: { tags: true } }, _count: { select: { posts: true } } },
      });
      expect(authors.map((u: { email: string }) => u.email)).toEqual(['ada@acme.com']);
      expect(authors[0]._count.posts).toBe(2);
      expect(await db.user.count({ where: { posts: { none: {} } } })).toBe(2);
      expect(await db.post.count({ where: { tags: { some: { name: 'news' } } } })).toBe(1);

      // Shop: Decimal, Json, uuid keys made in JS, composite primary key, enums with @map.
      const book = await db.product.create({ data: { sku: 'B-1', name: 'Book', price: '19.90', categoryId: child.id, attributes: { pages: 320 } } });
      expect(book.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(Number(book.price)).toBe(19.9);
      expect(book.active).toBe(true);
      const pen = await db.product.create({ data: { sku: 'P-1', name: 'Pen', price: '2.50', stock: 100 } });
      const order = await db.order.create({
        data: {
          number: 9007199254740993n,
          userId: ada.id,
          total: '24.90',
          items: { create: [{ productId: book.id, quantity: 1, unitPrice: '19.90' }, { productId: pen.id, quantity: 2, unitPrice: '2.50' }] },
        },
        include: { items: { include: { product: true }, orderBy: { quantity: 'asc' } } },
      });
      expect(order.status).toBe('PENDING');
      expect(order.number).toBe(9007199254740993n);
      expect(order.items.map((i: { product: { sku: string } }) => i.product.sku)).toEqual(['B-1', 'P-1']);
      await db.order.update({ where: { id: order.id }, data: { status: 'canceled' } });
      expect((await db.order.findUnique({ where: { id: order.id } })).status).toBe('canceled');
      const item = await db.orderItem.findUnique({ where: { orderId: order.id, productId: pen.id } });
      expect(item.quantity).toBe(2);
      const sum = await db.orderItem.aggregate({ _sum: { quantity: true }, where: { orderId: order.id } });
      expect(Number(sum._sum.quantity)).toBe(3);
      const byStatus = await db.order.groupBy({ by: ['status'], _count: { _all: true } });
      expect(byStatus).toEqual([{ status: 'canceled', _count: { _all: 1 } }]);
      const upserted = await db.tag.upsert({ where: { name: 'intro' }, create: { name: 'intro' }, update: { name: 'introduction' } });
      expect(upserted.name).toBe('introduction');

      // Referential actions from the Prisma schema: cascade, set null, restrict.
      await expect(db.user.delete({ where: { id: ada.id } })).rejects.toMatchObject({ code: 'FOREIGN_KEY_VIOLATION' });
      await db.order.delete({ where: { id: order.id } });
      expect(await db.orderItem.count({ where: { orderId: order.id } })).toBe(0);
      await db.category.delete({ where: { id: root.id } });
      expect((await db.category.findUnique({ where: { id: child.id } })).parentId).toBeNull();

      // Transactions roll back on errors.
      await expect(
        db.$transaction(async (tx: any) => {
          await tx.tag.create({ data: { name: 'temp' } });
          throw new Error('stop');
        }),
      ).rejects.toThrow('stop');
      expect(await db.tag.count({ where: { name: 'temp' } })).toBe(0);
    });

    it('migrate deploy rebuilds the same schema on an empty database from the baseline', async () => {
      const empty = await target.fresh('empty', dir);
      try {
        const { applied } = await deploy(empty.adapter, join(dir, 'kastor', 'migrations'));
        expect(applied).toHaveLength(1);
        const live = await introspect(empty.adapter);
        const { toSchemaIR } = await import('../src/core/schema-ir');
        const target2 = toSchemaIR(schemaModule.schema as Record<string, unknown>);
        expect(diffSchemas(live, target2, { dialect: empty.adapter.dialect }).ops).toEqual([]);
      } finally {
        await empty.close();
      }
    });
  });
}
