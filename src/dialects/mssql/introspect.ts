import type { ColumnDefaultIR, ColumnIR, Executor, ForeignKeyIR, IndexIR, NeutralType, ReferentialAction, SchemaIR, TableIR } from '../../core/ir';

type RawRow = Record<string, unknown>;
const str = (row: RawRow, key: string): string => (row[key] === null || row[key] === undefined ? '' : String(row[key]));
const num = (row: RawRow, key: string): number => Number(row[key] ?? 0);

/** Strips the parentheses SQL Server wraps around stored default and check expressions. */
export function unwrap(expression: string): string {
  let s = expression.trim();
  while (s.startsWith('(') && s.endsWith(')') && balanced(s.slice(1, -1))) s = s.slice(1, -1).trim();
  return s;
}

function balanced(s: string): boolean {
  let depth = 0;
  let quoted = false;
  for (const ch of s) {
    if (ch === "'") quoted = !quoted;
    if (quoted) continue;
    if (ch === '(') depth++;
    if (ch === ')' && --depth < 0) return false;
  }
  return depth === 0;
}

/**
 * Reads the allowed values out of an enum check. SQL Server stores
 * `[c] IN (N'a', N'b')` as `([c]=N'b' OR [c]=N'a')`, last value first.
 */
export function parseEnumCheck(definition: string, column: string): string[] | undefined {
  const body = unwrap(definition);
  const quotedColumn = '[' + column.replace(/]/g, ']]') + ']';
  const parts = body.split(/\s+OR\s+/i).map(unwrap);
  const values: string[] = [];
  for (const part of parts) {
    const m = /^(\[(?:[^\]]|\]\])+\])\s*=\s*N?'((?:[^']|'')*)'$/.exec(part);
    if (!m || m[1] !== quotedColumn) return undefined;
    values.push(m[2]!.replace(/''/g, "'"));
  }
  return values.length ? values.reverse() : undefined;
}

/** True for the JSON checks kastor writes (`ISJSON(CONCAT('[', [c], ']')) = 1`) and the plain `ISJSON([c]) = 1`. */
export function isJsonCheck(definition: string, column: string): boolean {
  const c = ('[' + column.replace(/]/g, ']]') + ']').toLowerCase();
  const compact = unwrap(definition).replace(/\s+/g, '').toLowerCase().replace(/=\(1\)$/, '=1');
  return compact === `isjson(${c})=1` || compact === `isjson(concat('[',${c},']'))=1` || compact === `isjson(concat(n'[',${c},n']'))=1`;
}

export function parseDefault(definition: string, type: NeutralType): ColumnDefaultIR | undefined {
  const s = unwrap(definition);
  const lowered = s.toLowerCase().replace(/\s+/g, '');
  if (/^(sysutcdatetime|getutcdate|sysdatetime|getdate|current_timestamp|sysdatetimeoffset)(\(\))?$/.test(lowered)) return { kind: 'now' };
  if (/^(cast|convert)\((sysutcdatetime|getutcdate|sysdatetime|getdate)\(\)as(date|time(\(\d\))?)\)$/.test(lowered)) return { kind: 'now' };
  // SQL Server stores CAST(x AS date) as CONVERT([date],x).
  if (/^convert\(\[?(date|time)\]?(\(\d\))?,(sysutcdatetime|getutcdate|sysdatetime|getdate)\(\)\)$/.test(lowered)) return { kind: 'now' };
  if (/^(newid|newsequentialid)\(\)$/.test(lowered)) return { kind: 'random' };
  const quoted = /^N?'((?:[^']|'')*)'$/.exec(s);
  if (quoted) return valueDefault(quoted[1]!.replace(/''/g, "'"), type);
  // Literals beyond INT range are stored as NUMERIC with a trailing dot: ((9007199254740993.))
  const number = /^\(?(-?\d+(?:\.\d*)?)\)?$/.exec(s);
  if (number) return valueDefault(number[1]!.replace(/\.$/, ''), type);
  if (/^0x[0-9a-f]*$/i.test(s)) return { kind: 'value', value: s };
  return { kind: 'sql', value: s };
}

function valueDefault(text: string, type: NeutralType): ColumnDefaultIR {
  switch (type) {
    case 'boolean':
      return { kind: 'value', value: text === '1' || text.toLowerCase() === 'true' };
    case 'int':
    case 'float':
      return { kind: 'value', value: Number(text) };
    case 'json':
      try {
        return { kind: 'value', value: JSON.parse(text) };
      } catch {
        return { kind: 'value', value: text };
      }
    default:
      return { kind: 'value', value: text };
  }
}

export function neutralColumn(typeName: string, maxLength: number, precision: number, scale: number): Pick<ColumnIR, 'type' | 'length' | 'precision' | 'scale' | 'nativeType'> {
  const t = typeName.toLowerCase();
  // max_length is in bytes; -1 means MAX.
  const chars = (unicode: boolean) => (maxLength === -1 ? -1 : unicode ? maxLength / 2 : maxLength);
  switch (t) {
    case 'nvarchar': {
      const n = chars(true);
      return n === -1 ? { type: 'text' } : { type: 'string', length: n };
    }
    case 'varchar': {
      const n = chars(false);
      return n === -1 ? { type: 'text', nativeType: 'varchar(max)' } : { type: 'string', length: n, nativeType: `varchar(${n})` };
    }
    case 'nchar':
    case 'char':
      return { type: 'string', length: chars(t === 'nchar'), nativeType: `${t}(${chars(t === 'nchar')})` };
    case 'ntext':
    case 'text':
      return { type: 'text', nativeType: t };
    case 'int':
      return { type: 'int' };
    case 'smallint':
    case 'tinyint':
      return { type: 'int', nativeType: t };
    case 'bigint':
      return { type: 'bigint' };
    case 'float':
      return { type: 'float' };
    case 'real':
      return { type: 'float', nativeType: 'real' };
    case 'decimal':
    case 'numeric':
      return { type: 'decimal', precision, scale };
    case 'money':
    case 'smallmoney':
      return { type: 'decimal', nativeType: t };
    case 'bit':
      return { type: 'boolean' };
    case 'datetime2':
      return scale === 3 ? { type: 'datetime' } : { type: 'datetime', nativeType: `datetime2(${scale})` };
    case 'datetime':
    case 'smalldatetime':
    case 'datetimeoffset':
      return { type: 'datetime', nativeType: t };
    case 'date':
      return { type: 'date' };
    case 'time':
      return scale === 0 ? { type: 'time' } : { type: 'time', nativeType: `time(${scale})` };
    case 'varbinary':
      return maxLength === -1 ? { type: 'bytes' } : { type: 'bytes', nativeType: `varbinary(${maxLength})` };
    case 'binary':
    case 'image':
      return { type: 'bytes', nativeType: t === 'binary' ? `binary(${maxLength})` : t };
    case 'uniqueidentifier':
      return { type: 'uuid' };
    default:
      return { type: 'string', nativeType: t };
  }
}

const ACTIONS: Record<string, ReferentialAction> = {
  CASCADE: 'cascade',
  NO_ACTION: 'no action',
  SET_NULL: 'set null',
  SET_DEFAULT: 'set default',
};

/** Reads the tables of the default schema (usually dbo) into a SchemaIR. */
export async function introspectMssql(exec: Executor): Promise<SchemaIR> {
  const columns = await exec.query(
    `SELECT t.name AS table_name, c.name AS column_name, ty.name AS type_name, c.max_length, c.precision, c.scale,
       c.is_nullable, c.is_identity, dc.definition AS default_definition
     FROM sys.tables t
     JOIN sys.columns c ON c.object_id = t.object_id
     JOIN sys.types ty ON ty.user_type_id = c.user_type_id
     LEFT JOIN sys.default_constraints dc ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
     WHERE t.schema_id = SCHEMA_ID() AND t.is_ms_shipped = 0
     ORDER BY t.name, c.column_id`,
    [],
  );
  const checks = await exec.query(
    `SELECT t.name AS table_name, c.name AS column_name, k.definition
     FROM sys.check_constraints k
     JOIN sys.tables t ON t.object_id = k.parent_object_id
     JOIN sys.columns c ON c.object_id = k.parent_object_id AND c.column_id = k.parent_column_id
     WHERE t.schema_id = SCHEMA_ID()`,
    [],
  );
  const indexes = await exec.query(
    `SELECT t.name AS table_name, i.name AS index_name, i.is_unique, i.is_primary_key, c.name AS column_name, ic.key_ordinal
     FROM sys.indexes i
     JOIN sys.tables t ON t.object_id = i.object_id
     JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
     JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
     WHERE t.schema_id = SCHEMA_ID() AND i.type > 0 AND ic.is_included_column = 0
     ORDER BY t.name, i.name, ic.key_ordinal`,
    [],
  );
  const fks = await exec.query(
    `SELECT t.name AS table_name, fk.name AS constraint_name, c.name AS column_name, rt.name AS ref_table, rc.name AS ref_column,
       fk.delete_referential_action_desc AS delete_rule, fk.update_referential_action_desc AS update_rule
     FROM sys.foreign_keys fk
     JOIN sys.tables t ON t.object_id = fk.parent_object_id
     JOIN sys.tables rt ON rt.object_id = fk.referenced_object_id
     JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
     JOIN sys.columns c ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
     JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
     WHERE t.schema_id = SCHEMA_ID()
     ORDER BY t.name, fk.name, fkc.constraint_column_id`,
    [],
  );

  const checkByColumn = new Map<string, string[]>();
  for (const row of checks.rows) {
    const key = `${str(row, 'table_name')}\u0000${str(row, 'column_name')}`;
    checkByColumn.set(key, [...(checkByColumn.get(key) ?? []), str(row, 'definition')]);
  }

  const byName = new Map<string, TableIR>();
  for (const row of columns.rows) {
    const tableName = str(row, 'table_name');
    let table = byName.get(tableName);
    if (!table) {
      table = { name: tableName, columns: [], primaryKey: [], indexes: [], foreignKeys: [] };
      byName.set(tableName, table);
    }
    const name = str(row, 'column_name');
    const neutral = neutralColumn(str(row, 'type_name'), num(row, 'max_length'), num(row, 'precision'), num(row, 'scale'));
    const col: ColumnIR = { name, type: neutral.type, nullable: Boolean(row.is_nullable) };
    if (neutral.length !== undefined) col.length = neutral.length;
    if (neutral.precision !== undefined) col.precision = neutral.precision;
    if (neutral.scale !== undefined) col.scale = neutral.scale;
    if (neutral.nativeType) col.nativeType = neutral.nativeType;
    for (const definition of checkByColumn.get(`${tableName}\u0000${name}`) ?? []) {
      if (col.type === 'text' && !col.nativeType && isJsonCheck(definition, name)) {
        col.type = 'json';
        continue;
      }
      const values = col.type === 'string' && !col.nativeType ? parseEnumCheck(definition, name) : undefined;
      if (values) {
        col.type = 'enum';
        col.enumValues = values;
        delete col.length;
      }
    }
    if (row.is_identity) col.default = { kind: 'autoincrement' };
    else if (row.default_definition !== null && row.default_definition !== undefined) {
      const def = parseDefault(str(row, 'default_definition'), col.type);
      if (def) col.default = def;
    }
    table.columns.push(col);
  }

  const indexMap = new Map<string, { table: string; index: IndexIR; primary: boolean }>();
  for (const row of indexes.rows) {
    const table = str(row, 'table_name');
    const name = str(row, 'index_name');
    const key = `${table}\u0000${name}`;
    let entry = indexMap.get(key);
    if (!entry) {
      entry = { table, primary: Boolean(row.is_primary_key), index: { name, columns: [], unique: Boolean(row.is_unique) } };
      indexMap.set(key, entry);
    }
    entry.index.columns.push(str(row, 'column_name'));
  }
  for (const { table, index, primary } of indexMap.values()) {
    const t = byName.get(table);
    if (!t) continue;
    if (primary) t.primaryKey = index.columns;
    else t.indexes.push(index);
  }

  const fkMap = new Map<string, { table: string; fk: ForeignKeyIR }>();
  for (const row of fks.rows) {
    const table = str(row, 'table_name');
    const name = str(row, 'constraint_name');
    const key = `${table}\u0000${name}`;
    let entry = fkMap.get(key);
    if (!entry) {
      entry = {
        table,
        fk: {
          name,
          columns: [],
          refTable: str(row, 'ref_table'),
          refColumns: [],
          onDelete: ACTIONS[str(row, 'delete_rule')] ?? 'no action',
          onUpdate: ACTIONS[str(row, 'update_rule')] ?? 'no action',
        },
      };
      fkMap.set(key, entry);
    }
    entry.fk.columns.push(str(row, 'column_name'));
    entry.fk.refColumns.push(str(row, 'ref_column'));
  }
  for (const { table, fk } of fkMap.values()) byName.get(table)?.foreignKeys.push(fk);

  return { tables: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}
