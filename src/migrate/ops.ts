/**
 * Migration operations: the neutral steps a migration is made of.
 *
 * The diff engine (`src/migrate/diff.ts`) turns two SchemaIR snapshots into an
 * ordered list of these operations, and every dialect turns one operation into
 * DDL statements with `dialect.ddl(op, schema)`.
 *
 * Contract for dialect authors:
 * - `ddl(op, schema)` returns zero or more complete statements without a
 *   trailing semicolon. Return `[]` for operations that mean nothing to the
 *   dialect, for example `createEnum` where enums live on the column itself
 *   (`features.namedEnums === false`).
 * - `schema` is the state of the database AFTER the operation is applied (see
 *   `applyOp`). A dialect that rebuilds a table to change it (SQLite) reads the
 *   full target table from it.
 * - `createTable` creates the table with its columns, primary key, foreign keys
 *   (`table.foreignKeys`) and indexes (`table.indexes`, as CREATE INDEX
 *   statements after CREATE TABLE). The diff engine orders tables so referenced
 *   tables come first; foreign keys inside a cycle are left out of the
 *   `createTable` op and follow as `addForeignKey` once both tables exist.
 * - Unique constraints are indexes with `unique: true`.
 * - Every name in an op is a database name (after `.map()`).
 * - Statements may contain semicolons of their own (procedural blocks); the
 *   migration file writer marks them so they are read back as one statement.
 */
import type { ColumnIR, EnumIR, ForeignKeyIR, IndexIR, SchemaIR, TableIR } from '../core/ir';

export interface CreateTableOp {
  kind: 'createTable';
  table: TableIR;
}

export interface DropTableOp {
  kind: 'dropTable';
  table: string;
  /** The table as it was, for comments, warnings and dialects that need it. */
  previous?: TableIR;
}

export interface RenameTableOp {
  kind: 'renameTable';
  from: string;
  to: string;
}

export interface AddColumnOp {
  kind: 'addColumn';
  table: string;
  column: ColumnIR;
}

export interface DropColumnOp {
  kind: 'dropColumn';
  table: string;
  column: string;
  previous?: ColumnIR;
}

export interface RenameColumnOp {
  kind: 'renameColumn';
  table: string;
  from: string;
  to: string;
}

export interface AlterColumnOp {
  kind: 'alterColumn';
  table: string;
  column: string;
  from: ColumnIR;
  to: ColumnIR;
  /** Which aspects changed. A dialect may emit one statement per aspect. */
  changes: { type: boolean; nullable: boolean; default: boolean };
}

export interface CreateIndexOp {
  kind: 'createIndex';
  table: string;
  index: IndexIR;
}

export interface DropIndexOp {
  kind: 'dropIndex';
  table: string;
  index: IndexIR;
}

export interface AddForeignKeyOp {
  kind: 'addForeignKey';
  table: string;
  foreignKey: ForeignKeyIR;
}

export interface DropForeignKeyOp {
  kind: 'dropForeignKey';
  table: string;
  foreignKey: ForeignKeyIR;
}

export interface CreateEnumOp {
  kind: 'createEnum';
  enum: EnumIR;
}

export interface DropEnumOp {
  kind: 'dropEnum';
  enum: EnumIR;
}

/**
 * Changes the values of a named enum. Columns that use the enum are listed so
 * a dialect that has to recreate the type (to remove values) can convert them.
 */
export interface AlterEnumOp {
  kind: 'alterEnum';
  name: string;
  from: string[];
  to: string[];
  /** Values in `to` but not in `from`, in target order. */
  added: string[];
  /** Values in `from` but not in `to`. Removing values is destructive. */
  removed: string[];
  /** Columns typed with this enum, as `{ table, column }` database names. */
  columns: Array<{ table: string; column: string }>;
}

export interface RawOp {
  kind: 'raw';
  /** One SQL string for every dialect, or one per dialect name. */
  sql: string | Partial<Record<string, string>>;
  comment?: string;
}

export type MigrationOp =
  | CreateTableOp
  | DropTableOp
  | RenameTableOp
  | AddColumnOp
  | DropColumnOp
  | RenameColumnOp
  | AlterColumnOp
  | CreateIndexOp
  | DropIndexOp
  | AddForeignKeyOp
  | DropForeignKeyOp
  | CreateEnumOp
  | DropEnumOp
  | AlterEnumOp
  | RawOp;

export type MigrationOpKind = MigrationOp['kind'];

/** Statements of a raw op for one dialect. */
export function rawSqlFor(op: RawOp, dialect: string): string[] {
  const sql = typeof op.sql === 'string' ? op.sql : op.sql[dialect];
  return sql ? [sql] : [];
}

/** True when the op can lose data: dropping tables, columns or enum values, or narrowing a column. */
export function isDestructive(op: MigrationOp): boolean {
  switch (op.kind) {
    case 'dropTable':
    case 'dropColumn':
      return true;
    case 'alterEnum':
      return op.removed.length > 0;
    case 'alterColumn':
      return op.changes.type && !isWidening(op.from, op.to);
    default:
      return false;
  }
}

/** Type changes that never lose data. */
export function isWidening(from: ColumnIR, to: ColumnIR): boolean {
  if (from.type === to.type) {
    if (from.type === 'string') return (to.length ?? Infinity) >= (from.length ?? Infinity);
    if (from.type === 'decimal') {
      const fp = from.precision ?? 0;
      const fs = from.scale ?? 0;
      const tp = to.precision ?? Infinity;
      const ts = to.scale ?? 0;
      return ts >= fs && tp - ts >= fp - fs;
    }
    if (from.type === 'enum') return (from.enumValues ?? []).every((v) => (to.enumValues ?? []).includes(v));
    return true;
  }
  const safe: Record<string, string[]> = {
    int: ['bigint', 'float', 'decimal', 'string', 'text'],
    bigint: ['decimal', 'string', 'text'],
    float: ['string', 'text'],
    decimal: ['string', 'text'],
    string: ['text'],
    enum: ['string', 'text'],
    uuid: ['string', 'text'],
    boolean: ['string', 'text'],
    date: ['datetime', 'string', 'text'],
    time: ['string', 'text'],
  };
  if (to.type === 'string' && to.length !== undefined && from.type !== 'enum') return false;
  return safe[from.type]?.includes(to.type) ?? false;
}

/** A one line, human friendly description of an op, used in files and terminal output. */
export function describeOp(op: MigrationOp): string {
  switch (op.kind) {
    case 'createTable':
      return `Create table ${op.table.name}`;
    case 'dropTable':
      return `Drop table ${op.table}`;
    case 'renameTable':
      return `Rename table ${op.from} to ${op.to}`;
    case 'addColumn':
      return `Add column ${op.table}.${op.column.name}`;
    case 'dropColumn':
      return `Drop column ${op.table}.${op.column}`;
    case 'renameColumn':
      return `Rename column ${op.table}.${op.from} to ${op.to}`;
    case 'alterColumn': {
      const parts: string[] = [];
      if (op.changes.type) parts.push(`type ${columnTypeLabel(op.from)} to ${columnTypeLabel(op.to)}`);
      if (op.changes.nullable) parts.push(op.to.nullable ? 'make nullable' : 'make required');
      if (op.changes.default) parts.push(op.to.default ? `default ${defaultLabel(op.to)}` : 'drop default');
      return `Alter column ${op.table}.${op.column}: ${parts.join(', ')}`;
    }
    case 'createIndex':
      return `Create ${op.index.unique ? 'unique index' : 'index'} ${op.index.name} on ${op.table} (${op.index.columns.join(', ')})`;
    case 'dropIndex':
      return `Drop ${op.index.unique ? 'unique index' : 'index'} ${op.index.name} on ${op.table}`;
    case 'addForeignKey':
      return `Add foreign key ${op.foreignKey.name} on ${op.table} (${op.foreignKey.columns.join(', ')}) to ${op.foreignKey.refTable}`;
    case 'dropForeignKey':
      return `Drop foreign key ${op.foreignKey.name} on ${op.table}`;
    case 'createEnum':
      return `Create enum ${op.enum.name} (${op.enum.values.join(', ')})`;
    case 'dropEnum':
      return `Drop enum ${op.enum.name}`;
    case 'alterEnum': {
      const parts: string[] = [];
      if (op.added.length) parts.push(`add ${op.added.join(', ')}`);
      if (op.removed.length) parts.push(`remove ${op.removed.join(', ')}`);
      if (!parts.length) parts.push('reorder values');
      return `Alter enum ${op.name}: ${parts.join('; ')}`;
    }
    case 'raw':
      return op.comment ?? 'Custom SQL';
  }
}

/** `string(255)`, `decimal(10, 2)`, `enum(a, b)`, with `?` for nullable. */
export function columnTypeLabel(col: ColumnIR): string {
  let label: string = col.type;
  if (col.nativeType) label = col.nativeType;
  else if (col.type === 'string' && col.length !== undefined) label = `string(${col.length})`;
  else if (col.type === 'decimal' && col.precision !== undefined) label = `decimal(${col.precision}${col.scale !== undefined ? `, ${col.scale}` : ''})`;
  else if (col.type === 'enum' && col.enumValues) label = `enum(${col.enumValues.join(', ')})`;
  return label;
}

export function defaultLabel(col: ColumnIR): string {
  const d = col.default;
  if (!d) return 'none';
  switch (d.kind) {
    case 'now':
      return 'now()';
    case 'random':
      return 'random uuid';
    case 'autoincrement':
      return 'autoincrement';
    case 'sql':
      return String(d.value);
    default:
      return JSON.stringify(d.value);
  }
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * Applies one op to a schema snapshot and returns the new snapshot (the input
 * is not changed). The migration engine passes the result to `dialect.ddl` so
 * a dialect always sees the target state of the table it changes.
 */
export function applyOp(schema: SchemaIR, op: MigrationOp): SchemaIR {
  const next = clone(schema);
  next.tables ??= [];
  const table = (name: string): TableIR => {
    const t = next.tables.find((x) => x.name === name);
    if (!t) throw new Error(`applyOp: table ${name} does not exist`);
    return t;
  };
  const renameIn = (list: string[], from: string, to: string): string[] => list.map((c) => (c === from ? to : c));
  switch (op.kind) {
    case 'createTable':
      next.tables = next.tables.filter((t) => t.name !== op.table.name);
      next.tables.push(clone(op.table));
      break;
    case 'dropTable':
      next.tables = next.tables.filter((t) => t.name !== op.table);
      break;
    case 'renameTable':
      for (const t of next.tables) {
        if (t.name === op.from) t.name = op.to;
        for (const fk of t.foreignKeys) if (fk.refTable === op.from) fk.refTable = op.to;
      }
      for (const t of next.tables) for (const c of t.columns) if (c.type === 'enum' && !c.enumName && t.name === op.to) c.enumName = `${op.from}_${c.name}`;
      break;
    case 'addColumn':
      table(op.table).columns.push(clone(op.column));
      break;
    case 'dropColumn': {
      const t = table(op.table);
      t.columns = t.columns.filter((c) => c.name !== op.column);
      t.primaryKey = t.primaryKey.filter((c) => c !== op.column);
      t.indexes = t.indexes.filter((i) => !i.columns.includes(op.column));
      t.foreignKeys = t.foreignKeys.filter((f) => !f.columns.includes(op.column));
      break;
    }
    case 'renameColumn': {
      const t = table(op.table);
      for (const c of t.columns) if (c.name === op.from) c.name = op.to;
      t.primaryKey = renameIn(t.primaryKey, op.from, op.to);
      for (const i of t.indexes) i.columns = renameIn(i.columns, op.from, op.to);
      for (const f of t.foreignKeys) f.columns = renameIn(f.columns, op.from, op.to);
      for (const other of next.tables) for (const f of other.foreignKeys) if (f.refTable === op.table) f.refColumns = renameIn(f.refColumns, op.from, op.to);
      break;
    }
    case 'alterColumn': {
      const t = table(op.table);
      t.columns = t.columns.map((c) => (c.name === op.column ? clone(op.to) : c));
      break;
    }
    case 'createIndex':
      table(op.table).indexes.push(clone(op.index));
      break;
    case 'dropIndex': {
      const t = table(op.table);
      t.indexes = t.indexes.filter((i) => i.name !== op.index.name);
      break;
    }
    case 'addForeignKey':
      table(op.table).foreignKeys.push(clone(op.foreignKey));
      break;
    case 'dropForeignKey': {
      const t = table(op.table);
      t.foreignKeys = t.foreignKeys.filter((f) => f.name !== op.foreignKey.name);
      break;
    }
    case 'createEnum':
      next.enums = [...(next.enums ?? []).filter((e) => e.name !== op.enum.name), clone(op.enum)];
      break;
    case 'dropEnum':
      next.enums = (next.enums ?? []).filter((e) => e.name !== op.enum.name);
      break;
    case 'alterEnum':
      next.enums = (next.enums ?? []).map((e) => (e.name === op.name ? { name: e.name, values: [...op.to] } : e));
      for (const ref of op.columns) {
        const col = next.tables.find((t) => t.name === ref.table)?.columns.find((c) => c.name === ref.column);
        if (col) col.enumValues = [...op.to];
      }
      break;
    case 'raw':
      break;
  }
  return next;
}
