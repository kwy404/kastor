// The docs playground runs the bundled kastor core in the browser. These tests
// load the same files the page loads and check that every example compiles
// on every database and that the TypeScript stripping and SQL formatting work.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const asset = (f: string) => pathToFileURL(join(root, 'docs', 'assets', f)).href;

type Compiled = { sql: string; params: unknown[] };
const K = (await import(asset('pg-kastor.js'))) as {
  DIALECTS: Record<string, unknown>;
  kastor: (config: Record<string, unknown>) => Record<string, unknown>;
  planCreate: (id: string, tables: Record<string, unknown>) => string[];
  dialectFeatures: () => Record<string, { jsonAggregation: boolean }>;
  sql: unknown;
};
const app = (await import(asset('pg-app.js'))) as {
  evalSchema: (src: string) => { tables: Record<string, unknown>; relations?: unknown };
  evalQuery: (src: string) => (db: unknown, sql: unknown) => { toSQL(): Compiled[] | Promise<Compiled[]> };
  stripTypes: (src: string) => string;
  formatSql: (sql: string) => string;
};
const { PRESETS, SCHEMA } = (await import(asset('pg-presets.js'))) as { PRESETS: { label: string; query: string }[]; SCHEMA: string };

const DATABASES = ['postgres', 'cockroach', 'mysql', 'mariadb', 'sqlite', 'libsql', 'd1', 'mssql', 'oracle', 'mongodb'];
const nullExecutor = {
  async query() {
    return { rows: [] };
  },
  async transaction(fn: (tx: unknown) => unknown) {
    return fn(nullExecutor);
  },
};

describe('docs playground', () => {
  const parsed = app.evalSchema(SCHEMA);

  it('reads the example schema written in TypeScript', () => {
    expect(Object.keys(parsed.tables)).toEqual(['users', 'posts', 'tags', 'postTags']);
    expect(typeof parsed.relations).toBe('function');
  });

  it('bundles a dialect for every database on the site', () => {
    expect(Object.keys(K.DIALECTS).sort()).toEqual([...DATABASES].sort());
    expect(Object.keys(K.dialectFeatures()).sort()).toEqual([...DATABASES].sort());
  });

  it.each(DATABASES)('plans the CREATE statements of the schema on %s', (id) => {
    const statements = K.planCreate(id, parsed.tables);
    expect(statements.length).toBeGreaterThanOrEqual(4);
  });

  for (const preset of PRESETS) {
    it.each(DATABASES)(`compiles "${preset.label}" on %s`, async (id) => {
      const db = K.kastor({ adapter: { dialect: K.DIALECTS[id], executor: nullExecutor }, schema: parsed.tables, relations: parsed.relations });
      const statements = await app.evalQuery(preset.query)(db, K.sql).toSQL();
      expect(statements.length).toBeGreaterThan(0);
      for (const s of statements) expect(typeof s.sql).toBe('string');
    });
  }

  it('strips the TypeScript the examples use', () => {
    const js = app.stripTypes(`import { table, t } from 'kastor'
import type { X } from './x'
export const a = t.json<{ tags: string[] }>().nullable()
export const relations = ({ users }: typeof schema) => ({ users })
const b = [1, 2] as const`);
    expect(js).not.toMatch(/import|export|typeof|as const|<\{/);
    expect(() => new Function('t', js)).not.toThrow();
  });

  it('breaks long SQL at clauses without touching quoted text', () => {
    const sql = 'SELECT "a" FROM "t" WHERE "b" = \'x FROM y\' AND "c" IN (SELECT "id" FROM "u" WHERE "d" = $1) ORDER BY "a" LIMIT 10';
    const out = app.formatSql(sql);
    expect(out.split('\n').length).toBeGreaterThan(3);
    expect(out).toContain("'x FROM y'");
    expect(out.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')')).toBe(sql);
  });

  it('ships the checker inputs: kastor sources, the standard library and the TypeScript version', () => {
    const types = JSON.parse(readFileSync(join(root, 'docs', 'assets', 'pg-types.json'), 'utf8'));
    expect(Object.keys(types)).toEqual(expect.arrayContaining(['src/index.ts', 'src/core/client.ts', 'src/core/types.ts']));
    const lib = JSON.parse(readFileSync(join(root, 'docs', 'assets', 'pg-lib.json'), 'utf8'));
    expect(Object.keys(lib)).toContain('lib.es5.d.ts');
    const meta = JSON.parse(readFileSync(join(root, 'docs', 'assets', 'pg-meta.json'), 'utf8'));
    expect(meta.typescript).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
