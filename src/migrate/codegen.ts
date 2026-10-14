/**
 * `db pull`: turns an introspected SchemaIR into a readable TypeScript schema
 * file, with relations guessed from foreign keys (one, many, and many-to-many
 * through join tables).
 */
import type { ColumnIR, Dialect, ForeignKeyIR, SchemaIR, TableIR } from '../core/ir';
import { constraintName, sortByDependencies } from '../core/schema-ir';
import { DEFAULT_STRING_LENGTH, normalizeDefault } from './diff';

export interface CodegenOptions {
  /** Used to keep `nativeType` only where it changes the DDL. */
  dialect?: Pick<Dialect, 'name' | 'ddl'>;
  /** Import path of kastor. Default `kastor`. */
  importFrom?: string;
  /** Header note, for example the database the file came from. */
  source?: string;
  date?: Date;
}

export interface CodegenResult {
  code: string;
  /** Things the file cannot express, to show the user. */
  notes: string[];
}

const RESERVED = new Set(
  'break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await schema relations table t one many index uniqueIndex'.split(
    ' ',
  ),
);

/** `blog_posts` to `blogPosts`, `User-Accounts` to `userAccounts`. */
export function camelCase(name: string): string {
  const parts = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!parts.length) return '_';
  const words = parts.flatMap((p) => p.split(/(?<=[a-z0-9])(?=[A-Z])/));
  let out = words.map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1))).join('');
  if (words.every((w) => w === w.toUpperCase())) out = words.map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0) + w.slice(1).toLowerCase())).join('');
  if (/^\d/.test(out)) out = `_${out}`;
  return out;
}

function safeIdent(name: string, taken: Set<string>): string {
  let base = camelCase(name);
  if (RESERVED.has(base)) base = `${base}Table`;
  let out = base;
  for (let i = 2; taken.has(out); i++) out = `${base}${i}`;
  taken.add(out);
  return out;
}

/** Very small English plural/singular helpers for relation names. */
export function plural(word: string): string {
  if (/(s|x|z|ch|sh)$/.test(word)) return `${word}es`;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

export function singular(word: string): string {
  if (/ies$/.test(word)) return `${word.slice(0, -3)}y`;
  if (/(ss|us|is)$/.test(word)) return word;
  if (/(ch|sh|x|z|ses)es$/.test(word)) return word.slice(0, -2);
  if (/s$/.test(word)) return word.slice(0, -1);
  return word;
}

const q = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

interface TableNames {
  ir: TableIR;
  ident: string;
  /** Column db name to TS key. */
  keys: Map<string, string>;
}

export function generateSchema(schema: SchemaIR, options: CodegenOptions = {}): CodegenResult {
  const notes: string[] = [];
  const tables = sortByDependencies(schema.tables);
  const taken = new Set<string>();
  const names = new Map<string, TableNames>();
  for (const t of tables) {
    const keys = new Map<string, string>();
    const used = new Set<string>(['$table']);
    for (const c of t.columns) {
      let key = camelCase(c.name);
      if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(key)) key = `_${key}`;
      let k = key;
      for (let i = 2; used.has(k); i++) k = `${key}${i}`;
      used.add(k);
      keys.set(c.name, k);
    }
    names.set(t.name, { ir: t, ident: safeIdent(t.name, taken), keys });
  }
  const position = new Map(tables.map((t, i) => [t.name, i]));
  const imports = new Set<string>(['table', 't']);
  let needsAnyColumn = false;
  const blocks: string[] = [];

  for (const t of tables) {
    const n = names.get(t.name)!;
    const singlePk = t.primaryKey.length === 1 ? t.primaryKey[0] : undefined;
    const lines: string[] = [];
    // The first one column foreign key of a column goes on the column; the rest use the foreignKeys option.
    const inlineFks = new Map<string, ForeignKeyIR>();
    for (const f of t.foreignKeys) if (f.columns.length === 1 && !inlineFks.has(f.columns[0]!)) inlineFks.set(f.columns[0]!, f);
    const inlined = new Set(inlineFks.values());
    for (const c of t.columns) {
      const key = n.keys.get(c.name)!;
      let expr = columnExpr(t, c, singlePk === c.name, options, notes);
      if (singlePk === c.name && !/^t\.(id|bigId)\(\)/.test(expr)) expr += '.primaryKey()';
      const uniq = t.indexes.find((i) => i.unique && i.columns.length === 1 && i.columns[0] === c.name);
      if (uniq && singlePk !== c.name) expr += uniq.name === constraintName(t.name, c.name, 'key') ? '.unique()' : `.unique(${q(uniq.name)})`;
      const fk = inlineFks.get(c.name);
      if (fk) {
        const target = names.get(fk.refTable);
        const refKey = target?.keys.get(fk.refColumns[0]!);
        if (target && refKey) {
          const later = (position.get(fk.refTable) ?? 0) >= (position.get(t.name) ?? 0);
          if (later) needsAnyColumn = true;
          const opts: string[] = [];
          if (fk.onDelete !== 'no action') opts.push(`onDelete: ${q(fk.onDelete)}`);
          if (fk.onUpdate !== 'no action') opts.push(`onUpdate: ${q(fk.onUpdate)}`);
          if (fk.name !== constraintName(t.name, c.name, 'fkey')) opts.push(`name: ${q(fk.name)}`);
          expr += `.references(${later ? '(): AnyColumn' : '()'} => ${target.ident}.${refKey}${opts.length ? `, { ${opts.join(', ')} }` : ''})`;
        } else notes.push(`${t.name}.${c.name} references ${fk.refTable}, which was not found; the foreign key was left out.`);
      }
      if (key !== c.name) expr += `.map(${q(c.name)})`;
      lines.push(`  ${key}: ${expr},`);
    }
    const tableOpts: string[] = [];
    if (t.primaryKey.length > 1) tableOpts.push(`primaryKey: (c) => [${t.primaryKey.map((p) => `c.${n.keys.get(p)}`).join(', ')}]`);
    const idx = t.indexes.filter((i) => !(i.unique && i.columns.length === 1));
    if (idx.length) {
      const items = idx.map((i) => {
        const fn = i.unique ? 'uniqueIndex' : 'index';
        imports.add(fn);
        const cols = i.columns.map((col) => `c.${n.keys.get(col)}`).join(', ');
        const defaultName = constraintName(t.name, ...i.columns, i.unique ? 'key' : 'idx');
        return `${fn}(${cols})${i.name === defaultName ? '' : `.name(${q(i.name)})`}`;
      });
      tableOpts.push(`indexes: (c) => [${items.join(', ')}]`);
    }
    const tableFks: string[] = [];
    for (const fk of t.foreignKeys.filter((f) => !inlined.has(f))) {
      const target = names.get(fk.refTable);
      const refKeys = fk.refColumns.map((col) => target?.keys.get(col));
      if (!target || refKeys.some((k) => !k)) {
        notes.push(`${t.name} has a foreign key ${fk.name} to ${fk.refTable}, which was not found; the foreign key was left out.`);
        continue;
      }
      const later = (position.get(fk.refTable) ?? 0) >= (position.get(t.name) ?? 0);
      if (later) needsAnyColumn = true;
      const opts: string[] = [];
      if (fk.onDelete !== 'no action') opts.push(`onDelete: ${q(fk.onDelete)}`);
      if (fk.onUpdate !== 'no action') opts.push(`onUpdate: ${q(fk.onUpdate)}`);
      if (fk.name !== constraintName(t.name, ...fk.columns, 'fkey')) opts.push(`name: ${q(fk.name)}`);
      const cols = fk.columns.map((col) => `c.${n.keys.get(col)}`).join(', ');
      const targets = refKeys.map((k) => `${target.ident}.${k}`).join(', ');
      tableFks.push(`foreignKey([${cols}], ${later ? '(): AnyColumn[]' : '()'} => [${targets}]${opts.length ? `, { ${opts.join(', ')} }` : ''})`);
    }
    if (tableFks.length) {
      imports.add('foreignKey');
      tableOpts.push(`foreignKeys: (c) => [${tableFks.join(', ')}]`);
    }
    const head = `export const ${n.ident} = table(${q(t.name)}, {\n${lines.join('\n')}\n}`;
    blocks.push(tableOpts.length ? `${head}, {\n  ${tableOpts.join(',\n  ')},\n});` : `${head});`);
  }

  const relations = buildRelations(tables, names);
  if (relations.length) {
    if (relations.some((r) => r.includes('one('))) imports.add('one');
    if (relations.some((r) => r.includes('many('))) imports.add('many');
  }

  const date = (options.date ?? new Date()).toISOString().slice(0, 10);
  const header = [
    `// Schema pulled from ${options.source ?? 'the database'} by kastor db pull on ${date}.`,
    '// This file is now the source of truth: edit it, then run kastor migrate dev.',
  ];
  const from = options.importFrom ?? 'kastor';
  const importLine = `import { ${[...imports].sort(importOrder).join(', ')} } from ${q(from)};`;
  const typeImport = needsAnyColumn ? `\nimport type { AnyColumn } from ${q(from)};` : '';
  const schemaObj = `export const schema = { ${tables.map((t) => names.get(t.name)!.ident).join(', ')} };`;
  const relBlock = relations.length
    ? `\nexport const relations = ({ ${tables.map((t) => names.get(t.name)!.ident).join(', ')} }: typeof schema) => ({\n${relations.join('\n')}\n});\n`
    : '';
  const code = `${header.join('\n')}\n${importLine}${typeImport}\n\n${blocks.join('\n\n')}\n\n${schemaObj}\n${relBlock}`;
  return { code, notes };
}

function importOrder(a: string, b: string): number {
  const order = ['table', 't', 'index', 'uniqueIndex', 'foreignKey', 'one', 'many'];
  return order.indexOf(a) - order.indexOf(b);
}

function columnExpr(t: TableIR, c: ColumnIR, isSinglePk: boolean, options: CodegenOptions, notes: string[]): string {
  const def = normalizeDefault(c.default, c.type);
  let base: string;
  let defaultHandled = false;
  switch (c.type) {
    case 'int':
    case 'bigint':
      if (isSinglePk && def?.kind === 'autoincrement') {
        base = c.type === 'int' ? 't.id()' : 't.bigId()';
        defaultHandled = true;
      } else base = `t.${c.type}()`;
      break;
    case 'string':
      base = c.length === undefined || c.length === DEFAULT_STRING_LENGTH ? 't.string()' : `t.string(${c.length})`;
      break;
    case 'decimal':
      base = (c.precision ?? 10) === 10 && (c.scale ?? 2) === 2 ? 't.decimal()' : `t.decimal(${c.precision ?? 10}, ${c.scale ?? 0})`;
      break;
    case 'enum': {
      const values = `[${(c.enumValues ?? []).map(q).join(', ')}]`;
      const custom = c.enumName && c.enumName !== `${t.name}_${c.name}` ? `, ${q(c.enumName)}` : '';
      base = `t.enum(${values}${custom})`;
      break;
    }
    default:
      base = `t.${c.type}()`;
  }
  let expr = base;
  if (c.nativeType && keepNativeType(t, c, options)) expr += `.nativeType(${q(c.nativeType)})`;
  else if (c.type === 'decimal' && c.precision === undefined && !c.nativeType) {
    // A decimal without precision (Prisma's DECIMAL on SQLite, a bare numeric on PostgreSQL):
    // t.decimal() alone would mean decimal(10, 2).
    const unbounded: Record<string, string> = { sqlite: 'DECIMAL', postgres: 'numeric', cockroach: 'numeric' };
    const native = unbounded[options.dialect?.name ?? ''];
    if (native) expr += `.nativeType(${q(native)})`;
  }
  if (c.nullable) expr += '.nullable()';
  if (def && !defaultHandled) {
    switch (def.kind) {
      case 'now':
        expr += c.type === 'datetime' || c.type === 'date' || c.type === 'time' ? '.defaultNow()' : `.defaultSql('CURRENT_TIMESTAMP')`;
        break;
      case 'random':
        expr += c.type === 'uuid' ? '.defaultRandom()' : '';
        if (c.type !== 'uuid') notes.push(`${t.name}.${c.name} has a random default on a ${c.type} column; it was left out.`);
        break;
      case 'autoincrement':
        notes.push(`${t.name}.${c.name} auto increments but is not a single column primary key; the default was left out.`);
        break;
      case 'sql':
        expr += `.defaultSql(${q(String(def.value))})`;
        break;
      case 'value':
        expr += `.default(${literal(c, def.value)})`;
        break;
    }
  }
  return expr;
}

function literal(c: ColumnIR, value: unknown): string {
  switch (c.type) {
    case 'boolean':
      return String(value === true || value === 'true');
    case 'int':
    case 'float':
      return String(Number(value));
    case 'bigint':
      return `${String(value)}n`;
    case 'datetime':
      return `new Date(${q(String(value))})`;
    case 'json':
      return typeof value === 'string' ? value : JSON.stringify(value);
    default:
      return q(String(value));
  }
}

function keepNativeType(t: TableIR, c: ColumnIR, options: CodegenOptions): boolean {
  const dialect = options.dialect;
  if (!dialect) return false;
  try {
    const render = (col: ColumnIR): string => dialect.ddl({ kind: 'addColumn', table: t.name, column: col }, { tables: [t] }).join('\n');
    const without: ColumnIR = { ...c };
    delete without.nativeType;
    return render(without) !== render(c);
  } catch {
    return false;
  }
}

/** Relation lines per table, guessed from foreign keys. */
function buildRelations(tables: TableIR[], names: Map<string, TableNames>): string[] {
  const rel = new Map<string, Array<[string, string]>>();
  for (const t of tables) rel.set(t.name, []);
  const usedNames = new Map<string, Set<string>>();
  for (const t of tables) usedNames.set(t.name, new Set(names.get(t.name)!.keys.values()));
  const add = (table: string, wanted: string, expr: string): void => {
    const used = usedNames.get(table)!;
    let name = wanted;
    for (let i = 2; used.has(name); i++) name = `${wanted}${i}`;
    used.add(name);
    rel.get(table)!.push([name, expr]);
  };
  const singleFks = (t: TableIR): ForeignKeyIR[] => t.foreignKeys.filter((f) => f.columns.length === 1 && names.has(f.refTable));

  for (const t of tables) {
    const n = names.get(t.name)!;
    const fks = singleFks(t);
    const counts = new Map<string, number>();
    for (const fk of fks) counts.set(fk.refTable, (counts.get(fk.refTable) ?? 0) + 1);
    for (const fk of fks) {
      const target = names.get(fk.refTable)!;
      const fieldKey = n.keys.get(fk.columns[0]!)!;
      const refKey = target.keys.get(fk.refColumns[0]!)!;
      const stripped = fieldKey.replace(/_?(Id|ID|_id)$/, '');
      const oneName = stripped && stripped !== fieldKey ? stripped : singular(target.ident);
      add(t.name, oneName, `one(${target.ident}, { fields: [${q(fieldKey)}], references: [${q(refKey)}] })`);
      const manyBase = plural(singular(n.ident));
      const manyName = (counts.get(fk.refTable) ?? 0) > 1 || fk.refTable === t.name ? `${manyBase}By${oneName.charAt(0).toUpperCase()}${oneName.slice(1)}` : manyBase;
      add(fk.refTable, manyName, `many(${n.ident}, { fields: [${q(refKey)}], references: [${q(fieldKey)}] })`);
    }
    // Composite foreign keys: spelled out on both sides.
    for (const fk of t.foreignKeys.filter((f) => f.columns.length > 1 && names.has(f.refTable))) {
      const target = names.get(fk.refTable)!;
      const fieldKeys = fk.columns.map((c) => n.keys.get(c)!);
      const refKeys = fk.refColumns.map((c) => target.keys.get(c));
      if (refKeys.some((k) => !k)) continue;
      const list = (keys: Array<string | undefined>): string => keys.map((k) => q(k!)).join(', ');
      add(t.name, singular(target.ident), `one(${target.ident}, { fields: [${list(fieldKeys)}], references: [${list(refKeys)}] })`);
      add(fk.refTable, plural(singular(n.ident)), `many(${n.ident}, { fields: [${list(refKeys)}], references: [${list(fieldKeys)}] })`);
    }
    // Join table: exactly two foreign keys to two other tables, covered by the primary key.
    if (fks.length === 2 && fks[0]!.refTable !== fks[1]!.refTable && fks.every((f) => f.refTable !== t.name)) {
      const fkCols = fks.map((f) => f.columns[0]!);
      const pkCovers = t.primaryKey.length === 2 && fkCols.every((c) => t.primaryKey.includes(c));
      const uniqueCovers = t.indexes.some((i) => i.unique && i.columns.length === 2 && fkCols.every((c) => i.columns.includes(c)));
      const extra = t.columns.filter((c) => !fkCols.includes(c.name) && !t.primaryKey.includes(c.name));
      if ((pkCovers || uniqueCovers) && extra.length <= 2) {
        const [a, b] = fks as [ForeignKeyIR, ForeignKeyIR];
        const ta = names.get(a.refTable)!;
        const tb = names.get(b.refTable)!;
        add(a.refTable, plural(singular(tb.ident)), `many(${tb.ident}, { through: ${n.ident} })`);
        add(b.refTable, plural(singular(ta.ident)), `many(${ta.ident}, { through: ${n.ident} })`);
      }
    }
  }
  const out: string[] = [];
  for (const t of tables) {
    const list = rel.get(t.name)!;
    if (!list.length) continue;
    const ident = names.get(t.name)!.ident;
    out.push(`  ${ident}: {\n${list.map(([k, v]) => `    ${k}: ${v},`).join('\n')}\n  },`);
  }
  return out;
}
