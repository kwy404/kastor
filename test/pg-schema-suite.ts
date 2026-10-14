import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Adapter, Executor, SchemaIR } from '../src/core/ir';
import { applyMigrationOp, createSchema, dropSchema, normalizeSchema, roundTripSchema } from './pg-sqlite-shared';

/** CockroachDB schema changes run as background jobs and take seconds each on a busy machine. */
const SLOW = 600_000;

/** Schema round trip and migration op suite for the pg family (Postgres, CockroachDB). */
export function pgSchemaSuite(name: string, url: string | undefined, makeAdapter: (pool: pg.Pool) => Adapter): void {
describe.skipIf(!url)(`${name} schema round trip`, () => {
  let pool: pg.Pool;
  let exec: Executor;
  const adapter = () => makeAdapter(pool);

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 4 });
    exec = adapter().executor;
    await dropSchema(exec, roundTripSchema, 'postgres');
  });

  afterAll(async () => {
    await dropSchema(exec, roundTripSchema, 'postgres');
    await pool.end();
  });

  it('introspects exactly what ddl created', async () => {
    const { dialect } = adapter();
    await createSchema(dialect, exec, roundTripSchema);
    const live = await dialect.introspect(exec);
    const only = roundTripSchema.tables.map((tbl) => tbl.name);
    expect(normalizeSchema(live, { enums: true, only })).toEqual(normalizeSchema(roundTripSchema, { enums: true }));
  }, SLOW);

  it('applies every migration op and reads the result back', async () => {
    const { dialect } = adapter();
    const only = () => schema.tables.map((tbl) => tbl.name);
    let schema: SchemaIR = roundTripSchema;
    const check = async () => {
      const live = await dialect.introspect(exec);
      expect(normalizeSchema(live, { enums: true, only: only() })).toEqual(normalizeSchema(schema, { enums: true }));
    };
    const users = () => schema.tables.find((tbl) => tbl.name === 'rt_users')!;
    const column = (name: string) => users().columns.find((c) => c.name === name)!;

    await exec.query(`INSERT INTO "rt_users" ("email", "name") VALUES ('a@x.io', 'Ann'), ('b@x.io', NULL)`, []);

    schema = await applyMigrationOp(dialect, exec, schema, { kind: 'addColumn', table: 'rt_users', column: { name: 'nickname', type: 'string', length: 30, nullable: true } });
    schema = await applyMigrationOp(dialect, exec, schema, {
      kind: 'addColumn',
      table: 'rt_users',
      column: { name: 'level', type: 'int', nullable: false, default: { kind: 'value', value: 3 } },
    });
    await check();

    schema = await applyMigrationOp(dialect, exec, schema, { kind: 'renameColumn', table: 'rt_users', from: 'nickname', to: 'handle' });
    schema = await applyMigrationOp(dialect, exec, schema, {
      kind: 'alterColumn',
      table: 'rt_users',
      column: 'age',
      from: column('age'),
      to: { ...column('age'), type: 'bigint', default: { kind: 'value', value: '21' } },
      changes: { type: true, nullable: false, default: true },
    });
    schema = await applyMigrationOp(dialect, exec, schema, {
      kind: 'alterColumn',
      table: 'rt_users',
      column: 'name',
      from: column('name'),
      to: { ...column('name'), length: 120, nullable: true },
      changes: { type: true, nullable: false, default: false },
    });
    // NULL bios would block SET NOT NULL: fill them first, like a user would.
    await exec.query(`UPDATE "rt_users" SET "bio" = 'none' WHERE "bio" IS NULL`, []);
    schema = await applyMigrationOp(dialect, exec, schema, {
      kind: 'alterColumn',
      table: 'rt_users',
      column: 'bio',
      from: column('bio'),
      to: { ...column('bio'), nullable: false, default: { kind: 'value', value: 'none' } },
      changes: { type: false, nullable: true, default: true },
    });
    await check();

    schema = await applyMigrationOp(dialect, exec, schema, { kind: 'createIndex', table: 'rt_users', index: { name: 'rt_users_level_idx', columns: ['level', 'age'], unique: false } });
    schema = await applyMigrationOp(dialect, exec, schema, { kind: 'dropIndex', table: 'rt_users', index: { name: 'rt_users_email_key', columns: ['email'], unique: true } });
    const fk = schema.tables.find((tbl) => tbl.name === 'rt_posts')!.foreignKeys.find((f) => f.name === 'rt_posts_editorId_fkey')!;
    schema = await applyMigrationOp(dialect, exec, schema, { kind: 'dropForeignKey', table: 'rt_posts', foreignKey: fk });
    schema = await applyMigrationOp(dialect, exec, schema, { kind: 'addForeignKey', table: 'rt_posts', foreignKey: { ...fk, name: 'rt_posts_editor_fk', onDelete: 'restrict' } });
    await check();

    // enums: add values in place, then remove one (recreates the type)
    const role = schema.enums!.find((e) => e.name === 'rt_users_role')!;
    schema = await applyMigrationOp(dialect, exec, schema, {
      kind: 'alterEnum',
      name: role.name,
      from: role.values,
      to: ['guest', 'user', 'editor', 'admin', "it's"],
      added: ['guest', 'editor'],
      removed: [],
      columns: [{ table: 'rt_users', column: 'role' }],
    });
    await check();
    schema = await applyMigrationOp(dialect, exec, schema, {
      kind: 'alterEnum',
      name: role.name,
      from: ['guest', 'user', 'editor', 'admin', "it's"],
      to: ['user', 'editor', 'admin'],
      added: [],
      removed: ['guest', "it's"],
      columns: [{ table: 'rt_users', column: 'role' }],
    });
    await check();
    const roles = await exec.query(`SELECT "role" FROM "rt_users" ORDER BY "email"`, []);
    expect(roles.rows.map((r) => r.role)).toEqual(['user', 'user']);

    schema = await applyMigrationOp(dialect, exec, schema, { kind: 'dropColumn', table: 'rt_users', column: 'handle' });
    schema = await applyMigrationOp(dialect, exec, schema, { kind: 'renameTable', from: 'rt_comments', to: 'rt_notes' });
    await check();
    schema = await applyMigrationOp(dialect, exec, schema, { kind: 'renameTable', from: 'rt_notes', to: 'rt_comments' });

    const kept = await exec.query(`SELECT "email", "name", "age", "level", "bio" FROM "rt_users" ORDER BY "email"`, []);
    expect(kept.rows).toEqual([
      { email: 'a@x.io', name: 'Ann', age: '18', level: 3, bio: 'none' },
      { email: 'b@x.io', name: null, age: '18', level: 3, bio: 'none' },
    ]);
  }, SLOW);
});
}
