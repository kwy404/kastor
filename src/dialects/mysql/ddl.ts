import type { ColumnIR, ForeignKeyIR, IndexIR, MigrationOpLike, SchemaIR, TableIR } from '../../core/ir';
import type { MigrationOp } from '../../migrate/ops';

export type MysqlFlavor = 'mysql' | 'mariadb';

/** `name` in backticks, with embedded backticks doubled. */
export function quoteIdent(name: string): string {
  return '`' + name.replace(/`/g, '``') + '`';
}

/** A string literal. Backslashes are doubled so the text is the same with or without NO_BACKSLASH_ESCAPES. */
export function quoteString(value: string): string {
  return "'" + value.replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
}

/** The native column type for a neutral column. */
export function columnType(col: ColumnIR, _flavor: MysqlFlavor): string {
  if (col.nativeType) return col.nativeType;
  switch (col.type) {
    case 'string':
      return `VARCHAR(${col.length ?? 255})`;
    case 'text':
      return 'LONGTEXT';
    case 'int':
      return 'INT';
    case 'bigint':
      return 'BIGINT';
    case 'float':
      return 'DOUBLE';
    case 'decimal':
      return `DECIMAL(${col.precision ?? 65}, ${col.scale ?? (col.precision === undefined ? 30 : 0)})`;
    case 'boolean':
      return 'TINYINT(1)';
    case 'datetime':
      return 'DATETIME(3)';
    case 'date':
      return 'DATE';
    case 'time':
      return 'TIME';
    case 'json':
      // MariaDB turns JSON into LONGTEXT plus a json_valid() check on its own.
      return 'JSON';
    case 'bytes':
      return 'LONGBLOB';
    case 'uuid':
      return 'CHAR(36)';
    case 'enum':
      return `ENUM(${(col.enumValues ?? []).map(quoteString).join(', ')})`;
  }
}

/** Types that only take an expression default (written in parentheses). */
const EXPRESSION_DEFAULT_TYPES = new Set(['text', 'json', 'bytes']);

const NUMERIC_TYPES = new Set(['int', 'bigint', 'float', 'decimal']);

export function literal(value: unknown, col: ColumnIR): string {
  if (value === null || value === undefined) return 'NULL';
  if (col.type === 'boolean') return value === true || value === 1 || value === '1' || value === 'true' ? '1' : '0';
  if (col.type === 'json') return quoteString(typeof value === 'string' ? value : JSON.stringify(value));
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (NUMERIC_TYPES.has(col.type) && typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) return value;
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (value instanceof Date) return quoteString(formatDateTime(value));
  if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString('hex')}'`;
  if (col.type === 'datetime' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return quoteString(formatDateTime(date));
  }
  return quoteString(String(value));
}

/** `YYYY-MM-DD HH:MM:SS.mmm` in UTC, the form DATETIME(3) stores. */
export function formatDateTime(date: Date): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

export function defaultClause(col: ColumnIR): string {
  const def = col.default;
  if (!def) return '';
  switch (def.kind) {
    case 'autoincrement':
      return ' AUTO_INCREMENT';
    case 'now':
      // kastor keeps datetimes in UTC whatever the session time zone is.
      if (col.type === 'date') return ' DEFAULT (UTC_DATE())';
      if (col.type === 'time') return ' DEFAULT (UTC_TIME())';
      return ' DEFAULT (UTC_TIMESTAMP(3))';
    case 'random':
      return ' DEFAULT (UUID())';
    case 'sql':
      return ` DEFAULT (${String(def.value)})`;
    case 'value': {
      const text = literal(def.value, col);
      return EXPRESSION_DEFAULT_TYPES.has(col.type) && text !== 'NULL' ? ` DEFAULT (${text})` : ` DEFAULT ${text}`;
    }
  }
}

export function columnDefinition(col: ColumnIR, flavor: MysqlFlavor): string {
  return `${quoteIdent(col.name)} ${columnType(col, flavor)}${col.nullable ? ' NULL' : ' NOT NULL'}${defaultClause(col)}`;
}

const actions: Record<ForeignKeyIR['onDelete'], string> = {
  cascade: 'CASCADE',
  restrict: 'RESTRICT',
  'set null': 'SET NULL',
  'set default': 'SET DEFAULT',
  'no action': 'NO ACTION',
};

const list = (names: string[]) => names.map(quoteIdent).join(', ');

export function foreignKeyClause(fk: ForeignKeyIR): string {
  return `CONSTRAINT ${quoteIdent(fk.name)} FOREIGN KEY (${list(fk.columns)}) REFERENCES ${quoteIdent(fk.refTable)} (${list(fk.refColumns)}) ON DELETE ${actions[fk.onDelete]} ON UPDATE ${actions[fk.onUpdate]}`;
}

export function createIndex(table: string, index: IndexIR): string {
  return `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${quoteIdent(index.name)} ON ${quoteIdent(table)} (${list(index.columns)})`;
}

export function createTable(table: TableIR, flavor: MysqlFlavor): string[] {
  const lines = table.columns.map((c) => '  ' + columnDefinition(c, flavor));
  if (table.primaryKey.length) lines.push(`  PRIMARY KEY (${list(table.primaryKey)})`);
  for (const fk of table.foreignKeys) lines.push('  ' + foreignKeyClause(fk));
  const statements = [`CREATE TABLE ${quoteIdent(table.name)} (\n${lines.join(',\n')}\n) DEFAULT CHARSET = utf8mb4`];
  for (const index of table.indexes) statements.push(createIndex(table.name, index));
  return statements;
}

/** True when an index (or the primary key) starts with `columns`, so InnoDB can use it for a foreign key. */
export function hasUsableIndex(table: TableIR, columns: string[]): boolean {
  const starts = (cols: string[]) => columns.every((c, i) => cols[i] === c);
  return starts(table.primaryKey) || table.indexes.some((i) => starts(i.columns));
}

/** Migration DDL for MySQL and MariaDB. */
export function mysqlDdl(flavor: MysqlFlavor): (op: MigrationOpLike, schema: SchemaIR) => string[] {
  return (input, schema) => {
    const op = input as unknown as MigrationOp;
    const t = (name: string) => quoteIdent(name);
    switch (op.kind) {
      case 'createTable':
        return createTable(op.table, flavor);
      case 'dropTable':
        return [`DROP TABLE ${t(op.table)}`];
      case 'renameTable':
        return [`RENAME TABLE ${t(op.from)} TO ${t(op.to)}`];
      case 'addColumn':
        return [`ALTER TABLE ${t(op.table)} ADD COLUMN ${columnDefinition(op.column, flavor)}`];
      case 'dropColumn':
        return [`ALTER TABLE ${t(op.table)} DROP COLUMN ${t(op.column)}`];
      case 'renameColumn':
        return [`ALTER TABLE ${t(op.table)} RENAME COLUMN ${t(op.from)} TO ${t(op.to)}`];
      case 'alterColumn':
        // MODIFY restates the whole column, so one statement covers type, null and default.
        return [`ALTER TABLE ${t(op.table)} MODIFY COLUMN ${columnDefinition({ ...op.to, name: op.column }, flavor)}`];
      case 'createIndex':
        return [createIndex(op.table, op.index)];
      case 'dropIndex':
        return [`DROP INDEX ${t(op.index.name)} ON ${t(op.table)}`];
      case 'addForeignKey':
        return [`ALTER TABLE ${t(op.table)} ADD ${foreignKeyClause(op.foreignKey)}`];
      case 'dropForeignKey': {
        const statements = [`ALTER TABLE ${t(op.table)} DROP FOREIGN KEY ${t(op.foreignKey.name)}`];
        // InnoDB created an index named after the key when no index could serve it; it outlives the key.
        const table = schema.tables.find((x) => x.name === op.table);
        if (table && !hasUsableIndex(table, op.foreignKey.columns) && !table.indexes.some((i) => i.name === op.foreignKey.name)) {
          statements.push(`DROP INDEX ${t(op.foreignKey.name)} ON ${t(op.table)}`);
        }
        return statements;
      }
      case 'createEnum':
      case 'dropEnum':
      case 'alterEnum':
        // Enums live on the column (ENUM(...)); alterColumn changes their values.
        return [];
      case 'raw': {
        const sql = typeof op.sql === 'string' ? op.sql : (op.sql[flavor] ?? (flavor === 'mariadb' ? op.sql.mysql : undefined));
        return sql ? [sql] : [];
      }
      default:
        throw new Error(`kastor: unknown migration op "${(op as { kind: string }).kind}"`);
    }
  };
}
