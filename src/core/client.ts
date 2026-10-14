/**
 * The kastor client: `kastor({ adapter, schema, relations })` returns an
 * object with one delegate per table (`db.users.findMany(...)`) plus
 * `$transaction`, `$sql`, `$execute` and friends.
 */
import { errors, isKastorError, KastorError } from './errors';
import type {
  Adapter,
  AggregateFn,
  AggregateIR,
  CompiledQuery,
  Dialect,
  Executor,
  IdType,
  OrderByIR,
  QueryIR,
  QueryResultMap,
  ReadIR,
  Row,
  SchemaIR,
  SelectColumnIR,
  TransactionOptions,
  WhereIR,
} from './ir';
import { buildModels, type ModelMeta, type Models, type RelationsInput } from './model';
import { renderFragment, sql as sqlTag } from './raw';
import { buildRead, checkCount, checkKeys, HIDDEN_PREFIX, normalizeOrderBy, softDeleteWhere, stripHidden } from './read';
import type { AnyTable } from './schema';
import { isTable } from './schema';
import type {
  AggregateArgs,
  AggregateResult,
  CountArgs,
  CountResult,
  CreateArgs,
  CreateManyAndReturnArgs,
  CreateManyArgs,
  DeleteArgs,
  DeleteManyArgs,
  FindFirstArgs,
  FindManyArgs,
  FindPageArgs,
  FindUniqueArgs,
  GroupByArgs,
  GroupByResult,
  Page,
  Payload,
  SchemaShape,
  Strict,
  WithIdType,
  UpdateArgs,
  UpdateManyArgs,
  UpsertArgs,
  WhereInput,
} from './types';
import { and, eq, fieldFilter, isPlainObject, normalizeWhere, requireUnique } from './where';
import {
  allFields,
  createRecord,
  createRow,
  findOne,
  hasRelations,
  pkWhere,
  plainUpdate,
  uniqueWhere,
  updateRecord,
  type Session,
} from './write';

/* ------------------------------------------------------------------------ */
/* Public types                                                               */
/* ------------------------------------------------------------------------ */

/** Keeps only the table entries of a schema object or module namespace. */
export type TablesOf<S> = { [K in keyof S as S[K] extends AnyTable ? K : never]: S[K] extends AnyTable ? S[K] : never };

/** The tables of S as a schema shape. */
export type SchemaOf<S> = TablesOf<S> extends infer T extends SchemaShape ? T : never;

export interface QueryEvent {
  sql: string;
  params: unknown[];
  durationMs: number;
  error?: unknown;
}

export interface KastorOptions<S, R, Ids extends IdType = 'number'> {
  /** Adapter from a dialect entry point: `postgres(pool)`, `sqlite(db)`, ... */
  adapter: Adapter<any, Ids>;
  /** Your tables: `{ users, posts }` or `import * as schema`. */
  schema: S;
  /** Relations between tables: `({ users, posts }) => ({ users: { posts: many(posts) } })`. */
  relations?: (tables: TablesOf<S>) => R;
  /** Logs every statement: `true` prints to the console, or pass a function. */
  log?: boolean | ((event: QueryEvent) => void);
}

export interface ModelClient<S extends SchemaShape, R, K extends keyof S> {
  /** Rows matching `where`, shaped by `select` / `include`. */
  findMany<A extends FindManyArgs<S, R, K> = {}>(args?: A & Strict<A, FindManyArgs<S, R, K>>): KastorQuery<Payload<S, R, K, A>[]>;
  /** First matching row or null. */
  findFirst<A extends FindFirstArgs<S, R, K> = {}>(args?: A & Strict<A, FindFirstArgs<S, R, K>>): KastorQuery<Payload<S, R, K, A> | null>;
  /** First matching row; throws KastorError NOT_FOUND when there is none. */
  findFirstOrThrow<A extends FindFirstArgs<S, R, K> = {}>(args?: A & Strict<A, FindFirstArgs<S, R, K>>): KastorQuery<Payload<S, R, K, A>>;
  /** The row with this unique value (primary key or `.unique()` column) or null. */
  findUnique<A extends FindUniqueArgs<S, R, K>>(args: A & Strict<A, FindUniqueArgs<S, R, K>>): KastorQuery<Payload<S, R, K, A> | null>;
  /** Like findUnique, throws KastorError NOT_FOUND when there is none. */
  findUniqueOrThrow<A extends FindUniqueArgs<S, R, K>>(args: A & Strict<A, FindUniqueArgs<S, R, K>>): KastorQuery<Payload<S, R, K, A>>;
  /** Cursor pagination with opaque cursors: `{ items, pageInfo }`. */
  findPage<A extends FindPageArgs<S, R, K>>(args: A & Strict<A, FindPageArgs<S, R, K>>): KastorQuery<Page<Payload<S, R, K, A>>>;
  /** Creates one row, with nested writes through relations. */
  create<A extends CreateArgs<S, R, K>>(args: A & Strict<A, CreateArgs<S, R, K>>): KastorQuery<Payload<S, R, K, A>>;
  /** Inserts many rows in as few statements as possible. */
  createMany(args: CreateManyArgs<S, K>): KastorQuery<{ count: number }>;
  /** Inserts many rows and returns them. */
  createManyAndReturn<A extends CreateManyAndReturnArgs<S, K>>(args: A): KastorQuery<Payload<S, R, K, A>[]>;
  /** Updates the row with this unique value; throws NOT_FOUND when there is none. */
  update<A extends UpdateArgs<S, R, K>>(args: A & Strict<A, UpdateArgs<S, R, K>>): KastorQuery<Payload<S, R, K, A>>;
  /** Updates every matching row. */
  updateMany(args: UpdateManyArgs<S, R, K>): KastorQuery<{ count: number }>;
  /** Creates the row or updates it when the unique value exists. */
  upsert<A extends UpsertArgs<S, R, K>>(args: A & Strict<A, UpsertArgs<S, R, K>>): KastorQuery<Payload<S, R, K, A>>;
  /** Deletes the row with this unique value (soft delete tables: marks it deleted). */
  delete<A extends DeleteArgs<S, R, K>>(args: A & Strict<A, DeleteArgs<S, R, K>>): KastorQuery<Payload<S, R, K, A>>;
  /** Deletes every matching row (soft delete tables: marks them deleted). */
  deleteMany(args?: DeleteManyArgs<S, R, K>): KastorQuery<{ count: number }>;
  /** Number of matching rows, or per field counts with `select`. */
  count<A extends CountArgs<S, R, K> = {}>(args?: A): KastorQuery<CountResult<A>>;
  /** `_count`, `_sum`, `_avg`, `_min`, `_max` over matching rows. */
  aggregate<A extends AggregateArgs<S, R, K>>(args: A): KastorQuery<AggregateResult<S, K, A>>;
  /** Aggregates per group of `by` fields. */
  groupBy<A extends GroupByArgs<S, R, K>>(args: A): KastorQuery<GroupByResult<S, K, A>[]>;
  /** Soft delete tables: brings back deleted rows. */
  restore(args?: { where?: WhereInput<S, R, K> }): KastorQuery<{ count: number }>;
  /** Soft delete tables: deletes the row for real. */
  hardDelete<A extends DeleteArgs<S, R, K>>(args: A & Strict<A, DeleteArgs<S, R, K>>): KastorQuery<Payload<S, R, K, A>>;
  /** Soft delete tables: deletes matching rows for real. */
  hardDeleteMany(args?: DeleteManyArgs<S, R, K>): KastorQuery<{ count: number }>;
}

type ClientMethods<S extends SchemaShape, R> = {
  /** Runs `fn` in a transaction; it commits when `fn` resolves and rolls back when it throws. */
  $transaction<T>(fn: (tx: KastorClient<S, R>) => Promise<T>, options?: TransactionOptions): Promise<T>;
  /** Runs queries one after another in one transaction. */
  $transaction<const Q extends readonly KastorQuery<any>[]>(queries: Q, options?: TransactionOptions): Promise<{ -readonly [I in keyof Q]: Awaited<Q[I]> }>;
  /** Raw SQL query with bound parameters: `db.$sql<{ id: number }>\`SELECT id FROM users WHERE email = ${email}\``. */
  $sql<T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): KastorQuery<T[]>;
  /** Raw SQL statement, resolves to the number of affected rows. */
  $execute(strings: TemplateStringsArray, ...values: unknown[]): KastorQuery<number>;
  /** The schema as SchemaIR (what migrations compare). */
  readonly $schema: SchemaIR;
  readonly $dialect: Dialect<any>;
  /** Closes the driver connection when the adapter supports it. */
  $disconnect(): Promise<void>;
};

export type KastorClient<S extends SchemaShape, R> = { readonly [K in keyof S]: ModelClient<S, R, K> } & ClientMethods<S, R>;

/* ------------------------------------------------------------------------ */
/* Lazy queries                                                               */
/* ------------------------------------------------------------------------ */

/**
 * A query that runs when awaited (or `.then` is called). Pass several to
 * `$transaction([...])` to run them in one transaction.
 */
export class KastorQuery<T> implements PromiseLike<T> {
  private promise: Promise<T> | undefined;

  /** @internal */
  constructor(
    private readonly session: SessionImpl,
    private readonly body: (session: SessionImpl) => Promise<T>,
    private readonly describe: () => QueryIR[],
  ) {}

  /** @internal runs on another session (transactions). */
  runOn(session: SessionImpl): Promise<T> {
    return this.body(session);
  }

  private start(): Promise<T> {
    if (!this.promise) this.promise = Promise.resolve().then(() => this.body(this.session));
    return this.promise;
  }

  then<A = T, B = never>(onfulfilled?: ((value: T) => A | PromiseLike<A>) | null, onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
    return this.start().then(onfulfilled, onrejected);
  }

  catch<B = never>(onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null): Promise<T | B> {
    return this.start().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<T> {
    return this.start().finally(onfinally);
  }

  /** The main SQL statements this query sends, without running it. */
  toSQL(): CompiledQuery[] {
    const dialect = this.session.rt.dialect;
    if (!dialect.compile) throw errors.unsupported('toSQL()', dialect.name, 'This dialect does not compile to SQL text.');
    return this.describe().flatMap((query) => dialect.compile!(query, this.session.rt.schemaIR));
  }

  /** The dialect neutral query tree. */
  toIR(): QueryIR[] {
    return this.describe();
  }

  get [Symbol.toStringTag](): string {
    return 'KastorQuery';
  }
}

/* ------------------------------------------------------------------------ */
/* Runtime and sessions                                                       */
/* ------------------------------------------------------------------------ */

interface Runtime {
  models: Models;
  dialect: Dialect<any>;
  schemaIR: SchemaIR;
  executor: any;
}

function wrapExecutor<E extends object>(exec: E, log: (event: QueryEvent) => void): E {
  const base = exec as unknown as Executor;
  const wrapped = Object.create(exec) as Executor;
  if (typeof base.query === 'function') {
    wrapped.query = async (sql, params) => {
      const start = Date.now();
      try {
        const result = await base.query(sql, params);
        log({ sql, params, durationMs: Date.now() - start });
        return result;
      } catch (error) {
        log({ sql, params, durationMs: Date.now() - start, error });
        throw error;
      }
    };
  }
  wrapped.transaction = (fn, options) => base.transaction((tx) => fn(wrapExecutor(tx, log)), options);
  return wrapped as unknown as E;
}

class SessionImpl implements Session {
  constructor(
    readonly rt: Runtime,
    readonly exec: any,
  ) {}

  get models(): Models {
    return this.rt.models;
  }

  async run<K extends QueryIR['kind']>(query: QueryIR & { kind: K }, model: string): Promise<QueryResultMap[K]> {
    try {
      return (await this.rt.dialect.execute(query, this.rt.schemaIR, this.exec)) as QueryResultMap[K];
    } catch (error) {
      throw toKastorError(this.rt.dialect, error, { model, operation: query.kind });
    }
  }

  async transaction<T>(fn: (s: SessionImpl) => Promise<T>, options?: TransactionOptions): Promise<T> {
    if (this.exec.inTransaction) return fn(this);
    try {
      return await this.exec.transaction((tx: any) => fn(new SessionImpl(this.rt, tx)), options);
    } catch (error) {
      throw toKastorError(this.rt.dialect, error, { operation: 'transaction' });
    }
  }
}

function toKastorError(dialect: Dialect<any>, error: unknown, meta: Record<string, unknown>): Error {
  if (isKastorError(error)) {
    for (const [k, v] of Object.entries(meta)) if (!(k in error.meta)) error.meta[k] = v;
    return error;
  }
  const mapped = dialect.mapError?.(error);
  if (mapped) {
    if (isKastorError(mapped)) for (const [k, v] of Object.entries(meta)) if (!(k in mapped.meta)) mapped.meta[k] = v;
    return mapped;
  }
  const failed = errors.queryFailed(error);
  Object.assign(failed.meta, meta);
  return failed;
}

/* ------------------------------------------------------------------------ */
/* Helpers                                                                    */
/* ------------------------------------------------------------------------ */

const FIND_UNIQUE_KEYS = new Set(['where', 'select', 'include', 'withDeleted']);
const WRITE_KEYS = new Set(['data', 'select', 'include']);
const UPDATE_KEYS = new Set(['where', 'data', 'select', 'include']);
const UPSERT_KEYS = new Set(['where', 'create', 'update', 'select', 'include']);
const DELETE_KEYS = new Set(['where', 'select', 'include']);

function argsObject(m: ModelMeta, method: string, args: unknown, required = false): Record<string, unknown> {
  if (args === undefined || args === null) {
    if (required) throw errors.invalidArgument(`${m.key}.${method} needs arguments.`, `Example: ${m.key}.${method}({ where: { id: 1 } }).`);
    return {};
  }
  if (!isPlainObject(args)) throw errors.invalidArgument(`${m.key}.${method} takes an object.`, `Example: ${m.key}.${method}({ where: { ... } }).`);
  return args;
}

/** True when the result can come straight from RETURNING (no relations asked for). */
function scalarSelection(m: ModelMeta, args: Record<string, unknown>): SelectColumnIR[] | null {
  if (args.include !== undefined && args.select !== undefined) {
    throw errors.invalidArgument(`${m.key}: use select or include, not both.`, 'select picks exact fields, include adds relations.');
  }
  if (isPlainObject(args.include) && Object.values(args.include).some((v) => v !== undefined && v !== false)) return null;
  if (args.select === undefined) return allFields(m);
  if (!isPlainObject(args.select)) throw errors.invalidArgument(`${m.key}: select must be an object.`, 'Example: select: { id: true }.');
  const out: SelectColumnIR[] = [];
  for (const [key, v] of Object.entries(args.select)) {
    if (v === undefined || v === false) continue;
    const f = m.fields.get(key);
    if (!f) {
      if (m.relations.has(key) || key === '_count') return null;
      throw errors.unknownField(m.key, key, [...m.fieldKeys, ...m.relationKeys], 'select');
    }
    out.push({ column: f.column, as: key });
  }
  return out;
}

/** Reads a row back by primary key with the caller's select / include. */
async function readBack(s: SessionImpl, m: ModelMeta, row: Row, args: Record<string, unknown>): Promise<Row> {
  const read = buildRead({ models: s.models }, m, pick(args, ['select', 'include']), undefined, 'findUnique');
  read.where = pkWhere(m, row);
  const found = await s.run({ kind: 'findUnique', table: m.table, read: { ...read, take: 1 } }, m.key);
  if (!found) throw errors.notFound(m.key, 'read back');
  return found;
}

function pick(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

function projectRow(row: Row, select: SelectColumnIR[]): Row {
  const out: Row = {};
  for (const s of select) out[s.as] = row[s.as];
  return out;
}

function hasHidden(read: ReadIR): boolean {
  return read.select.some((s) => s.as.startsWith(HIDDEN_PREFIX)) || read.include.some((i) => hasHidden(i.read));
}

function reverseOrder(order: OrderByIR[]): OrderByIR[] {
  return order.map((o) => {
    const direction = o.direction === 'asc' ? 'desc' : 'asc';
    if ((o.kind === 'column' || o.kind === 'relationColumn') && o.nulls) {
      return { ...o, direction, nulls: o.nulls === 'first' ? 'last' : 'first' } as OrderByIR;
    }
    return { ...o, direction } as OrderByIR;
  });
}

/** Order by the given columns, then by the primary key so the order is total. */
function totalOrder(m: ModelMeta, order: OrderByIR[]): OrderByIR[] {
  const out = [...order];
  for (const k of m.primaryKey.length ? m.primaryKey : (m.uniques[0] ?? [])) {
    const column = m.fields.get(k)!.column;
    if (!out.some((o) => o.kind === 'column' && o.column === column)) out.push({ kind: 'column', column, direction: 'asc' });
  }
  return out;
}

/** Rows at or after (inclusive) or strictly after the key values, in `order`. */
function keyset(order: OrderByIR[], values: unknown[], inclusive: boolean): WhereIR {
  const branches: WhereIR[] = [];
  order.forEach((o, i) => {
    if (o.kind !== 'column') return;
    const v = values[i];
    const prefix = order.slice(0, i).map((p, j) => eq((p as { column: string }).column, values[j]));
    if (v === null || v === undefined) return;
    branches.push({ kind: 'and', items: [...prefix, { kind: 'compare', column: o.column, op: o.direction === 'asc' ? 'gt' : 'lt', value: v }] });
  });
  if (inclusive) branches.push({ kind: 'and', items: order.map((o, j) => eq((o as { column: string }).column, values[j])) });
  return { kind: 'or', items: branches };
}

function checkCursorOrder(m: ModelMeta, order: OrderByIR[]): void {
  if (order.some((o) => o.kind !== 'column')) {
    throw errors.invalidArgument(`${m.key}: cursor pagination needs orderBy on fields of ${m.key}.`, 'Order by columns such as createdAt or id when using cursor or findPage.');
  }
}

/* Opaque cursors for findPage */

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): string {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function encodeCursor(values: unknown[]): string {
  return toBase64Url(
    JSON.stringify(
      values.map((v) => {
        if (v instanceof Date) return { d: v.toISOString() };
        if (typeof v === 'bigint') return { n: v.toString() };
        if (v instanceof Uint8Array) return { b: Array.from(v) };
        return v;
      }),
    ),
  );
}

function decodeCursor(m: ModelMeta, cursor: string, length: number): unknown[] {
  try {
    const raw = JSON.parse(fromBase64Url(cursor)) as unknown[];
    if (!Array.isArray(raw) || raw.length !== length) throw new Error('length');
    return raw.map((v) => {
      if (isPlainObject(v) && typeof v.d === 'string') return new Date(v.d);
      if (isPlainObject(v) && typeof v.n === 'string') return BigInt(v.n);
      if (isPlainObject(v) && Array.isArray(v.b)) return Uint8Array.from(v.b as number[]);
      return v;
    });
  } catch (cause) {
    throw new KastorError('INVALID_CURSOR', `The cursor passed to ${m.key}.findPage is not valid for this query.`, {
      hint: 'Pass pageInfo.endCursor or startCursor from a findPage call with the same orderBy.',
      cause,
    });
  }
}

/* ------------------------------------------------------------------------ */
/* Aggregates                                                                 */
/* ------------------------------------------------------------------------ */

interface AggregatePlan {
  aggregates: AggregateIR[];
  assemble(row: Row): Row;
}

function aggregatePlan(m: ModelMeta, args: Record<string, unknown>): AggregatePlan {
  const aggregates: AggregateIR[] = [];
  const shape: [string, string | null, string][] = []; // [group, field or null for scalar count, alias]
  const add = (fn: AggregateFn, column: string | null, group: string, field: string | null): void => {
    const as = `a${aggregates.length}`;
    aggregates.push({ fn, column, as });
    shape.push([group, field, as]);
  };
  const fnFor: Record<string, AggregateFn> = { _count: 'count', _sum: 'sum', _avg: 'avg', _min: 'min', _max: 'max' };
  for (const group of ['_count', '_sum', '_avg', '_min', '_max']) {
    const spec = args[group];
    if (spec === undefined || spec === false) continue;
    const fn = fnFor[group]!;
    if (group === '_count' && spec === true) {
      add('count', null, group, null);
      continue;
    }
    if (!isPlainObject(spec)) throw errors.invalidArgument(`${m.key}: ${group} must be an object of fields.`, `Example: ${group}: { price: true }.`);
    for (const [key, v] of Object.entries(spec)) {
      if (v === undefined || v === false) continue;
      if (group === '_count' && key === '_all') {
        add('count', null, group, '_all');
        continue;
      }
      const f = m.fields.get(key);
      if (!f) throw errors.unknownField(m.key, key, m.fieldKeys, group);
      if ((fn === 'sum' || fn === 'avg') && !['int', 'bigint', 'float', 'decimal'].includes(f.ir.type)) {
        throw errors.invalidArgument(`${m.key}: ${group} needs a numeric field, ${key} is ${f.ir.type}.`, 'Use _min, _max or _count for other types.');
      }
      add(fn, f.column, group, key);
    }
  }
  return {
    aggregates,
    assemble(row) {
      const out: Row = {};
      for (const [group, field, as] of shape) {
        if (field === null) out[group] = row[as];
        else ((out[group] ??= {}) as Row)[field] = row[as];
      }
      return out;
    },
  };
}

function havingWhere(m: ModelMeta, input: unknown, path = 'having'): WhereIR | undefined {
  if (input === undefined || input === null) return undefined;
  if (!isPlainObject(input)) throw errors.invalidArgument(`${m.key}: having must be an object.`, 'Example: having: { price: { _avg: { gt: 10 } } }.');
  const items: WhereIR[] = [];
  const fnFor: Record<string, AggregateFn> = { _count: 'count', _sum: 'sum', _avg: 'avg', _min: 'min', _max: 'max' };
  const aggFilter = (column: string, fn: AggregateFn, filter: unknown, p: string): void => {
    const spec = isPlainObject(filter) ? filter : { equals: filter };
    for (const [op, v] of Object.entries(spec)) {
      if (v === undefined) continue;
      const base = { column, aggregate: fn };
      switch (op) {
        case 'equals':
          if (v === null) throw errors.invalidArgument(`${m.key}: aggregates in having cannot equal null (in ${p}).`, 'Compare with a number, for example { gt: 0 }.');
          items.push({ kind: 'compare', ...base, op: 'eq', value: v });
          break;
        case 'not':
          items.push({ kind: 'compare', ...base, op: 'ne', value: v });
          break;
        case 'in':
        case 'notIn':
          items.push({ kind: 'in', ...base, values: v as unknown[], negate: op === 'notIn' });
          break;
        case 'lt':
        case 'lte':
        case 'gt':
        case 'gte':
          items.push({ kind: 'compare', ...base, op, value: v });
          break;
        default:
          throw errors.invalidArgument(`${m.key}: "${op}" is not an aggregate filter (in ${p}).`, 'Use equals, not, in, notIn, lt, lte, gt or gte.');
      }
    }
  };
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (key === 'AND' || key === 'OR' || key === 'NOT') {
      const list = (Array.isArray(value) ? value : [value]).map((v, i) => havingWhere(m, v, `${path}.${key}[${i}]`) ?? { kind: 'const', value: true } as WhereIR);
      if (key === 'AND') items.push({ kind: 'and', items: list });
      else if (key === 'OR') items.push({ kind: 'or', items: list });
      else for (const l of list) items.push({ kind: 'not', item: l });
      continue;
    }
    if (key === '_count') {
      if (!isPlainObject(value) || value._all === undefined) throw errors.invalidArgument(`${m.key}: having._count needs _all.`, 'Example: having: { _count: { _all: { gt: 1 } } }.');
      aggFilter('', 'count', value._all, `${path}._count._all`);
      continue;
    }
    const f = m.fields.get(key);
    if (!f) throw errors.unknownField(m.key, key, m.fieldKeys, path);
    if (isPlainObject(value) && Object.keys(value).some((k) => k.startsWith('_'))) {
      for (const [agg, filter] of Object.entries(value)) {
        const fn = fnFor[agg];
        if (!fn) throw errors.invalidArgument(`${m.key}: "${agg}" is not an aggregate (in ${path}.${key}).`, 'Use _count, _sum, _avg, _min or _max.');
        aggFilter(f.column, fn, filter, `${path}.${key}.${agg}`);
      }
    } else {
      items.push(fieldFilter(m, f, value, `${path}.${key}`));
    }
  }
  if (items.length === 0) return undefined;
  return items.length === 1 ? items[0] : { kind: 'and', items };
}

function groupOrder(models: Models, m: ModelMeta, input: unknown, by: string[]): OrderByIR[] {
  if (input === undefined || input === null) return [];
  const out: OrderByIR[] = [];
  const fnFor: Record<string, AggregateFn> = { _count: 'count', _sum: 'sum', _avg: 'avg', _min: 'min', _max: 'max' };
  for (const item of Array.isArray(input) ? input : [input]) {
    if (!isPlainObject(item)) throw errors.invalidArgument(`${m.key}: groupBy orderBy entries must be objects.`, "Example: orderBy: { _count: { _all: 'desc' } }.");
    for (const [key, spec] of Object.entries(item)) {
      if (spec === undefined) continue;
      const fn = fnFor[key];
      if (fn) {
        if (!isPlainObject(spec)) throw errors.invalidArgument(`${m.key}: orderBy.${key} must name a field.`, `Example: orderBy: { ${key}: { price: 'desc' } }.`);
        for (const [field, dir] of Object.entries(spec)) {
          if (dir !== 'asc' && dir !== 'desc') throw errors.invalidArgument(`${m.key}: orderBy.${key}.${field} must be 'asc' or 'desc'.`, `Example: { ${field}: 'desc' }.`);
          if (field === '_all') out.push({ kind: 'aggregate', fn, column: null, direction: dir });
          else {
            const f = m.fields.get(field);
            if (!f) throw errors.unknownField(m.key, field, m.fieldKeys, `orderBy.${key}`);
            out.push({ kind: 'aggregate', fn, column: f.column, direction: dir });
          }
        }
        continue;
      }
      if (!by.includes(key)) {
        throw errors.invalidArgument(`${m.key}: groupBy can only order by fields in by, or by aggregates.`, `Add "${key}" to by, or order by an aggregate such as { _count: { _all: 'desc' } }.`);
      }
      out.push(...normalizeOrderBy(models, m, { [key]: spec }));
    }
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Model delegate                                                             */
/* ------------------------------------------------------------------------ */

function delegate(session: SessionImpl, m: ModelMeta): ModelClient<any, any, any> {
  const rt = session.rt;
  const models = rt.models;
  const q = <T>(body: (s: SessionImpl) => Promise<T>, describe: () => QueryIR[]): KastorQuery<T> => new KastorQuery<T>(session, body, describe);

  const readArgs = (method: string, raw: unknown): { args: Record<string, unknown>; read: ReadIR; reversed: boolean; strip: boolean } => {
    const args = argsObject(m, method, raw);
    const read = buildRead({ models }, m, args, undefined, method);
    let reversed = false;
    if (read.take !== undefined && read.take < 0) {
      reversed = true;
      read.take = -read.take;
      read.orderBy = reverseOrder(totalOrder(m, read.orderBy));
    }
    return { args, read, reversed, strip: hasHidden(read) };
  };

  const applyCursor = async (s: SessionImpl, read: ReadIR, cursor: unknown, withDeleted: unknown): Promise<boolean> => {
    if (cursor === undefined) return true;
    const order = totalOrder(m, read.orderBy);
    checkCursorOrder(m, order);
    const row = await findOne(s, m, uniqueWhere(s, m, cursor, 'cursor', withDeleted));
    if (!row) return false;
    const values = order.map((o) => row[m.byColumn.get((o as { column: string }).column)!.key]);
    read.orderBy = order;
    read.where = and(read.where, keyset(order, values, true));
    return true;
  };

  const findMany = async (s: SessionImpl, method: string, raw: unknown, single: boolean): Promise<Row[]> => {
    const { args, read, reversed, strip } = readArgs(method, raw);
    if (single) read.take = read.take ?? 1;
    if (!(await applyCursor(s, read, args.cursor, args.withDeleted))) return [];
    let list: Row[];
    if (single) {
      const row = await s.run({ kind: 'findFirst', table: m.table, read }, m.key);
      list = row ? [row] : [];
    } else {
      list = await s.run({ kind: 'findMany', table: m.table, read }, m.key);
    }
    if (reversed) list = list.reverse();
    if (strip) stripHidden(list);
    return list;
  };

  const describeRead = (method: string, raw: unknown, kind: 'findMany' | 'findFirst' | 'findUnique'): (() => QueryIR[]) => () => {
    const { read } = readArgs(method, raw);
    if (kind !== 'findMany') read.take = read.take ?? 1;
    return [{ kind, table: m.table, read }];
  };

  const findUniqueRead = (method: string, raw: unknown): ReadIR => {
    const args = argsObject(m, method, raw, true);
    checkKeys(m.key, method, args, FIND_UNIQUE_KEYS);
    requireUnique(m, args.where, method);
    return { ...buildRead({ models }, m, args, undefined, method), take: 1 };
  };

  const findUnique = async (s: SessionImpl, method: string, raw: unknown): Promise<Row | null> => {
    const read = findUniqueRead(method, raw);
    return s.run({ kind: 'findUnique', table: m.table, read }, m.key);
  };

  const softDelete = m.softDelete;
  const requireSoft = (method: string): NonNullable<typeof softDelete> => {
    if (!softDelete) throw errors.unsupported(`${m.key}.${method}`, `table ${m.table}`, `Enable soft delete with table('${m.table}', { ... }, { softDelete: 'deletedAt' }).`);
    return softDelete;
  };

  const deleteRow = async (s: SessionImpl, raw: unknown, method: string, hard: boolean): Promise<Row> => {
    const args = argsObject(m, method, raw, true);
    checkKeys(m.key, method, args, DELETE_KEYS);
    const where = uniqueWhere(s, m, args.where, method, hard);
    if (softDelete && !hard) {
      const updated = await s.run({ kind: 'update', table: m.table, where, data: { [softDelete.column]: { op: 'set', value: new Date() } }, returning: allFields(m) }, m.key);
      if (!updated) throw errors.notFound(m.key, method, args.where);
      const selection = scalarSelection(m, args);
      return selection ? projectRow(updated, selection) : readBackWithDeleted(s, updated, args);
    }
    const selection = scalarSelection(m, args);
    if (selection) {
      const row = await s.run({ kind: 'delete', table: m.table, where, returning: selection }, m.key);
      if (!row) throw errors.notFound(m.key, method, args.where);
      return row;
    }
    return s.transaction(async (tx) => {
      const read = buildRead({ models }, m, pick(args, ['select', 'include']), undefined, method);
      read.where = where;
      const keyRead: ReadIR = { ...read, select: [...read.select, ...m.primaryKey.filter((k) => !read.select.some((x) => x.as === k)).map((k) => ({ column: m.fields.get(k)!.column, as: `${HIDDEN_PREFIX}${k}` }))], take: 1 };
      const row = await tx.run({ kind: 'findUnique', table: m.table, read: keyRead }, m.key);
      if (!row) throw errors.notFound(m.key, method, args.where);
      const key = Object.fromEntries(m.primaryKey.map((k) => [k, row[k] ?? row[`${HIDDEN_PREFIX}${k}`]]));
      await tx.run({ kind: 'deleteMany', table: m.table, where: pkWhere(m, key) }, m.key);
      stripHidden(row);
      return row;
    });
  };

  const readBackWithDeleted = async (s: SessionImpl, row: Row, args: Record<string, unknown>): Promise<Row> => {
    const read = buildRead({ models }, m, { ...pick(args, ['select', 'include']), withDeleted: true }, undefined, 'delete');
    read.where = pkWhere(m, row);
    const found = await s.run({ kind: 'findUnique', table: m.table, read: { ...read, take: 1 } }, m.key);
    if (!found) throw errors.notFound(m.key, 'delete');
    return found;
  };

  const manyWhere = (s: SessionImpl, method: string, raw: unknown, withDeleted: boolean): WhereIR | undefined => {
    const args = argsObject(m, method, raw);
    checkKeys(m.key, method, args, new Set(['where']));
    return and(normalizeWhere({ models: s.models, softDelete: !withDeleted }, m, args.where), withDeleted ? undefined : softDeleteWhere(m, false));
  };

  const deleteMany = async (s: SessionImpl, raw: unknown, method: string, hard: boolean): Promise<{ count: number }> => {
    const where = manyWhere(s, method, raw, hard);
    if (softDelete && !hard) {
      const res = await s.run({ kind: 'updateMany', table: m.table, ...(where ? { where } : {}), data: { [softDelete.column]: { op: 'set', value: new Date() } } }, m.key);
      return { count: Array.isArray(res) ? res.length : res.count };
    }
    return s.run({ kind: 'deleteMany', table: m.table, ...(where ? { where } : {}) }, m.key);
  };

  const api: ModelClient<any, any, any> = {
    findMany: (raw?: unknown) => q((s) => findMany(s, 'findMany', raw, false), describeRead('findMany', raw, 'findMany')) as never,
    findFirst: (raw?: unknown) => q(async (s) => (await findMany(s, 'findFirst', raw, true))[0] ?? null, describeRead('findFirst', raw, 'findFirst')) as never,
    findFirstOrThrow: (raw?: unknown) =>
      q(
        async (s) => {
          const row = (await findMany(s, 'findFirstOrThrow', raw, true))[0];
          if (!row) throw errors.notFound(m.key, 'findFirstOrThrow', (raw as Record<string, unknown> | undefined)?.where);
          return row;
        },
        describeRead('findFirstOrThrow', raw, 'findFirst'),
      ) as never,
    findUnique: (raw: unknown) => q((s) => findUnique(s, 'findUnique', raw), () => [{ kind: 'findUnique', table: m.table, read: findUniqueRead('findUnique', raw) }]) as never,
    findUniqueOrThrow: (raw: unknown) =>
      q(
        async (s) => {
          const row = await findUnique(s, 'findUniqueOrThrow', raw);
          if (!row) throw errors.notFound(m.key, 'findUniqueOrThrow', (raw as Record<string, unknown>).where);
          return row;
        },
        () => [{ kind: 'findUnique', table: m.table, read: findUniqueRead('findUniqueOrThrow', raw) }],
      ) as never,

    findPage: (raw: unknown) => {
      const build = () => {
        const args = argsObject(m, 'findPage', raw, true);
        checkKeys(m.key, 'findPage', args, new Set(['where', 'orderBy', 'first', 'after', 'before', 'select', 'include', 'withDeleted']));
        const first = checkCount(args.first, 'first');
        if (first === undefined || first < 1 || first > 1000) {
          throw errors.invalidArgument(`${m.key}.findPage needs first between 1 and 1000.`, 'Example: findPage({ first: 20 }).');
        }
        if (args.after != null && args.before != null) throw errors.invalidArgument(`${m.key}.findPage takes after or before, not both.`, 'Use after to go forward and before to go back.');
        const order = totalOrder(m, normalizeOrderBy(models, m, args.orderBy));
        checkCursorOrder(m, order);
        const orderFields = order.map((o) => m.byColumn.get((o as { column: string }).column)!.key);
        const read = buildRead({ models, extraFields: orderFields }, m, pick(args, ['where', 'select', 'include', 'withDeleted']), undefined, 'findPage');
        const backward = args.before != null;
        const cursor = (backward ? args.before : args.after) as string | null | undefined;
        read.orderBy = backward ? reverseOrder(order) : order;
        if (cursor != null) {
          if (typeof cursor !== 'string') throw errors.invalidArgument(`${m.key}.findPage cursors are strings.`, 'Pass pageInfo.endCursor as after.');
          read.where = and(read.where, keyset(read.orderBy, decodeCursor(m, cursor, order.length), false));
        }
        read.take = first + 1;
        return { read, first, backward, cursor, orderFields };
      };
      return q(
        async (s) => {
          const { read, first, backward, cursor, orderFields } = build();
          const rows = await s.run({ kind: 'findMany', table: m.table, read }, m.key);
          const more = rows.length > first;
          let items = rows.slice(0, first);
          if (backward) items = items.reverse();
          const valueOf = (r: Row, k: string): unknown => (k in r ? r[k] : r[`${HIDDEN_PREFIX}${m.fields.get(k)!.column}`]);
          const cursorOf = (r: Row | undefined): string | null => (r ? encodeCursor(orderFields.map((k) => valueOf(r, k))) : null);
          const pageInfo = {
            startCursor: cursorOf(items[0]),
            endCursor: cursorOf(items[items.length - 1]),
            hasNextPage: backward ? cursor != null : more,
            hasPreviousPage: backward ? more : cursor != null,
          };
          stripHidden(items);
          return { items, pageInfo };
        },
        () => [{ kind: 'findMany', table: m.table, read: build().read }],
      ) as never;
    },

    create: (raw: unknown) => {
      const args = argsObject(m, 'create', raw, true);
      checkKeys(m.key, 'create', args, WRITE_KEYS);
      const describe = (): QueryIR[] => {
        const data = isPlainObject(args.data) ? Object.fromEntries(Object.entries(args.data).filter(([k]) => m.fields.has(k))) : {};
        return [{ kind: 'create', table: m.table, data: createRow(m, data), returning: scalarSelection(m, args) ?? allFields(m) }];
      };
      return q(async (s) => {
        const selection = scalarSelection(m, args);
        if (selection && !hasRelations(m, args.data)) {
          return createRecord(s, m, args.data).then((row) => projectRow(row, selection));
        }
        return s.transaction(async (tx) => readBack(tx, m, await createRecord(tx, m, args.data), args));
      }, describe) as never;
    },

    createMany: (raw: unknown) => {
      const build = (): QueryIR & { kind: 'createMany' } => {
        const args = argsObject(m, 'createMany', raw, true);
        checkKeys(m.key, 'createMany', args, new Set(['data', 'skipDuplicates']));
        if (!Array.isArray(args.data)) throw errors.invalidArgument(`${m.key}.createMany needs data as an array.`, 'Example: createMany({ data: [{ ... }, { ... }] }).');
        return { kind: 'createMany', table: m.table, data: args.data.map((d) => createRow(m, d, 'createMany')), skipDuplicates: args.skipDuplicates === true };
      };
      return q(async (s) => {
        const query = build();
        if (query.data.length === 0) return { count: 0 };
        const res = await s.run(query, m.key);
        return Array.isArray(res) ? { count: res.length } : res;
      }, () => [build()]) as never;
    },

    createManyAndReturn: (raw: unknown) => {
      const build = (): QueryIR & { kind: 'createMany' } => {
        const args = argsObject(m, 'createManyAndReturn', raw, true);
        checkKeys(m.key, 'createManyAndReturn', args, new Set(['data', 'skipDuplicates', 'select']));
        if (!Array.isArray(args.data)) throw errors.invalidArgument(`${m.key}.createManyAndReturn needs data as an array.`, 'Example: createManyAndReturn({ data: [{ ... }] }).');
        const selection = scalarSelection(m, pick(args, ['select']));
        if (!selection) throw errors.invalidArgument(`${m.key}.createManyAndReturn selects plain fields only.`, 'Read relations afterwards with findMany.');
        return { kind: 'createMany', table: m.table, data: args.data.map((d) => createRow(m, d, 'createManyAndReturn')), skipDuplicates: args.skipDuplicates === true, returning: selection };
      };
      return q(async (s) => {
        const query = build();
        if (query.data.length === 0) return [];
        const res = await s.run(query, m.key);
        return Array.isArray(res) ? res : [];
      }, () => [build()]) as never;
    },

    update: (raw: unknown) => {
      const args = argsObject(m, 'update', raw, true);
      checkKeys(m.key, 'update', args, UPDATE_KEYS);
      return q(
        async (s) => {
          const where = uniqueWhere(s, m, args.where, 'update');
          const selection = scalarSelection(m, args);
          if (selection && !hasRelations(m, args.data)) {
            const data = plainUpdate(m, args.data, 'update');
            const row = await s.run({ kind: 'update', table: m.table, where, data, returning: selection }, m.key);
            if (!row) throw errors.notFound(m.key, 'update', args.where);
            return row;
          }
          return s.transaction(async (tx) => {
            const current = await findOne(tx, m, where);
            if (!current) throw errors.notFound(m.key, 'update', args.where);
            const updated = await updateRecord(tx, m, current, args.data, 'update');
            return readBack(tx, m, updated, args);
          });
        },
        () => [{ kind: 'update', table: m.table, where: uniqueWhere(session, m, args.where, 'update'), data: hasRelations(m, args.data) ? {} : plainUpdate(m, args.data, 'update'), returning: scalarSelection(m, args) ?? allFields(m) }],
      ) as never;
    },

    updateMany: (raw: unknown) => {
      const build = (s: SessionImpl): QueryIR & { kind: 'updateMany' } => {
        const args = argsObject(m, 'updateMany', raw, true);
        checkKeys(m.key, 'updateMany', args, new Set(['where', 'data']));
        const where = and(normalizeWhere({ models: s.models, softDelete: true }, m, args.where), softDeleteWhere(m, false));
        return { kind: 'updateMany', table: m.table, ...(where ? { where } : {}), data: plainUpdate(m, args.data, 'updateMany') };
      };
      return q(async (s) => {
        const res = await s.run(build(s), m.key);
        return Array.isArray(res) ? { count: res.length } : res;
      }, () => [build(session)]) as never;
    },

    upsert: (raw: unknown) => {
      const args = argsObject(m, 'upsert', raw, true);
      checkKeys(m.key, 'upsert', args, UPSERT_KEYS);
      const native = (): (QueryIR & { kind: 'upsert' }) | null => {
        const { fields, values } = requireUnique(m, args.where, 'upsert');
        const selection = scalarSelection(m, args);
        const whereKeys = isPlainObject(args.where) ? Object.keys(args.where).filter((k) => args.where && (args.where as Record<string, unknown>)[k] !== undefined) : [];
        const exact = whereKeys.length === fields.length && whereKeys.every((k) => fields.includes(k));
        if (!selection || softDelete || hasRelations(m, args.create) || hasRelations(m, args.update) || !exact || !rt.dialect.features.upsert) return null;
        const conflict = Object.fromEntries(fields.map((k) => [m.fields.get(k)!.column, values.get(k)]));
        return {
          kind: 'upsert',
          table: m.table,
          conflict,
          where: uniqueWhere(session, m, args.where, 'upsert'),
          create: createRow(m, args.create as Record<string, unknown>, 'upsert'),
          update: plainUpdate(m, args.update, 'upsert'),
          returning: selection,
        };
      };
      return q(
        async (s) => {
          const query = native();
          if (query) {
            for (const [column, value] of Object.entries(query.conflict)) if (query.create[column] === undefined) query.create[column] = value;
            return s.run(query, m.key);
          }
          return s.transaction(async (tx) => {
            const where = uniqueWhere(tx, m, args.where, 'upsert');
            const current = await findOne(tx, m, where);
            const row = current ? await updateRecord(tx, m, current, args.update, 'upsert') : await createRecord(tx, m, args.create, {}, 'upsert');
            const selection = scalarSelection(m, args);
            return selection ? projectRow(row, selection) : readBack(tx, m, row, args);
          });
        },
        () => {
          const query = native();
          return query ? [query] : [{ kind: 'findUnique', table: m.table, read: { table: m.table, select: allFields(m), include: [], counts: [], orderBy: [], where: uniqueWhere(session, m, args.where, 'upsert'), take: 1 } }];
        },
      ) as never;
    },

    delete: (raw: unknown) =>
      q(
        (s) => deleteRow(s, raw, 'delete', false),
        () => {
          const args = argsObject(m, 'delete', raw, true);
          const where = uniqueWhere(session, m, args.where, 'delete');
          return softDelete
            ? [{ kind: 'update', table: m.table, where, data: { [softDelete.column]: { op: 'set', value: new Date() } }, returning: allFields(m) }]
            : [{ kind: 'delete', table: m.table, where, returning: scalarSelection(m, args) ?? allFields(m) }];
        },
      ) as never,
    deleteMany: (raw?: unknown) =>
      q(
        (s) => deleteMany(s, raw, 'deleteMany', false),
        () => {
          const where = manyWhere(session, 'deleteMany', raw, false);
          return softDelete
            ? [{ kind: 'updateMany', table: m.table, ...(where ? { where } : {}), data: { [softDelete.column]: { op: 'set', value: new Date() } } }]
            : [{ kind: 'deleteMany', table: m.table, ...(where ? { where } : {}) }];
        },
      ) as never,
    hardDelete: (raw: unknown) => {
      requireSoft('hardDelete');
      return q((s) => deleteRow(s, raw, 'hardDelete', true), () => [{ kind: 'delete', table: m.table, where: uniqueWhere(session, m, argsObject(m, 'hardDelete', raw, true).where, 'hardDelete', true), returning: allFields(m) }]) as never;
    },
    hardDeleteMany: (raw?: unknown) => {
      requireSoft('hardDeleteMany');
      return q((s) => deleteMany(s, raw, 'hardDeleteMany', true), () => {
        const where = manyWhere(session, 'hardDeleteMany', raw, true);
        return [{ kind: 'deleteMany', table: m.table, ...(where ? { where } : {}) }];
      }) as never;
    },
    restore: (raw?: unknown) => {
      const sd = requireSoft('restore');
      const build = (s: SessionImpl): QueryIR & { kind: 'updateMany' } => {
        const where = and(manyWhere(s, 'restore', raw, true), { kind: 'null', column: sd.column, negate: true });
        return { kind: 'updateMany', table: m.table, ...(where ? { where } : {}), data: { [sd.column]: { op: 'set', value: null } } };
      };
      return q(async (s) => {
        const res = await s.run(build(s), m.key);
        return { count: Array.isArray(res) ? res.length : res.count };
      }, () => [build(session)]) as never;
    },

    count: (raw?: unknown) => {
      const build = (): { query: QueryIR & { kind: 'count' | 'aggregate' }; select: string[] | null; read: ReadIR; args: Record<string, unknown> } => {
        const args = argsObject(m, 'count', raw);
        checkKeys(m.key, 'count', args, new Set(['where', 'orderBy', 'take', 'skip', 'cursor', 'distinct', 'select', 'withDeleted']));
        const read = buildRead({ models }, m, pick(args, ['where', 'orderBy', 'take', 'skip', 'distinct', 'withDeleted']), undefined, 'count');
        const base = {
          table: m.table,
          ...(read.where ? { where: read.where } : {}),
          ...(read.orderBy.length ? { orderBy: read.orderBy } : {}),
          ...(read.take !== undefined ? { take: Math.abs(read.take) } : {}),
          ...(read.skip !== undefined ? { skip: read.skip } : {}),
        };
        if (args.select !== undefined) {
          if (!isPlainObject(args.select)) throw errors.invalidArgument(`${m.key}.count select must be an object.`, 'Example: count({ select: { _all: true, name: true } }).');
          const keys = Object.keys(args.select).filter((k) => (args.select as Record<string, unknown>)[k] === true);
          const aggregates: AggregateIR[] = keys.map((k, i) => {
            if (k === '_all') return { fn: 'count', column: null, as: `a${i}` };
            const f = m.fields.get(k);
            if (!f) throw errors.unknownField(m.key, k, m.fieldKeys, 'count.select');
            return { fn: 'count', column: f.column, as: `a${i}` };
          });
          return { query: { kind: 'aggregate', ...base, aggregates }, select: keys, read, args };
        }
        return { query: { kind: 'count', ...base, ...(read.distinct ? { distinct: read.distinct } : {}) }, select: null, read, args };
      };
      return q(
        async (s) => {
          const { query, select, read, args } = build();
          const empty = select ? Object.fromEntries(select.map((k) => [k, 0])) : 0;
          if (args.cursor !== undefined) {
            if (!(await applyCursor(s, read, args.cursor, args.withDeleted))) return empty;
            if (read.where) query.where = read.where;
            query.orderBy = read.orderBy;
          }
          if (query.kind === 'aggregate') {
            const res = await s.run(query, m.key);
            return Object.fromEntries(select!.map((k, i) => [k, Number(res[`a${i}`] ?? 0)]));
          }
          return s.run(query, m.key);
        },
        () => [build().query],
      ) as never;
    },

    aggregate: (raw: unknown) => {
      const build = (): { query: QueryIR & { kind: 'aggregate' }; plan: AggregatePlan; cursor: unknown; read: ReadIR; withDeleted: unknown } => {
        const args = argsObject(m, 'aggregate', raw, true);
        checkKeys(m.key, 'aggregate', args, new Set(['where', 'orderBy', 'take', 'skip', 'cursor', 'withDeleted', '_count', '_sum', '_avg', '_min', '_max']));
        const read = buildRead({ models }, m, pick(args, ['where', 'orderBy', 'take', 'skip', 'withDeleted']), undefined, 'aggregate');
        const plan = aggregatePlan(m, args);
        const query: QueryIR & { kind: 'aggregate' } = {
          kind: 'aggregate',
          table: m.table,
          aggregates: plan.aggregates,
          ...(read.where ? { where: read.where } : {}),
          ...(read.orderBy.length ? { orderBy: read.orderBy } : {}),
          ...(read.take !== undefined ? { take: Math.abs(read.take) } : {}),
          ...(read.skip !== undefined ? { skip: read.skip } : {}),
        };
        return { query, plan, cursor: args.cursor, read, withDeleted: args.withDeleted };
      };
      return q(
        async (s) => {
          const { query, plan, cursor, read, withDeleted } = build();
          if (cursor !== undefined) {
            if (!(await applyCursor(s, read, cursor, withDeleted))) return plan.assemble({});
            if (read.where) query.where = read.where;
            query.orderBy = read.orderBy;
          }
          const row = await s.run(query, m.key);
          return plan.assemble(row);
        },
        () => [build().query],
      ) as never;
    },

    groupBy: (raw: unknown) => {
      const build = (): { query: QueryIR & { kind: 'groupBy' }; plan: AggregatePlan } => {
        const args = argsObject(m, 'groupBy', raw, true);
        checkKeys(m.key, 'groupBy', args, new Set(['by', 'where', 'having', 'orderBy', 'take', 'skip', 'withDeleted', '_count', '_sum', '_avg', '_min', '_max']));
        const by = (Array.isArray(args.by) ? args.by : [args.by]).map((k) => {
          const f = typeof k === 'string' ? m.fields.get(k) : undefined;
          if (!f) throw errors.unknownField(m.key, String(k), m.fieldKeys, 'groupBy.by');
          return f;
        });
        const where = and(normalizeWhere({ models, softDelete: args.withDeleted !== true }, m, args.where), softDeleteWhere(m, args.withDeleted));
        const plan = aggregatePlan(m, args);
        const having = havingWhere(m, args.having);
        const take = checkCount(args.take, 'take');
        const skip = checkCount(args.skip, 'skip');
        const query: QueryIR & { kind: 'groupBy' } = {
          kind: 'groupBy',
          table: m.table,
          by: by.map((f) => ({ column: f.column, as: f.key })),
          aggregates: plan.aggregates,
          orderBy: groupOrder(models, m, args.orderBy, by.map((f) => f.key)),
          ...(where ? { where } : {}),
          ...(having ? { having } : {}),
          ...(take !== undefined ? { take } : {}),
          ...(skip ? { skip } : {}),
        };
        return { query, plan };
      };
      return q(
        async (s) => {
          const { query, plan } = build();
          const rows = await s.run(query, m.key);
          return rows.map((r) => ({ ...Object.fromEntries(query.by.map((b) => [b.as, r[b.as]])), ...plan.assemble(r) }));
        },
        () => [build().query],
      ) as never;
    },
  };
  return api;
}

/* ------------------------------------------------------------------------ */
/* kastor()                                                                   */
/* ------------------------------------------------------------------------ */

function buildClient(session: SessionImpl): any {
  const { rt } = session;
  const client: Record<string, unknown> = {};
  for (const m of rt.models.byKey.values()) {
    Object.defineProperty(client, m.key, { value: delegate(session, m), enumerable: true });
  }

  const rawQuery = (strings: TemplateStringsArray, values: unknown[]): { sql: string; params: unknown[] } => {
    if (!rt.dialect.features.rawSql) {
      throw errors.unsupported('Raw SQL', rt.dialect.name, 'Use the query API, or the native driver for database specific commands.');
    }
    const quote = rt.dialect.quoteIdent ?? ((n: string) => `"${n.replace(/"/g, '""')}"`);
    const placeholder = rt.dialect.placeholder ?? (() => '?');
    const encode = rt.dialect.encodeParam ?? ((v: unknown) => v);
    return renderFragment(sqlTag(strings, ...values), quote, placeholder, 1, encode);
  };

  const runRaw = async (s: SessionImpl, strings: TemplateStringsArray, values: unknown[]) => {
    const { sql, params } = rawQuery(strings, values);
    if (typeof s.exec.query !== 'function') throw errors.unsupported('Raw SQL', rt.dialect.name, 'This adapter does not run SQL text.');
    try {
      return await (s.exec as Executor).query(sql, params);
    } catch (error) {
      throw toKastorError(rt.dialect, error, { operation: 'raw' });
    }
  };

  const methods = {
    $transaction(arg: unknown, options?: TransactionOptions): Promise<unknown> {
      if (Array.isArray(arg)) {
        for (const item of arg) {
          if (!(item instanceof KastorQuery)) {
            throw errors.invalidArgument('$transaction([...]) takes queries made by this client.', 'Pass the queries without awaiting them: $transaction([db.a.create(...), db.b.update(...)]).');
          }
        }
        return session.transaction(async (tx) => {
          const results: unknown[] = [];
          for (const item of arg as KastorQuery<unknown>[]) results.push(await item.runOn(tx));
          return results;
        }, options);
      }
      if (typeof arg !== 'function') throw errors.invalidArgument('$transaction takes a function or an array of queries.', 'Example: await db.$transaction(async (tx) => { ... }).');
      return session.transaction((tx) => (arg as (c: unknown) => Promise<unknown>)(tx === session ? client : buildClient(tx)), options);
    },
    $sql(strings: TemplateStringsArray, ...values: unknown[]) {
      return new KastorQuery(session, async (s) => (await runRaw(s, strings, values)).rows, () => []);
    },
    $execute(strings: TemplateStringsArray, ...values: unknown[]) {
      return new KastorQuery(session, async (s) => {
        const res = await runRaw(s, strings, values);
        return res.rowsAffected ?? 0;
      }, () => []);
    },
    async $disconnect() {
      if (typeof rt.executor.close === 'function') await rt.executor.close();
    },
  };
  for (const [k, v] of Object.entries(methods)) Object.defineProperty(client, k, { value: v, enumerable: false });
  Object.defineProperty(client, '$schema', { value: rt.schemaIR, enumerable: false });
  Object.defineProperty(client, '$dialect', { value: rt.dialect, enumerable: false });
  return client;
}

/**
 * Creates a client.
 *
 * ```ts
 * const db = kastor({ adapter: postgres(pool), schema: { users, posts }, relations: ... })
 * const users = await db.users.findMany({ include: { posts: true } })
 * ```
 */
export function kastor<S extends Record<string, unknown>, R extends object = {}, Ids extends IdType = 'number'>(config: KastorOptions<S, R, Ids>): KastorClient<WithIdType<SchemaOf<S>, Ids>, R> {
  if (!config || typeof config !== 'object') throw errors.invalidArgument('kastor() needs a config object.', 'Example: kastor({ adapter: postgres(pool), schema: { users } }).');
  const { adapter } = config;
  if (!adapter || typeof adapter !== 'object' || !adapter.dialect || !adapter.executor) {
    throw errors.invalidArgument(
      'kastor() needs an adapter.',
      "Create one from a dialect entry point, for example: import { postgres } from 'kastor/postgres'; kastor({ adapter: postgres(pool), schema }).",
    );
  }
  if (!config.schema || typeof config.schema !== 'object') {
    throw errors.invalidArgument('kastor() needs a schema.', 'Pass your tables: kastor({ adapter, schema: { users, posts } }).');
  }
  const tables = Object.fromEntries(Object.entries(config.schema).filter(([, v]) => isTable(v)));
  const models = buildModels(tables, config.relations as ((t: any) => RelationsInput) | undefined, { idType: adapter.dialect.features.idType ?? 'number' });
  const log = config.log === true ? (e: QueryEvent) => console.log(`[kastor] ${e.sql} ${JSON.stringify(e.params, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))} (${e.durationMs} ms)`) : typeof config.log === 'function' ? config.log : undefined;
  const executor = log ? wrapExecutor(adapter.executor, log) : adapter.executor;
  const rt: Runtime = { models, dialect: adapter.dialect, schemaIR: models.schemaIR, executor };
  return buildClient(new SessionImpl(rt, executor));
}
