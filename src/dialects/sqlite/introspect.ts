import type { ColumnDefaultIR, ColumnIR, Executor, ForeignKeyIR, IndexIR, ReferentialAction, SchemaIR, TableIR } from '../../core/ir';
import { sortByDependencies } from '../../core/schema-ir';
import { readStringLiteral } from '../postgres/introspect';
import { NOW_DATE, NOW_DATETIME, NOW_TIME, RANDOM_UUID } from './ddl';

/** Tables SQLite, libSQL and D1 keep for themselves. */
const systemTable = /^(sqlite_|_cf_|libsql_)/i;

const actions: Record<string, ReferentialAction> = {
  CASCADE: 'cascade',
  RESTRICT: 'restrict',
  'SET NULL': 'set null',
  'SET DEFAULT': 'set default',
  'NO ACTION': 'no action',
};

/* ------------------------------------------------------------------------ */
/* CREATE TABLE parsing                                                       */
/* ------------------------------------------------------------------------ */

/** Splits the body of a CREATE TABLE into its top level definitions. */
export function splitDefinitions(sql: string): string[] {
  const open = sql.indexOf('(');
  if (open < 0) return [];
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = open + 1; i < sql.length; i++) {
    const ch = sql[i]!;
    if (ch === "'" || ch === '"' || ch === '`' || ch === '[') {
      const close = ch === '[' ? ']' : ch;
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === close) {
          if (close !== ']' && sql[j + 1] === close) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      current += sql.slice(i, j + 1);
      i = j;
      continue;
    }
    if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      i = end < 0 ? sql.length : end;
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      current += sql.slice(i, end < 0 ? sql.length : end + 2);
      i = end < 0 ? sql.length : end + 1;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      if (depth === 0) {
        parts.push(current.trim());
        return parts.filter(Boolean);
      }
      depth--;
    } else if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current.trim());
  return parts.filter(Boolean);
}

/** Reads a leading identifier (quoted or bare) and returns it with the rest of the text. */
export function readIdentifier(text: string): { name: string; rest: string } | null {
  const s = text.trimStart();
  const first = s[0];
  if (first === '"' || first === '`' || first === '[') {
    const close = first === '[' ? ']' : first;
    let name = '';
    let i = 1;
    while (i < s.length) {
      if (s[i] === close) {
        if (close !== ']' && s[i + 1] === close) {
          name += close;
          i += 2;
          continue;
        }
        return { name, rest: s.slice(i + 1) };
      }
      name += s[i];
      i++;
    }
    return null;
  }
  const m = /^([A-Za-z_][\w$]*)/.exec(s);
  return m ? { name: m[1]!, rest: s.slice(m[1]!.length) } : null;
}

const tableConstraint = /^(constraint|primary|foreign|unique|check)\b/i;

interface ParsedColumn {
  autoincrement: boolean;
  bigint: boolean;
  enumName?: string;
  enumValues?: string[];
}

interface ParsedTable {
  columns: Map<string, ParsedColumn>;
  /** Foreign key constraint names, keyed by their column list. */
  foreignKeyNames: Map<string, string>;
}

/** Reads `IN ('a', 'b')` string lists. */
function readStringList(text: string): string[] | null {
  const values: string[] = [];
  let i = 0;
  for (;;) {
    while (/\s/.test(text[i] ?? '')) i++;
    const literal = readStringLiteral(text, i);
    if (!literal) return null;
    values.push(literal.value);
    i = literal.end;
    while (/\s/.test(text[i] ?? '')) i++;
    if (text[i] === ',') {
      i++;
      continue;
    }
    return text[i] === ')' ? values : null;
  }
}

const quotedName = (name: string) => `(?:"${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/"/g, '""')}"|${/^\w+$/.test(name) ? name : '(?!)'})`;

export function parseCreateTable(sql: string): ParsedTable {
  const columns = new Map<string, ParsedColumn>();
  const foreignKeyNames = new Map<string, string>();
  for (const definition of splitDefinitions(sql)) {
    if (tableConstraint.test(definition)) {
      const named = /^constraint\s+/i.exec(definition);
      let name: string | undefined;
      let rest = definition;
      if (named) {
        const id = readIdentifier(definition.slice(named[0].length));
        if (!id) continue;
        name = id.name;
        rest = id.rest.trimStart();
      }
      const fk = /^foreign\s+key\s*\(([^)]*)\)/i.exec(rest);
      if (fk && name) {
        const cols = fk[1]!.split(',').map((c) => readIdentifier(c.trim())?.name ?? c.trim());
        foreignKeyNames.set(cols.join('\u0000'), name);
      }
      continue;
    }
    const id = readIdentifier(definition);
    if (!id) continue;
    const parsed: ParsedColumn = {
      autoincrement: /\bautoincrement\b/i.test(id.rest),
      bigint: /\/\*\s*kastor:bigint\s*\*\//i.test(id.rest),
    };
    // CONSTRAINT "name" CHECK ("col" IN ('a', 'b')) or an unnamed CHECK.
    const check = new RegExp(`(?:constraint\\s+("(?:[^"]|"")+"|\\w+)\\s+)?check\\s*\\(\\s*${quotedName(id.name)}\\s+in\\s*\\(`, 'i').exec(id.rest);
    if (check) {
      const values = readStringList(id.rest.slice(check.index + check[0].length));
      if (values) {
        parsed.enumValues = values;
        if (check[1]) parsed.enumName = readIdentifier(check[1])?.name;
      }
    }
    columns.set(id.name, parsed);
  }
  return { columns, foreignKeyNames };
}

/* ------------------------------------------------------------------------ */
/* Types and defaults                                                         */
/* ------------------------------------------------------------------------ */

/** Maps a declared type to a neutral column. Unknown types keep their text as nativeType. */
export function typeFromDeclared(declared: string, column: ColumnIR): void {
  const decl = declared.trim();
  const upper = decl.toUpperCase();
  const args = /\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\)$/.exec(decl);
  const base = upper.replace(/\s*\(.*\)$/, '');
  switch (base) {
    case 'VARCHAR':
      column.type = 'string';
      if (args) column.length = Number(args[1]);
      return;
    case 'TEXT':
      column.type = 'text';
      return;
    case 'INTEGER':
      column.type = 'int';
      return;
    case 'BIGINT':
      column.type = 'bigint';
      return;
    case 'REAL':
      column.type = 'float';
      return;
    case 'DECIMAL':
      column.type = 'decimal';
      if (args) {
        column.precision = Number(args[1]);
        if (args[2] !== undefined) column.scale = Number(args[2]);
      }
      return;
    case 'BOOLEAN':
      column.type = 'boolean';
      return;
    case 'DATETIME':
      column.type = 'datetime';
      return;
    case 'DATE':
      column.type = 'date';
      return;
    case 'TIME':
      column.type = 'time';
      return;
    case 'JSON':
      column.type = 'json';
      return;
    case 'BLOB':
      column.type = 'bytes';
      return;
    case 'UUID':
      column.type = 'uuid';
      return;
  }
  // Anything else: pick the neutral type from SQLite's affinity rules and keep the text.
  column.nativeType = decl;
  if (upper === '') column.type = 'bytes';
  else if (upper.includes('INT')) column.type = upper.includes('BIG') ? 'bigint' : 'int';
  else if (/CHAR|CLOB|TEXT/.test(upper)) column.type = 'text';
  else if (upper.includes('BLOB')) column.type = 'bytes';
  else if (/REAL|FLOA|DOUB/.test(upper)) column.type = 'float';
  else if (/BOOL/.test(upper)) column.type = 'boolean';
  else if (/TIMESTAMP|DATETIME/.test(upper)) column.type = 'datetime';
  else column.type = 'decimal';
}

const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim().toLowerCase();
const nowDefaults = new Map([
  [normalize(NOW_DATETIME), 'datetime'],
  [normalize(NOW_DATE), 'date'],
  [normalize(NOW_TIME), 'time'],
]);

export function parseDefault(raw: unknown, column: ColumnIR): ColumnDefaultIR | undefined {
  if (raw === null || raw === undefined) return undefined;
  const text = String(raw).trim();
  if (/^null$/i.test(text)) return undefined;
  const norm = normalize(text);
  if (nowDefaults.has(norm)) return { kind: 'now' };
  if (norm === normalize(RANDOM_UUID)) return { kind: 'random' };

  const literal = readStringLiteral(text, 0);
  if (literal && literal.end === text.length) {
    const value = fromText(literal.value, column);
    return value === undefined ? { kind: 'sql', value: text } : { kind: 'value', value };
  }
  if (/^[+-]?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(text)) {
    const value = fromNumber(text, column);
    return value === undefined ? { kind: 'sql', value: text } : { kind: 'value', value };
  }
  if (/^(true|false)$/i.test(text) && column.type === 'boolean') return { kind: 'value', value: /^true$/i.test(text) };
  const blob = /^x'([0-9a-f]*)'$/i.exec(text);
  if (blob && column.type === 'bytes') {
    const out: number[] = [];
    for (let i = 0; i < blob[1]!.length; i += 2) out.push(parseInt(blob[1]!.slice(i, i + 2), 16));
    return { kind: 'value', value: out };
  }
  // Expressions are stored with their parentheses; give back what the user wrote.
  const inner = /^\((.*)\)$/s.exec(text);
  return { kind: 'sql', value: inner ? inner[1]!.trim() : text };
}

function fromText(text: string, column: ColumnIR): unknown {
  switch (column.type) {
    case 'json':
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return undefined;
      }
    case 'int':
    case 'float':
      return Number.isNaN(Number(text)) ? undefined : Number(text);
    case 'bigint':
      return /^-?\d+$/.test(text) ? text : undefined;
    case 'boolean':
      return text === '1' || /^true$/i.test(text) ? true : text === '0' || /^false$/i.test(text) ? false : undefined;
    default:
      return text;
  }
}

function fromNumber(text: string, column: ColumnIR): unknown {
  switch (column.type) {
    case 'boolean':
      return Number(text) !== 0;
    case 'bigint':
      return /^[+-]?\d+$/.test(text) ? BigInt(text).toString() : undefined;
    case 'decimal':
    case 'string':
    case 'text':
      return text;
    case 'json':
      return Number(text);
    default:
      return Number(text);
  }
}

/* ------------------------------------------------------------------------ */
/* Introspection                                                              */
/* ------------------------------------------------------------------------ */

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

export async function sqliteIntrospect(exec: Executor): Promise<SchemaIR> {
  const master = await exec.query(`SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name`, []);
  const tables: TableIR[] = [];
  for (const row of master.rows) {
    const name = String(row.name);
    if (systemTable.test(name)) continue;
    const parsed = parseCreateTable(String(row.sql ?? ''));
    tables.push(await readTable(exec, name, parsed));
  }
  return { tables: sortByDependencies(tables), enums: [] };
}

async function readTable(exec: Executor, name: string, parsed: ParsedTable): Promise<TableIR> {
  const info = await exec.query(`PRAGMA table_info(${q(name)})`, []);
  const columns: ColumnIR[] = [];
  const pk: { name: string; seq: number }[] = [];
  for (const row of info.rows) {
    const columnName = String(row.name);
    const column: ColumnIR = { name: columnName, type: 'text', nullable: Number(row.notnull) === 0 };
    typeFromDeclared(String(row.type ?? ''), column);
    const extra = parsed.columns.get(columnName);
    const pkSeq = Number(row.pk);
    if (pkSeq > 0) pk.push({ name: columnName, seq: pkSeq });
    if (extra?.autoincrement) {
      column.default = { kind: 'autoincrement' };
      if (extra.bigint) column.type = 'bigint';
    } else {
      const def = parseDefault(row.dflt_value, column);
      if (def) column.default = def;
    }
    if (extra?.enumValues && column.type === 'text') {
      column.type = 'enum';
      column.enumValues = extra.enumValues;
      column.enumName = extra.enumName ?? `${name}_${columnName}`;
    }
    columns.push(column);
  }
  pk.sort((a, b) => a.seq - b.seq);
  const primaryKey = pk.map((p) => p.name);
  for (const column of columns) if (primaryKey.includes(column.name)) column.nullable = false;

  const indexes: IndexIR[] = [];
  const indexList = await exec.query(`PRAGMA index_list(${q(name)})`, []);
  for (const row of indexList.rows) {
    if (row.origin === 'pk' || Number(row.partial) === 1) continue;
    const indexName = String(row.name);
    const cols = await exec.query(`PRAGMA index_info(${q(indexName)})`, []);
    const names = cols.rows
      .sort((a, b) => Number(a.seqno) - Number(b.seqno))
      .map((c) => (c.name === null || c.name === undefined ? null : String(c.name)));
    // Expression indexes have NULL column names: no neutral form.
    if (names.some((n) => n === null)) continue;
    const unique = Number(row.unique) === 1;
    const auto = indexName.startsWith('sqlite_autoindex_');
    indexes.push({
      name: auto ? `${name}_${(names as string[]).join('_')}_key` : indexName,
      columns: names as string[],
      unique,
    });
  }
  indexes.sort((a, b) => a.name.localeCompare(b.name));

  const fkRows = await exec.query(`PRAGMA foreign_key_list(${q(name)})`, []);
  const grouped = new Map<number, Record<string, unknown>[]>();
  for (const row of fkRows.rows) {
    const id = Number(row.id);
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id)!.push(row);
  }
  const foreignKeys: ForeignKeyIR[] = [];
  for (const rows of [...grouped.entries()].sort((a, b) => b[0] - a[0]).map((e) => e[1])) {
    rows.sort((a, b) => Number(a.seq) - Number(b.seq));
    const first = rows[0]!;
    const cols = rows.map((r) => String(r.from));
    const refTable = String(first.table);
    let refColumns = rows.map((r) => (r.to === null || r.to === undefined ? '' : String(r.to)));
    if (refColumns.some((c) => c === '')) refColumns = await primaryKeyOf(exec, refTable);
    foreignKeys.push({
      name: parsed.foreignKeyNames.get(cols.join('\u0000')) ?? `${name}_${cols.join('_')}_fkey`,
      columns: cols,
      refTable,
      refColumns,
      onDelete: actions[String(first.on_delete).toUpperCase()] ?? 'no action',
      onUpdate: actions[String(first.on_update).toUpperCase()] ?? 'no action',
    });
  }

  return { name, columns, primaryKey, indexes, foreignKeys };
}

async function primaryKeyOf(exec: Executor, table: string): Promise<string[]> {
  const info = await exec.query(`PRAGMA table_info(${q(table)})`, []);
  return info.rows
    .filter((r) => Number(r.pk) > 0)
    .sort((a, b) => Number(a.pk) - Number(b.pk))
    .map((r) => String(r.name));
}
