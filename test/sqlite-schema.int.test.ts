import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { createClient } from '@libsql/client';
import { afterAll, describe, expect, it } from 'vitest';
import type { Adapter, Executor, SchemaIR } from '../src/core/ir';
import { libsql } from '../src/libsql';
import { needsForeignKeysOff, sqlite } from '../src/sqlite';
import type { MigrationOp } from '../src/migrate/ops';
import { applyOp } from '../src/migrate/ops';
import { createSchema, normalizeSchema, roundTripSchema, runAll } from './pg-sqlite-shared';

const dir = mkdtempSync(join(tmpdir(), 'kastor-sqlite-schema-'));
afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows may keep the libSQL file open a little longer
  }
});

let nodeSqlite: { DatabaseSync: new (path: string) => unknown } | undefined;
try {
  nodeSqlite = (await import('node:sqlite')) as never;
} catch {
  nodeSqlite = undefined;
}

let counter = 0;
const drivers: { name: string; make: () => Adapter; skip?: boolean }[] = [
  { name: 'better-sqlite3', make: () => sqlite(new Database(':memory:')) },
  { name: 'node:sqlite', make: () => sqlite(new nodeSqlite!.DatabaseSync(':memory:') as never), skip: !nodeSqlite },
  { name: 'libsql', make: () => libsql(createClient({ url: pathToFileURL(join(dir, `schema-${counter++}.db`)).href })) },
];

/** What `kastor migrate` does with a SQLite script: foreign keys off around the transaction when tables are rebuilt. */
async function migrate(exec: Executor, statements: string[]): Promise<void> {
  const off = needsForeignKeysOff(statements);
  if (off) await exec.query('PRAGMA foreign_keys = OFF', []);
  try {
    await exec.transaction(async (tx) => {
      await runAll(tx, statements);
      if (off) {
        const broken = await tx.query('PRAGMA foreign_key_check', []);
        if (broken.rows.length > 0) throw new Error(`foreign key check failed: ${JSON.stringify(broken.rows)}`);
      }
    });
  } finally {
    if (off) await exec.query('PRAGMA foreign_keys = ON', []);
  }
}

for (const driver of drivers) {
  describe.skipIf(driver.skip)(`sqlite schema round trip (${driver.name})`, () => {
    it('introspects exactly what ddl created', async () => {
      const { dialect, executor } = driver.make();
      await createSchema(dialect, executor, roundTripSchema);
      const live = await dialect.introspect(executor);
      expect(normalizeSchema(live)).toEqual(normalizeSchema(roundTripSchema));
      await executor.close?.();
    });

    it('applies every migration op, rebuilding tables without losing rows', async () => {
      const { dialect, executor: exec } = driver.make();
      await createSchema(dialect, exec, roundTripSchema);
      let schema: SchemaIR = roundTripSchema;
      const apply = async (op: MigrationOp) => {
        const next = applyOp(schema, op);
        await migrate(exec, dialect.ddl(op as never, next));
        schema = next;
      };
      const check = async () => {
        const live = await dialect.introspect(exec);
        expect(normalizeSchema(live)).toEqual(normalizeSchema(schema));
      };
      const users = () => schema.tables.find((tbl) => tbl.name === 'rt_users')!;
      const column = (name: string) => users().columns.find((c) => c.name === name)!;

      await exec.query(`INSERT INTO "rt_users" ("email", "name") VALUES ('a@x.io', 'Ann'), ('b@x.io', NULL)`, []);
      await exec.query(`INSERT INTO "rt_posts" ("title", "slug", "author_id") VALUES ('Hello', 'hello', 1), ('Again', 'again', 2)`, []);
      await exec.query(`INSERT INTO "rt_comments" ("body") VALUES ('root')`, []);
      await exec.query(`INSERT INTO "rt_comments" ("body", "parentId") VALUES ('child', 1)`, []);

      // in place
      await apply({ kind: 'addColumn', table: 'rt_users', column: { name: 'nickname', type: 'string', length: 30, nullable: true } });
      await apply({ kind: 'addColumn', table: 'rt_users', column: { name: 'level', type: 'int', nullable: false, default: { kind: 'value', value: 3 } } });
      await apply({ kind: 'renameColumn', table: 'rt_users', from: 'nickname', to: 'handle' });
      await check();

      // rebuilds of a table other tables point at with ON DELETE CASCADE
      await apply({ kind: 'addColumn', table: 'rt_users', column: { name: 'seenAt', type: 'datetime', nullable: false, default: { kind: 'now' } } });
      await apply({
        kind: 'alterColumn',
        table: 'rt_users',
        column: 'age',
        from: column('age'),
        to: { ...column('age'), type: 'bigint', default: { kind: 'value', value: '21' } },
        changes: { type: true, nullable: false, default: true },
      });
      await exec.query(`UPDATE "rt_users" SET "bio" = 'none' WHERE "bio" IS NULL`, []);
      await apply({
        kind: 'alterColumn',
        table: 'rt_users',
        column: 'bio',
        from: column('bio'),
        to: { ...column('bio'), nullable: false, default: { kind: 'value', value: 'none' } },
        changes: { type: false, nullable: true, default: true },
      });
      await apply({ kind: 'dropColumn', table: 'rt_users', column: 'handle' });
      await apply({
        kind: 'alterEnum',
        name: 'rt_users_role',
        from: ['user', 'admin', "it's"],
        to: ['user', 'editor', 'admin'],
        added: ['editor'],
        removed: ["it's"],
        columns: [{ table: 'rt_users', column: 'role' }],
      });
      await check();

      const fk = schema.tables.find((tbl) => tbl.name === 'rt_posts')!.foreignKeys.find((f) => f.name === 'rt_posts_editorId_fkey')!;
      await apply({ kind: 'dropForeignKey', table: 'rt_posts', foreignKey: fk });
      await apply({ kind: 'addForeignKey', table: 'rt_posts', foreignKey: { ...fk, name: 'rt_posts_editor_fk', onDelete: 'restrict' } });
      await apply({ kind: 'createIndex', table: 'rt_users', index: { name: 'rt_users_level_idx', columns: ['level', 'age'], unique: false } });
      await apply({ kind: 'dropIndex', table: 'rt_users', index: { name: 'rt_users_email_key', columns: ['email'], unique: true } });
      await apply({ kind: 'renameTable', from: 'rt_comments', to: 'rt_notes' });
      await check();

      const posts = await exec.query(`SELECT "title" FROM "rt_posts" ORDER BY "title"`, []);
      expect(posts.rows.map((r) => r.title)).toEqual(['Again', 'Hello']);
      const notes = await exec.query(`SELECT "body", "parentId" FROM "rt_notes" ORDER BY "id"`, []);
      expect(notes.rows).toEqual([
        { body: 'root', parentId: null },
        { body: 'child', parentId: 1 },
      ]);
      const kept = await exec.query(`SELECT "email", "name", "age", "level", "bio", "role" FROM "rt_users" ORDER BY "email"`, []);
      expect(kept.rows).toEqual([
        { email: 'a@x.io', name: 'Ann', age: 18, level: 3, bio: 'none', role: 'user' },
        { email: 'b@x.io', name: null, age: 18, level: 3, bio: 'none', role: 'user' },
      ]);
      // foreign keys still work after the rebuilds
      await expect(exec.query(`INSERT INTO "rt_posts" ("title", "slug", "author_id") VALUES ('x', 'x', 99)`, [])).rejects.toThrow(/FOREIGN KEY/);
      await exec.query(`DELETE FROM "rt_users" WHERE "email" = 'a@x.io'`, []);
      const left = await exec.query(`SELECT count(*) AS n FROM "rt_posts"`, []);
      expect(left.rows[0]!.n).toBe(1);
      await exec.close?.();
    });

    it('refuses to rebuild a referenced table while foreign keys are enforced', async () => {
      const { dialect, executor: exec } = driver.make();
      await createSchema(dialect, exec, roundTripSchema);
      await exec.query(`INSERT INTO "rt_users" ("email") VALUES ('a@x.io')`, []);
      await exec.query(`INSERT INTO "rt_posts" ("title", "slug", "author_id") VALUES ('Hello', 'hello', 1)`, []);
      const users = roundTripSchema.tables.find((tbl) => tbl.name === 'rt_users')!;
      const age = users.columns.find((c) => c.name === 'age')!;
      const op: MigrationOp = { kind: 'alterColumn', table: 'rt_users', column: 'age', from: age, to: { ...age, nullable: true }, changes: { type: false, nullable: true, default: false } };
      const statements = dialect.ddl(op as never, applyOp(roundTripSchema, op));
      await expect(exec.transaction((tx) => runAll(tx, statements))).rejects.toThrow(/needs foreign keys off/);
      const posts = await exec.query(`SELECT count(*) AS n FROM "rt_posts"`, []);
      expect(posts.rows[0]!.n).toBe(1);
      await exec.close?.();
    });
  });
}
