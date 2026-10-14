/**
 * SQLite specific behaviour on every local driver: case sensitive matching
 * (SQLite LIKE ignores ASCII case), exact 64 bit integers, decimal scale,
 * transaction isolation on a single connection and introspecting a schema
 * kastor did not write.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { createClient } from '@libsql/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Adapter } from '../src/core/ir';
import { kastor, t, table, toSchemaIR } from '../src/index';
import { libsql } from '../src/libsql';
import { sqlite } from '../src/sqlite';
import { createSchema } from './pg-sqlite-shared';

const dir = mkdtempSync(join(tmpdir(), 'kastor-sqlite-dialect-'));
afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows may keep a database file open a little longer
  }
});

let nodeSqlite: { DatabaseSync: new (path: string) => unknown } | undefined;
try {
  const specifier = 'node:sqlite';
  nodeSqlite = (await import(/* @vite-ignore */ specifier)) as never;
} catch {
  nodeSqlite = undefined;
}

const notes = table('notes', {
  id: t.id(),
  title: t.string(100),
  big: t.bigint().nullable(),
  price: t.decimal(10, 2).nullable(),
  flag: t.boolean().default(false),
  meta: t.json<unknown>().nullable(),
});
const schema = { notes };

let files = 0;
const drivers: { name: string; make: () => Adapter; skip?: boolean }[] = [
  { name: 'better-sqlite3', make: () => sqlite(new Database(join(dir, `b${files++}.db`))) },
  { name: 'node:sqlite', make: () => sqlite(new nodeSqlite!.DatabaseSync(join(dir, `n${files++}.db`)) as never), skip: !nodeSqlite },
  { name: 'libsql', make: () => libsql(createClient({ url: pathToFileURL(join(dir, `l${files++}.db`)).href })) },
];

for (const driver of drivers) {
  describe.skipIf(driver.skip)(`sqlite specifics: ${driver.name}`, () => {
    let adapter: Adapter;
    let db: ReturnType<typeof kastor<typeof schema>>;

    beforeAll(async () => {
      adapter = driver.make();
      await createSchema(adapter.dialect, adapter.executor, toSchemaIR(schema));
      db = kastor({ adapter, schema });
      await db.notes.createMany({
        data: [
          { title: 'Hello World', big: 2n ** 62n + 1n, price: '1.5', meta: { a: 1 } },
          { title: 'hello world', big: 5n, price: '20', meta: 42 },
          { title: '100% sure_thing', price: '0.07', flag: true },
        ],
      });
    });

    afterAll(async () => {
      await adapter.executor.close?.();
    });

    it('matches text case sensitively unless asked not to', async () => {
      const titles = async (where: object) => (await db.notes.findMany({ where, orderBy: { id: 'asc' } })).map((n) => n.title);
      expect(await titles({ title: { contains: 'Hello' } })).toEqual(['Hello World']);
      expect(await titles({ title: { contains: 'Hello', mode: 'insensitive' } })).toEqual(['Hello World', 'hello world']);
      expect(await titles({ title: { startsWith: 'hello' } })).toEqual(['hello world']);
      expect(await titles({ title: { endsWith: 'World' } })).toEqual(['Hello World']);
      expect(await titles({ title: { contains: '0% s' } })).toEqual(['100% sure_thing']);
      expect(await titles({ title: { contains: '_t', mode: 'insensitive' } })).toEqual(['100% sure_thing']);
      expect(await titles({ title: { not: { contains: 'o' } } })).toEqual(['100% sure_thing']);
    });

    it('keeps 64 bit integers exact and decimals at their scale', async () => {
      const first = await db.notes.findFirst({ where: { big: { gt: 2n ** 62n } } });
      expect(first!.big).toBe(2n ** 62n + 1n);
      const prices = (await db.notes.findMany({ orderBy: { price: 'asc' } })).map((n) => n.price);
      expect(prices).toEqual(['0.07', '1.50', '20.00']);
      const sum = await db.notes.aggregate({ _sum: { price: true } });
      expect(Number(sum._sum.price)).toBeCloseTo(21.57);
    });

    it('reads booleans and json back as JS values', async () => {
      const rows = await db.notes.findMany({ orderBy: { id: 'asc' } });
      expect(rows.map((r) => r.flag)).toEqual([false, false, true]);
      expect(rows.map((r) => r.meta)).toEqual([{ a: 1 }, 42, null]);
    });

    it('keeps applied migrations in _kastor_migrations', async () => {
      // The bookkeeping table may be shared with other suites: only touch our own rows.
      const { dialect, executor } = adapter;
      const tag = Math.random().toString(36).slice(2, 10);
      const first = `20260102030405_init_${tag}`;
      const second = `20260103000000_more_${tag}`;
      await dialect.migrationTable.ensure(executor);
      await dialect.migrationTable.ensure(executor);
      const appliedAt = new Date('2026-01-02T03:04:05.678Z');
      await dialect.migrationTable.record(executor, { id: first, checksum: 'abc', appliedAt });
      await dialect.migrationTable.record(executor, { id: second, checksum: 'def', appliedAt });
      const ours = async () => (await dialect.migrationTable.list(executor)).filter((m) => m.id.endsWith(tag));
      expect(await ours()).toEqual([
        { id: first, checksum: 'abc', appliedAt },
        { id: second, checksum: 'def', appliedAt },
      ]);
      await dialect.migrationTable.remove(executor, second);
      await dialect.migrationTable.remove(executor, first);
      expect(await ours()).toEqual([]);
    });

    it('isolates a transaction from statements outside it', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const tx = db
        .$transaction(async (t) => {
          await t.notes.create({ data: { title: 'inside' } });
          await gate;
          throw new Error('rollback');
        })
        .catch(() => 'rolled back');
      const outside = db.notes.create({ data: { title: 'outside' } });
      await new Promise((r) => setTimeout(r, 20));
      release();
      expect(await tx).toBe('rolled back');
      await outside;
      expect(await db.notes.count({ where: { title: { in: ['inside', 'outside'] } } })).toBe(1);
    });
  });
}

describe('sqlite introspection of a hand written schema', () => {
  it('reads rowid keys, inline unique and foreign keys without names', async () => {
    const adapter = sqlite(new Database(':memory:'));
    const exec = adapter.executor;
    await exec.query(`CREATE TABLE parent (id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, price NUMERIC, at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`, []);
    await exec.query(`CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent ON DELETE CASCADE, kind TEXT CHECK (kind IN ('a', 'b')))`, []);
    await exec.query(`CREATE INDEX child_kind ON child (kind) WHERE kind IS NOT NULL`, []);
    const live = await adapter.dialect.introspect(exec);
    expect(live.tables.map((tbl) => tbl.name)).toEqual(['parent', 'child']);
    const [parent, child] = live.tables;
    expect(parent!.columns).toEqual([
      { name: 'id', type: 'int', nullable: false },
      { name: 'code', type: 'text', nullable: false },
      { name: 'price', type: 'decimal', nullable: true, nativeType: 'NUMERIC' },
      { name: 'at', type: 'datetime', nullable: true, nativeType: 'TIMESTAMP', default: { kind: 'sql', value: 'CURRENT_TIMESTAMP' } },
    ]);
    expect(parent!.indexes).toEqual([{ name: 'parent_code_key', columns: ['code'], unique: true }]);
    expect(child!.columns[2]).toEqual({ name: 'kind', type: 'enum', nullable: true, enumValues: ['a', 'b'], enumName: 'child_kind' });
    expect(child!.indexes).toEqual([]);
    expect(child!.foreignKeys).toEqual([
      { name: 'child_parent_id_fkey', columns: ['parent_id'], refTable: 'parent', refColumns: ['id'], onDelete: 'cascade', onUpdate: 'no action' },
    ]);
  });
});
