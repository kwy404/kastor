import type { ColumnDefaultIR, ColumnIR, Executor, ForeignKeyIR, IndexIR, NeutralType, SchemaIR, TableIR } from '../../core/ir';

type RawRow = Record<string, unknown>;
const str = (row: RawRow, key: string): string => {
  const value = row[key] ?? row[key.toUpperCase()];
  return value === null || value === undefined ? '' : String(value);
};
const num = (row: RawRow, key: string): number | undefined => {
  const value = row[key] ?? row[key.toUpperCase()];
  return value === null || value === undefined || value === '' ? undefined : Number(value);
};

function unwrap(expression: string): string {
  let s = expression.trim();
  while (s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1).trim();
  return s;
}

/** Values of `"c" IN ('a', 'b')`, or undefined when the check is something else. */
export function parseInCheck(condition: string, column: string): string[] | undefined {
  const m = /^"((?:[^"]|"")+)"\s+IN\s*\((.*)\)$/is.exec(unwrap(condition));
  if (!m || m[1]!.replace(/""/g, '"') !== column) return undefined;
  const values: string[] = [];
  const re = /'((?:[^']|'')*)'|(-?\d+)/g;
  let v: RegExpExecArray | null;
  while ((v = re.exec(m[2]!))) values.push(v[1] !== undefined ? v[1].replace(/''/g, "'") : v[2]!);
  return values;
}

export function neutralColumn(row: RawRow): Pick<ColumnIR, 'type' | 'length' | 'precision' | 'scale' | 'nativeType'> {
  const type = str(row, 'data_type').toUpperCase();
  const precision = num(row, 'data_precision');
  const scale = num(row, 'data_scale');
  const charLength = num(row, 'char_length') ?? 0;
  const charUsed = str(row, 'char_used') === 'C';
  if (type === 'VARCHAR2' || type === 'NVARCHAR2') {
    if (type === 'VARCHAR2' && charUsed) return { type: 'string', length: charLength };
    return { type: 'string', length: charLength, nativeType: `${type.toLowerCase()}(${charLength}${charUsed ? ' char' : ''})` };
  }
  if (type === 'CHAR' || type === 'NCHAR') {
    if (type === 'CHAR' && charUsed && charLength === 36) return { type: 'uuid' };
    return { type: 'string', length: charLength, nativeType: `${type.toLowerCase()}(${charLength}${charUsed ? ' char' : ''})` };
  }
  if (type === 'CLOB') return { type: 'text' };
  if (type === 'NCLOB' || type === 'LONG') return { type: 'text', nativeType: type.toLowerCase() };
  if (type === 'NUMBER') {
    if (precision === undefined) return scale === 0 ? { type: 'int', nativeType: 'integer' } : { type: 'decimal' };
    if (scale === 0 || scale === undefined) {
      if (precision === 10) return { type: 'int' };
      if (precision === 19) return { type: 'bigint' };
      if (precision === 1) return { type: 'boolean' };
      return { type: precision > 10 ? 'bigint' : 'int', nativeType: `number(${precision})` };
    }
    return { type: 'decimal', precision, scale };
  }
  if (type === 'FLOAT') return { type: 'float', nativeType: precision ? `float(${precision})` : 'float' };
  if (type === 'BINARY_DOUBLE') return { type: 'float' };
  if (type === 'BINARY_FLOAT') return { type: 'float', nativeType: 'binary_float' };
  if (type === 'DATE') return { type: 'date' };
  const ts = /^TIMESTAMP\((\d)\)( WITH (LOCAL )?TIME ZONE)?$/.exec(type);
  if (ts) {
    if (ts[1] === '3' && ts[2] && !ts[3]) return { type: 'datetime' };
    return { type: 'datetime', nativeType: type.toLowerCase() };
  }
  if (/^INTERVAL DAY\(\d\) TO SECOND\(\d\)$/.test(type)) {
    return type === 'INTERVAL DAY(0) TO SECOND(0)' ? { type: 'time' } : { type: 'time', nativeType: type.toLowerCase() };
  }
  if (type === 'BLOB') return { type: 'bytes' };
  if (type === 'RAW') return { type: 'bytes', nativeType: `raw(${num(row, 'data_length') ?? 2000})` };
  if (type === 'JSON') return { type: 'json', nativeType: 'json' };
  if (type === 'BOOLEAN') return { type: 'boolean', nativeType: 'boolean' };
  return { type: 'string', nativeType: type.toLowerCase() };
}

const NOW = /^(systimestamp|current_timestamp|localtimestamp|sysdate|current_date)(\(\d\))?$/i;

export function parseDefault(raw: string, type: NeutralType): ColumnDefaultIR | undefined {
  const s = raw.trim();
  if (!s || /^null$/i.test(s)) return undefined;
  const compact = s.replace(/\s+/g, '').toLowerCase();
  if (NOW.test(compact)) return { kind: 'now' };
  if (compact.includes('sys_extract_utc(systimestamp)')) return { kind: 'now' };
  if (compact.includes('sys_guid()')) return { kind: 'random' };
  const quoted = /^'((?:[^']|'')*)'$/.exec(s);
  if (quoted) return valueDefault(quoted[1]!.replace(/''/g, "'"), type);
  if (/^-?\d+(\.\d+)?$/.test(s)) return valueDefault(s, type);
  const timestamp = /^TIMESTAMP\s*'([^']+)'$/i.exec(s);
  if (timestamp) {
    const text = timestamp[1]!.replace(/\s*\+00:00$/, '').replace(' ', 'T');
    return { kind: 'value', value: new Date(text + 'Z').toISOString() };
  }
  const date = /^DATE\s*'([^']+)'$/i.exec(s);
  if (date) return { kind: 'value', value: date[1] };
  const interval = /^INTERVAL\s*'([^']+)'\s*HOUR TO SECOND$/i.exec(s);
  if (interval) return { kind: 'value', value: interval[1] };
  return { kind: 'sql', value: s };
}

function valueDefault(text: string, type: NeutralType): ColumnDefaultIR {
  switch (type) {
    case 'boolean':
      return { kind: 'value', value: text === '1' };
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

/** Reads the current user's tables (USER_* views) into a SchemaIR. */
export async function introspectOracle(exec: Executor): Promise<SchemaIR> {
  const columns = await exec.query(
    `SELECT c.table_name, c.column_name, c.data_type, c.data_length, c.data_precision, c.data_scale, c.char_length, c.char_used,
       c.nullable, c.data_default, c.identity_column
     FROM user_tab_columns c JOIN user_tables t ON t.table_name = c.table_name
     WHERE t.table_name NOT LIKE 'BIN$%' AND t.nested = 'NO' AND t.secondary = 'N' AND t.iot_type IS NULL
     ORDER BY c.table_name, c.column_id`,
    [],
  );
  const constraints = await exec.query(
    `SELECT uc.table_name, uc.constraint_name, uc.constraint_type, uc.search_condition_vc, uc.r_constraint_name, uc.delete_rule, uc.index_name,
       cc.column_name, cc.position
     FROM user_constraints uc
     LEFT JOIN user_cons_columns cc ON cc.constraint_name = uc.constraint_name AND cc.table_name = uc.table_name
     WHERE uc.constraint_type IN ('P', 'R', 'C', 'U') AND uc.table_name NOT LIKE 'BIN$%'
     ORDER BY uc.table_name, uc.constraint_name, cc.position`,
    [],
  );
  const indexes = await exec.query(
    `SELECT i.table_name, i.index_name, i.uniqueness, ic.column_name, ic.column_position
     FROM user_indexes i JOIN user_ind_columns ic ON ic.index_name = i.index_name AND ic.table_name = i.table_name
     WHERE i.index_type IN ('NORMAL', 'NORMAL/REV') AND i.table_name NOT LIKE 'BIN$%' AND i.generated = 'N'
     ORDER BY i.table_name, i.index_name, ic.column_position`,
    [],
  );

  // Constraint rows grouped by name.
  interface Constraint {
    table: string;
    name: string;
    type: string;
    condition: string;
    refName: string;
    deleteRule: string;
    indexName: string;
    columns: string[];
  }
  const cons = new Map<string, Constraint>();
  for (const row of constraints.rows) {
    const name = str(row, 'constraint_name');
    let c = cons.get(name);
    if (!c) {
      c = {
        table: str(row, 'table_name'),
        name,
        type: str(row, 'constraint_type'),
        condition: str(row, 'search_condition_vc'),
        refName: str(row, 'r_constraint_name'),
        deleteRule: str(row, 'delete_rule'),
        indexName: str(row, 'index_name'),
        columns: [],
      };
      cons.set(name, c);
    }
    const column = str(row, 'column_name');
    if (column) c.columns.push(column);
  }

  const byName = new Map<string, TableIR>();
  const checks = [...cons.values()].filter((c) => c.type === 'C' && c.columns.length === 1 && !/ IS NOT NULL$/i.test(c.condition));
  for (const row of columns.rows) {
    const tableName = str(row, 'table_name');
    let table = byName.get(tableName);
    if (!table) {
      table = { name: tableName, columns: [], primaryKey: [], indexes: [], foreignKeys: [] };
      byName.set(tableName, table);
    }
    const name = str(row, 'column_name');
    const neutral = neutralColumn(row);
    const col: ColumnIR = { name, type: neutral.type, nullable: str(row, 'nullable') === 'Y' };
    if (neutral.length !== undefined) col.length = neutral.length;
    if (neutral.precision !== undefined) col.precision = neutral.precision;
    if (neutral.scale !== undefined) col.scale = neutral.scale;
    if (neutral.nativeType) col.nativeType = neutral.nativeType;
    for (const check of checks.filter((c) => c.table === tableName && c.columns[0] === name)) {
      const condition = unwrap(check.condition);
      if (col.type === 'text' && !col.nativeType && /^"(?:[^"]|"")+"\s+IS\s+JSON/i.test(condition)) col.type = 'json';
      else if (col.type === 'string' && !col.nativeType) {
        const values = parseInCheck(condition, name);
        if (values) {
          col.type = 'enum';
          col.enumValues = values;
          delete col.length;
        }
      }
    }
    if (str(row, 'identity_column') === 'YES') col.default = { kind: 'autoincrement' };
    else {
      const def = parseDefault(str(row, 'data_default'), col.type);
      if (def) col.default = def;
    }
    table.columns.push(col);
  }

  const backing = new Set<string>();
  for (const c of cons.values()) {
    const table = byName.get(c.table);
    if (!table) continue;
    if (c.type === 'P') {
      table.primaryKey = c.columns;
      backing.add(c.indexName || c.name);
    } else if (c.type === 'U') {
      table.indexes.push({ name: c.name, columns: c.columns, unique: true });
      backing.add(c.indexName || c.name);
    } else if (c.type === 'R') {
      const target = cons.get(c.refName);
      if (!target) continue;
      const fk: ForeignKeyIR = {
        name: c.name,
        columns: c.columns,
        refTable: target.table,
        refColumns: target.columns,
        onDelete: c.deleteRule === 'CASCADE' ? 'cascade' : c.deleteRule === 'SET NULL' ? 'set null' : 'no action',
        onUpdate: 'no action',
      };
      table.foreignKeys.push(fk);
    }
  }

  const indexMap = new Map<string, { table: string; index: IndexIR }>();
  for (const row of indexes.rows) {
    const name = str(row, 'index_name');
    if (backing.has(name)) continue;
    let entry = indexMap.get(name);
    if (!entry) {
      entry = { table: str(row, 'table_name'), index: { name, columns: [], unique: str(row, 'uniqueness') === 'UNIQUE' } };
      indexMap.set(name, entry);
    }
    entry.index.columns.push(str(row, 'column_name'));
  }
  for (const { table, index } of indexMap.values()) byName.get(table)?.indexes.push(index);

  return { tables: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}
