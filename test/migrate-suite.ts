/**
 * End to end migration suite shared by every `migrate-*.int.test.ts`: migrate
 * dev with a rename, deploy on an empty database, status, db push and a db pull
 * round trip, against a real database.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Adapter, Row, SchemaIR } from '../src/core/ir';
import { index, t, table, type AnyColumn } from '../src/core/schema';
import { toSchemaIR } from '../src/core/schema-ir';
import { generateSchema } from '../src/migrate/codegen';
import { importModule } from '../src/migrate/config';
import { diffSchemas } from '../src/migrate/diff';
import { deploy, dev, drift, dropEverything, introspect, push, status } from '../src/migrate/engine';
import { readMigrations } from '../src/migrate/files';

export interface Connected {
  adapter: Adapter;
  close(): Promise<void>;
}

/** A database of its own, so dropping everything never touches other suites. */
export async function ensurePgDatabase(baseUrl: string, name: string): Promise<string> {
  const client = new pg.Client({ connectionString: baseUrl });
  await client.connect();
  try {
    const found = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (!found.rowCount) await client.query(`CREATE DATABASE ${name}`);
  } finally {
    await client.end();
  }
  const u = new URL(baseUrl);
  u.pathname = `/${name}`;
  return u.toString();
}

export interface SuiteOptions {
  /** Run the suite (the env var is set and the dialect is ready). */
  enabled: boolean;
  /** Why the suite is skipped, shown in the test name. */
  skipReason?: string;
  /** Run the db pull round trip (needs exact introspection). Default true. */
  pull?: boolean;
}

export function v1(): SchemaIR {
  const users = table('mg_users', {
    id: t.id(),
    email: t.string(120).unique(),
    name: t.string(100).nullable(),
    role: t.enum(['user', 'admin']).default('user'),
    active: t.boolean().default(true),
    createdAt: t.datetime().defaultNow(),
  });
  const posts = table(
    'mg_posts',
    {
      id: t.id(),
      title: t.string(200),
      body: t.text().nullable(),
      authorId: t.int().references(() => users.id, { onDelete: 'cascade' }),
    },
    { indexes: (p) => [index(p.authorId)] },
  );
  return toSchemaIR({ users, posts });
}

export function v2(): SchemaIR {
  const users = table('mg_users', {
    id: t.id(),
    email: t.string(120).unique(),
    fullName: t.string(100).nullable(),
    role: t.enum(['user', 'admin', 'owner']).default('user'),
    active: t.boolean().default(true),
    createdAt: t.datetime().defaultNow(),
    bio: t.text().nullable(),
  });
  const posts = table(
    'mg_posts',
    {
      id: t.id(),
      title: t.string(300),
      body: t.text().nullable(),
      authorId: t.int().references(() => users.id, { onDelete: 'cascade' }),
    },
    { indexes: (p) => [index(p.authorId)] },
  );
  const tags = table('mg_tags', { id: t.id(), label: t.string(50).unique() });
  const postTags = table(
    'mg_post_tags',
    {
      postId: t.int().references((): AnyColumn => posts.id, { onDelete: 'cascade' }),
      tagId: t.int().references((): AnyColumn => tags.id, { onDelete: 'cascade' }),
    },
    { primaryKey: (c) => [c.postId, c.tagId] },
  );
  return toSchemaIR({ users, posts, tags, postTags });
}

/** Only the tables of this suite, so other suites' tables in a shared database do not count. */
const own = (s: SchemaIR): SchemaIR => ({ ...s, tables: s.tables.filter((x) => x.name.startsWith('mg_')), enums: (s.enums ?? []).filter((e) => e.name.startsWith('mg_')) });

export function runMigrateSuite(name: string, connect: () => Promise<Connected>, options: SuiteOptions): void {
  const title = options.enabled ? `migrate on ${name}` : `migrate on ${name} (skipped: ${options.skipReason ?? 'no database'})`;
  describe.skipIf(!options.enabled)(title, () => {
    let conn: Connected;
    let dir: string;
    const exec = (query: Record<string, unknown>, schema: SchemaIR): Promise<unknown> => conn.adapter.dialect.execute(query as never, schema, conn.adapter.executor);
    const rows = async (tableName: string, schema: SchemaIR, columns: string[]): Promise<Row[]> =>
      (await exec(
        {
          kind: 'findMany',
          table: tableName,
          read: { table: tableName, select: columns.map((c) => ({ column: c, as: c })), include: [], counts: [], orderBy: [{ kind: 'column', column: columns[0], direction: 'asc' }] },
        },
        schema,
      )) as Row[];

    beforeAll(async () => {
      conn = await connect();
      dir = mkdtempSync(join(tmpdir(), `kastor-mig-${name.replace(/\W+/g, '-')}-`));
      await dropEverything(conn.adapter);
    });

    afterAll(async () => {
      try {
        if (conn) await dropEverything(conn.adapter);
      } finally {
        await conn?.close();
        if (dir) rmSync(dir, { recursive: true, force: true });
      }
    });

    it('migrate dev creates and applies the first migration', async () => {
      const result = await dev(conn.adapter, v1(), dir, { version: '0.1.0', name: 'init' });
      expect(result.kind).toBe('created');
      expect((await drift(conn.adapter, v1())).ops).toEqual([]);
      expect((await dev(conn.adapter, v1(), dir, { version: '0.1.0' })).kind).toBe('in-sync');
      await exec({ kind: 'createMany', table: 'mg_users', data: [{ email: 'ada@example.com', name: 'Ada' }], skipDuplicates: false }, v1());
      const [ada] = await rows('mg_users', v1(), ['id', 'email', 'name', 'role', 'active']);
      expect(ada).toMatchObject({ email: 'ada@example.com', name: 'Ada', role: 'user', active: true });
      await exec({ kind: 'createMany', table: 'mg_posts', data: [{ title: 'Hello', authorId: ada!.id }], skipDuplicates: false }, v1());
    });

    it('migrate dev renames instead of dropping and keeps the rows', async () => {
      const asked: string[] = [];
      const result = await dev(conn.adapter, v2(), dir, {
        version: '0.1.0',
        name: 'rename_and_tags',
        askRename: async (c) => {
          asked.push(`${c.table}.${c.from}`);
          return c.from === 'name' ? 'fullName' : null;
        },
      });
      expect(asked).toEqual(['mg_users.name']);
      expect(result.kind).toBe('created');
      if (result.kind === 'created') expect(result.diff.destructive).toBe(false);
      expect((await drift(conn.adapter, v2())).ops).toEqual([]);
      const [ada] = await rows('mg_users', v2(), ['id', 'fullName', 'bio']);
      expect(ada).toMatchObject({ fullName: 'Ada', bio: null });
      const [post] = await rows('mg_posts', v2(), ['id', 'title']);
      expect(post).toMatchObject({ title: 'Hello' });
    });

    it('migrate deploy replays the files on an empty database', async () => {
      await dropEverything(conn.adapter);
      expect(own(await introspect(conn.adapter)).tables).toEqual([]);
      const applied: string[] = [];
      const result = await deploy(conn.adapter, dir, { onApplied: (m) => applied.push(m.name) });
      expect(applied).toEqual(['init', 'rename_and_tags']);
      expect(result.applied).toHaveLength(2);
      expect((await drift(conn.adapter, v2())).ops).toEqual([]);
      const st = await status(conn.adapter, dir);
      expect(st.pending).toEqual([]);
      expect(st.applied.map((a) => a.id)).toEqual(readMigrations(dir).map((m) => m.id));
      expect((await deploy(conn.adapter, dir)).applied).toEqual([]);
    });

    it('migrate status notices a file changed after it was applied', async () => {
      const [first] = readMigrations(dir);
      writeFileSync(first!.file, `${first!.sql}\n-- changed\n`);
      try {
        expect((await status(conn.adapter, dir)).modified.map((m) => m.local.id)).toEqual([first!.id]);
        await expect(deploy(conn.adapter, dir)).rejects.toThrow(/changed after/);
      } finally {
        writeFileSync(first!.file, first!.sql);
      }
    });

    it('db push adds and drops a column without files', async () => {
      const v3 = v2();
      v3.tables.find((x) => x.name === 'mg_posts')!.columns.push({ name: 'views', type: 'int', nullable: false, default: { kind: 'value', value: 0 } });
      expect((await push(conn.adapter, v2())).kind).toBe('in-sync');
      expect((await push(conn.adapter, v3)).kind).toBe('pushed');
      expect((await drift(conn.adapter, v3)).ops).toEqual([]);
      await expect(push(conn.adapter, v2())).rejects.toThrow(/nobody confirmed|cannot tell/);
      expect((await push(conn.adapter, v2(), { acceptDataLoss: true })).kind).toBe('pushed');
      expect((await drift(conn.adapter, v2())).ops).toEqual([]);
    });

    it.skipIf(options.pull === false)('db pull writes a schema that matches the database', async () => {
      const live = own(await introspect(conn.adapter));
      const { code } = generateSchema(live, { dialect: conn.adapter.dialect, importFrom: resolve('src/core/schema.ts').replace(/\\/g, '/') });
      mkdirSync(resolve('.kastor'), { recursive: true });
      const tmp = mkdtempSync(join(resolve('.kastor'), 'pull-'));
      try {
        const file = join(tmp, 'schema.ts');
        writeFileSync(file, code);
        const mod = await importModule(file);
        const pulled = toSchemaIR(mod.schema as Record<string, unknown>);
        expect(diffSchemas(live, pulled, { dialect: conn.adapter.dialect }).ops).toEqual([]);
        expect(diffSchemas(pulled, v2(), { dialect: conn.adapter.dialect }).ops).toEqual([]);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  });
}
