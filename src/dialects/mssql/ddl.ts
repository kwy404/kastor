import type { ColumnIR, ForeignKeyIR, IndexIR, MigrationOpLike, SchemaIR, TableIR } from '../../core/ir';
import type { MigrationOp } from '../../migrate/ops';

/** `[name]`, with `]` doubled. */
export function quoteIdent(name: string): string {
  return '[' + name.replace(/]/g, ']]') + ']';
}

/** An nvarchar literal. */
export function quoteString(value: string): string {
  return "N'" + value.replace(/'/g, "''") + "'";
}

/** A plain varchar literal for object names inside catalog lookups. */
function nameLiteral(value: string): string {
  return "N'" + value.replace(/'/g, "''") + "'";
}

export function columnType(col: ColumnIR): string {
  if (col.nativeType) return col.nativeType;
  switch (col.type) {
    case 'string':
      return `NVARCHAR(${col.length ?? 255})`;
    case 'text':
      return 'NVARCHAR(MAX)';
    case 'int':
      return 'INT';
    case 'bigint':
      return 'BIGINT';
    case 'float':
      return 'FLOAT';
    case 'decimal':
      return `DECIMAL(${col.precision ?? 38}, ${col.scale ?? (col.precision === undefined ? 10 : 0)})`;
    case 'boolean':
      return 'BIT';
    case 'datetime':
      return 'DATETIME2(3)';
    case 'date':
      return 'DATE';
    case 'time':
      return 'TIME(0)';
    case 'json':
      return 'NVARCHAR(MAX)';
    case 'bytes':
      return 'VARBINARY(MAX)';
    case 'uuid':
      return 'UNIQUEIDENTIFIER';
    case 'enum':
      return `NVARCHAR(${Math.max(1, ...(col.enumValues ?? []).map((v) => v.length))})`;
  }
}

export function literal(value: unknown, col: ColumnIR): string {
  if (value === null || value === undefined) return 'NULL';
  if (col.type === 'boolean') return value === true || value === 1 || value === '1' || value === 'true' ? '1' : '0';
  if (col.type === 'json') return quoteString(typeof value === 'string' ? value : JSON.stringify(value));
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (value instanceof Date) return quoteString(value.toISOString().replace('Z', ''));
  if (value instanceof Uint8Array) return '0x' + Buffer.from(value).toString('hex');
  if (col.type === 'datetime' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value)) return quoteString(value.replace('Z', ''));
  return quoteString(String(value));
}

/** Name of the default constraint kastor creates for a column. */
export const defaultName = (table: string, column: string) => `DF_${table}_${column}`;
/** Name of the check constraint kastor creates for enum, json and similar columns. */
export const checkName = (table: string, column: string) => `CK_${table}_${column}`;

export function defaultExpression(col: ColumnIR): string | undefined {
  const def = col.default;
  if (!def || def.kind === 'autoincrement') return undefined;
  switch (def.kind) {
    case 'now':
      if (col.type === 'date') return 'CAST(SYSUTCDATETIME() AS DATE)';
      if (col.type === 'time') return 'CAST(SYSUTCDATETIME() AS TIME(0))';
      return 'SYSUTCDATETIME()';
    case 'random':
      return 'NEWID()';
    case 'sql':
      return String(def.value);
    case 'value':
      return literal(def.value, col);
  }
}

/** The CHECK a column needs: allowed enum values, valid JSON. */
export function checkExpression(col: ColumnIR): string | undefined {
  if (col.nativeType) return undefined;
  if (col.type === 'enum') return `${quoteIdent(col.name)} IN (${(col.enumValues ?? []).map(quoteString).join(', ')})`;
  if (col.type === 'json') return `ISJSON(${quoteIdent(col.name)}) = 1`;
  return undefined;
}

export function columnDefinition(table: string, col: ColumnIR): string {
  let sql = `${quoteIdent(col.name)} ${columnType(col)}`;
  if (col.default?.kind === 'autoincrement') sql += ' IDENTITY(1, 1)';
  sql += col.nullable ? ' NULL' : ' NOT NULL';
  const def = defaultExpression(col);
  if (def !== undefined) sql += ` CONSTRAINT ${quoteIdent(defaultName(table, col.name))} DEFAULT ${def}`;
  const check = checkExpression(col);
  if (check) sql += ` CONSTRAINT ${quoteIdent(checkName(table, col.name))} CHECK (${check})`;
  return sql;
}

const actions: Record<ForeignKeyIR['onDelete'], string> = {
  cascade: 'CASCADE',
  // SQL Server has no RESTRICT; NO ACTION checks at the end of the statement, which is the same for single statements.
  restrict: 'NO ACTION',
  'set null': 'SET NULL',
  'set default': 'SET DEFAULT',
  'no action': 'NO ACTION',
};

const list = (names: string[]) => names.map(quoteIdent).join(', ');

/**
 * SQL Server refuses cascading actions on a foreign key that points back to
 * its own table, that closes a cycle, or that would give a row two cascade
 * paths (errors 1785 and 1787). kastor walks the keys of the schema in order
 * and turns the action of each key that would break one of those rules into
 * NO ACTION, so the table can still be created. Deleting a parent then fails
 * while children exist, instead of silently skipping them.
 */
export function foreignKeyAction(table: string, fk: ForeignKeyIR, which: 'onDelete' | 'onUpdate', schema?: SchemaIR): string {
  const action = fk[which];
  if (action === 'restrict' || action === 'no action') return actions[action];
  if (fk.refTable === table) return 'NO ACTION';
  if (schema && degradedKeys(schema, which).has(`${table}\u0000${fk.name}`)) return 'NO ACTION';
  return actions[action];
}

/** Keys (`table NUL name`) whose cascading action SQL Server would reject, in schema order. */
export function degradedKeys(schema: SchemaIR, which: 'onDelete' | 'onUpdate'): Set<string> {
  const degraded = new Set<string>();
  // Kept cascading edges: parent table -> child tables.
  const edges = new Map<string, string[]>();
  const reach = (start: string): Set<string> => {
    const seen = new Set<string>();
    const queue = [start];
    while (queue.length) {
      for (const next of edges.get(queue.shift()!) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return seen;
  };
  for (const t of schema.tables) {
    for (const fk of t.foreignKeys) {
      const action = fk[which];
      if (action === 'restrict' || action === 'no action' || fk.refTable === t.name) continue;
      const parent = fk.refTable;
      const child = t.name;
      // Every table whose delete already reaches `parent`, plus `parent` itself.
      const sources = [parent, ...schema.tables.map((x) => x.name).filter((name) => name !== parent && reach(name).has(parent))];
      const conflict = reach(child).has(parent) || sources.some((source) => source === child || reach(source).has(child));
      if (conflict) degraded.add(`${child}\u0000${fk.name}`);
      else edges.set(parent, [...(edges.get(parent) ?? []), child]);
    }
  }
  return degraded;
}

export function foreignKeyClause(table: string, fk: ForeignKeyIR, schema?: SchemaIR): string {
  return `CONSTRAINT ${quoteIdent(fk.name)} FOREIGN KEY (${list(fk.columns)}) REFERENCES ${quoteIdent(fk.refTable)} (${list(fk.refColumns)}) ON DELETE ${foreignKeyAction(table, fk, 'onDelete', schema)} ON UPDATE ${foreignKeyAction(table, fk, 'onUpdate', schema)}`;
}

/**
 * Unique indexes in SQL Server allow a single NULL. kastor filters NULLs out
 * of unique indexes on nullable columns so they behave like every other
 * database: many NULLs, unique values otherwise.
 */
export function createIndex(table: TableIR | undefined, tableName: string, index: IndexIR): string {
  let sql = `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${quoteIdent(index.name)} ON ${quoteIdent(tableName)} (${list(index.columns)})`;
  if (index.unique && table) {
    const nullable = index.columns.filter((c) => table.columns.find((col) => col.name === c)?.nullable);
    if (nullable.length) sql += ` WHERE ${nullable.map((c) => `${quoteIdent(c)} IS NOT NULL`).join(' AND ')}`;
  }
  return sql;
}

export function createTable(table: TableIR, schema?: SchemaIR): string[] {
  const lines = table.columns.map((c) => '  ' + columnDefinition(table.name, c));
  if (table.primaryKey.length) lines.push(`  CONSTRAINT ${quoteIdent(`PK_${table.name}`)} PRIMARY KEY (${list(table.primaryKey)})`);
  for (const fk of table.foreignKeys) lines.push('  ' + foreignKeyClause(table.name, fk, schema));
  const statements = [`CREATE TABLE ${quoteIdent(table.name)} (\n${lines.join(',\n')}\n)`];
  for (const index of table.indexes) statements.push(createIndex(table, table.name, index));
  return statements;
}

/**
 * Drops every default and check constraint on a column, whatever its name
 * (constraints made outside kastor get generated names). One T-SQL block.
 */
export function dropColumnConstraints(table: string, column: string, kinds: Array<'default' | 'check'> = ['default', 'check']): string {
  const parts: string[] = [];
  const t = nameLiteral(table);
  const c = nameLiteral(column);
  if (kinds.includes('default')) {
    parts.push(
      `SELECT @sql = @sql + N'ALTER TABLE ' + QUOTENAME(OBJECT_SCHEMA_NAME(d.parent_object_id)) + N'.' + QUOTENAME(OBJECT_NAME(d.parent_object_id)) + N' DROP CONSTRAINT ' + QUOTENAME(d.name) + N';' FROM sys.default_constraints d JOIN sys.columns col ON col.object_id = d.parent_object_id AND col.column_id = d.parent_column_id WHERE d.parent_object_id = OBJECT_ID(${t}) AND col.name = ${c};`,
    );
  }
  if (kinds.includes('check')) {
    parts.push(
      `SELECT @sql = @sql + N'ALTER TABLE ' + QUOTENAME(OBJECT_SCHEMA_NAME(k.parent_object_id)) + N'.' + QUOTENAME(OBJECT_NAME(k.parent_object_id)) + N' DROP CONSTRAINT ' + QUOTENAME(k.name) + N';' FROM sys.check_constraints k JOIN sys.columns col ON col.object_id = k.parent_object_id AND col.column_id = k.parent_column_id WHERE k.parent_object_id = OBJECT_ID(${t}) AND col.name = ${c};`,
    );
  }
  return `DECLARE @sql NVARCHAR(MAX) = N'';\n${parts.join('\n')}\nEXEC sp_executesql @sql;`;
}

function alterColumn(op: Extract<MigrationOp, { kind: 'alterColumn' }>, schema: SchemaIR): string[] {
  const t = quoteIdent(op.table);
  const table = schema.tables.find((x) => x.name === op.table);
  const col: ColumnIR = { ...op.to, name: op.column };
  const statements: string[] = [];
  const typeOrNull = op.changes.type || op.changes.nullable;
  // Constraints and indexes that depend on the column block ALTER COLUMN.
  const touchingIndexes = typeOrNull ? (table?.indexes ?? []).filter((i) => i.columns.includes(op.column)) : [];
  const kinds: Array<'default' | 'check'> = [];
  if (op.changes.default || op.changes.type) kinds.push('default');
  if (op.changes.type) kinds.push('check');
  if (kinds.length) statements.push(dropColumnConstraints(op.table, op.column, kinds));
  for (const index of touchingIndexes) statements.push(`DROP INDEX IF EXISTS ${quoteIdent(index.name)} ON ${t}`);
  if (typeOrNull) statements.push(`ALTER TABLE ${t} ALTER COLUMN ${quoteIdent(op.column)} ${columnType(col)}${col.nullable ? ' NULL' : ' NOT NULL'}`);
  if (kinds.includes('default')) {
    const def = defaultExpression(col);
    if (def !== undefined) statements.push(`ALTER TABLE ${t} ADD CONSTRAINT ${quoteIdent(defaultName(op.table, op.column))} DEFAULT ${def} FOR ${quoteIdent(op.column)}`);
  }
  if (kinds.includes('check')) {
    const check = checkExpression(col);
    if (check) statements.push(`ALTER TABLE ${t} ADD CONSTRAINT ${quoteIdent(checkName(op.table, op.column))} CHECK (${check})`);
  }
  for (const index of touchingIndexes) statements.push(createIndex(table, op.table, index));
  return statements;
}

/** Migration DDL for SQL Server. */
export function mssqlDdl(input: MigrationOpLike, schema: SchemaIR): string[] {
  const op = input as unknown as MigrationOp;
  const t = (name: string) => quoteIdent(name);
  switch (op.kind) {
    case 'createTable':
      return createTable(op.table, schema);
    case 'dropTable':
      return [`DROP TABLE ${t(op.table)}`];
    case 'renameTable':
      return [`EXEC sp_rename ${nameLiteral(op.from)}, ${nameLiteral(op.to)}`];
    case 'addColumn':
      return [`ALTER TABLE ${t(op.table)} ADD ${columnDefinition(op.table, op.column)}`];
    case 'dropColumn':
      return [dropColumnConstraints(op.table, op.column), `ALTER TABLE ${t(op.table)} DROP COLUMN ${t(op.column)}`];
    case 'renameColumn':
      return [`EXEC sp_rename ${nameLiteral(`${op.table}.${op.from}`)}, ${nameLiteral(op.to)}, 'COLUMN'`];
    case 'alterColumn':
      return alterColumn(op, schema);
    case 'createIndex':
      return [createIndex(schema.tables.find((x) => x.name === op.table), op.table, op.index)];
    case 'dropIndex':
      return [`DROP INDEX ${t(op.index.name)} ON ${t(op.table)}`];
    case 'addForeignKey':
      return [`ALTER TABLE ${t(op.table)} ADD ${foreignKeyClause(op.table, op.foreignKey, schema)}`];
    case 'dropForeignKey':
      return [`ALTER TABLE ${t(op.table)} DROP CONSTRAINT ${t(op.foreignKey.name)}`];
    case 'createEnum':
    case 'dropEnum':
    case 'alterEnum':
      // Enums are a CHECK on the column; alterColumn rewrites it.
      return [];
    case 'raw': {
      const sql = typeof op.sql === 'string' ? op.sql : op.sql.mssql;
      return sql ? [sql] : [];
    }
    default:
      throw new Error(`kastor: unknown migration op "${(op as { kind: string }).kind}"`);
  }
}
