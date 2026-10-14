import type { ColumnDefaultIR, ColumnIR, Executor, ForeignKeyIR, IndexIR, NeutralType, ReferentialAction, SchemaIR, TableIR } from '../../core/ir';

type RawRow = Record<string, unknown>;

/** information_schema column names come back upper case on MySQL 8 and lower case on MariaDB. */
function pick(row: RawRow, key: string): unknown {
  if (key in row) return row[key];
  const upper = key.toUpperCase();
  if (upper in row) return row[upper];
  const lower = key.toLowerCase();
  return row[lower];
}

const str = (row: RawRow, key: string): string => {
  const value = pick(row, key);
  if (value === null || value === undefined) return '';
  return Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
};
const num = (row: RawRow, key: string): number | undefined => {
  const value = pick(row, key);
  return value === null || value === undefined || value === '' ? undefined : Number(value);
};

/** Parses `enum('a','b''c')` into its values. */
export function parseEnumValues(columnType: string): string[] {
  const body = /^enum\((.*)\)$/i.exec(columnType.trim())?.[1] ?? '';
  const values: string[] = [];
  const re = /'((?:[^'\\]|''|\\.)*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) values.push(m[1]!.replace(/''/g, "'").replace(/\\(.)/g, '$1'));
  return values;
}

interface ColumnFacts {
  dataType: string;
  columnType: string;
  length?: number;
  precision?: number;
  scale?: number;
  isJsonChecked: boolean;
}

/** Maps a native column to a neutral type, keeping the native spelling when it does not map cleanly. */
export function neutralColumn(facts: ColumnFacts): Pick<ColumnIR, 'type' | 'length' | 'precision' | 'scale' | 'enumValues' | 'nativeType'> {
  const dt = facts.dataType.toLowerCase();
  const ct = facts.columnType.toLowerCase();
  switch (dt) {
    case 'varchar':
      return { type: 'string', length: facts.length };
    case 'char':
      if (facts.length === 36) return { type: 'uuid' };
      return { type: 'string', length: facts.length, nativeType: ct };
    case 'tinytext':
    case 'text':
    case 'mediumtext':
    case 'longtext':
      return facts.isJsonChecked ? { type: 'json' } : ct === 'longtext' ? { type: 'text' } : { type: 'text', nativeType: ct };
    case 'json':
      return { type: 'json' };
    case 'tinyint':
      if (/^tinyint\(1\)/.test(ct)) return { type: 'boolean' };
      return { type: 'int', nativeType: ct.replace(/\(\d+\)/, '') };
    case 'bit':
      return /^bit\(1\)$/.test(ct) ? { type: 'boolean', nativeType: 'bit(1)' } : { type: 'bytes', nativeType: ct };
    case 'smallint':
    case 'mediumint':
      return { type: 'int', nativeType: ct.replace(/\(\d+\)/, '') };
    case 'int':
    case 'integer':
      return { type: 'int' };
    case 'bigint':
      return { type: 'bigint' };
    case 'float':
    case 'double':
    case 'real':
      return dt === 'double' ? { type: 'float' } : { type: 'float', nativeType: ct };
    case 'decimal':
    case 'numeric':
      return { type: 'decimal', precision: facts.precision, scale: facts.scale };
    case 'datetime':
      return { type: 'datetime' };
    case 'timestamp':
      return { type: 'datetime', nativeType: ct };
    case 'date':
      return { type: 'date' };
    case 'time':
      return { type: 'time' };
    case 'year':
      return { type: 'int', nativeType: 'year' };
    case 'enum':
      return { type: 'enum', enumValues: parseEnumValues(facts.columnType) };
    case 'binary':
    case 'varbinary':
    case 'tinyblob':
    case 'blob':
    case 'mediumblob':
      return { type: 'bytes', nativeType: ct };
    case 'longblob':
      return { type: 'bytes' };
    case 'uuid':
      return { type: 'uuid', nativeType: 'uuid' };
    default:
      return { type: 'string', nativeType: ct };
  }
}

/**
 * Turns an information_schema COLUMN_DEFAULT into a neutral default.
 * MySQL 8 shows plain literals bare (`a`, `1`) and expression defaults with
 * DEFAULT_GENERATED in EXTRA (`_utf8mb4\'x\'`); MariaDB quotes literals (`'a'`)
 * and shows NULL as the string `NULL`.
 */
export function parseDefault(raw: unknown, extra: string, type: NeutralType, flavor: 'mysql' | 'mariadb'): ColumnDefaultIR | undefined {
  if (/auto_increment/i.test(extra)) return { kind: 'autoincrement' };
  if (raw === null || raw === undefined) return undefined;
  let text = String(raw).trim();
  if (flavor === 'mariadb' && /^null$/i.test(text)) return undefined;
  const generated = /DEFAULT_GENERATED/i.test(extra);
  // MySQL escapes quotes inside expression defaults: _utf8mb4\'x\'
  if (generated) text = text.replace(/\\'/g, "'");
  const lowered = text.toLowerCase().replace(/\s+/g, '');
  if (/^(utc_timestamp|current_timestamp|now|localtimestamp|utc_date|curdate|current_date|utc_time|curtime|current_time)(\(\d*\))?$/.test(lowered)) {
    return { kind: 'now' };
  }
  if (/^uuid\(\)$/.test(lowered)) return { kind: 'random' };
  const charsetLiteral = /^_[a-z0-9]+'((?:[^']|'')*)'$/i.exec(text);
  if (charsetLiteral) return valueDefault(unescape(charsetLiteral[1]!), type);
  const quoted = /^'((?:[^'\\]|''|\\.)*)'$/.exec(text);
  if (quoted) return valueDefault(unescape(quoted[1]!), type);
  if (flavor === 'mysql' && !generated) return valueDefault(text, type);
  if (/^-?\d+(\.\d+)?$/.test(text)) return valueDefault(text, type);
  if (/^b'[01]+'$/i.test(text)) return valueDefault(String(parseInt(text.slice(2, -1), 2)), type);
  return { kind: 'sql', value: text };
}

function unescape(text: string): string {
  return text.replace(/''/g, "'").replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c === '0' ? '\0' : c));
}

function valueDefault(text: string, type: NeutralType): ColumnDefaultIR {
  switch (type) {
    case 'boolean':
      return { kind: 'value', value: text === '1' || text.toLowerCase() === 'true' };
    case 'int':
    case 'float':
      return { kind: 'value', value: Number(text) };
    case 'bigint':
    case 'decimal':
      return { kind: 'value', value: text };
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

const ACTIONS: Record<string, ReferentialAction> = {
  CASCADE: 'cascade',
  RESTRICT: 'restrict',
  'SET NULL': 'set null',
  'SET DEFAULT': 'set default',
  'NO ACTION': 'no action',
};

/** Reads the current database (`DATABASE()`) into a SchemaIR. */
export async function introspectMysql(exec: Executor, flavor: 'mysql' | 'mariadb'): Promise<SchemaIR> {
  const tables = await exec.query(
    `SELECT TABLE_NAME AS table_name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
    [],
  );
  const columns = await exec.query(
    `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name, DATA_TYPE AS data_type, COLUMN_TYPE AS column_type,
       IS_NULLABLE AS is_nullable, COLUMN_DEFAULT AS column_default, EXTRA AS extra,
       CHARACTER_MAXIMUM_LENGTH AS char_length, NUMERIC_PRECISION AS num_precision, NUMERIC_SCALE AS num_scale
     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [],
  );
  const stats = await exec.query(
    `SELECT TABLE_NAME AS table_name, INDEX_NAME AS index_name, NON_UNIQUE AS non_unique, COLUMN_NAME AS column_name, SEQ_IN_INDEX AS seq
     FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
    [],
  );
  const fks = await exec.query(
    `SELECT k.TABLE_NAME AS table_name, k.CONSTRAINT_NAME AS constraint_name, k.COLUMN_NAME AS column_name,
       k.REFERENCED_TABLE_NAME AS ref_table, k.REFERENCED_COLUMN_NAME AS ref_column, r.DELETE_RULE AS delete_rule, r.UPDATE_RULE AS update_rule
     FROM information_schema.KEY_COLUMN_USAGE k
     JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME
     WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL
     ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION`,
    [],
  );
  // MariaDB stores JSON as LONGTEXT with a json_valid() check.
  const jsonColumns = new Set<string>();
  if (flavor === 'mariadb') {
    const checks = await exec.query(
      `SELECT TABLE_NAME AS table_name, CHECK_CLAUSE AS check_clause FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()`,
      [],
    );
    for (const row of checks.rows) {
      const m = /^json_valid\(`((?:[^`]|``)+)`\)$/i.exec(str(row, 'check_clause').trim());
      if (m) jsonColumns.add(`${str(row, 'table_name')}.${m[1]!.replace(/``/g, '`')}`);
    }
  }

  const byName = new Map<string, TableIR>();
  for (const row of tables.rows) {
    const name = str(row, 'table_name');
    byName.set(name, { name, columns: [], primaryKey: [], indexes: [], foreignKeys: [] });
  }
  for (const row of columns.rows) {
    const table = byName.get(str(row, 'table_name'));
    if (!table) continue;
    const name = str(row, 'column_name');
    const neutral = neutralColumn({
      dataType: str(row, 'data_type'),
      columnType: str(row, 'column_type'),
      length: num(row, 'char_length'),
      precision: num(row, 'num_precision'),
      scale: num(row, 'num_scale'),
      isJsonChecked: jsonColumns.has(`${table.name}.${name}`),
    });
    const col: ColumnIR = { name, type: neutral.type, nullable: str(row, 'is_nullable') === 'YES' };
    if (neutral.length !== undefined) col.length = neutral.length;
    if (neutral.precision !== undefined) col.precision = neutral.precision;
    if (neutral.scale !== undefined) col.scale = neutral.scale;
    if (neutral.enumValues) col.enumValues = neutral.enumValues;
    if (neutral.nativeType) col.nativeType = neutral.nativeType;
    const def = parseDefault(pick(row, 'column_default'), str(row, 'extra'), col.type, flavor);
    if (def) col.default = def;
    table.columns.push(col);
  }

  const indexes = new Map<string, { table: string; index: IndexIR; primary: boolean }>();
  for (const row of stats.rows) {
    const table = str(row, 'table_name');
    const name = str(row, 'index_name');
    const key = `${table}\u0000${name}`;
    let entry = indexes.get(key);
    if (!entry) {
      entry = { table, primary: name === 'PRIMARY', index: { name, columns: [], unique: Number(pick(row, 'non_unique')) === 0 } };
      indexes.set(key, entry);
    }
    entry.index.columns.push(str(row, 'column_name'));
  }
  for (const { table, index, primary } of indexes.values()) {
    const t = byName.get(table);
    if (!t) continue;
    if (primary) t.primaryKey = index.columns;
    else t.indexes.push(index);
  }

  const foreignKeys = new Map<string, { table: string; fk: ForeignKeyIR }>();
  for (const row of fks.rows) {
    const table = str(row, 'table_name');
    const name = str(row, 'constraint_name');
    const key = `${table}\u0000${name}`;
    let entry = foreignKeys.get(key);
    if (!entry) {
      entry = {
        table,
        fk: {
          name,
          columns: [],
          refTable: str(row, 'ref_table'),
          refColumns: [],
          onDelete: ACTIONS[str(row, 'delete_rule').toUpperCase()] ?? 'no action',
          onUpdate: ACTIONS[str(row, 'update_rule').toUpperCase()] ?? 'no action',
        },
      };
      foreignKeys.set(key, entry);
    }
    entry.fk.columns.push(str(row, 'column_name'));
    entry.fk.refColumns.push(str(row, 'ref_column'));
  }
  for (const { table, fk } of foreignKeys.values()) {
    const t = byName.get(table);
    if (!t) continue;
    t.foreignKeys.push(fk);
    // InnoDB adds an index named after the constraint when no index covers the
    // foreign key columns; it is not part of the user's schema.
    t.indexes = t.indexes.filter((i) => !(i.name === fk.name && !i.unique && i.columns.join('\u0000') === fk.columns.join('\u0000')));
  }

  return { tables: [...byName.values()] };
}
