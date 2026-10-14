/**
 * Internal contracts shared by the core, the dialects and the migration engine.
 *
 * Everything here is plain data (JSON friendly) except the Executor and
 * Dialect interfaces. The client turns every call into a QueryIR, a dialect
 * runs it, and migrations diff two SchemaIR values. See README-internal.md in
 * this folder for the full contract, including what each query kind returns.
 */

/* ------------------------------------------------------------------------ */
/* Schema                                                                     */
/* ------------------------------------------------------------------------ */

/** Database neutral column types. Dialects map them to native types. */
export type NeutralType =
  | 'string'
  | 'text'
  | 'int'
  | 'bigint'
  | 'float'
  | 'decimal'
  | 'boolean'
  | 'datetime'
  | 'date'
  | 'time'
  | 'json'
  | 'bytes'
  | 'uuid'
  | 'enum';

export const neutralTypes: readonly NeutralType[] = [
  'string',
  'text',
  'int',
  'bigint',
  'float',
  'decimal',
  'boolean',
  'datetime',
  'date',
  'time',
  'json',
  'bytes',
  'uuid',
  'enum',
];

/**
 * How a column gets a value when an insert leaves it out.
 * - `value`: a literal (`value` holds it, already JSON friendly: Date as ISO string, bigint as string)
 * - `now`: current timestamp
 * - `random`: random UUID
 * - `autoincrement`: identity or serial
 * - `sql`: raw SQL expression in `value`
 */
export interface ColumnDefaultIR {
  kind: 'value' | 'now' | 'random' | 'autoincrement' | 'sql';
  value?: unknown;
}

export interface ColumnIR {
  /** Column name in the database (after `.map()`). */
  name: string;
  type: NeutralType;
  nullable: boolean;
  default?: ColumnDefaultIR;
  /** string(length) */
  length?: number;
  /** decimal(precision, scale) */
  precision?: number;
  scale?: number;
  /** enum values, in declaration order */
  enumValues?: string[];
  /** enum type name for dialects with named enums (Postgres). Defaults to `<table>_<column>`. */
  enumName?: string;
  /** Native type override chosen by the user or found by introspection, e.g. `varchar(64)`. */
  nativeType?: string;
}

export interface IndexIR {
  name: string;
  /** Database column names, in index order. */
  columns: string[];
  unique: boolean;
}

export type ReferentialAction = 'cascade' | 'restrict' | 'set null' | 'set default' | 'no action';

export interface ForeignKeyIR {
  name: string;
  columns: string[];
  refTable: string;
  refColumns: string[];
  onDelete: ReferentialAction;
  onUpdate: ReferentialAction;
}

export interface TableIR {
  /** Table name in the database. */
  name: string;
  columns: ColumnIR[];
  /** Database column names of the primary key (empty when the table has none). */
  primaryKey: string[];
  /** Secondary indexes. A `.unique()` column shows up here as a one column unique index. */
  indexes: IndexIR[];
  foreignKeys: ForeignKeyIR[];
}

export interface EnumIR {
  name: string;
  values: string[];
}

export interface SchemaIR {
  tables: TableIR[];
  /** Named enums (Postgres style). Dialects without named enums ignore this. */
  enums?: EnumIR[];
}

/* ------------------------------------------------------------------------ */
/* Relations                                                                  */
/* ------------------------------------------------------------------------ */

/**
 * A resolved relation between two tables, all names are database names.
 *
 * Direct relation: `from.fromColumns[i] = to.toColumns[i]`.
 * Through a join table (n:m):
 *   `from.fromColumns[i] = through.sourceColumns[i]` and
 *   `through.targetColumns[j] = to.toColumns[j]`.
 */
export interface RelationIR {
  /** Relation field name on the source model, e.g. `posts`. Used as the output key. */
  name: string;
  cardinality: 'one' | 'many';
  from: string;
  to: string;
  fromColumns: string[];
  toColumns: string[];
  through?: {
    table: string;
    sourceColumns: string[];
    targetColumns: string[];
  };
  /**
   * When the target table uses soft delete, the column that marks deleted rows.
   * The SQL base adds `<column> IS NULL` to every join with this relation.
   */
  softDeleteColumn?: string;
}

/* ------------------------------------------------------------------------ */
/* Where tree                                                                 */
/* ------------------------------------------------------------------------ */

export type CompareOp = 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte';
export type AggregateFn = 'count' | 'sum' | 'avg' | 'min' | 'max';

/**
 * Normalized filter tree. Column names are database names relative to the
 * table in scope (the query table, or the related table inside `relation`).
 * Values are plain JS values (Date, bigint, Uint8Array, objects for json);
 * dialects encode them with the column type.
 */
export type WhereIR =
  | { kind: 'and'; items: WhereIR[] }
  | { kind: 'or'; items: WhereIR[] }
  | { kind: 'not'; item: WhereIR }
  /** Always true (`true`) or always false (`false`), e.g. `in: []`. */
  | { kind: 'const'; value: boolean }
  | {
      kind: 'compare';
      column: string;
      op: CompareOp;
      value: unknown;
      /** Compare case insensitively (strings only). */
      insensitive?: boolean;
      /** Only inside `having`: compare an aggregate of the column (`null` column means `count(*)`). */
      aggregate?: AggregateFn;
    }
  | { kind: 'in'; column: string; values: unknown[]; negate: boolean; insensitive?: boolean; aggregate?: AggregateFn }
  | { kind: 'null'; column: string; negate: boolean }
  | {
      kind: 'like';
      column: string;
      mode: 'contains' | 'startsWith' | 'endsWith';
      /** The raw user string. Dialects escape wildcard characters themselves. */
      value: string;
      insensitive: boolean;
      negate: boolean;
    }
  | {
      kind: 'relation';
      relation: RelationIR;
      /** `some`, `every`, `none` for many relations; `is`, `isNot` for one relations. */
      op: 'some' | 'every' | 'none' | 'is' | 'isNot';
      /** Filter on the related table, `null` means no filter (or `is: null` / `isNot: null`). */
      where: WhereIR | null;
    }
  /** Raw SQL fragment from `sql\`...\``, only produced when the user passes one. */
  | { kind: 'raw'; sql: SqlFragmentIR };

/** A raw SQL fragment: `strings.length === params.length + 1`, joined by placeholders. */
export interface SqlFragmentIR {
  strings: string[];
  params: unknown[];
}

/* ------------------------------------------------------------------------ */
/* Reads                                                                      */
/* ------------------------------------------------------------------------ */

export interface SelectColumnIR {
  /** Database column name. */
  column: string;
  /** Output key (the TypeScript field name). */
  as: string;
}

export type OrderByIR =
  | { kind: 'column'; column: string; direction: 'asc' | 'desc'; nulls?: 'first' | 'last' }
  /** `orderBy: { posts: { _count: 'desc' } }` */
  | { kind: 'relationCount'; relation: RelationIR; direction: 'asc' | 'desc' }
  /** `orderBy: { author: { name: 'asc' } }`, path of one relations from the query table. */
  | { kind: 'relationColumn'; path: RelationIR[]; column: string; direction: 'asc' | 'desc'; nulls?: 'first' | 'last' }
  /** groupBy only: order by an aggregate. `column` null means `count(*)`. */
  | { kind: 'aggregate'; fn: AggregateFn; column: string | null; direction: 'asc' | 'desc' };

/** `_count: { posts: true }` or `_count: { posts: { where } }` */
export interface RelationCountIR {
  relation: RelationIR;
  where?: WhereIR;
  /** Output key inside `_count`. */
  as: string;
}

/**
 * A read of one table: what to select, which relations to load, filters and
 * paging. Used by the root of find queries and by every include level.
 */
export interface ReadIR {
  table: string;
  select: SelectColumnIR[];
  include: IncludeIR[];
  /** Relation counts, returned under the `_count` key. */
  counts: RelationCountIR[];
  where?: WhereIR;
  orderBy: OrderByIR[];
  take?: number;
  skip?: number;
  /** Database column names: keep the first row (by `orderBy`) of every distinct combination. */
  distinct?: string[];
}

export interface IncludeIR {
  relation: RelationIR;
  /** The related read. `table` equals `relation.to`. */
  read: ReadIR;
}

/* ------------------------------------------------------------------------ */
/* Writes                                                                     */
/* ------------------------------------------------------------------------ */

/** Value of one column in an update. Plain `set` for assignments. */
export type UpdateValueIR =
  | { op: 'set'; value: unknown }
  | { op: 'increment' | 'decrement' | 'multiply' | 'divide'; value: number | bigint };

/** One row to insert, keyed by database column name. Missing columns use their default. */
export type RowDataIR = Record<string, unknown>;

/* ------------------------------------------------------------------------ */
/* Queries                                                                    */
/* ------------------------------------------------------------------------ */

export interface FindQueryIR {
  kind: 'findMany' | 'findFirst' | 'findUnique';
  table: string;
  read: ReadIR;
}

export interface CreateQueryIR {
  kind: 'create';
  table: string;
  data: RowDataIR;
  /** Columns to return for the new row. */
  returning: SelectColumnIR[];
}

export interface CreateManyQueryIR {
  kind: 'createMany';
  table: string;
  data: RowDataIR[];
  /** Skip rows that would break a unique constraint instead of failing. */
  skipDuplicates: boolean;
  /** When set, return the created rows (createManyAndReturn). Otherwise `{ count }`. */
  returning?: SelectColumnIR[];
}

export interface UpdateQueryIR {
  kind: 'update';
  table: string;
  /** Selects at most one row (the client checks it holds a unique condition). */
  where: WhereIR;
  data: Record<string, UpdateValueIR>;
  returning: SelectColumnIR[];
}

export interface UpdateManyQueryIR {
  kind: 'updateMany';
  table: string;
  where?: WhereIR;
  data: Record<string, UpdateValueIR>;
  /** When set, return the updated rows. Otherwise `{ count }`. */
  returning?: SelectColumnIR[];
}

export interface UpsertQueryIR {
  kind: 'upsert';
  table: string;
  /** The unique condition as plain column equality, used for the conflict target. */
  conflict: RowDataIR;
  /** The same condition as a where tree, used to read the row back. */
  where: WhereIR;
  create: RowDataIR;
  update: Record<string, UpdateValueIR>;
  returning: SelectColumnIR[];
}

export interface DeleteQueryIR {
  kind: 'delete';
  table: string;
  where: WhereIR;
  returning: SelectColumnIR[];
}

export interface DeleteManyQueryIR {
  kind: 'deleteMany';
  table: string;
  where?: WhereIR;
}

export interface CountQueryIR {
  kind: 'count';
  table: string;
  where?: WhereIR;
  orderBy?: OrderByIR[];
  take?: number;
  skip?: number;
  distinct?: string[];
}

export interface AggregateIR {
  fn: AggregateFn;
  /** Database column, or `null` for `count(*)`. */
  column: string | null;
  /** Output key, a safe identifier chosen by the client (`a0`, `a1`, ...). */
  as: string;
}

export interface AggregateQueryIR {
  kind: 'aggregate';
  table: string;
  where?: WhereIR;
  orderBy?: OrderByIR[];
  take?: number;
  skip?: number;
  aggregates: AggregateIR[];
}

export interface GroupByQueryIR {
  kind: 'groupBy';
  table: string;
  where?: WhereIR;
  /** Group columns, returned under their `as` key. */
  by: SelectColumnIR[];
  aggregates: AggregateIR[];
  /** Filter on groups: compare/in nodes may carry `aggregate`. */
  having?: WhereIR;
  orderBy: OrderByIR[];
  take?: number;
  skip?: number;
}

export type QueryIR =
  | FindQueryIR
  | CreateQueryIR
  | CreateManyQueryIR
  | UpdateQueryIR
  | UpdateManyQueryIR
  | UpsertQueryIR
  | DeleteQueryIR
  | DeleteManyQueryIR
  | CountQueryIR
  | AggregateQueryIR
  | GroupByQueryIR;

export type QueryKind = QueryIR['kind'];

/**
 * What `Dialect.execute` resolves to for each query kind. Rows are keyed by the
 * `as` names of the select list, include results by relation name (array for
 * many, object or null for one) and relation counts under `_count`. Values are
 * already decoded to JS values (boolean, Date, bigint, Uint8Array, parsed json).
 */
export interface QueryResultMap {
  findMany: Row[];
  findFirst: Row | null;
  findUnique: Row | null;
  create: Row;
  createMany: { count: number } | Row[];
  update: Row | null;
  updateMany: { count: number } | Row[];
  upsert: Row;
  delete: Row | null;
  deleteMany: { count: number };
  count: number;
  aggregate: Row;
  groupBy: Row[];
}

export type Row = Record<string, unknown>;

/* ------------------------------------------------------------------------ */
/* Execution                                                                  */
/* ------------------------------------------------------------------------ */

export interface ExecResult {
  rows: Record<string, unknown>[];
  /** Rows changed by INSERT, UPDATE or DELETE when the driver reports it. */
  rowsAffected?: number;
  /** Last inserted auto increment id (MySQL, SQLite) when the driver reports it. */
  insertId?: unknown;
}

export interface TransactionOptions {
  isolationLevel?: 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable';
}

/** Runs SQL. Adapters wrap the user's driver instance in one of these. */
export interface Executor {
  query(sql: string, params: unknown[]): Promise<ExecResult>;
  /**
   * Runs `fn` inside one transaction: commit when it resolves, roll back when
   * it throws. `tx` must send every statement over the same connection.
   */
  transaction<T>(fn: (tx: Executor) => Promise<T>, options?: TransactionOptions): Promise<T>;
  /** True on the executor handed to a transaction callback. */
  readonly inTransaction?: boolean;
  close?(): Promise<void>;
}

/* ------------------------------------------------------------------------ */
/* Migrations                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * One migration step. The migrate module owns the full union in
 * `src/migrate/ops.ts`; this structural type keeps the core independent of it.
 */
export interface MigrationOpLike {
  kind: string;
  [key: string]: unknown;
}

/** A row of the migrations bookkeeping table (`_kastor_migrations`). */
export interface AppliedMigration {
  /** Folder name, `<timestamp>_<name>`. */
  id: string;
  /** sha256 of migration.sql, hex. */
  checksum: string;
  appliedAt: Date;
}

/** Bookkeeping for applied migrations, implemented per dialect. */
export interface MigrationTable<E = Executor> {
  /** Creates the bookkeeping table when it does not exist. */
  ensure(exec: E): Promise<void>;
  list(exec: E): Promise<AppliedMigration[]>;
  record(exec: E, migration: AppliedMigration): Promise<void>;
  remove(exec: E, id: string): Promise<void>;
}

/* ------------------------------------------------------------------------ */
/* Dialect                                                                    */
/* ------------------------------------------------------------------------ */

export type DialectName = 'postgres' | 'cockroach' | 'mysql' | 'mariadb' | 'sqlite' | 'mssql' | 'oracle' | 'mongodb';

export interface DialectFeatures {
  /** INSERT/UPDATE/DELETE can return rows (RETURNING or OUTPUT). */
  returning: boolean;
  /** Includes load in the same query through JSON aggregation. */
  jsonAggregation: boolean;
  /** Native upsert (ON CONFLICT, ON DUPLICATE KEY, MERGE). */
  upsert: boolean;
  /** Native case insensitive LIKE. */
  ilike: boolean;
  transactions: boolean;
  /** Named enum types (CREATE TYPE ... AS ENUM). */
  namedEnums: boolean;
  /** DDL inside transactions is safe (Postgres, SQLite, SQL Server). */
  transactionalDdl: boolean;
  /** Accepts raw SQL through `$sql`. */
  rawSql: boolean;
  /**
   * How the database hands out generated keys. `number` (default) for SQL
   * identity columns. `string` when keys are strings, such as MongoDB
   * ObjectIds or UUIDs: the client then accepts and types `t.id()` /
   * `t.bigId()` columns, and integer columns with `.references()`, as strings.
   */
  idType?: IdType;
}

export type IdType = 'number' | 'string';

/** A compiled statement, for logging and `toSQL()`. */
export interface CompiledQuery {
  sql: string;
  params: unknown[];
}

export interface Dialect<E = Executor> {
  name: DialectName;
  features: DialectFeatures;
  /** Runs one query. The resolved value follows QueryResultMap. */
  execute(query: QueryIR, schema: SchemaIR, exec: E): Promise<unknown>;
  /**
   * Statements the query would run, without running them. Queries that need
   * results of an earlier statement (re-select after insert, IN-list include
   * loading) list the first statement only. Optional for non SQL dialects.
   */
  compile?(query: QueryIR, schema: SchemaIR): CompiledQuery[];
  /** Migration DDL statements for one op. */
  ddl(op: MigrationOpLike, schema: SchemaIR): string[];
  /** Reads the live schema. */
  introspect(exec: E): Promise<SchemaIR>;
  migrationTable: MigrationTable<E>;
  /** Splits a migration.sql script into statements the driver can run one by one. */
  splitScript?(script: string): string[];
  /** Turns a driver error into a KastorError (return null to keep the default mapping). */
  mapError?(error: unknown): Error | null;
  /** Quotes an identifier (used by `$sql` for interpolated tables and columns). */
  quoteIdent?(name: string): string;
  /** Placeholder for the n-th (1 based) parameter (used by `$sql`). */
  placeholder?(index: number): string;
  /** Encodes a JS value for a raw query parameter (used by `$sql`). */
  encodeParam?(value: unknown): unknown;
}

/** What an adapter factory returns: `postgres(pool)` gives `{ dialect, executor }`. */
export interface Adapter<E = Executor, Ids extends IdType = 'number'> {
  dialect: Dialect<E>;
  executor: E;
  /**
   * Type level marker for `features.idType`, never set at runtime. A dialect
   * whose keys are strings returns `Adapter<MyExecutor, 'string'>` so the
   * client types id columns as strings.
   */
  readonly idType?: Ids;
}
