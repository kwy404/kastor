// Browser entry for the docs playground, bundled by scripts/site/bundle.mjs
// into docs/assets/pg-kastor.js. It is the real kastor source: the core, every
// dialect and the migration planner, plus a small adapter for sql.js.
import { kastor, table, t, one, many, index, uniqueIndex, sql, isTable, toSchemaIR, sortByDependencies } from '../../../src/index';
import type { Adapter, Dialect, ExecResult, SchemaIR } from '../../../src/index';
import { postgresDialect, cockroachDialect } from '../../../src/dialects/postgres/dialect';
import { sqliteDialect, d1Dialect } from '../../../src/dialects/sqlite/dialect';
import { syncExecutor } from '../../../src/dialects/sqlite/executor-sync';
import { mysqlDialect } from '../../../src/dialects/mysql/dialect';
import { mariadbDialect } from '../../../src/dialects/mariadb';
import { mssqlDialect } from '../../../src/dialects/mssql/dialect';
import { oracleDialect } from '../../../src/dialects/oracle/dialect';
import { mongoDialect } from '../../../src/dialects/mongodb/index';
import { diffSchemas } from '../../../src/migrate/diff';
import { planStatements } from '../../../src/migrate/engine';

export { kastor, table, t, one, many, index, uniqueIndex, sql, isTable, toSchemaIR, sortByDependencies };
export const VERSION = '0.1.0';

export const DIALECTS: Record<string, Dialect<any>> = {
  postgres: postgresDialect,
  cockroach: cockroachDialect,
  mysql: mysqlDialect,
  mariadb: mariadbDialect,
  sqlite: sqliteDialect,
  libsql: sqliteDialect,
  d1: d1Dialect,
  mssql: mssqlDialect,
  oracle: oracleDialect,
  mongodb: mongoDialect,
};

/** The features each dialect declares, for the support matrix on the site. */
export function dialectFeatures(): Record<string, Dialect['features']> {
  return Object.fromEntries(Object.entries(DIALECTS).map(([id, d]) => [id, d.features]));
}

/** The statements `migrate dev` would write for a fresh database. */
export function planCreate(id: string, tables: Record<string, unknown>): string[] {
  const dialect = DIALECTS[id];
  if (!dialect) throw new Error(`Unknown database ${id}`);
  const target = toSchemaIR(tables);
  const empty: SchemaIR = { tables: [], enums: [] };
  const { ops } = diffSchemas(empty, target, { dialect });
  return planStatements(dialect, empty, ops).flatMap((step) => step.statements);
}

interface SqlJsStatement {
  bind(values: unknown[]): boolean;
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  getColumnNames(): string[];
  free(): boolean;
}
interface SqlJsDatabase {
  prepare(sql: string): SqlJsStatement;
  getRowsModified(): number;
  exec(sql: string): { values: unknown[][] }[];
}

function toSqlJs(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString();
  return value;
}

/** A kastor SQLite adapter over a sql.js database (SQLite compiled to WebAssembly). */
export function sqlJsAdapter(db: SqlJsDatabase): Adapter {
  const connection = {
    execute(text: string, params: unknown[]): ExecResult {
      const statement = db.prepare(text);
      try {
        statement.bind(params.map(toSqlJs));
        const reader = statement.getColumnNames().length > 0;
        const rows: Record<string, unknown>[] = [];
        while (statement.step()) rows.push(statement.getAsObject());
        if (reader) return { rows };
        const last = db.exec('select last_insert_rowid()')[0]?.values[0]?.[0];
        return { rows, rowsAffected: db.getRowsModified(), insertId: last };
      } finally {
        statement.free();
      }
    },
    close() {},
  };
  connection.execute('PRAGMA foreign_keys = ON', []);
  return { dialect: sqliteDialect, executor: syncExecutor(connection as never) };
}
