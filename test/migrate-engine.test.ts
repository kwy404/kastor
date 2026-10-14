import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isKastorError } from '../src/core/errors';
import type { Adapter, SchemaIR } from '../src/core/ir';
import { index, t, table, uniqueIndex } from '../src/core/schema';
import { toSchemaIR } from '../src/core/schema-ir';
import { generateSchema, camelCase, plural, singular } from '../src/migrate/codegen';
import { importModule } from '../src/migrate/config';
import { diffSchemas } from '../src/migrate/diff';
import { deploy, dev, drift, introspect, planStatements, push, reset, resolveRenames, status } from '../src/migrate/engine';
import { readMigrations, writeLock } from '../src/migrate/files';
import { sqlite } from '../src/sqlite';

const v1 = () => {
  const users = table('users', {
    id: t.id(),
    email: t.string(255).unique(),
    name: t.string().nullable(),
    role: t.enum(['user', 'admin']).default('user'),
  });
  const posts = table(
    'posts',
    { id: t.id(), title: t.string(200), authorId: t.int().references(() => users.id, { onDelete: 'cascade' }) },
    { indexes: (p) => [index(p.authorId)] },
  );
  return toSchemaIR({ users, posts });
};

const v2 = () => {
  const users = table('users', {
    id: t.id(),
    email: t.string(255).unique(),
    fullName: t.string().nullable(),
    role: t.enum(['user', 'admin', 'owner']).default('user'),
    createdAt: t.datetime().defaultNow(),
  });
  const posts = table(
    'posts',
    { id: t.id(), title: t.string(300), published: t.boolean().default(false), authorId: t.int().references(() => users.id, { onDelete: 'cascade' }) },
    { indexes: (p) => [index(p.authorId), uniqueIndex(p.title)] },
  );
  return toSchemaIR({ users, posts });
};

describe('migration engine on SQLite', () => {
  let dir: string;
  let adapter: Adapter;
  let db: Database.Database;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kastor-engine-'));
    db = new Database(':memory:');
    adapter = sqlite(db);
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates, applies and records the first migration', async () => {
    const written: string[] = [];
    const result = await dev(adapter, v1(), dir, { version: '0.1.0', name: 'init', onWritten: (m) => written.push(m.id) });
    expect(result.kind).toBe('created');
    if (result.kind !== 'created') return;
    expect(result.applied).toBe(true);
    expect(written).toEqual([result.migration.id]);
    expect(result.migration.id).toMatch(/^\d{14}_init$/);
    expect(readFileSync(result.migration.file, 'utf8')).toContain('CREATE TABLE "users"');
    expect(readFileSync(join(dir, 'migration_lock.toml'), 'utf8')).toContain('dialect = "sqlite"');
    const st = await status(adapter, dir);
    expect(st.applied.map((a) => a.id)).toEqual([result.migration.id]);
    expect(st.pending).toEqual([]);
    expect((await drift(adapter, v1())).ops).toEqual([]);
    expect((await dev(adapter, v1(), dir, { version: '0.1.0' })).kind).toBe('in-sync');
  });

  it('asks about renames, then alters with table rebuilds and keeps the data', async () => {
    await dev(adapter, v1(), dir, { version: '0.1.0', name: 'init' });
    db.prepare("INSERT INTO users (email, name) VALUES ('a@x.io', 'Ada')").run();
    db.prepare("INSERT INTO posts (title, authorId) VALUES ('Hi', 1)").run();
    const asked: string[] = [];
    const result = await dev(adapter, v2(), dir, {
      version: '0.1.0',
      askRename: async (c) => {
        asked.push(`${c.table}.${c.from} -> ${c.to.join('|')}`);
        return 'fullName';
      },
      confirmDataLoss: async () => true,
    });
    expect(asked).toEqual(['users.name -> fullName']);
    expect(result.kind).toBe('created');
    if (result.kind !== 'created') return;
    expect(result.migration.name).toBe('rename_users_name_and_more');
    expect(db.prepare('SELECT fullName, role FROM users').get()).toEqual({ fullName: 'Ada', role: 'user' });
    expect(db.prepare('SELECT title, published FROM posts').get()).toEqual({ title: 'Hi', published: 0 });
    expect((await drift(adapter, v2())).ops).toEqual([]);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('refuses unresolved renames without --accept-data-loss and drops with it', async () => {
    await dev(adapter, v1(), dir, { version: '0.1.0', name: 'init' });
    const err = await dev(adapter, v2(), dir, { version: '0.1.0' }).catch((e: unknown) => e);
    expect(isKastorError(err, 'MIGRATION_FAILED')).toBe(true);
    expect((err as { hint: string }).hint).toContain('--rename users.name:fullName');
    const cancelled = await dev(adapter, v2(), dir, { version: '0.1.0', renames: [], acceptDataLoss: false, askRename: async () => null, confirmDataLoss: async () => false });
    expect(cancelled.kind).toBe('cancelled');
    expect(readMigrations(dir)).toHaveLength(1);
    const dropped = await dev(adapter, v2(), dir, { version: '0.1.0', acceptDataLoss: true });
    expect(dropped.kind === 'created' && dropped.diff.destructive).toBe(true);
  });

  it('goes through without a confirmation when nothing is destructive', async () => {
    await dev(adapter, v1(), dir, { version: '0.1.0', name: 'init' });
    const r = await dev(adapter, v2(), dir, { version: '0.1.0', renames: [{ kind: 'column', table: 'users', from: 'name', to: 'fullName' }] });
    expect(r.kind === 'created' && r.diff.destructive).toBe(false);
  });

  it('needs a confirmation for destructive changes', async () => {
    await dev(adapter, v1(), dir, { version: '0.1.0', name: 'init' });
    const users = table('users', { id: t.id(), email: t.string(255).unique(), role: t.enum(['user', 'admin']).default('user') });
    const posts = table('posts', { id: t.id(), title: t.string(200), authorId: t.int().references(() => users.id, { onDelete: 'cascade' }) }, { indexes: (p) => [index(p.authorId)] });
    const smaller = toSchemaIR({ users, posts });
    await expect(dev(adapter, smaller, dir, { version: '0.1.0' })).rejects.toThrow(/nobody confirmed/);
    const seen: string[] = [];
    const r = await dev(adapter, smaller, dir, { version: '0.1.0', confirmDataLoss: async (d) => (seen.push(d.warnings[0]!.message), true) });
    expect(seen[0]).toContain('users.name will be dropped');
    expect(r.kind).toBe('created');
  });

  it('writes without applying with createOnly, then deploy applies it', async () => {
    const r = await dev(adapter, v1(), dir, { version: '0.1.0', name: 'init', createOnly: true });
    expect(r.kind === 'created' && r.applied).toBe(false);
    expect((await status(adapter, dir)).pending).toHaveLength(1);
    const applied: string[] = [];
    const d = await deploy(adapter, dir, { onApplied: (m) => applied.push(m.id) });
    expect(d.applied).toHaveLength(1);
    expect(applied).toHaveLength(1);
    expect((await deploy(adapter, dir)).applied).toEqual([]);
  });

  it('applies pending migrations before diffing in dev', async () => {
    await dev(adapter, v1(), dir, { version: '0.1.0', name: 'init', createOnly: true });
    const r = await dev(adapter, v1(), dir, { version: '0.1.0' });
    expect(r.kind).toBe('in-sync');
    expect(r.appliedPending).toHaveLength(1);
  });

  it('detects modified and missing migrations', async () => {
    const r = await dev(adapter, v1(), dir, { version: '0.1.0', name: 'init' });
    if (r.kind !== 'created') throw new Error('expected a migration');
    writeFileSync(r.migration.file, `${readFileSync(r.migration.file, 'utf8')}\n-- edited\n`);
    const st = await status(adapter, dir);
    expect(st.modified.map((m) => m.local.id)).toEqual([r.migration.id]);
    const err = await deploy(adapter, dir).catch((e: unknown) => e);
    expect(isKastorError(err, 'MIGRATION_DRIFT')).toBe(true);
    const devErr = await dev(adapter, v1(), dir, { version: '0.1.0' }).catch((e: unknown) => e);
    expect((devErr as { hint: string }).hint).toContain('migrate reset');
    rmSync(r.migration.dir, { recursive: true });
    expect((await status(adapter, dir)).missing.map((m) => m.id)).toEqual([r.migration.id]);
  });

  it('refuses a folder written for another database', async () => {
    mkdirSync(dir, { recursive: true });
    writeLock(dir, 'postgres');
    const err = await deploy(adapter, dir).catch((e: unknown) => e);
    expect(String((err as Error).message)).toContain('written for postgres');
  });

  it('reports the failing statement and rolls the migration back', async () => {
    mkdirSync(join(dir, '20260101000000_bad'), { recursive: true });
    writeFileSync(join(dir, '20260101000000_bad', 'migration.sql'), 'CREATE TABLE ok (id int);\nCREATE TABLE broken (;\n');
    const err = await deploy(adapter, dir).catch((e: unknown) => e);
    expect(isKastorError(err, 'MIGRATION_FAILED')).toBe(true);
    expect((err as { meta: { statement: string; index: number } }).meta).toMatchObject({ statement: 'CREATE TABLE broken (', index: 1 });
    expect((await introspect(adapter)).tables.map((x) => x.name)).not.toContain('ok');
    expect((await status(adapter, dir)).applied).toEqual([]);
  });

  it('pushes without files and resets everything', async () => {
    const p = await push(adapter, v1());
    expect(p.kind).toBe('pushed');
    expect((await push(adapter, v1())).kind).toBe('in-sync');
    expect(readMigrations(dir)).toEqual([]);
    const wiped = await reset(adapter, join(dir, 'none'));
    expect(wiped.applied).toEqual([]);
    expect((await introspect(adapter)).tables).toEqual([]);
    await dev(adapter, v1(), join(dir, 'm'), { version: '0.1.0', name: 'init' });
    db.prepare("INSERT INTO users (email) VALUES ('a@x.io')").run();
    const r = await reset(adapter, join(dir, 'm'));
    expect(r.dropped.some((s) => s.op.kind === 'dropTable')).toBe(true);
    expect(r.applied).toHaveLength(1);
    expect(db.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 0 });
  });

  it('push stops for destructive changes unless confirmed', async () => {
    await push(adapter, v1());
    const smaller = toSchemaIR({ users: table('users', { id: t.id(), email: t.string(255).unique() }) });
    await expect(push(adapter, smaller)).rejects.toThrow(/cannot tell whether|drop data/);
    const done = await push(adapter, smaller, { acceptDataLoss: true });
    expect(done.kind).toBe('pushed');
  });

  it('resolves renames from flags first', async () => {
    await push(adapter, v1());
    const live = await introspect(adapter);
    const r = await resolveRenames(live, v2(), [{ kind: 'column', table: 'users', from: 'name', to: 'fullName' }]);
    expect(r.renames).toEqual([{ kind: 'column', table: 'users', from: 'name', to: 'fullName' }]);
    expect(r.unresolved).toEqual([]);
    const none = await resolveRenames(live, v2());
    expect(none.unresolved).toEqual([{ kind: 'column', table: 'users', from: 'name', to: ['fullName'] }]);
  });

  it('plans statements with the schema after each op', () => {
    const seen: string[] = [];
    const steps = planStatements(
      {
        name: 'sqlite',
        ddl: (op, schema) => {
          seen.push(`${op.kind}:${schema.tables.map((x) => x.name).join(',')}`);
          return [];
        },
      },
      { tables: [] },
      diffSchemas({ tables: [] }, v1()).ops,
    );
    expect(steps).toHaveLength(2);
    expect(seen).toEqual(['createTable:users', 'createTable:users,posts']);
    const raw = planStatements({ name: 'mysql', ddl: () => [] }, { tables: [] }, [{ kind: 'raw', sql: { mysql: 'SELECT 1', postgres: 'SELECT 2' } }]);
    expect(raw[0]!.statements).toEqual(['SELECT 1']);
  });
});

describe('db pull codegen', () => {
  it('names things like a person would', () => {
    expect(camelCase('blog_posts')).toBe('blogPosts');
    expect(camelCase('USER_ID')).toBe('userId');
    expect(camelCase('createdAt')).toBe('createdAt');
    expect(camelCase('1st')).toBe('_1st');
    expect(plural('category')).toBe('categories');
    expect(plural('box')).toBe('boxes');
    expect(singular('posts')).toBe('post');
    expect(singular('categories')).toBe('category');
    expect(singular('status')).toBe('status');
  });

  it('writes a schema that round trips to the same SchemaIR', async () => {
    const db = new Database(':memory:');
    const adapter = sqlite(db);
    const users = table('app_users', {
      id: t.id(),
      email: t.string(120).unique(),
      displayName: t.string().nullable().map('display_name'),
      role: t.enum(['user', 'admin']).default('admin'),
      score: t.float().default(1.5),
      big: t.bigint().default(7n),
      price: t.decimal(12, 4).nullable(),
      active: t.boolean().default(true),
      createdAt: t.datetime().defaultNow(),
      meta: t.json().nullable(),
    });
    const tags = table('tags', { id: t.id(), label: t.string(50) });
    const posts = table(
      'posts',
      {
        id: t.id(),
        title: t.string(200),
        authorId: t.int().references(() => users.id, { onDelete: 'cascade' }),
        parentId: t.int().nullable().references((): any => posts.id),
      },
      { indexes: (p) => [index(p.authorId).name('posts_by_author'), uniqueIndex(p.title, p.authorId)] },
    );
    const postTags = table(
      'post_tags',
      { postId: t.int().references(() => posts.id), tagId: t.int().references(() => tags.id) },
      { primaryKey: (c) => [c.postId, c.tagId] },
    );
    const original = toSchemaIR({ users, tags, posts, postTags });
    await push(adapter, original);
    const live = await introspect(adapter);
    const { code, notes } = generateSchema(live, { dialect: adapter.dialect, importFrom: resolve('src/core/schema.ts').replace(/\\/g, '/'), date: new Date(Date.UTC(2026, 0, 1)) });
    expect(notes).toEqual([]);
    expect(code).toContain("export const appUsers = table('app_users', {");
    expect(code).toContain("displayName: t.string().nullable().map('display_name'),");
    expect(code).toContain("index(c.authorId).name('posts_by_author')");
    expect(code).toContain('parentId: t.int().nullable().references((): AnyColumn => posts.id),');
    expect(code).toContain('posts: many(posts, { through: postTags }),');
    expect(code).toContain("author: one(appUsers, { fields: ['authorId'], references: ['id'] }),");
    const dir = mkdtempSync(join(resolve('.kastor'), 'pull-'));
    try {
      const file = join(dir, 'schema.ts');
      writeFileSync(file, code);
      const mod = await importModule(file);
      const again: SchemaIR = toSchemaIR(mod.schema as Record<string, unknown>);
      expect(diffSchemas(live, again, { dialect: adapter.dialect }).ops).toEqual([]);
      expect(typeof mod.relations).toBe('function');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      db.close();
    }
  });
});
