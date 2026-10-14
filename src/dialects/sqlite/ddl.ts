import type { ColumnIR, ForeignKeyIR, IndexIR, MigrationOpLike, SchemaIR, TableIR } from '../../core/ir';
import type { MigrationOp } from '../../migrate/ops';

export const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;

export const quoteString = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/** Marks a bigint auto increment key, which SQLite can only declare as INTEGER. */
export const BIGINT_MARKER = '/* kastor:bigint */';

/** `strftime` with milliseconds gives the same text as `Date#toISOString()`. */
export const NOW_DATETIME = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";
export const NOW_DATE = "(date('now'))";
export const NOW_TIME = "(time('now'))";

/** A random version 4 UUID in plain SQLite SQL, used for `defaultRandom()`. */
export const RANDOM_UUID =
  "(lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || " +
  "substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))))";

const actions: Record<string, string> = {
  cascade: 'CASCADE',
  restrict: 'RESTRICT',
  'set null': 'SET NULL',
  'set default': 'SET DEFAULT',
  'no action': 'NO ACTION',
};

export function enumConstraintName(table: string, column: ColumnIR): string {
  return column.enumName ?? `${table}_${column.name}`;
}

/** Declared column type. SQLite keeps it verbatim, which lets introspection read the neutral type back. */
export function columnType(column: ColumnIR): string {
  if (column.nativeType) return column.nativeType;
  switch (column.type) {
    case 'string':
      return column.length !== undefined ? `VARCHAR(${column.length})` : 'VARCHAR';
    case 'text':
    case 'enum':
      return 'TEXT';
    case 'int':
      return 'INTEGER';
    case 'bigint':
      return 'BIGINT';
    case 'float':
      return 'REAL';
    case 'decimal':
      if (column.precision === undefined) return 'DECIMAL';
      return column.scale !== undefined ? `DECIMAL(${column.precision}, ${column.scale})` : `DECIMAL(${column.precision})`;
    case 'boolean':
      return 'BOOLEAN';
    case 'datetime':
      return 'DATETIME';
    case 'date':
      return 'DATE';
    case 'time':
      return 'TIME';
    case 'json':
      return 'JSON';
    case 'bytes':
      return 'BLOB';
    case 'uuid':
      return 'UUID';
  }
}

export function defaultSql(column: ColumnIR): string | undefined {
  const d = column.default;
  if (!d) return undefined;
  switch (d.kind) {
    case 'autoincrement':
      return undefined;
    case 'now':
      return column.type === 'date' ? NOW_DATE : column.type === 'time' ? NOW_TIME : NOW_DATETIME;
    case 'random':
      return RANDOM_UUID;
    case 'sql': {
      const expression = String(d.value).trim();
      return /^\(.*\)$/s.test(expression) ? expression : `(${expression})`;
    }
    case 'value':
      return literal(column, d.value);
  }
}

export function literal(column: ColumnIR, value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  switch (column.type) {
    case 'int':
    case 'float':
      return String(Number(value));
    case 'bigint':
      return String(BigInt(value as string | number));
    case 'decimal':
      return /^-?\d+(\.\d+)?$/.test(String(value)) ? String(value) : quoteString(String(value));
    case 'boolean':
      return value ? '1' : '0';
    case 'json':
      return quoteString(JSON.stringify(value));
    case 'bytes': {
      const bytes = Array.isArray(value) ? (value as number[]) : Array.from(value as Uint8Array);
      return `X'${bytes.map((b) => b.toString(16).padStart(2, '0')).join('')}'`;
    }
    case 'datetime':
      return quoteString(value instanceof Date ? value.toISOString() : String(value));
    default:
      return quoteString(String(value));
  }
}

const isAutoincrement = (column: ColumnIR) => column.default?.kind === 'autoincrement';

/** The single column auto increment key, declared inline as INTEGER PRIMARY KEY AUTOINCREMENT. */
function inlineKey(table: TableIR): ColumnIR | undefined {
  if (table.primaryKey.length !== 1) return undefined;
  const column = table.columns.find((c) => c.name === table.primaryKey[0]);
  return column && isAutoincrement(column) ? column : undefined;
}

export function columnDefinition(table: string, column: ColumnIR, inlinePrimaryKey = false): string {
  const parts = [quoteIdent(column.name)];
  if (inlinePrimaryKey) {
    parts.push('INTEGER');
    if (!column.nullable) parts.push('NOT NULL');
    parts.push('PRIMARY KEY AUTOINCREMENT');
    if (column.type === 'bigint') parts.push(BIGINT_MARKER);
  } else {
    parts.push(columnType(column));
    if (!column.nullable) parts.push('NOT NULL');
  }
  const def = defaultSql(column);
  if (def !== undefined) parts.push(`DEFAULT ${def}`);
  if (column.type === 'enum' && column.enumValues) {
    const name = quoteIdent(enumConstraintName(table, column));
    parts.push(`CONSTRAINT ${name} CHECK (${quoteIdent(column.name)} IN (${column.enumValues.map(quoteString).join(', ')}))`);
  }
  return parts.join(' ');
}

function foreignKeyClause(fk: ForeignKeyIR): string {
  return (
    `CONSTRAINT ${quoteIdent(fk.name)} FOREIGN KEY (${fk.columns.map(quoteIdent).join(', ')}) ` +
    `REFERENCES ${quoteIdent(fk.refTable)} (${fk.refColumns.map(quoteIdent).join(', ')}) ` +
    `ON DELETE ${actions[fk.onDelete] ?? 'NO ACTION'} ON UPDATE ${actions[fk.onUpdate] ?? 'NO ACTION'}`
  );
}

export function createIndexSql(table: string, index: IndexIR): string {
  return `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${quoteIdent(index.name)} ON ${quoteIdent(table)} (${index.columns.map(quoteIdent).join(', ')})`;
}

/** CREATE TABLE without its indexes. */
export function createTableStatement(table: TableIR, name = table.name): string {
  const key = inlineKey(table);
  const lines = table.columns.map((c) => `  ${columnDefinition(table.name, c, c === key)}`);
  if (!key && table.primaryKey.length > 0) lines.push(`  PRIMARY KEY (${table.primaryKey.map(quoteIdent).join(', ')})`);
  for (const fk of table.foreignKeys) lines.push(`  ${foreignKeyClause(fk)}`);
  return `CREATE TABLE ${quoteIdent(name)} (\n${lines.join(',\n')}\n)`;
}

export function createTableSql(table: TableIR): string[] {
  return [createTableStatement(table), ...table.indexes.map((i) => createIndexSql(table.name, i))];
}

/**
 * Rebuilds a table for changes SQLite cannot make in place (column types,
 * nullability, defaults, foreign keys, enum checks, dropping columns), with
 * the procedure from the SQLite manual: create the new shape under a temporary
 * name, copy the rows, drop the old table, rename the new one and recreate
 * the indexes.
 *
 * Foreign keys must be OFF while this runs, otherwise dropping the old table
 * fires ON DELETE actions in the tables that point at it. `PRAGMA foreign_keys`
 * is ignored inside a transaction, so the migration runner turns it off before
 * BEGIN (see `needsForeignKeysOff`). When other tables reference the rebuilt
 * one, a guard statement stops the migration if foreign keys are still on,
 * instead of letting a cascade delete rows.
 *
 * `copy` lists the columns that exist in both the old and the new table.
 */
export function rebuildTable(table: TableIR, copy: string[], schema: SchemaIR): string[] {
  const temp = `__kastor_new_${table.name}`;
  const columns = copy.map(quoteIdent).join(', ');
  const out = [FOREIGN_KEYS_OFF];
  const referenced = schema.tables.some((t) => t.name !== table.name && t.foreignKeys.some((fk) => fk.refTable === table.name));
  if (referenced) out.push(foreignKeysGuard(table.name));
  out.push(createTableStatement(table, temp));
  if (copy.length > 0) out.push(`INSERT INTO ${quoteIdent(temp)} (${columns}) SELECT ${columns} FROM ${quoteIdent(table.name)}`);
  out.push(`DROP TABLE ${quoteIdent(table.name)}`);
  out.push(`ALTER TABLE ${quoteIdent(temp)} RENAME TO ${quoteIdent(table.name)}`);
  out.push(...table.indexes.map((i) => createIndexSql(table.name, i)));
  out.push(FOREIGN_KEYS_ON);
  return out;
}

export const FOREIGN_KEYS_OFF = 'PRAGMA foreign_keys = OFF';
export const FOREIGN_KEYS_ON = 'PRAGMA foreign_keys = ON';

/** True when a migration script rebuilds tables and must run with foreign keys off, outside a transaction. */
export function needsForeignKeysOff(statements: readonly string[]): boolean {
  return statements.some((s) => /^\s*PRAGMA\s+foreign_keys\s*=\s*(OFF|0|false)\b/i.test(s));
}

/**
 * Fails with a readable message when foreign keys are still enforced. SQLite
 * has no RAISE outside triggers; a bad JSON path error carries our text.
 */
export function foreignKeysGuard(table: string): string {
  const message = `kastor: rebuilding table ${table} needs foreign keys off. Run PRAGMA foreign_keys = OFF before BEGIN, or apply the migration with kastor migrate`;
  return `SELECT json_extract('{}', ${quoteString(message)}) FROM pragma_foreign_keys WHERE foreign_keys = 1`;
}

function findTable(schema: SchemaIR, name: string): TableIR {
  const table = schema.tables.find((t) => t.name === name);
  if (!table) throw new TypeError(`SQLite DDL needs the target state of table "${name}", which is missing from the schema.`);
  return table;
}

/** ADD COLUMN works in place unless the column is a key, unique, or has a non constant default. */
function canAddInPlace(column: ColumnIR): boolean {
  if (isAutoincrement(column)) return false;
  const def = column.default;
  // SQLite rejects parenthesized expressions as defaults of added columns.
  if (def && def.kind !== 'value') return false;
  // NOT NULL needs a non null default to fill existing rows.
  if (!column.nullable && (!def || def.value === null || def.value === undefined)) return false;
  return true;
}

/** DDL statements for one migration op. `schema` is the state after the op. */
export function sqliteDdl(opLike: MigrationOpLike, schema: SchemaIR): string[] {
  const op = opLike as unknown as MigrationOp;
  switch (op.kind) {
    case 'createTable':
      return createTableSql(op.table);
    case 'dropTable':
      return [`DROP TABLE ${quoteIdent(op.table)}`];
    case 'renameTable':
      return [`ALTER TABLE ${quoteIdent(op.from)} RENAME TO ${quoteIdent(op.to)}`];
    case 'addColumn': {
      const table = schema.tables.find((t) => t.name === op.table);
      if (canAddInPlace(op.column) || !table) {
        return [`ALTER TABLE ${quoteIdent(op.table)} ADD COLUMN ${columnDefinition(op.table, op.column)}`];
      }
      return rebuildTable(
        table,
        table.columns.filter((c) => c.name !== op.column.name).map((c) => c.name),
        schema,
      );
    }
    case 'dropColumn': {
      const table = findTable(schema, op.table);
      return rebuildTable(
        table,
        table.columns.map((c) => c.name),
        schema,
      );
    }
    case 'renameColumn':
      return [`ALTER TABLE ${quoteIdent(op.table)} RENAME COLUMN ${quoteIdent(op.from)} TO ${quoteIdent(op.to)}`];
    case 'alterColumn':
    case 'addForeignKey':
    case 'dropForeignKey': {
      const table = findTable(schema, op.table);
      return rebuildTable(
        table,
        table.columns.map((c) => c.name),
        schema,
      );
    }
    case 'createIndex':
      return [createIndexSql(op.table, op.index)];
    case 'dropIndex':
      return [`DROP INDEX ${quoteIdent(op.index.name)}`];
    case 'createEnum':
    case 'dropEnum':
      // Enums live on the column as CHECK constraints.
      return [];
    case 'alterEnum': {
      const out: string[] = [];
      const tables = [...new Set(op.columns.map((c) => c.table))];
      for (const name of tables) {
        const table = findTable(schema, name);
        out.push(
          ...rebuildTable(
            table,
            table.columns.map((c) => c.name),
            schema,
          ),
        );
      }
      return out;
    }
    case 'raw': {
      const sql = typeof op.sql === 'string' ? op.sql : op.sql.sqlite;
      return sql ? [sql] : [];
    }
    default:
      throw new TypeError(`Unknown migration op "${(opLike as { kind: string }).kind}"`);
  }
}
