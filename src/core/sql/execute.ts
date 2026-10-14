/**
 * Runs QueryIR on a SQL executor: compiles, sends, decodes, and emulates
 * what the database lacks (RETURNING, native upsert, JSON aggregation).
 */
import { errors, KastorError } from '../errors';
import type {
  AggregateIR,
  ColumnIR,
  CompiledQuery,
  CreateManyQueryIR,
  CreateQueryIR,
  DeleteManyQueryIR,
  DeleteQueryIR,
  ExecResult,
  Executor,
  PreparedStatement,
  QueryIR,
  Row,
  SchemaIR,
  SelectColumnIR,
  TableIR,
  UpdateManyQueryIR,
  UpdateQueryIR,
  UpdateValueIR,
  UpsertQueryIR,
  WhereIR,
} from '../ir';
import { COUNT_PREFIX, HIDDEN_KEY, LINK_PREFIX, SqlCompiler, type LevelPlan } from './compile';
import { join, q, type Sql } from './frag';
import type { SqlHooks } from './hooks';
import { ORDER_KEY } from './json';
import { bytesToHex } from './values';

const compilers = new WeakMap<SqlHooks, WeakMap<SchemaIR, SqlCompiler>>();

export function compilerFor(hooks: SqlHooks, schema: SchemaIR): SqlCompiler {
  let bySchema = compilers.get(hooks);
  if (!bySchema) compilers.set(hooks, (bySchema = new WeakMap()));
  let c = bySchema.get(schema);
  if (!c) bySchema.set(schema, (c = new SqlCompiler(hooks, schema)));
  return c;
}

function render(c: SqlCompiler, sql: Sql): CompiledQuery {
  return sql.render(c.hooks.placeholder);
}

async function run(c: SqlCompiler, exec: Executor, sql: Sql): Promise<ExecResult> {
  const { sql: textSql, params } = render(c, sql);
  return exec.query(textSql, params);
}

/* ------------------------------------------------------------------------ */
/* Decoding                                                                   */
/* ------------------------------------------------------------------------ */

/** Canonical string for grouping keys of any type. */
export function keyString(values: readonly unknown[]): string {
  return values
    .map((v) => {
      if (v === null || v === undefined) return '\u0000';
      if (v instanceof Date) return `d${v.toISOString()}`;
      if (v instanceof Uint8Array) return `b${bytesToHex(v)}`;
      if (typeof v === 'string') return `s${v}`;
      return `v${String(v)}`;
    })
    .join('\u0001');
}

function parseJson(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (cause) {
      throw new KastorError('QUERY_FAILED', 'The database returned an include that is not valid JSON.', {
        hint: 'This usually means the dialect JSON flavor does not match the database version. Report it with the SQL from toSQL().',
        cause,
        meta: { value: value.slice(0, 200) },
      });
    }
  }
  if (value instanceof Uint8Array) return parseJson(new TextDecoder().decode(value));
  return value;
}

function decodeColumns(c: SqlCompiler, raw: Record<string, unknown>, columns: readonly SelectColumnIR[], tbl: TableIR, source: 'row' | 'json'): Row {
  const out: Row = {};
  for (const s of columns) out[s.as] = c.hooks.decode(raw[s.as], c.column(tbl, s.column), source);
  return out;
}

export function decodeRow(c: SqlCompiler, raw: Record<string, unknown>, plan: LevelPlan, source: 'row' | 'json'): Row {
  const read = plan.read;
  const out = decodeColumns(c, raw, read.select, plan.table, source);
  for (const h of plan.hidden) {
    out[h] = c.hooks.decode(raw[h], c.column(plan.table, h.slice(HIDDEN_KEY.length)), source);
  }
  if (read.counts.length > 0) {
    const obj = source === 'json' ? ((parseJson(raw._count) ?? {}) as Record<string, unknown>) : null;
    out._count = Object.fromEntries(
      read.counts.map((cnt) => [cnt.as, Number((obj ? obj[cnt.as] : raw[COUNT_PREFIX + cnt.as]) ?? 0)]),
    );
  }
  for (const { inc, plan: child } of plan.json) {
    const value = parseJson(raw[inc.relation.name]);
    if (inc.relation.cardinality === 'many') {
      let list = (Array.isArray(value) ? value : value === null || value === undefined ? [] : [value]) as Record<string, unknown>[];
      if (list.length > 0 && typeof list[0] === 'object' && list[0] !== null && ORDER_KEY in list[0]) {
        list = [...list].sort((a, b) => Number(a[ORDER_KEY]) - Number(b[ORDER_KEY]));
      }
      let rows = list.map((item) => decodeRow(c, (parseJson(item) ?? {}) as Record<string, unknown>, child, 'json'));
      if (inc.read.distinct?.length) rows = distinctRows(rows, inc.read.distinct, inc.read.select);
      out[inc.relation.name] = rows;
    } else {
      out[inc.relation.name] = value === null || value === undefined ? null : decodeRow(c, value as Record<string, unknown>, child, 'json');
    }
  }
  return out;
}

function distinctRows(rows: Row[], distinct: readonly string[], select: readonly SelectColumnIR[]): Row[] {
  const keys = distinct.map((col) => select.find((s) => s.column === col)?.as ?? col);
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = keyString(keys.map((key) => r[key]));
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Loads IN-list includes level by level (one query per include per level, never per row). */
async function loadFallbacks(c: SqlCompiler, exec: Executor, rows: Row[], plan: LevelPlan): Promise<void> {
  if (rows.length === 0) return;
  for (const { inc, plan: child } of plan.json) {
    const children: Row[] = [];
    for (const r of rows) {
      const v = r[inc.relation.name];
      if (Array.isArray(v)) children.push(...(v as Row[]));
      else if (v) children.push(v as Row);
    }
    await loadFallbacks(c, exec, children, child);
  }
  for (const { inc, plan: child } of plan.fallback) {
    const rel = inc.relation;
    const many = rel.cardinality === 'many';
    const groups = new Map<string, Row[]>();
    const unique = new Map<string, unknown[]>();
    for (const r of rows) {
      const key = rel.fromColumns.map((col) => r[HIDDEN_KEY + col]);
      if (key.some((v) => v === null || v === undefined)) continue;
      unique.set(keyString(key), key);
    }
    const keys = [...unique.values()];
    const linkTable = c.table(rel.through ? rel.through.table : rel.to);
    const linkColumns: ColumnIR[] = (rel.through ? rel.through.sourceColumns : rel.toColumns).map((col) => c.column(linkTable, col));
    const perChunk = Math.max(1, Math.min(c.hooks.maxInList, Math.floor((c.hooks.maxParams - 50) / Math.max(1, rel.fromColumns.length))));
    const loaded: Row[] = [];
    for (let i = 0; i < keys.length; i += perChunk) {
      const chunk = keys.slice(i, i + perChunk);
      const result = await run(c, exec, c.compileFallback(inc, chunk, child, plan.table));
      for (const raw of result.rows) {
        const row = decodeRow(c, raw, child, 'row');
        const link = linkColumns.map((col, j) => c.hooks.decode(raw[LINK_PREFIX + j], col, 'row'));
        const k = keyString(link);
        let g = groups.get(k);
        if (!g) groups.set(k, (g = []));
        g.push(row);
        loaded.push(row);
      }
    }
    for (const r of rows) {
      const key = rel.fromColumns.map((col) => r[HIDDEN_KEY + col]);
      let found = key.some((v) => v === null || v === undefined) ? [] : (groups.get(keyString(key)) ?? []);
      if (many && inc.read.distinct?.length) found = distinctRows(found, inc.read.distinct, inc.read.select);
      r[rel.name] = many ? found : (found[0] ?? null);
    }
    await loadFallbacks(c, exec, loaded, child);
  }
}

function stripHidden(rows: Row[], plan: LevelPlan): void {
  const nested = [...plan.json, ...plan.fallback];
  if (plan.hidden.length === 0 && nested.length === 0) return;
  for (const r of rows) {
    for (const h of plan.hidden) delete r[h];
    for (const { inc, plan: child } of nested) {
      const v = r[inc.relation.name];
      if (Array.isArray(v)) stripHidden(v as Row[], child);
      else if (v) stripHidden([v as Row], child);
    }
  }
}

function decodeAggregate(c: SqlCompiler, value: unknown, a: AggregateIR, tbl: TableIR): unknown {
  if (value === null || value === undefined) return a.fn === 'count' ? 0 : null;
  if (a.fn === 'count') return Number(value);
  const column = a.column === null ? undefined : c.column(tbl, a.column);
  if (!column) return Number(value);
  if (a.fn === 'avg') return column.type === 'decimal' ? c.hooks.decode(value, column, 'row') : Number(value);
  if (a.fn === 'sum') {
    if (column.type === 'bigint' || column.type === 'decimal') return c.hooks.decode(value, column, 'row');
    return Number(value);
  }
  return c.hooks.decode(value, column, 'row');
}

/* ------------------------------------------------------------------------ */
/* Helpers                                                                    */
/* ------------------------------------------------------------------------ */

function definedColumns(data: Record<string, unknown>): string[] {
  return Object.keys(data).filter((k) => data[k] !== undefined);
}

function keyWhere(columns: readonly string[], values: Record<string, unknown>): WhereIR {
  return { kind: 'and', items: columns.map((column) => ({ kind: 'compare' as const, column, op: 'eq' as const, value: values[column] })) };
}

function keysWhere(columns: readonly string[], rows: readonly Record<string, unknown>[]): WhereIR {
  if (columns.length === 1) return { kind: 'in', column: columns[0]!, values: rows.map((r) => r[columns[0]!]), negate: false };
  return { kind: 'or', items: rows.map((r) => keyWhere(columns, r)) };
}

function hasSubquery(w: WhereIR | undefined): boolean {
  if (!w) return false;
  switch (w.kind) {
    case 'and':
    case 'or':
      return w.items.some(hasSubquery);
    case 'not':
      return hasSubquery(w.item);
    case 'relation':
    case 'raw':
      return true;
    default:
      return false;
  }
}

function requirePk(tbl: TableIR, what: string): string[] {
  if (tbl.primaryKey.length === 0) {
    throw errors.unsupported(
      `${what} on table "${tbl.name}" without a primary key`,
      'this dialect',
      'Add a primary key: kastor needs it to read rows back on databases without RETURNING.',
    );
  }
  return tbl.primaryKey;
}

const pkSelect = (pk: readonly string[]): SelectColumnIR[] => pk.map((column) => ({ column, as: column }));

async function selectRows(c: SqlCompiler, exec: Executor, table: string, columns: SelectColumnIR[], where: WhereIR | undefined, take?: number): Promise<Record<string, unknown>[]> {
  const res = await run(c, exec, c.compileSelectWhere(table, columns, where, take));
  return res.rows;
}

/** Primary key (column to value) of a freshly inserted row. */
async function insertedKey(c: SqlCompiler, exec: Executor, tbl: TableIR, data: Record<string, unknown>, res: ExecResult): Promise<Record<string, unknown> | null> {
  const pk = tbl.primaryKey;
  if (pk.length > 0 && pk.every((col) => data[col] !== undefined && data[col] !== null)) {
    return Object.fromEntries(pk.map((col) => [col, data[col]]));
  }
  if (pk.length === 1) {
    let id = res.insertId;
    if ((id === undefined || id === null) && c.hooks.lastInsertIdSql) {
      const r = await exec.query(c.hooks.lastInsertIdSql, []);
      const first = r.rows[0];
      id = first ? (first.id ?? first.ID ?? Object.values(first)[0]) : undefined;
    }
    if (id !== undefined && id !== null) return { [pk[0]!]: id };
  }
  for (const idx of tbl.indexes) {
    if (idx.unique && idx.columns.every((col) => data[col] !== undefined && data[col] !== null)) {
      return Object.fromEntries(idx.columns.map((col) => [col, data[col]]));
    }
  }
  return null;
}

/* ------------------------------------------------------------------------ */
/* Operations                                                                 */
/* ------------------------------------------------------------------------ */

async function create(c: SqlCompiler, exec: Executor, query: CreateQueryIR): Promise<Row> {
  const tbl = c.table(query.table);
  const cols = definedColumns(query.data);
  if (c.hooks.returning !== 'none') {
    const res = await run(c, exec, c.compileInsert(query.table, cols, [query.data], { returning: query.returning }));
    const raw = res.rows[0];
    if (!raw) throw new KastorError('QUERY_FAILED', `The insert into ${tbl.name} returned no row.`, { hint: 'Check for triggers that cancel the insert.' });
    return decodeColumns(c, raw, query.returning, tbl, 'row');
  }
  const res = await run(c, exec, c.compileInsert(query.table, cols, [query.data]));
  if (query.returning.length === 0) return {};
  const key = await insertedKey(c, exec, tbl, query.data, res);
  if (!key) {
    // No key to read the row back: return what was written.
    return decodeColumns(c, query.data, query.returning.filter((r) => r.column in query.data), tbl, 'row');
  }
  const rows = await selectRows(c, exec, query.table, query.returning, keyWhere(Object.keys(key), key), 1);
  if (!rows[0]) throw new KastorError('QUERY_FAILED', `The new ${tbl.name} row could not be read back.`, { hint: 'Check that the primary key is generated by the database or passed in.' });
  return decodeColumns(c, rows[0], query.returning, tbl, 'row');
}

function uniqueSetsIn(tbl: TableIR, row: Record<string, unknown>): string[][] {
  const sets: string[][] = [];
  if (tbl.primaryKey.length && tbl.primaryKey.every((col) => row[col] !== undefined && row[col] !== null)) sets.push(tbl.primaryKey);
  for (const idx of tbl.indexes) {
    if (idx.unique && idx.columns.every((col) => row[col] !== undefined && row[col] !== null)) sets.push(idx.columns);
  }
  return sets;
}

/** INSERT ... SELECT ... WHERE NOT EXISTS, for skipDuplicates without native support. */
function insertIfAbsent(c: SqlCompiler, tbl: TableIR, cols: string[], row: Record<string, unknown>): Sql | null {
  const sets = uniqueSetsIn(tbl, row);
  if (sets.length === 0) return null;
  const qt = c.qi(tbl.name);
  const x = c.qi('x');
  const valueList = join(cols.map((col) => q`${c.param(row[col], c.column(tbl, col))} AS ${c.qi(col)}`), ', ');
  const conds = join(
    sets.map((set) => q`(${join(set.map((col) => q`${x}.${c.qi(col)} = ${c.param(row[col], c.column(tbl, col))}`), ' AND ')})`),
    ' OR ',
  );
  return q`INSERT INTO ${qt} (${cols.map((col) => c.qi(col)).join(', ')}) SELECT ${valueList}${c.hooks.fromDual} WHERE NOT EXISTS (SELECT 1 FROM ${qt} ${x} WHERE ${conds})`;
}

async function createMany(c: SqlCompiler, exec: Executor, query: CreateManyQueryIR): Promise<{ count: number } | Row[]> {
  const tbl = c.table(query.table);
  const groups = new Map<string, { cols: string[]; rows: Record<string, unknown>[] }>();
  for (const row of query.data) {
    const cols = definedColumns(row);
    const sig = cols.join('\u0001');
    let g = groups.get(sig);
    if (!g) groups.set(sig, (g = { cols, rows: [] }));
    g.rows.push(row);
  }
  const returning = query.returning;
  const out: Row[] = [];
  let count = 0;
  const nativeSkip = c.hooks.upsert === 'onConflict' ? 'onConflict' : c.hooks.upsert === 'onDuplicateKey' ? 'ignore' : null;

  for (const { cols, rows } of groups.values()) {
    const perRow = cols.length === 0 || !c.hooks.multiRowInsert || (query.skipDuplicates && !nativeSkip) || (returning && (c.hooks.returning === 'none' || c.hooks.returning === 'into'));
    if (perRow) {
      for (const row of rows) {
        if (query.skipDuplicates && !nativeSkip) {
          const stmt = insertIfAbsent(c, tbl, cols, row);
          if (stmt) {
            const res = await run(c, exec, stmt);
            const n = res.rowsAffected ?? 1;
            count += n;
            if (returning && n > 0) out.push(await readBack(c, exec, tbl, row, returning));
            continue;
          }
        }
        if (returning) {
          if (query.skipDuplicates) {
            const sets = uniqueSetsIn(tbl, row);
            const clash = sets.length ? await selectRows(c, exec, tbl.name, pkSelect(sets[0]!), { kind: 'or', items: sets.map((set) => keyWhere(set, row)) }, 1) : [];
            if (clash.length > 0) continue;
          }
          out.push(await create(c, exec, { kind: 'create', table: query.table, data: row, returning }));
          count++;
        } else {
          const res = await run(c, exec, c.compileInsert(query.table, cols, [row], query.skipDuplicates && nativeSkip ? { ignoreDuplicates: nativeSkip } : {}));
          count += res.rowsAffected ?? 1;
        }
      }
      continue;
    }
    const size = Math.max(1, Math.min(1000, Math.floor((c.hooks.maxParams - 10) / Math.max(1, cols.length))));
    for (let i = 0; i < rows.length; i += size) {
      const chunk = rows.slice(i, i + size);
      const opts: Parameters<SqlCompiler['compileInsert']>[3] = {};
      if (query.skipDuplicates && nativeSkip) opts.ignoreDuplicates = nativeSkip;
      if (returning) opts.returning = returning;
      const res = await run(c, exec, c.compileInsert(query.table, cols, chunk, opts));
      if (returning) {
        for (const raw of res.rows) out.push(decodeColumns(c, raw, returning, tbl, 'row'));
        count += res.rows.length;
      } else {
        count += res.rowsAffected ?? chunk.length;
      }
    }
  }
  return returning ? out : { count };
}

async function readBack(c: SqlCompiler, exec: Executor, tbl: TableIR, row: Record<string, unknown>, returning: SelectColumnIR[]): Promise<Row> {
  const sets = uniqueSetsIn(tbl, row);
  const rows = sets[0] ? await selectRows(c, exec, tbl.name, returning, keyWhere(sets[0], row), 1) : [];
  return rows[0] ? decodeColumns(c, rows[0], returning, tbl, 'row') : decodeColumns(c, row, returning.filter((r) => r.column in row), tbl, 'row');
}

function applyKeyChanges(key: Record<string, unknown>, data: Record<string, UpdateValueIR>): Record<string, unknown> {
  const next = { ...key };
  for (const col of Object.keys(key)) {
    const v = data[col];
    if (v && v.op === 'set') next[col] = v.value;
  }
  return next;
}

async function update(c: SqlCompiler, exec: Executor, query: UpdateQueryIR): Promise<Row | null> {
  const tbl = c.table(query.table);
  if (Object.keys(query.data).length === 0) {
    const rows = await selectRows(c, exec, query.table, query.returning, query.where, 1);
    return rows[0] ? decodeColumns(c, rows[0], query.returning, tbl, 'row') : null;
  }
  const direct = c.hooks.returning !== 'none' && (c.hooks.mutationSelfReference || !hasSubquery(query.where));
  if (direct) {
    const res = await run(c, exec, c.compileUpdate(query.table, query.data, query.where, query.returning.length ? query.returning : pkSelect(requirePk(tbl, 'update'))));
    const raw = res.rows[0];
    return raw ? decodeColumns(c, raw, query.returning, tbl, 'row') : null;
  }
  const pk = requirePk(tbl, 'update');
  const found = await selectRows(c, exec, query.table, pkSelect(pk), query.where, 1);
  if (!found[0]) return null;
  const key = found[0];
  await run(c, exec, c.compileUpdate(query.table, query.data, keyWhere(pk, key)));
  const next = applyKeyChanges(key, query.data);
  if (query.returning.length === 0) return {};
  const rows = await selectRows(c, exec, query.table, query.returning, keyWhere(pk, next), 1);
  return rows[0] ? decodeColumns(c, rows[0], query.returning, tbl, 'row') : null;
}

async function mutateMany(
  c: SqlCompiler,
  exec: Executor,
  tbl: TableIR,
  where: WhereIR | undefined,
  build: (where: WhereIR | undefined) => Sql,
): Promise<number> {
  if (c.hooks.mutationSelfReference || !hasSubquery(where)) {
    const res = await run(c, exec, build(where));
    return res.rowsAffected ?? res.rows.length;
  }
  const pk = requirePk(tbl, 'filtered update or delete');
  const keys = await selectRows(c, exec, tbl.name, pkSelect(pk), where);
  let count = 0;
  const size = Math.max(1, Math.floor(c.hooks.maxInList / pk.length));
  for (let i = 0; i < keys.length; i += size) {
    const res = await run(c, exec, build(keysWhere(pk, keys.slice(i, i + size))));
    count += res.rowsAffected ?? 0;
  }
  return count;
}

async function updateMany(c: SqlCompiler, exec: Executor, query: UpdateManyQueryIR): Promise<{ count: number } | Row[]> {
  const tbl = c.table(query.table);
  const returning = query.returning;
  if (Object.keys(query.data).length === 0) {
    if (returning) {
      const rows = await selectRows(c, exec, query.table, returning, query.where);
      return rows.map((r) => decodeColumns(c, r, returning, tbl, 'row'));
    }
    const res = await run(c, exec, c.compileCount(query.table, query.where, undefined, undefined, undefined, undefined));
    return { count: Number(res.rows[0]?.count ?? 0) };
  }
  if (!returning) {
    const count = await mutateMany(c, exec, tbl, query.where, (w) => c.compileUpdate(query.table, query.data, w));
    return { count };
  }
  if (c.hooks.returning !== 'none' && (c.hooks.mutationSelfReference || !hasSubquery(query.where))) {
    const res = await run(c, exec, c.compileUpdate(query.table, query.data, query.where, returning));
    return res.rows.map((r) => decodeColumns(c, r, returning, tbl, 'row'));
  }
  const pk = requirePk(tbl, 'updateMany with returning');
  const keys = await selectRows(c, exec, query.table, pkSelect(pk), query.where);
  if (keys.length === 0) return [];
  await run(c, exec, c.compileUpdate(query.table, query.data, keysWhere(pk, keys)));
  const next = keys.map((k) => applyKeyChanges(k, query.data));
  const rows = await selectRows(c, exec, query.table, returning, keysWhere(pk, next));
  return rows.map((r) => decodeColumns(c, r, returning, tbl, 'row'));
}

async function upsert(c: SqlCompiler, exec: Executor, query: UpsertQueryIR): Promise<Row> {
  const tbl = c.table(query.table);
  const style = c.hooks.upsert;
  if (style === 'none') {
    const body = async (tx: Executor): Promise<Row> => {
      const existing = await selectRows(c, tx, query.table, pkSelect(tbl.primaryKey.length ? tbl.primaryKey : Object.keys(query.conflict)), query.where, 1);
      if (existing[0]) {
        const row = await update(c, tx, { kind: 'update', table: query.table, where: query.where, data: query.update, returning: query.returning });
        if (row) return row;
      }
      return create(c, tx, { kind: 'create', table: query.table, data: { ...query.create }, returning: query.returning });
    };
    return exec.inTransaction ? body(exec) : exec.transaction(body);
  }
  const create_ = { ...query.create };
  for (const [col, value] of Object.entries(query.conflict)) if (create_[col] === undefined) create_[col] = value;
  const res = await run(c, exec, c.compileUpsert(query.table, query.conflict, Object.fromEntries(Object.entries(create_).filter(([, v]) => v !== undefined)), query.update, query.returning));
  if (res.rows[0] && c.hooks.returning !== 'none' && style !== 'onDuplicateKey') {
    return decodeColumns(c, res.rows[0], query.returning, tbl, 'row');
  }
  // Read back through the conflict columns, updated values included.
  const lookup = applyKeyChanges(query.conflict, query.update);
  const rows = await selectRows(c, exec, query.table, query.returning, keyWhere(Object.keys(lookup), lookup), 1);
  if (!rows[0]) throw new KastorError('QUERY_FAILED', `The upserted ${tbl.name} row could not be read back.`, { hint: 'Make sure the where clause of upsert names a unique constraint.' });
  return decodeColumns(c, rows[0], query.returning, tbl, 'row');
}

async function remove(c: SqlCompiler, exec: Executor, query: DeleteQueryIR): Promise<Row | null> {
  const tbl = c.table(query.table);
  const direct = c.hooks.returning !== 'none' && (c.hooks.mutationSelfReference || !hasSubquery(query.where));
  if (direct) {
    const returning = query.returning.length ? query.returning : pkSelect(requirePk(tbl, 'delete'));
    const res = await run(c, exec, c.compileDelete(query.table, query.where, returning));
    const raw = res.rows[0];
    return raw ? decodeColumns(c, raw, query.returning, tbl, 'row') : null;
  }
  const pk = requirePk(tbl, 'delete');
  const cols = [...query.returning, ...pk.filter((col) => !query.returning.some((r) => r.as === `__pk_${col}`)).map((column) => ({ column, as: `__pk_${column}` }))];
  const found = await selectRows(c, exec, query.table, cols, query.where, 1);
  if (!found[0]) return null;
  const key = Object.fromEntries(pk.map((col) => [col, found[0]![`__pk_${col}`]]));
  await run(c, exec, c.compileDelete(query.table, keyWhere(pk, key)));
  return decodeColumns(c, found[0], query.returning, tbl, 'row');
}

async function removeMany(c: SqlCompiler, exec: Executor, query: DeleteManyQueryIR): Promise<{ count: number }> {
  const tbl = c.table(query.table);
  const count = await mutateMany(c, exec, tbl, query.where, (w) => c.compileDelete(query.table, w));
  return { count };
}

/* ------------------------------------------------------------------------ */
/* Entry points                                                               */
/* ------------------------------------------------------------------------ */

export async function executeSql(hooks: SqlHooks, query: QueryIR, schema: SchemaIR, exec: Executor): Promise<unknown> {
  const c = compilerFor(hooks, schema);
  switch (query.kind) {
    case 'findMany':
    case 'findFirst':
    case 'findUnique': {
      const read = query.kind === 'findMany' ? query.read : { ...query.read, take: query.read.take ?? 1 };
      const { sql, plan } = c.compileRead(read);
      const res = await run(c, exec, sql);
      const rows = res.rows.map((raw) => decodeRow(c, raw, plan, 'row'));
      await loadFallbacks(c, exec, rows, plan);
      stripHidden(rows, plan);
      return query.kind === 'findMany' ? rows : (rows[0] ?? null);
    }
    case 'create':
      return create(c, exec, query);
    case 'createMany':
      return createMany(c, exec, query);
    case 'update':
      return update(c, exec, query);
    case 'updateMany':
      return updateMany(c, exec, query);
    case 'upsert':
      return upsert(c, exec, query);
    case 'delete':
      return remove(c, exec, query);
    case 'deleteMany':
      return removeMany(c, exec, query);
    case 'count': {
      const res = await run(c, exec, c.compileCount(query.table, query.where, query.orderBy, query.take, query.skip, query.distinct));
      const first = res.rows[0] ?? {};
      return Number(first.count ?? first.COUNT ?? Object.values(first)[0] ?? 0);
    }
    case 'aggregate': {
      const tbl = c.table(query.table);
      const res = await run(c, exec, c.compileAggregate(query.table, query.aggregates, query.where, query.orderBy, query.take, query.skip));
      const raw = res.rows[0] ?? {};
      return Object.fromEntries(query.aggregates.map((a) => [a.as, decodeAggregate(c, raw[a.as], a, tbl)]));
    }
    case 'groupBy': {
      const tbl = c.table(query.table);
      const res = await run(c, exec, c.compileGroupBy(query.table, query.by, query.aggregates, query.where, query.having, query.orderBy, query.take, query.skip));
      return res.rows.map((raw) => ({
        ...decodeColumns(c, raw, query.by, tbl, 'row'),
        ...Object.fromEntries(query.aggregates.map((a) => [a.as, decodeAggregate(c, raw[a.as], a, tbl)])),
      }));
    }
    default:
      throw errors.invalidArgument(`Unknown query kind ${(query as { kind: string }).kind}.`, 'This is a bug in kastor, please report it.');
  }
}

/**
 * The query as exactly one statement with a decoder for its result, or null
 * when running it takes more than one statement (re-selects, IN-list
 * includes, chunked inserts, emulated upserts, key pre-selects).
 */
export function prepareSingle(hooks: SqlHooks, query: QueryIR, schema: SchemaIR): PreparedStatement | null {
  const c = compilerFor(hooks, schema);
  const make = (sql: Sql, decode: (res: ExecResult) => unknown): PreparedStatement => ({ ...render(c, sql), decode });
  const returns = hooks.returning === 'returning' || hooks.returning === 'output';
  const direct = (where: WhereIR | undefined): boolean => hooks.mutationSelfReference || !hasSubquery(where);
  switch (query.kind) {
    case 'findMany':
    case 'findFirst':
    case 'findUnique': {
      const read = query.kind === 'findMany' ? query.read : { ...query.read, take: query.read.take ?? 1 };
      const { sql, plan } = c.compileRead(read);
      if (hasFallback(plan)) return null;
      return make(sql, (res) => {
        const rows = res.rows.map((raw) => decodeRow(c, raw, plan, 'row'));
        stripHidden(rows, plan);
        return query.kind === 'findMany' ? rows : (rows[0] ?? null);
      });
    }
    case 'create': {
      if (!returns || query.returning.length === 0) return null;
      const tbl = c.table(query.table);
      return make(c.compileInsert(query.table, definedColumns(query.data), [query.data], { returning: query.returning }), (res) =>
        res.rows[0] ? decodeColumns(c, res.rows[0], query.returning, tbl, 'row') : null,
      );
    }
    case 'createMany': {
      if (query.returning || query.data.length === 0 || !hooks.multiRowInsert) return null;
      const cols = definedColumns(query.data[0]!);
      const sig = cols.join('\u0001');
      if (cols.length === 0 || query.data.some((row) => definedColumns(row).join('\u0001') !== sig)) return null;
      if (cols.length * query.data.length > hooks.maxParams - 10 || query.data.length > 1000) return null;
      const nativeSkip: 'onConflict' | 'ignore' | null = hooks.upsert === 'onConflict' ? 'onConflict' : hooks.upsert === 'onDuplicateKey' ? 'ignore' : null;
      if (query.skipDuplicates && !nativeSkip) return null;
      const opts = query.skipDuplicates && nativeSkip ? { ignoreDuplicates: nativeSkip } : {};
      return make(c.compileInsert(query.table, cols, query.data, opts), (res) => ({ count: res.rowsAffected ?? query.data.length }));
    }
    case 'update': {
      if (!returns || Object.keys(query.data).length === 0 || query.returning.length === 0 || !direct(query.where)) return null;
      const tbl = c.table(query.table);
      return make(c.compileUpdate(query.table, query.data, query.where, query.returning), (res) => (res.rows[0] ? decodeColumns(c, res.rows[0], query.returning, tbl, 'row') : null));
    }
    case 'updateMany':
      if (query.returning || Object.keys(query.data).length === 0 || !direct(query.where)) return null;
      return make(c.compileUpdate(query.table, query.data, query.where), (res) => ({ count: res.rowsAffected ?? 0 }));
    case 'upsert': {
      if (hooks.upsert !== 'onConflict' || !returns || query.returning.length === 0) return null;
      const tbl = c.table(query.table);
      const create = { ...query.create };
      for (const [col, value] of Object.entries(query.conflict)) if (create[col] === undefined) create[col] = value;
      const data = Object.fromEntries(Object.entries(create).filter(([, v]) => v !== undefined));
      return make(c.compileUpsert(query.table, query.conflict, data, query.update, query.returning), (res) => (res.rows[0] ? decodeColumns(c, res.rows[0], query.returning, tbl, 'row') : null));
    }
    case 'delete': {
      if (!returns || query.returning.length === 0 || !direct(query.where)) return null;
      const tbl = c.table(query.table);
      return make(c.compileDelete(query.table, query.where, query.returning), (res) => (res.rows[0] ? decodeColumns(c, res.rows[0], query.returning, tbl, 'row') : null));
    }
    case 'deleteMany':
      if (!direct(query.where)) return null;
      return make(c.compileDelete(query.table, query.where), (res) => ({ count: res.rowsAffected ?? 0 }));
    case 'count':
      return make(c.compileCount(query.table, query.where, query.orderBy, query.take, query.skip, query.distinct), (res) => {
        const first = res.rows[0] ?? {};
        return Number(first.count ?? first.COUNT ?? Object.values(first)[0] ?? 0);
      });
    case 'aggregate': {
      const tbl = c.table(query.table);
      return make(c.compileAggregate(query.table, query.aggregates, query.where, query.orderBy, query.take, query.skip), (res) => {
        const raw = res.rows[0] ?? {};
        return Object.fromEntries(query.aggregates.map((a) => [a.as, decodeAggregate(c, raw[a.as], a, tbl)]));
      });
    }
    case 'groupBy': {
      const tbl = c.table(query.table);
      return make(c.compileGroupBy(query.table, query.by, query.aggregates, query.where, query.having, query.orderBy, query.take, query.skip), (res) =>
        res.rows.map((raw) => ({
          ...decodeColumns(c, raw, query.by, tbl, 'row'),
          ...Object.fromEntries(query.aggregates.map((a) => [a.as, decodeAggregate(c, raw[a.as], a, tbl)])),
        })),
      );
    }
    default:
      return null;
  }
}

function hasFallback(plan: LevelPlan): boolean {
  return plan.fallback.length > 0 || plan.json.some((j) => hasFallback(j.plan));
}

/** The main statement of a query, without running it. */
export function compileSql(hooks: SqlHooks, query: QueryIR, schema: SchemaIR): CompiledQuery[] {
  const c = compilerFor(hooks, schema);
  const one = (sql: Sql): CompiledQuery[] => [render(c, sql)];
  switch (query.kind) {
    case 'findMany':
    case 'findFirst':
    case 'findUnique': {
      const read = query.kind === 'findMany' ? query.read : { ...query.read, take: query.read.take ?? 1 };
      return one(c.compileRead(read).sql);
    }
    case 'create': {
      const returning = hooks.returning === 'none' ? undefined : query.returning;
      return one(c.compileInsert(query.table, definedColumns(query.data), [query.data], returning ? { returning } : {}));
    }
    case 'createMany': {
      if (query.data.length === 0) return [];
      const cols = definedColumns(query.data[0]!);
      const nativeSkip = hooks.upsert === 'onConflict' ? 'onConflict' : hooks.upsert === 'onDuplicateKey' ? 'ignore' : undefined;
      return one(c.compileInsert(query.table, cols, query.data, query.skipDuplicates && nativeSkip ? { ignoreDuplicates: nativeSkip } : {}));
    }
    case 'update':
      return one(c.compileUpdate(query.table, query.data, query.where, hooks.returning === 'none' ? undefined : query.returning));
    case 'updateMany':
      return one(c.compileUpdate(query.table, query.data, query.where));
    case 'upsert':
      if (hooks.upsert === 'none') return one(c.compileSelectWhere(query.table, query.returning, query.where, 1));
      return one(c.compileUpsert(query.table, query.conflict, query.create, query.update, query.returning));
    case 'delete':
      return one(c.compileDelete(query.table, query.where, hooks.returning === 'none' ? undefined : query.returning));
    case 'deleteMany':
      return one(c.compileDelete(query.table, query.where));
    case 'count':
      return one(c.compileCount(query.table, query.where, query.orderBy, query.take, query.skip, query.distinct));
    case 'aggregate':
      return one(c.compileAggregate(query.table, query.aggregates, query.where, query.orderBy, query.take, query.skip));
    case 'groupBy':
      return one(c.compileGroupBy(query.table, query.by, query.aggregates, query.where, query.having, query.orderBy, query.take, query.skip));
    default:
      return [];
  }
}
