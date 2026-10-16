/**
 * The studio JSON API. Pure request handling on top of `dialect.execute`, so
 * it works the same for every database and can be tested without a server.
 */
import { KastorError, isKastorError } from '../core/errors';
import type { Adapter, ColumnIR, OrderByIR, QueryIR, ReadIR, SchemaIR, SelectColumnIR, TableIR, WhereIR } from '../core/ir';
import { introspect } from '../migrate/engine';
import type { QueryEntry, QueryLog } from './queries';

export interface StudioState {
  adapter: Adapter;
  schema: SchemaIR;
  version: string;
  /** Refuse writes (create, update, delete). */
  readOnly?: boolean;
  /** Records the statements the studio sends, for the query log view. */
  queries?: QueryLog;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

export interface Filter {
  column: string;
  op: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains' | 'startsWith' | 'endsWith' | 'null' | 'notNull' | 'in';
  value?: unknown;
}

export const MAX_PAGE_SIZE = 500;

const bad = (message: string, hint?: string): KastorError => new KastorError('INVALID_ARGUMENT', message, { hint });

/** Relations derived from foreign keys, for navigation and the diagram. */
export function relationsOf(schema: SchemaIR): Array<{ from: string; columns: string[]; to: string; refColumns: string[]; name: string }> {
  return schema.tables.flatMap((t) => t.foreignKeys.map((fk) => ({ from: t.name, columns: fk.columns, to: fk.refTable, refColumns: fk.refColumns, name: fk.name })));
}

function tableOf(state: StudioState, name: string): TableIR {
  const t = state.schema.tables.find((x) => x.name === name);
  if (!t) throw new KastorError('UNKNOWN_MODEL', `There is no table named "${name}".`, { hint: 'Refresh the studio if the schema changed.' });
  return t;
}

function columnOf(table: TableIR, name: string): ColumnIR {
  const c = table.columns.find((x) => x.name === name);
  if (!c) throw new KastorError('UNKNOWN_FIELD', `Table ${table.name} has no column "${name}".`);
  return c;
}

/** Turns a JSON value from the browser into the JS value the dialect expects. */
export function fromJson(value: unknown, col: ColumnIR): unknown {
  if (value === null || value === undefined) return null;
  switch (col.type) {
    case 'int':
    case 'float': {
      const n = typeof value === 'number' ? value : Number(String(value).trim());
      if (String(value).trim() === '' || !Number.isFinite(n)) throw bad(`${col.name} needs a number, got "${String(value)}".`);
      if (col.type === 'int' && !Number.isInteger(n)) throw bad(`${col.name} needs a whole number, got ${n}.`);
      return n;
    }
    case 'bigint':
      try {
        return BigInt(String(value).trim());
      } catch {
        throw bad(`${col.name} needs a whole number, got "${String(value)}".`);
      }
    case 'decimal':
      if (!/^-?\d+(\.\d+)?$/.test(String(value).trim())) throw bad(`${col.name} needs a decimal number, got "${String(value)}".`);
      return String(value).trim();
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (/^(true|1|yes)$/i.test(String(value))) return true;
      if (/^(false|0|no)$/i.test(String(value))) return false;
      throw bad(`${col.name} needs true or false, got "${String(value)}".`);
    case 'datetime': {
      const d = new Date(String(value));
      if (Number.isNaN(d.getTime())) throw bad(`${col.name} needs a date and time, got "${String(value)}".`);
      return d;
    }
    case 'json':
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          throw bad(`${col.name} needs valid JSON.`, 'Strings in JSON need double quotes: "text".');
        }
      }
      return value;
    case 'bytes': {
      const b64 = typeof value === 'object' && value && '$bytes' in value ? String((value as { $bytes: unknown }).$bytes) : String(value);
      return new Uint8Array(Buffer.from(b64, 'base64'));
    }
    case 'enum':
      if (col.enumValues && !col.enumValues.includes(String(value))) throw bad(`${col.name} must be one of ${col.enumValues.join(', ')}.`);
      return String(value);
    default:
      return typeof value === 'string' ? value : JSON.stringify(value);
  }
}

/** JSON.stringify that keeps bigint, Date and bytes readable. */
export function toJson(value: unknown): string {
  return JSON.stringify(value, function (this: Record<string, unknown>, key, v) {
    const raw = key === '' ? value : this[key];
    if (typeof raw === 'bigint') return raw.toString();
    if (raw instanceof Uint8Array) return { $bytes: Buffer.from(raw).toString('base64'), length: raw.length };
    if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw.toISOString();
    return v;
  });
}

function filterToWhere(table: TableIR, f: Filter): WhereIR {
  const col = columnOf(table, f.column);
  switch (f.op) {
    case 'null':
      return { kind: 'null', column: col.name, negate: false };
    case 'notNull':
      return { kind: 'null', column: col.name, negate: true };
    case 'contains':
    case 'startsWith':
    case 'endsWith':
      return { kind: 'like', column: col.name, mode: f.op, value: String(f.value ?? ''), insensitive: true, negate: false };
    case 'in': {
      const list = Array.isArray(f.value) ? f.value : String(f.value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      return { kind: 'in', column: col.name, values: list.map((v) => fromJson(v, col)), negate: false };
    }
    case 'eq':
    case 'ne':
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte':
      if (f.value === null) return { kind: 'null', column: col.name, negate: f.op === 'ne' };
      return { kind: 'compare', column: col.name, op: f.op, value: fromJson(f.value, col) };
    default:
      throw bad(`Unknown filter operator "${String((f as { op: unknown }).op)}".`);
  }
}

const TEXTY = new Set(['string', 'text', 'enum', 'uuid']);

export function buildWhere(table: TableIR, filters: Filter[], search?: string): WhereIR | undefined {
  const items = filters.map((f) => filterToWhere(table, f));
  if (search && search.trim()) {
    const cols = table.columns.filter((c) => TEXTY.has(c.type) && c.type !== 'uuid');
    const ors: WhereIR[] = cols.map((c) => ({ kind: 'like', column: c.name, mode: 'contains', value: search.trim(), insensitive: true, negate: false }));
    const numeric = Number(search.trim());
    for (const c of table.columns) {
      if ((c.type === 'int' || c.type === 'bigint') && Number.isInteger(numeric)) ors.push({ kind: 'compare', column: c.name, op: 'eq', value: c.type === 'bigint' ? BigInt(numeric) : numeric });
    }
    items.push(ors.length ? { kind: 'or', items: ors } : { kind: 'const', value: false });
  }
  if (!items.length) return undefined;
  return items.length === 1 ? items[0] : { kind: 'and', items };
}

const selectAll = (table: TableIR): SelectColumnIR[] => table.columns.map((c) => ({ column: c.name, as: c.name }));

function keyWhere(table: TableIR, key: unknown): WhereIR {
  if (!table.primaryKey.length) throw bad(`Table ${table.name} has no primary key, so the studio cannot tell rows apart.`, 'Add a primary key to edit this table here.');
  if (!key || typeof key !== 'object') throw bad('The request needs the key of the row.');
  const k = key as Record<string, unknown>;
  const items: WhereIR[] = table.primaryKey.map((name) => {
    if (!(name in k)) throw bad(`The row key needs ${name}.`);
    return { kind: 'compare', column: name, op: 'eq', value: fromJson(k[name], columnOf(table, name)) };
  });
  return items.length === 1 ? items[0]! : { kind: 'and', items };
}

function rowData(table: TableIR, data: unknown, forCreate: boolean): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw bad('The request needs a data object.');
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(data as Record<string, unknown>)) {
    const col = columnOf(table, name);
    if (forCreate && value === undefined) continue;
    if (value === null && !col.nullable) throw bad(`${name} cannot be empty.`);
    out[name] = fromJson(value, col);
  }
  return out;
}

async function exec(state: StudioState, query: QueryIR): Promise<unknown> {
  const executor = state.queries ? state.queries.executor(state.adapter.executor) : state.adapter.executor;
  return state.adapter.dialect.execute(query, state.schema, executor);
}

/** True when the database speaks SQL, so the query log has statements to show. */
export function logsSql(state: StudioState): boolean {
  return state.adapter.dialect.name !== 'mongodb';
}

/** Runs one API action, labelled in the query log when there is one. */
async function logged<T>(state: StudioState, action: string, fn: () => Promise<T>): Promise<{ result: T; queries: QueryEntry[] }> {
  if (!state.queries) return { result: await fn(), queries: [] };
  return state.queries.run(action, fn);
}

export interface RowsQuery {
  page: number;
  pageSize: number;
  sort?: string;
  dir: 'asc' | 'desc';
  filters: Filter[];
  search?: string;
}

export function parseRowsQuery(params: URLSearchParams): RowsQuery {
  const page = Math.max(1, Math.floor(Number(params.get('page') ?? 1)) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(params.get('pageSize') ?? 50)) || 50));
  let filters: Filter[] = [];
  const raw = params.get('filters');
  if (raw) {
    try {
      filters = JSON.parse(raw) as Filter[];
    } catch {
      throw bad('The filters parameter is not valid JSON.');
    }
    if (!Array.isArray(filters)) throw bad('The filters parameter must be a list.');
  }
  return { page, pageSize, sort: params.get('sort') ?? undefined, dir: params.get('dir') === 'desc' ? 'desc' : 'asc', filters, search: params.get('q') ?? undefined };
}

export async function listRows(state: StudioState, tableName: string, q: RowsQuery): Promise<{ rows: unknown[]; total: number; page: number; pageSize: number }> {
  const table = tableOf(state, tableName);
  const where = buildWhere(table, q.filters, q.search);
  const orderBy: OrderByIR[] = [];
  if (q.sort) orderBy.push({ kind: 'column', column: columnOf(table, q.sort).name, direction: q.dir });
  for (const pk of table.primaryKey) if (pk !== q.sort) orderBy.push({ kind: 'column', column: pk, direction: 'asc' });
  if (!orderBy.length && table.columns[0]) orderBy.push({ kind: 'column', column: table.columns[0].name, direction: 'asc' });
  const read: ReadIR = { table: table.name, select: selectAll(table), include: [], counts: [], where, orderBy, take: q.pageSize, skip: (q.page - 1) * q.pageSize };
  const [rows, total] = await Promise.all([
    exec(state, { kind: 'findMany', table: table.name, read }) as Promise<unknown[]>,
    exec(state, { kind: 'count', table: table.name, where }) as Promise<number>,
  ]);
  return { rows, total: Number(total), page: q.page, pageSize: q.pageSize };
}

function guardWrite(state: StudioState, table: TableIR): void {
  if (state.readOnly) throw new KastorError('UNSUPPORTED', 'The studio runs read only.', { hint: 'Start it without --read-only to edit data.' });
  if (!table.primaryKey.length) throw bad(`Table ${table.name} has no primary key, so the studio cannot edit it.`, 'Add a primary key to edit this table here.');
}

export async function createRow(state: StudioState, tableName: string, data: unknown): Promise<unknown> {
  const table = tableOf(state, tableName);
  guardWrite(state, table);
  return exec(state, { kind: 'create', table: table.name, data: rowData(table, data, true), returning: selectAll(table) });
}

export async function updateRow(state: StudioState, tableName: string, key: unknown, data: unknown): Promise<unknown> {
  const table = tableOf(state, tableName);
  guardWrite(state, table);
  const values = rowData(table, data, false);
  if (!Object.keys(values).length) throw bad('Nothing to update.');
  const row = await exec(state, {
    kind: 'update',
    table: table.name,
    where: keyWhere(table, key),
    data: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { op: 'set', value: v }])),
    returning: selectAll(table),
  });
  if (row === null) throw new KastorError('NOT_FOUND', 'That row no longer exists.', { hint: 'Refresh the table.' });
  return row;
}

export async function deleteRows(state: StudioState, tableName: string, keys: unknown): Promise<{ count: number }> {
  const table = tableOf(state, tableName);
  guardWrite(state, table);
  if (!Array.isArray(keys) || !keys.length) throw bad('The request needs a non empty list of row keys.');
  if (keys.length > MAX_PAGE_SIZE) throw bad(`Delete at most ${MAX_PAGE_SIZE} rows at once.`);
  const where: WhereIR = keys.length === 1 ? keyWhere(table, keys[0]) : { kind: 'or', items: keys.map((k) => keyWhere(table, k)) };
  const result = (await exec(state, { kind: 'deleteMany', table: table.name, where })) as { count: number };
  return { count: Number(result.count) };
}

function errorResponse(error: unknown): ApiResponse {
  if (isKastorError(error)) {
    const status = error.code === 'NOT_FOUND' || error.code === 'UNKNOWN_MODEL' ? 404 : ['INVALID_ARGUMENT', 'UNKNOWN_FIELD', 'UNSUPPORTED'].includes(error.code) ? 400 : 409;
    return { status, body: { error: { code: error.code, message: error.message, hint: error.hint || undefined } } };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { status: 500, body: { error: { code: 'INTERNAL', message } } };
}

/** Routes one API request. `path` starts with `/api/`. */
export async function handleApi(state: StudioState, method: string, path: string, params: URLSearchParams, body: unknown): Promise<ApiResponse> {
  try {
    if (path === '/api/schema' && method === 'GET') {
      return { status: 200, body: { dialect: state.adapter.dialect.name, version: state.version, readOnly: Boolean(state.readOnly), tables: state.schema.tables, enums: state.schema.enums ?? [], relations: relationsOf(state.schema) } };
    }
    if (path === '/api/refresh' && method === 'POST') {
      const adapter = state.queries ? state.queries.adapter(state.adapter) : state.adapter;
      const { result } = await logged(state, 'Reload schema', () => introspect(adapter));
      state.schema = result;
      return { status: 200, body: { tables: state.schema.tables.length } };
    }
    if (path === '/api/queries') {
      if (method === 'GET') {
        const after = Math.max(0, Math.floor(Number(params.get('after') ?? 0)) || 0);
        return { status: 200, body: { sql: logsSql(state), enabled: Boolean(state.queries), limit: state.queries?.limit ?? 0, queries: state.queries?.list(after) ?? [] } };
      }
      if (method === 'DELETE') {
        state.queries?.clear();
        return { status: 200, body: { cleared: true } };
      }
      return { status: 405, body: { error: { code: 'METHOD', message: `${method} is not allowed here.` } } };
    }
    const m = /^\/api\/tables\/([^/]+)\/rows$/.exec(path);
    if (m) {
      const table = decodeURIComponent(m[1]!);
      const b = (body ?? {}) as { data?: unknown; key?: unknown; keys?: unknown };
      switch (method) {
        case 'GET': {
          const { result, queries } = await logged(state, `Browse ${table}`, () => listRows(state, table, parseRowsQuery(params)));
          return { status: 200, body: { ...result, queries } };
        }
        case 'POST':
          return { status: 201, body: { row: (await logged(state, `Add a row to ${table}`, () => createRow(state, table, b.data))).result } };
        case 'PATCH':
          return { status: 200, body: { row: (await logged(state, `Edit a row in ${table}`, () => updateRow(state, table, b.key, b.data))).result } };
        case 'DELETE':
          return { status: 200, body: (await logged(state, `Delete rows from ${table}`, () => deleteRows(state, table, b.keys))).result };
        default:
          return { status: 405, body: { error: { code: 'METHOD', message: `${method} is not allowed here.` } } };
      }
    }
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: `No API route ${method} ${path}.` } } };
  } catch (error) {
    const mapped = state.adapter.dialect.mapError?.(error);
    return errorResponse(mapped ?? error);
  }
}
