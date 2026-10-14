/**
 * Schema suite shared by the MySQL, MariaDB, SQL Server and Oracle
 * integration tests: tables created through `dialect.ddl` must introspect
 * back to a schema the diff engine sees as unchanged, and every migration op
 * must apply on the live database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Adapter, Dialect, Executor, SchemaIR } from '../src/core/ir';
import { diffSchemas } from '../src/migrate/diff';
import { applyOp, describeOp, type MigrationOp } from '../src/migrate/ops';
import { roundTripSchema } from './pg-sqlite-shared';

export interface SqlmoreTarget {
  name: string;
  url: string | undefined;
  /** Creates the adapter and returns it with a function that closes the driver. */
  connect(url: string): Promise<{ adapter: Adapter; close(): Promise<void> }>;
  /** Drops one table if it exists, with its foreign keys. */
  dropTable(exec: Executor, table: string): Promise<void>;
}

export async function runAll(exec: Executor, statements: string[]): Promise<void> {
  for (const statement of statements) await exec.query(statement, []);
}

/** Ops still needed to go from the live database to `schema`, as readable lines. */
export async function drift(dialect: Dialect, exec: Executor, schema: SchemaIR): Promise<string[]> {
  const names = new Set(schema.tables.map((t) => t.name));
  const live = await dialect.introspect(exec);
  const current: SchemaIR = { tables: live.tables.filter((t) => names.has(t.name)) };
  return diffSchemas(current, schema, { dialect }).ops.map(describeOp);
}

export function sqlmoreSchemaSuite(target: SqlmoreTarget): void {
  describe.skipIf(!target.url)(`${target.name} schema round trip`, () => {
    let adapter: Adapter;
    let close: () => Promise<void>;
    const tables = [...roundTripSchema.tables].reverse().map((t) => t.name);

    const dropAll = async (extra: string[] = []) => {
      for (const name of [...extra, ...tables]) await target.dropTable(adapter.executor, name);
    };

    beforeAll(async () => {
      ({ adapter, close } = await target.connect(target.url!));
      await dropAll(['rt_renamed', 'rt_extra']);
    });

    afterAll(async () => {
      if (!adapter) return;
      await dropAll(['rt_renamed', 'rt_extra']);
      await close();
    });

    it('introspects exactly what ddl created', async () => {
      const { dialect, executor } = adapter;
      for (const table of roundTripSchema.tables) await runAll(executor, dialect.ddl({ kind: 'createTable', table }, roundTripSchema));
      expect(await drift(dialect, executor, roundTripSchema)).toEqual([]);
    });

    it('applies every migration op and reads the result back', async () => {
      const { dialect, executor } = adapter;
      let schema: SchemaIR = roundTripSchema;
      const apply = async (op: MigrationOp) => {
        schema = applyOp(schema, op);
        await runAll(executor, dialect.ddl(op as never, schema));
      };
      const users = () => schema.tables.find((t) => t.name === 'rt_users')!;
      const column = (name: string) => users().columns.find((c) => c.name === name)!;

      await apply({ kind: 'addColumn', table: 'rt_users', column: { name: 'nickname', type: 'string', length: 30, nullable: true } });
      await apply({ kind: 'addColumn', table: 'rt_users', column: { name: 'level', type: 'int', nullable: false, default: { kind: 'value', value: 3 } } });
      expect(await drift(dialect, executor, schema)).toEqual([]);

      await apply({ kind: 'renameColumn', table: 'rt_users', from: 'nickname', to: 'handle' });
      await apply({
        kind: 'alterColumn',
        table: 'rt_users',
        column: 'age',
        from: column('age'),
        to: { ...column('age'), type: 'bigint', default: { kind: 'value', value: '21' } },
        changes: { type: true, nullable: false, default: true },
      });
      await apply({
        kind: 'alterColumn',
        table: 'rt_users',
        column: 'name',
        from: column('name'),
        to: { ...column('name'), length: 120 },
        changes: { type: true, nullable: false, default: false },
      });
      await apply({
        kind: 'alterColumn',
        table: 'rt_users',
        column: 'handle',
        from: column('handle'),
        to: { ...column('handle'), nullable: false, default: { kind: 'value', value: 'anon' } },
        changes: { type: false, nullable: true, default: true },
      });
      await apply({
        kind: 'alterColumn',
        table: 'rt_users',
        column: 'role',
        from: column('role'),
        to: { ...column('role'), enumValues: ['user', 'admin', "it's", 'owner'] },
        changes: { type: true, nullable: false, default: false },
      });
      expect(await drift(dialect, executor, schema)).toEqual([]);

      await apply({ kind: 'createIndex', table: 'rt_users', index: { name: 'rt_users_handle_idx', columns: ['handle'], unique: false } });
      await apply({ kind: 'dropIndex', table: 'rt_users', index: { name: 'rt_users_handle_idx', columns: ['handle'], unique: false } });
      await apply({ kind: 'dropColumn', table: 'rt_users', column: 'level' });
      expect(await drift(dialect, executor, schema)).toEqual([]);

      await apply({
        kind: 'createTable',
        table: {
          name: 'rt_extra',
          columns: [
            { name: 'id', type: 'int', nullable: false, default: { kind: 'autoincrement' } },
            { name: 'user_id', type: 'int', nullable: true },
          ],
          primaryKey: ['id'],
          indexes: [],
          foreignKeys: [],
        },
      });
      const fk = { name: 'rt_extra_user_fk', columns: ['user_id'], refTable: 'rt_users', refColumns: ['id'], onDelete: 'set null' as const, onUpdate: 'no action' as const };
      await apply({ kind: 'addForeignKey', table: 'rt_extra', foreignKey: fk });
      expect(await drift(dialect, executor, schema)).toEqual([]);
      await apply({ kind: 'dropForeignKey', table: 'rt_extra', foreignKey: fk });
      await apply({ kind: 'renameTable', from: 'rt_extra', to: 'rt_renamed' });
      expect(await drift(dialect, executor, schema)).toEqual([]);
      await apply({ kind: 'dropTable', table: 'rt_renamed' });
      expect(await drift(dialect, executor, schema)).toEqual([]);
    });
  });
}
