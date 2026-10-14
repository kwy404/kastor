import type { ColumnDefaultIR, ColumnIR, Executor, ForeignKeyIR, IndexIR, ReferentialAction, SchemaIR, TableIR } from '../../core/ir';
import { sortByDependencies } from '../../core/schema-ir';
import type { PgFlavor } from './ddl';

/** Tables kastor keeps for itself and never reports. */
export const internalTables = new Set(['_kastor_migrations']);

const actionCodes: Record<string, ReferentialAction> = {
  a: 'no action',
  r: 'restrict',
  c: 'cascade',
  n: 'set null',
  d: 'set default',
};

interface ColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  character_maximum_length: unknown;
  numeric_precision: unknown;
  numeric_scale: unknown;
  datetime_precision: unknown;
  is_nullable: string;
  column_default: string | null;
  is_identity: string | null;
  is_hidden?: string | boolean | null;
}

const num = (value: unknown): number | undefined => (value === null || value === undefined ? undefined : Number(value));

/**
 * Reads one SQL string literal starting at `text[start]` (a quote, or `E'`/`e'`
 * for escape strings). Returns the value and the index after the literal.
 */
export function readStringLiteral(text: string, start: number): { value: string; end: number } | null {
  let i = start;
  let escapes = false;
  if (text[i] === 'e' || text[i] === 'E') {
    escapes = true;
    i++;
  }
  if (text[i] !== "'") return null;
  i++;
  let value = '';
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "'") {
      if (text[i + 1] === "'") {
        value += "'";
        i += 2;
        continue;
      }
      return { value, end: i + 1 };
    }
    if (escapes && ch === '\\' && i + 1 < text.length) {
      const next = text[i + 1]!;
      const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' };
      value += map[next] ?? next;
      i += 2;
      continue;
    }
    value += ch;
    i++;
  }
  return null;
}

/** Removes `::type` / `:::TYPE` casts and wrapping parentheses around a default expression. */
export function stripCasts(expression: string): string {
  let text = expression.trim();
  for (;;) {
    const before = text;
    if (text.startsWith('(') && text.endsWith(')') && balanced(text.slice(1, -1))) text = text.slice(1, -1).trim();
    // A trailing cast: everything after the last top level `::` that is not inside quotes or parentheses.
    const cut = lastTopLevelCast(text);
    if (cut >= 0) text = text.slice(0, cut).trim();
    if (text === before) return text;
  }
}

function balanced(text: string): boolean {
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'") quoted = !quoted;
    else if (!quoted && ch === '(') depth++;
    else if (!quoted && ch === ')') {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0 && !quoted;
}

function lastTopLevelCast(text: string): number {
  let depth = 0;
  let quoted = false;
  let found = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'") quoted = !quoted;
    else if (quoted) continue;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ':' && text[i + 1] === ':' && depth === 0) {
      found = i;
      while (text[i + 1] === ':') i++;
    }
  }
  return found;
}

const nowRe = /^(?:current_timestamp|current_date|localtime|localtimestamp|current_time|now|transaction_timestamp|statement_timestamp)(?:\s*\(\s*\d*\s*\))?$/i;
const randomRe = /^(?:gen_random_uuid|uuid_generate_v4)\(\)$/i;
const sequenceRe = /^(?:nextval\(|unique_rowid\(\))/i;

/** Turns a column default expression back into a ColumnDefaultIR. */
export function parseDefault(expression: string | null, column: Pick<ColumnIR, 'type'>): ColumnDefaultIR | undefined {
  if (expression === null || expression === undefined) return undefined;
  const raw = expression.trim();
  if (sequenceRe.test(raw)) return { kind: 'autoincrement' };
  const bare = stripCasts(raw);
  if (/^null$/i.test(bare)) return undefined;
  if (nowRe.test(bare) || /^'now'$/i.test(bare)) return { kind: 'now' };
  if (randomRe.test(bare)) return { kind: 'random' };

  let text: string | undefined;
  const literal = readStringLiteral(bare, 0);
  if (literal && literal.end === bare.length) text = literal.value;
  else if (/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(bare) || /^(true|false)$/i.test(bare)) text = bare;
  if (text === undefined) return { kind: 'sql', value: raw };

  const value = literalValue(text, column.type);
  return value === undefined ? { kind: 'sql', value: raw } : { kind: 'value', value };
}

function literalValue(text: string, type: ColumnIR['type']): unknown {
  switch (type) {
    case 'int':
    case 'float': {
      const n = Number(text);
      return Number.isNaN(n) ? undefined : n;
    }
    case 'bigint':
      return /^-?\d+$/.test(text) ? BigInt(text).toString() : undefined;
    case 'boolean': {
      const t = text.toLowerCase();
      if (['true', 't', 'yes', 'on', '1'].includes(t)) return true;
      if (['false', 'f', 'no', 'off', '0'].includes(t)) return false;
      return undefined;
    }
    case 'json':
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return undefined;
      }
    case 'bytes': {
      const m = /^\\x([0-9a-f]*)$/i.exec(text);
      if (!m) return undefined;
      const out: number[] = [];
      for (let i = 0; i < m[1]!.length; i += 2) out.push(parseInt(m[1]!.slice(i, i + 2), 16));
      return out;
    }
    case 'datetime': {
      const iso = text.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00');
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
    }
    default:
      return text;
  }
}

/** Maps one information_schema column to a ColumnIR. */
export function columnFromRow(row: ColumnRow, enums: Map<string, string[]>): ColumnIR {
  const column: ColumnIR = { name: row.column_name, type: 'text', nullable: row.is_nullable === 'YES' };
  const precision = num(row.numeric_precision);
  const scale = num(row.numeric_scale);
  const dtPrecision = num(row.datetime_precision);
  const length = num(row.character_maximum_length);
  switch (row.data_type) {
    case 'character varying':
      column.type = 'string';
      if (length !== undefined) column.length = length;
      break;
    case 'character':
      column.type = 'string';
      column.nativeType = `char(${length ?? 1})`;
      break;
    case 'text':
      column.type = 'text';
      break;
    case 'integer':
      column.type = 'int';
      break;
    case 'smallint':
      column.type = 'int';
      column.nativeType = 'smallint';
      break;
    case 'bigint':
      column.type = 'bigint';
      break;
    case 'double precision':
      column.type = 'float';
      break;
    case 'real':
      column.type = 'float';
      column.nativeType = 'real';
      break;
    case 'numeric':
      column.type = 'decimal';
      if (precision !== undefined) column.precision = precision;
      if (precision !== undefined && scale !== undefined) column.scale = scale;
      break;
    case 'boolean':
      column.type = 'boolean';
      break;
    case 'timestamp with time zone':
      column.type = 'datetime';
      if (dtPrecision !== 3) column.nativeType = dtPrecision === undefined ? 'timestamptz' : `timestamptz(${dtPrecision})`;
      break;
    case 'timestamp without time zone':
      column.type = 'datetime';
      column.nativeType = dtPrecision === undefined ? 'timestamp' : `timestamp(${dtPrecision})`;
      break;
    case 'date':
      column.type = 'date';
      break;
    case 'time without time zone':
      column.type = 'time';
      if (dtPrecision !== undefined && dtPrecision !== 6) column.nativeType = `time(${dtPrecision})`;
      break;
    case 'jsonb':
      column.type = 'json';
      break;
    case 'json':
      column.type = 'json';
      column.nativeType = 'json';
      break;
    case 'bytea':
      column.type = 'bytes';
      break;
    case 'uuid':
      column.type = 'uuid';
      break;
    case 'USER-DEFINED': {
      const values = enums.get(row.udt_name);
      if (values) {
        column.type = 'enum';
        column.enumValues = [...values];
        column.enumName = row.udt_name;
      } else {
        column.nativeType = row.udt_name;
      }
      break;
    }
    default:
      column.nativeType = row.data_type === 'ARRAY' ? `${row.udt_name.replace(/^_/, '')}[]` : row.data_type;
  }
  if (row.is_identity === 'YES') column.default = { kind: 'autoincrement' };
  else {
    const def = parseDefault(row.column_default, column);
    if (def) column.default = def;
  }
  return column;
}

/** Reads the current schema (search_path) into SchemaIR. */
export async function pgIntrospect(flavor: PgFlavor, exec: Executor): Promise<SchemaIR> {
  const tableRows = await exec.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name`,
    [],
  );
  const tableNames = tableRows.rows.map((r) => String(r.table_name)).filter((name) => !internalTables.has(name));

  const enumRows = await exec.query(
    `SELECT t.typname AS name, e.enumlabel AS label FROM pg_catalog.pg_type t
     JOIN pg_catalog.pg_enum e ON e.enumtypid = t.oid
     JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = current_schema() ORDER BY t.typname, e.enumsortorder`,
    [],
  );
  const enums = new Map<string, string[]>();
  for (const row of enumRows.rows) {
    const name = String(row.name);
    if (!enums.has(name)) enums.set(name, []);
    enums.get(name)!.push(String(row.label));
  }

  const hidden = flavor === 'cockroach' ? ', is_hidden' : '';
  const columnRows = await exec.query(
    `SELECT table_name, column_name, data_type, udt_name, character_maximum_length, numeric_precision, numeric_scale,
            datetime_precision, is_nullable, column_default, is_identity${hidden}
     FROM information_schema.columns WHERE table_schema = current_schema() ORDER BY table_name, ordinal_position`,
    [],
  );

  const indexRows = await exec.query(
    `SELECT t.relname AS table_name, i.relname AS index_name, ix.indisunique AS is_unique, ix.indisprimary AS is_primary,
            a.attname AS column_name, k.ord AS ord,
            (ix.indpred IS NOT NULL OR ix.indexprs IS NOT NULL) AS is_special
     FROM pg_catalog.pg_index ix
     JOIN pg_catalog.pg_class t ON t.oid = ix.indrelid
     JOIN pg_catalog.pg_class i ON i.oid = ix.indexrelid
     JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
     CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord)
     JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
     WHERE n.nspname = current_schema() AND k.ord <= ix.indnkeyatts
     ORDER BY t.relname, i.relname, k.ord`,
    [],
  );

  const fkRows = await exec.query(
    `SELECT c.conname AS name, t.relname AS table_name, rt.relname AS ref_table, c.confdeltype AS on_delete,
            c.confupdtype AS on_update, a.attname AS column_name, ra.attname AS ref_column, k.ord AS ord
     FROM pg_catalog.pg_constraint c
     JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
     JOIN pg_catalog.pg_class rt ON rt.oid = c.confrelid
     JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
     CROSS JOIN LATERAL unnest(c.conkey, c.confkey) WITH ORDINALITY AS k(attnum, refnum, ord)
     JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
     JOIN pg_catalog.pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attnum = k.refnum
     WHERE c.contype = 'f' AND n.nspname = current_schema()
     ORDER BY t.relname, c.conname, k.ord`,
    [],
  );

  const tables = new Map<string, TableIR>();
  for (const name of tableNames) tables.set(name, { name, columns: [], primaryKey: [], indexes: [], foreignKeys: [] });

  for (const row of columnRows.rows as unknown as ColumnRow[]) {
    const table = tables.get(row.table_name);
    if (!table || row.is_hidden === 'YES' || row.is_hidden === true) continue;
    table.columns.push(columnFromRow(row, enums));
  }

  const indexes = new Map<string, { table: string; index: IndexIR; primary: boolean; special: boolean }>();
  for (const row of indexRows.rows) {
    const table = String(row.table_name);
    if (!tables.has(table)) continue;
    const key = `${table}\u0000${String(row.index_name)}`;
    let entry = indexes.get(key);
    if (!entry) {
      entry = {
        table,
        index: { name: String(row.index_name), columns: [], unique: row.is_unique === true || row.is_unique === 't' },
        primary: row.is_primary === true || row.is_primary === 't',
        special: row.is_special === true || row.is_special === 't',
      };
      indexes.set(key, entry);
    }
    entry.index.columns.push(String(row.column_name));
  }
  for (const entry of indexes.values()) {
    const table = tables.get(entry.table)!;
    // Partial and expression indexes have no neutral form; they stay out of the schema.
    if (entry.special) continue;
    if (entry.primary) table.primaryKey = entry.index.columns;
    else table.indexes.push(entry.index);
  }

  const fks = new Map<string, { table: string; fk: ForeignKeyIR }>();
  for (const row of fkRows.rows) {
    const table = String(row.table_name);
    if (!tables.has(table)) continue;
    const key = `${table}\u0000${String(row.name)}`;
    let entry = fks.get(key);
    if (!entry) {
      entry = {
        table,
        fk: {
          name: String(row.name),
          columns: [],
          refTable: String(row.ref_table),
          refColumns: [],
          onDelete: actionCodes[String(row.on_delete)] ?? 'no action',
          onUpdate: actionCodes[String(row.on_update)] ?? 'no action',
        },
      };
      fks.set(key, entry);
    }
    entry.fk.columns.push(String(row.column_name));
    entry.fk.refColumns.push(String(row.ref_column));
  }
  for (const entry of fks.values()) tables.get(entry.table)!.foreignKeys.push(entry.fk);

  // Primary key columns are NOT NULL whatever the catalog says about the column.
  for (const table of tables.values()) {
    for (const column of table.columns) if (table.primaryKey.includes(column.name)) column.nullable = false;
  }

  return {
    tables: sortByDependencies([...tables.values()]),
    enums: [...enums.entries()].map(([name, values]) => ({ name, values })),
  };
}
