/**
 * The diff engine: compares the schema the database has with the schema the
 * code declares and returns the ordered operations that turn one into the
 * other, plus warnings for anything that can lose data or fail on live rows.
 *
 * Renames cannot be told apart from a drop plus a create by looking at two
 * snapshots, so the engine never guesses: `findRenameCandidates` lists the
 * pairs that look like renames, the caller asks the user (or reads
 * `--rename` flags) and passes the answers to `diffSchemas`.
 */
import type { ColumnDefaultIR, ColumnIR, Dialect, EnumIR, ForeignKeyIR, IndexIR, SchemaIR, TableIR } from '../core/ir';
import { applyOp, columnTypeLabel, isDestructive, isWidening, type MigrationOp } from './ops';

export interface Rename {
  kind: 'table' | 'column';
  /** For column renames, the table name in the TARGET schema. */
  table?: string;
  from: string;
  to: string;
}

export interface RenameCandidate {
  kind: 'table' | 'column';
  table?: string;
  /** The name that disappeared. */
  from: string;
  /** Names that appeared and could be the same thing, best match first. */
  to: string[];
}

export interface DiffWarning {
  level: 'danger' | 'warn';
  message: string;
  /** Short advice shown under the warning. */
  hint?: string;
}

export interface DiffOptions {
  renames?: Rename[];
  /** The dialect of the live database. Used for named enums and to compare columns the way the database stores them. */
  dialect?: Pick<Dialect, 'name' | 'features' | 'ddl'>;
  /** Override `dialect.features.namedEnums`. */
  namedEnums?: boolean;
}

export interface DiffResult {
  ops: MigrationOp[];
  warnings: DiffWarning[];
  /** True when at least one op can lose data. */
  destructive: boolean;
}

type DialectLike = NonNullable<DiffOptions['dialect']>;

/* ------------------------------------------------------------------------ */
/* Normalization                                                             */
/* ------------------------------------------------------------------------ */

const NOW = /^(strftime\('[^']*',\s*'now'\)|datetime\('now'(,\s*'[a-z]+')?\)|date\('now'\)|time\('now'\)|current_date|current_time(\(\d*\))?|now\(\)|current_timestamp(\(\d*\))?|localtimestamp(\(\d*\))?|getdate\(\)|getutcdate\(\)|sysdatetime\(\)|sysdate|systimestamp|datetime\('now'\)|transaction_timestamp\(\)|statement_timestamp\(\)|clock_timestamp\(\))$/i;
const RANDOM = /^(gen_random_uuid\(\)|uuid_generate_v4\(\)|uuid\(\)|newid\(\)|sys_guid\(\)|lower\(hex\(randomblob\(16\)\)\)|random_uuid\(\))$/i;

/** Turns introspected SQL defaults into the neutral kinds when they mean the same thing. */
export function normalizeDefault(def: ColumnDefaultIR | undefined, type: ColumnIR['type']): ColumnDefaultIR | undefined {
  if (!def) return undefined;
  if (def.kind !== 'sql' && def.kind !== 'value') return { kind: def.kind };
  let value = def.value;
  if (def.kind === 'sql') {
    let s = String(def.value ?? '').trim();
    while (/^\(.*\)$/.test(s) && balanced(s.slice(1, -1))) s = s.slice(1, -1).trim();
    s = s.replace(/::[a-z_ ]+(\([^)]*\))?(\[\])?$/i, '').trim();
    if (/^null$/i.test(s)) return undefined;
    if (NOW.test(s)) return { kind: 'now' };
    if (RANDOM.test(s)) return { kind: 'random' };
    if (/^nextval\(/i.test(s)) return { kind: 'autoincrement' };
    const quoted = /^[nN]?'((?:[^']|'')*)'$/.exec(s);
    if (quoted) value = quoted[1]!.replace(/''/g, "'");
    else if (/^-?\d+(\.\d+)?$/.test(s)) value = s;
    else if (/^(true|false)$/i.test(s)) value = s.toLowerCase() === 'true';
    else return { kind: 'sql', value: s.replace(/\s+/g, ' ') };
  }
  return { kind: 'value', value: canonicalValue(value, type) };
}

function balanced(s: string): boolean {
  let depth = 0;
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')' && --depth < 0) return false;
  }
  return depth === 0;
}

function canonicalValue(value: unknown, type: ColumnIR['type']): unknown {
  if (type === 'boolean') {
    if (value === 1 || value === '1' || value === 't' || value === 'true' || value === true) return true;
    if (value === 0 || value === '0' || value === 'f' || value === 'false' || value === false) return false;
  }
  if (type === 'int' || type === 'bigint' || type === 'float' || type === 'decimal') {
    if (typeof value === 'number' || typeof value === 'bigint' || (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value))) {
      const n = String(value);
      return n.includes('.') ? n.replace(/0+$/, '').replace(/\.$/, '') : n;
    }
  }
  if (type === 'json' && typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value));
    } catch {
      return value;
    }
  }
  if (type === 'json') return JSON.stringify(value);
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
}

function sameDefault(a: ColumnIR, b: ColumnIR): boolean {
  const da = normalizeDefault(a.default, a.type);
  const db = normalizeDefault(b.default, b.type);
  if (!da || !db) return !da && !db;
  if (da.kind !== db.kind) return false;
  if (da.kind === 'value' || da.kind === 'sql') return String(da.value).toLowerCase() === String(db.value).toLowerCase();
  return true;
}

export function enumNameOf(table: string, col: ColumnIR): string {
  return col.enumName ?? `${table}_${col.name}`;
}

/* ------------------------------------------------------------------------ */
/* Column comparison                                                         */
/* ------------------------------------------------------------------------ */

interface ColumnDelta {
  type: boolean;
  nullable: boolean;
  default: boolean;
}

/**
 * What differs between the live column `from` and the declared column `to`.
 * Details the code leaves open (string length, decimal precision, native type)
 * only count when the code sets them.
 */
export function compareColumns(table: string, from: ColumnIR, to: ColumnIR, namedEnums: boolean): ColumnDelta {
  let type = from.type !== to.type;
  if (!type) {
    if (to.type === 'string' && (from.length ?? DEFAULT_STRING_LENGTH) !== (to.length ?? DEFAULT_STRING_LENGTH)) type = true;
    if (to.precision !== undefined && from.precision !== to.precision) type = true;
    if (to.scale !== undefined && (from.scale ?? 0) !== to.scale) type = true;
    if (to.type === 'enum') {
      if (namedEnums) type ||= enumNameOf(table, from) !== enumNameOf(table, to);
      else type ||= (from.enumValues ?? []).join('\u0000') !== (to.enumValues ?? []).join('\u0000');
    }
  }
  if (to.nativeType && norm(from.nativeType) !== norm(to.nativeType)) type = true;
  const fromAuto = from.default?.kind === 'autoincrement';
  const toAuto = to.default?.kind === 'autoincrement';
  return {
    type: type || fromAuto !== toAuto,
    nullable: from.nullable !== to.nullable,
    default: !fromAuto && !toAuto && !sameDefault(from, to),
  };
}

/** `t.string()` without a length becomes varchar(255) in migrations. */
export const DEFAULT_STRING_LENGTH = 255;

const norm = (s: string | undefined): string => (s ?? '').toLowerCase().replace(/\s+/g, '');

/** Asks the dialect whether two columns produce the same DDL; false when it cannot tell. */
function sameInDialect(dialect: DialectLike | undefined, table: TableIR, from: ColumnIR, to: ColumnIR, context?: SchemaIR): boolean {
  if (!dialect) return false;
  try {
    const strip = (c: ColumnIR): ColumnIR => {
      const copy: ColumnIR = { ...c, name: to.name };
      if (!to.nativeType) delete copy.nativeType;
      if (c.default) copy.default = normalizeDefault(c.default, c.type);
      if (!copy.default) delete copy.default;
      return copy;
    };
    const render = (c: ColumnIR): string => {
      const t: TableIR = { ...table, columns: [...table.columns.filter((x) => x.name !== to.name), c] };
      const schema: SchemaIR = withTable(context, t);
      return dialect.ddl({ kind: 'addColumn', table: table.name, column: c }, schema).join('\n');
    };
    const a = render(strip(from));
    return a !== '' && a === render(strip(to));
  } catch {
    return false;
  }
}

/** The context schema with `table` in place of its namesake (or added). */
function withTable(context: SchemaIR | undefined, table: TableIR): SchemaIR {
  if (!context) return { tables: [table] };
  const found = context.tables.some((t) => t.name === table.name);
  return { ...context, tables: found ? context.tables.map((t) => (t.name === table.name ? table : t)) : [...context.tables, table] };
}

function sameFkInDialect(dialect: DialectLike | undefined, table: TableIR, a: ForeignKeyIR, b: ForeignKeyIR, context?: SchemaIR): boolean {
  if (!dialect) return false;
  try {
    const render = (fk: ForeignKeyIR): string => {
      const named = { ...fk, name: b.name };
      const t: TableIR = { ...table, foreignKeys: [...table.foreignKeys.filter((x) => x.name !== b.name && x.name !== fk.name), named] };
      return dialect.ddl({ kind: 'addForeignKey', table: table.name, foreignKey: named }, withTable(context, t)).join('\n');
    };
    const x = render(a);
    return x !== '' && x === render(b);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------------ */
/* Rename detection                                                          */
/* ------------------------------------------------------------------------ */

function compatible(from: ColumnIR, to: ColumnIR): boolean {
  return from.type === to.type || isWidening(from, to);
}

function tableSimilarity(a: TableIR, b: TableIR): number {
  const max = Math.max(a.columns.length, b.columns.length);
  if (!max) return 1;
  let same = 0;
  for (const col of a.columns) {
    const other = b.columns.find((c) => c.name === col.name);
    if (other && compatible(col, other)) same++;
  }
  return same / max;
}

/** Tables that disappeared while similar tables appeared. */
export function findTableRenameCandidates(current: SchemaIR, target: SchemaIR): RenameCandidate[] {
  const targetNames = new Set(target.tables.map((t) => t.name));
  const currentNames = new Set(current.tables.map((t) => t.name));
  const dropped = current.tables.filter((t) => !targetNames.has(t.name));
  const added = target.tables.filter((t) => !currentNames.has(t.name));
  const out: RenameCandidate[] = [];
  for (const d of dropped) {
    const scored = added
      .map((a) => ({ name: a.name, score: tableSimilarity(d, a) }))
      .filter((s) => s.score >= 0.5 || (dropped.length === 1 && added.length === 1))
      .sort((x, y) => y.score - x.score || x.name.localeCompare(y.name));
    if (scored.length) out.push({ kind: 'table', from: d.name, to: scored.map((s) => s.name) });
  }
  return out;
}

/** Columns that disappeared while columns of a compatible type appeared in the same table. */
export function findColumnRenameCandidates(current: SchemaIR, target: SchemaIR, tableRenames: Rename[] = []): RenameCandidate[] {
  const out: RenameCandidate[] = [];
  const renamed = applyRenames(current, tableRenames.filter((r) => r.kind === 'table'));
  for (const t of target.tables) {
    const live = renamed.tables.find((x) => x.name === t.name);
    if (!live) continue;
    const dropped = live.columns.filter((c) => !t.columns.some((x) => x.name === c.name));
    const added = t.columns.filter((c) => !live.columns.some((x) => x.name === c.name));
    for (const d of dropped) {
      const to = added
        .filter((a) => compatible(d, a))
        .sort((x, y) => Number(y.type === d.type) - Number(x.type === d.type) || x.name.localeCompare(y.name))
        .map((a) => a.name);
      if (to.length) out.push({ kind: 'column', table: t.name, from: d.name, to });
    }
  }
  return out;
}

/** Applies rename answers to the live schema, so the rest of the diff sees matching names. */
export function applyRenames(schema: SchemaIR, renames: Rename[]): SchemaIR {
  let next = schema;
  for (const r of renames.filter((x) => x.kind === 'table')) {
    if (!next.tables.some((t) => t.name === r.from)) throw new RenameError(`Cannot rename table ${r.from}: the database has no such table.`);
    next = applyOp(next, { kind: 'renameTable', from: r.from, to: r.to });
  }
  for (const r of renames.filter((x) => x.kind === 'column')) {
    const t = next.tables.find((x) => x.name === r.table);
    if (!t) throw new RenameError(`Cannot rename column ${r.table}.${r.from}: the database has no table ${r.table}.`);
    if (!t.columns.some((c) => c.name === r.from)) throw new RenameError(`Cannot rename column ${r.table}.${r.from}: the table has no such column.`);
    next = applyOp(next, { kind: 'renameColumn', table: r.table!, from: r.from, to: r.to });
  }
  return next;
}

export class RenameError extends Error {
  override name = 'RenameError';
}

/* ------------------------------------------------------------------------ */
/* Ordering                                                                  */
/* ------------------------------------------------------------------------ */

/**
 * Orders tables so every table comes after the tables it references. Returns
 * the order and the foreign keys that had to be deferred to break cycles.
 */
export function orderTables(tables: TableIR[]): { order: TableIR[]; deferred: Array<{ table: string; foreignKey: ForeignKeyIR }> } {
  const names = new Set(tables.map((t) => t.name));
  const remaining = new Map(tables.map((t) => [t.name, t]));
  const deps = new Map<string, Set<string>>();
  for (const t of tables) deps.set(t.name, new Set(t.foreignKeys.map((f) => f.refTable).filter((r) => r !== t.name && names.has(r))));
  const order: TableIR[] = [];
  const deferred: Array<{ table: string; foreignKey: ForeignKeyIR }> = [];
  const sortedNames = (): string[] => [...remaining.keys()].sort();
  while (remaining.size) {
    const ready = sortedNames().filter((n) => [...deps.get(n)!].every((d) => !remaining.has(d)));
    if (ready.length) {
      for (const n of ready) {
        order.push(remaining.get(n)!);
        remaining.delete(n);
      }
      continue;
    }
    // A cycle: create the first table now and add its foreign keys to the
    // other remaining tables later.
    const name = sortedNames()[0]!;
    const t = remaining.get(name)!;
    const keep: ForeignKeyIR[] = [];
    for (const fk of t.foreignKeys) {
      if (fk.refTable !== name && remaining.has(fk.refTable)) deferred.push({ table: name, foreignKey: fk });
      else keep.push(fk);
    }
    order.push({ ...t, foreignKeys: keep });
    remaining.delete(name);
  }
  return { order, deferred };
}

/* ------------------------------------------------------------------------ */
/* Enums                                                                     */
/* ------------------------------------------------------------------------ */

function collectEnums(schema: SchemaIR): Map<string, EnumIR> {
  const map = new Map<string, EnumIR>();
  for (const e of schema.enums ?? []) map.set(e.name, { name: e.name, values: [...e.values] });
  for (const t of schema.tables) {
    for (const c of t.columns) {
      if (c.type !== 'enum') continue;
      const name = enumNameOf(t.name, c);
      if (!map.has(name)) map.set(name, { name, values: [...(c.enumValues ?? [])] });
    }
  }
  return map;
}

function enumUsers(schema: SchemaIR, name: string): Array<{ table: string; column: string }> {
  const out: Array<{ table: string; column: string }> = [];
  for (const t of schema.tables) for (const c of t.columns) if (c.type === 'enum' && enumNameOf(t.name, c) === name) out.push({ table: t.name, column: c.name });
  return out;
}

/**
 * False for databases that do not keep foreign keys (MongoDB emulates them
 * from the schema): their `addForeignKey` DDL is empty, so the live schema
 * never shows foreign keys and comparing them would always differ.
 */
export function storesForeignKeys(dialect: DialectLike | undefined): boolean {
  if (!dialect) return true;
  const parent: TableIR = { name: 'p', columns: [{ name: 'id', type: 'int', nullable: false }], primaryKey: ['id'], indexes: [], foreignKeys: [] };
  const foreignKey: ForeignKeyIR = { name: 'c_p_fkey', columns: ['p_id'], refTable: 'p', refColumns: ['id'], onDelete: 'no action', onUpdate: 'no action' };
  const child: TableIR = { name: 'c', columns: [{ name: 'id', type: 'int', nullable: false }, { name: 'p_id', type: 'int', nullable: false }], primaryKey: ['id'], indexes: [], foreignKeys: [foreignKey] };
  try {
    return dialect.ddl({ kind: 'addForeignKey', table: 'c', foreignKey }, { tables: [parent, child] }).length > 0;
  } catch {
    return true;
  }
}

/* ------------------------------------------------------------------------ */
/* Diff                                                                      */
/* ------------------------------------------------------------------------ */

const indexKey = (i: IndexIR): string => `${i.unique ? 'u' : 'i'}:${i.columns.join(',')}`;
const action = (a: string): string => (a === 'restrict' ? 'no action' : a);
const fkKey = (f: ForeignKeyIR): string => `${f.columns.join(',')}>${f.refTable}(${f.refColumns.join(',')})`;
const fkFullKey = (f: ForeignKeyIR): string => `${fkKey(f)}:${action(f.onDelete)}:${action(f.onUpdate)}`;

/**
 * Diffs the live schema (`current`) against the declared one (`target`).
 * Renames listed in `options.renames` become rename ops; every other missing
 * table or column is dropped.
 */
export function diffSchemas(current: SchemaIR, target: SchemaIR, options: DiffOptions = {}): DiffResult {
  const dialect = options.dialect;
  const namedEnums = options.namedEnums ?? dialect?.features.namedEnums ?? false;
  const fksStored = storesForeignKeys(dialect);
  const renames = options.renames ?? [];
  const warnings: DiffWarning[] = [];

  const tableRenames = renames.filter((r) => r.kind === 'table');
  const columnRenames = renames.filter((r) => r.kind === 'column');
  for (const r of tableRenames) {
    if (!target.tables.some((t) => t.name === r.to)) throw new RenameError(`Cannot rename table ${r.from} to ${r.to}: the schema has no table ${r.to}.`);
  }
  for (const r of columnRenames) {
    const t = target.tables.find((x) => x.name === r.table);
    if (!t?.columns.some((c) => c.name === r.to)) throw new RenameError(`Cannot rename column ${r.table}.${r.from} to ${r.to}: the schema has no column ${r.table}.${r.to}.`);
  }
  const live = applyRenames(current, renames);

  const ops = {
    renames: [] as MigrationOp[],
    enumsBefore: [] as MigrationOp[],
    dropFks: [] as MigrationOp[],
    dropIndexes: [] as MigrationOp[],
    createTables: [] as MigrationOp[],
    addColumns: [] as MigrationOp[],
    alterColumns: [] as MigrationOp[],
    dropColumns: [] as MigrationOp[],
    dropTables: [] as MigrationOp[],
    createIndexes: [] as MigrationOp[],
    addFks: [] as MigrationOp[],
    enumsAfter: [] as MigrationOp[],
  };
  for (const r of tableRenames) ops.renames.push({ kind: 'renameTable', from: r.from, to: r.to });
  for (const r of columnRenames) ops.renames.push({ kind: 'renameColumn', table: r.table!, from: r.from, to: r.to });

  // Named enums.
  if (namedEnums) {
    const before = collectEnums(live);
    const after = collectEnums(target);
    for (const [name, e] of after) {
      const old = before.get(name);
      if (!old) {
        ops.enumsBefore.push({ kind: 'createEnum', enum: e });
        continue;
      }
      if (old.values.join('\u0000') !== e.values.join('\u0000')) {
        const removed = old.values.filter((v) => !e.values.includes(v));
        ops.enumsBefore.push({
          kind: 'alterEnum',
          name,
          from: old.values,
          to: e.values,
          added: e.values.filter((v) => !old.values.includes(v)),
          removed,
          columns: enumUsers(target, name),
        });
        if (removed.length) {
          warnings.push({
            level: 'danger',
            message: `Enum ${name} loses the value${removed.length > 1 ? 's' : ''} ${removed.join(', ')}. Rows that hold ${removed.length > 1 ? 'them' : 'it'} make the migration fail.`,
            hint: `Update those rows first, for example: UPDATE ... SET ... = '${e.values[0] ?? ''}' WHERE ... = '${removed[0]}'.`,
          });
        }
      }
    }
    for (const [name, e] of before) if (!after.has(name)) ops.enumsAfter.push({ kind: 'dropEnum', enum: e });
  }

  const liveByName = new Map(live.tables.map((t) => [t.name, t]));
  const targetByName = new Map(target.tables.map((t) => [t.name, t]));

  // New tables, in dependency order.
  const created = target.tables.filter((t) => !liveByName.has(t.name));
  const { order, deferred } = orderTables(created);
  for (const t of order) ops.createTables.push({ kind: 'createTable', table: t });
  for (const d of deferred) ops.addFks.push({ kind: 'addForeignKey', table: d.table, foreignKey: d.foreignKey });

  // Dropped tables: referencing tables first; foreign keys inside a cycle go first.
  const dropped = live.tables.filter((t) => !targetByName.has(t.name));
  if (dropped.length) {
    const { order: dropOrder, deferred: cyclic } = orderTables(dropped);
    for (const d of cyclic) ops.dropFks.push({ kind: 'dropForeignKey', table: d.table, foreignKey: d.foreignKey });
    for (const t of [...dropOrder].reverse()) {
      ops.dropTables.push({ kind: 'dropTable', table: t.name, previous: liveByName.get(t.name) });
      warnings.push({ level: 'danger', message: `Table ${t.name} will be dropped with all of its rows.`, hint: `If it was renamed, run again with --rename ${t.name}:<new name>.` });
    }
  }

  // Tables on both sides.
  for (const t of target.tables) {
    const old = liveByName.get(t.name);
    if (!old) continue;
    const typeChanged = new Set<string>();

    for (const col of t.columns) {
      const was = old.columns.find((c) => c.name === col.name);
      if (!was) {
        ops.addColumns.push({ kind: 'addColumn', table: t.name, column: col });
        if (!col.nullable && !col.default) {
          warnings.push({
            level: 'warn',
            message: `Column ${t.name}.${col.name} is required and has no default, so adding it fails if ${t.name} already has rows.`,
            hint: 'Give it a default (.default(...)), make it nullable, or fill it in a second migration.',
          });
        }
        continue;
      }
      const delta = compareColumns(t.name, was, col, namedEnums);
      if (!delta.type && !delta.nullable && !delta.default) continue;
      if (sameInDialect(dialect, old, was, col, target)) continue;
      const op: MigrationOp = { kind: 'alterColumn', table: t.name, column: col.name, from: was, to: col, changes: delta };
      ops.alterColumns.push(op);
      if (delta.type) {
        typeChanged.add(col.name);
        if (isDestructive(op)) {
          warnings.push({
            level: 'danger',
            message: `Column ${t.name}.${col.name} changes type from ${columnTypeLabel(was)} to ${columnTypeLabel(col)}, which can lose data or fail on existing rows.`,
          });
        }
      }
      if (delta.nullable && !col.nullable) {
        warnings.push({
          level: 'warn',
          message: `Column ${t.name}.${col.name} becomes required. The migration fails if any row holds NULL there.`,
          hint: `Fill the NULLs first: UPDATE ${t.name} SET ${col.name} = ... WHERE ${col.name} IS NULL.`,
        });
      }
    }
    for (const was of old.columns) {
      if (t.columns.some((c) => c.name === was.name)) continue;
      ops.dropColumns.push({ kind: 'dropColumn', table: t.name, column: was.name, previous: was });
      warnings.push({
        level: 'danger',
        message: `Column ${t.name}.${was.name} will be dropped with its data.`,
        hint: `If it was renamed, run again with --rename ${t.name}.${was.name}:<new name>.`,
      });
    }

    if (old.primaryKey.join(',') !== t.primaryKey.join(',') && t.primaryKey.length) {
      warnings.push({
        level: 'warn',
        message: `The primary key of ${t.name} changes from (${old.primaryKey.join(', ') || 'none'}) to (${t.primaryKey.join(', ')}). kastor does not change primary keys of existing tables.`,
        hint: 'Write that change by hand in a migration created with --create-only.',
      });
    }

    // Foreign keys.
    const touches = (fk: ForeignKeyIR, table: string): boolean =>
      fk.columns.some((c) => typeChanged.has(c)) || (fk.refTable === table && fk.refColumns.some((c) => typeChanged.has(c)));
    for (const fk of fksStored ? old.foreignKeys : []) {
      const match = t.foreignKeys.find((x) => fkFullKey(x) === fkFullKey(fk) || (fkKey(x) === fkKey(fk) && sameFkInDialect(dialect, t, fk, x, target)));
      if (!match || touches(fk, t.name)) ops.dropFks.push({ kind: 'dropForeignKey', table: t.name, foreignKey: fk });
    }
    for (const fk of fksStored ? t.foreignKeys : []) {
      const match = old.foreignKeys.find((x) => fkFullKey(x) === fkFullKey(fk) || (fkKey(x) === fkKey(fk) && sameFkInDialect(dialect, t, x, fk, target)));
      if (!match || touches(match, t.name)) ops.addFks.push({ kind: 'addForeignKey', table: t.name, foreignKey: fk });
    }

    // Indexes, matched by columns and uniqueness (names may differ).
    const rebuildForType = dialect?.name === 'mssql';
    for (const idx of old.indexes) {
      const match = t.indexes.find((x) => indexKey(x) === indexKey(idx));
      const rebuild = rebuildForType && idx.columns.some((c) => typeChanged.has(c));
      if (match && !rebuild) continue;
      if (!match && !idx.unique && t.foreignKeys.some((fk) => fk.columns.every((c, i) => idx.columns[i] === c))) continue; // index the database made for a foreign key
      ops.dropIndexes.push({ kind: 'dropIndex', table: t.name, index: idx });
    }
    for (const idx of t.indexes) {
      const match = old.indexes.find((x) => indexKey(x) === indexKey(idx));
      const rebuild = rebuildForType && idx.columns.some((c) => typeChanged.has(c));
      if (match && !rebuild) continue;
      ops.createIndexes.push({ kind: 'createIndex', table: t.name, index: match && rebuild ? match : idx });
      if (idx.unique && !match) {
        warnings.push({ level: 'warn', message: `Unique index ${idx.name} on ${t.name} (${idx.columns.join(', ')}) fails if duplicates already exist.` });
      }
    }
  }

  // Foreign keys on other tables that point at a column whose type changes.
  for (const t of fksStored ? target.tables : []) {
    const old = liveByName.get(t.name);
    if (!old) continue;
    for (const fk of old.foreignKeys) {
      if (fk.refTable === t.name) continue;
      const refOld = liveByName.get(fk.refTable);
      const refNew = targetByName.get(fk.refTable);
      if (!refOld || !refNew) continue;
      const changed = fk.refColumns.some((c) => {
        const a = refOld.columns.find((x) => x.name === c);
        const b = refNew.columns.find((x) => x.name === c);
        return a && b && compareColumns(fk.refTable, a, b, namedEnums).type && !sameInDialect(dialect, refOld, a, b, target);
      });
      if (!changed) continue;
      const already = (list: MigrationOp[]): boolean =>
        list.some((o) => (o.kind === 'dropForeignKey' || o.kind === 'addForeignKey') && o.table === t.name && fkKey(o.foreignKey) === fkKey(fk));
      if (!already(ops.dropFks)) ops.dropFks.push({ kind: 'dropForeignKey', table: t.name, foreignKey: fk });
      const now = t.foreignKeys.find((x) => fkKey(x) === fkKey(fk));
      if (now && !already(ops.addFks)) ops.addFks.push({ kind: 'addForeignKey', table: t.name, foreignKey: now });
    }
  }

  const all = [
    ...ops.renames,
    ...ops.enumsBefore,
    ...ops.dropFks,
    ...ops.dropIndexes,
    ...ops.createTables,
    ...ops.addColumns,
    ...ops.alterColumns,
    ...ops.dropColumns,
    ...ops.dropTables,
    ...ops.createIndexes,
    ...ops.addFks,
    ...ops.enumsAfter,
  ];
  return { ops: all, warnings, destructive: all.some(isDestructive) };
}

/** True when the two schemas need no migration between them. */
export function schemasMatch(current: SchemaIR, target: SchemaIR, options: Omit<DiffOptions, 'renames'> = {}): boolean {
  return diffSchemas(current, target, options).ops.length === 0;
}
