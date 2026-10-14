/**
 * Builds a full Dialect from SQL hooks: the dialect owner supplies hooks,
 * DDL and introspection, the shared base supplies everything else.
 */
import { errors, KastorError } from '../errors';
import type {
  AppliedMigration,
  ColumnIR,
  Dialect,
  DialectFeatures,
  DialectName,
  Executor,
  MigrationOpLike,
  MigrationTable,
  SchemaIR,
} from '../ir';
import type { SqlHooks } from './hooks';
import { compileSql, executeSql } from './execute';
import { splitSqlScript } from './script';

export const MIGRATIONS_TABLE = '_kastor_migrations';

export interface SqlMigrationTableOptions {
  /** Native type for `applied_at`, e.g. `TIMESTAMPTZ`, `DATETIME(3)`, `DATETIME2`, `TEXT`. */
  timestampType: string;
  /** Native type for the text columns (default `VARCHAR(255)`). */
  textType?: string;
  /** Table name (default `_kastor_migrations`). */
  table?: string;
}

/**
 * Bookkeeping table for applied migrations on any SQL database:
 * `(id VARCHAR(255) PRIMARY KEY, checksum VARCHAR(255), applied_at <timestampType>)`.
 */
export function sqlMigrationTable(hooks: SqlHooks, options: SqlMigrationTableOptions): MigrationTable {
  const name = options.table ?? MIGRATIONS_TABLE;
  const t = hooks.quoteIdent(name);
  const id = hooks.quoteIdent('id');
  const checksum = hooks.quoteIdent('checksum');
  const appliedAt = hooks.quoteIdent('applied_at');
  const textType = options.textType ?? 'VARCHAR(255)';
  const ph = (i: number): string => hooks.placeholder(i);
  const dateColumn: ColumnIR = { name: 'applied_at', type: 'datetime', nullable: false };
  const textColumn: ColumnIR = { name: 'id', type: 'string', nullable: false };

  const exists = async (exec: Executor): Promise<boolean> => {
    try {
      await exec.query(`SELECT ${id} FROM ${t} WHERE 1=0`, []);
      return true;
    } catch {
      return false;
    }
  };

  return {
    async ensure(exec) {
      if (await exists(exec)) return;
      await exec.query(
        `CREATE TABLE ${t} (${id} ${textType} NOT NULL PRIMARY KEY, ${checksum} ${textType} NOT NULL, ${appliedAt} ${options.timestampType} NOT NULL)`,
        [],
      );
    },
    async list(exec) {
      if (!(await exists(exec))) return [];
      const res = await exec.query(`SELECT ${id} AS ${id}, ${checksum} AS ${checksum}, ${appliedAt} AS ${appliedAt} FROM ${t} ORDER BY ${id}`, []);
      return res.rows.map(
        (r): AppliedMigration => ({
          id: String(r.id),
          checksum: String(r.checksum),
          appliedAt: hooks.decode(r.applied_at, dateColumn, 'row') as Date,
        }),
      );
    },
    async record(exec, m) {
      await exec.query(`INSERT INTO ${t} (${id}, ${checksum}, ${appliedAt}) VALUES (${ph(1)}, ${ph(2)}, ${ph(3)})`, [
        hooks.encode(m.id, textColumn),
        hooks.encode(m.checksum, textColumn),
        hooks.encode(m.appliedAt, dateColumn),
      ]);
    },
    async remove(exec, migrationId) {
      await exec.query(`DELETE FROM ${t} WHERE ${id} = ${ph(1)}`, [hooks.encode(migrationId, textColumn)]);
    },
  };
}

export interface SqlDialectOptions {
  name: DialectName;
  hooks: SqlHooks;
  /** Overrides for the features derived from the hooks. */
  features?: Partial<DialectFeatures>;
  ddl(op: MigrationOpLike, schema: SchemaIR): string[];
  introspect(exec: Executor): Promise<SchemaIR>;
  /** Defaults to `sqlMigrationTable(hooks, { timestampType })`. */
  migrationTable?: MigrationTable;
  /** Native timestamp type for the default migration table. */
  timestampType?: string;
  splitScript?(script: string): string[];
  mapError?(error: unknown): Error | null;
}

export function createSqlDialect(options: SqlDialectOptions): Dialect {
  const { hooks } = options;
  const features: DialectFeatures = {
    returning: hooks.returning !== 'none',
    jsonAggregation: hooks.json !== null,
    upsert: hooks.upsert !== 'none',
    ilike: hooks.caseInsensitive === 'ilike',
    transactions: true,
    namedEnums: false,
    transactionalDdl: false,
    rawSql: true,
    ...options.features,
  };
  const migrationTable =
    options.migrationTable ??
    (options.timestampType
      ? sqlMigrationTable(hooks, { timestampType: options.timestampType })
      : (() => {
          throw errors.schema(`Dialect ${options.name} has no migration table.`, 'Pass migrationTable or timestampType to createSqlDialect.');
        })());

  const dialect: Dialect = {
    name: options.name,
    features,
    execute: (query, schema, exec) => executeSql(hooks, query, schema, exec),
    compile: (query, schema) => compileSql(hooks, query, schema),
    ddl: options.ddl,
    introspect: options.introspect,
    migrationTable,
    splitScript: options.splitScript ?? ((script) => splitSqlScript(script)),
    quoteIdent: hooks.quoteIdent,
    placeholder: hooks.placeholder,
    encodeParam: (value) => hooks.encode(value, undefined),
  };
  if (options.mapError) dialect.mapError = options.mapError;
  return dialect;
}

/** A dialect that only compiles (no DDL, no introspection), handy for tests and the docs playground. */
export function compileOnlyDialect(name: DialectName, hooks: SqlHooks): Dialect {
  const unsupported = (what: string) => (): never => {
    throw new KastorError('UNSUPPORTED', `${what} is not available on a compile only dialect.`, { hint: 'Use the real adapter for this database.' });
  };
  return createSqlDialect({
    name,
    hooks,
    ddl: unsupported('DDL'),
    introspect: unsupported('Introspection'),
    migrationTable: {
      ensure: unsupported('Migrations'),
      list: unsupported('Migrations'),
      record: unsupported('Migrations'),
      remove: unsupported('Migrations'),
    },
  });
}
