/**
 * Builds ReadIR trees from find arguments: select / include shaping,
 * relation counts, ordering, paging and soft delete filters.
 */
import { errors } from './errors';
import type { IncludeIR, OrderByIR, ReadIR, RelationCountIR, RelationIR, SelectColumnIR, WhereIR } from './ir';
import type { ModelMeta, Models, RelationMeta } from './model';
import { and, isPlainObject, normalizeWhere } from './where';

/** Output keys starting with this prefix are added by kastor and removed before results reach the caller. */
export const HIDDEN_PREFIX = '__kastor_';

export interface ReadOptions {
  models: Models;
  /** Root level only: extra fields to select under hidden names (cursor building). */
  extraFields?: string[];
}

const ROOT_KEYS = new Set(['where', 'select', 'include', 'orderBy', 'take', 'skip', 'cursor', 'distinct', 'withDeleted']);
const MANY_INCLUDE_KEYS = new Set(['where', 'select', 'include', 'orderBy', 'take', 'skip', 'distinct', 'withDeleted']);
const ONE_INCLUDE_KEYS = new Set(['select', 'include', 'withDeleted']);

export function checkKeys(model: string, method: string, args: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  for (const key of Object.keys(args)) {
    if (!allowed.has(key)) {
      throw errors.invalidArgument(
        `${model}.${method} does not take "${key}".`,
        `Arguments of ${method}: ${[...allowed].join(', ')}.`,
        { model, method, argument: key },
      );
    }
  }
}

export function checkCount(value: unknown, what: string, allowNegative = false): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || (!allowNegative && value < 0)) {
    throw errors.invalidArgument(
      `${what} must be a ${allowNegative ? '' : 'non negative '}whole number, got ${String(value)}.`,
      `Example: ${what}: 10.`,
    );
  }
  return value;
}

/** Soft delete condition for a model, unless `withDeleted`. */
export function softDeleteWhere(m: ModelMeta, withDeleted: unknown): WhereIR | undefined {
  if (!m.softDelete || withDeleted === true) return undefined;
  return { kind: 'null', column: m.softDelete.column, negate: false };
}

export function relationFor(rel: RelationMeta, withDeleted: unknown): RelationIR {
  if (withDeleted !== true || !rel.ir.softDeleteColumn) return rel.ir;
  const { softDeleteColumn: _drop, ...rest } = rel.ir;
  return rest;
}

export function normalizeOrderBy(models: Models, m: ModelMeta, input: unknown, path = 'orderBy'): OrderByIR[] {
  if (input === undefined || input === null) return [];
  const list = Array.isArray(input) ? input : [input];
  const out: OrderByIR[] = [];
  for (const item of list) {
    if (!isPlainObject(item)) throw errors.invalidArgument(`${m.key}: ${path} entries must be objects.`, "Example: orderBy: { createdAt: 'desc' }.");
    for (const [key, spec] of Object.entries(item)) {
      if (spec === undefined) continue;
      const f = m.fields.get(key);
      if (f) {
        const { direction, nulls } = sortSpec(m.key, `${path}.${key}`, spec);
        out.push({ kind: 'column', column: f.column, direction, ...(nulls ? { nulls } : {}) });
        continue;
      }
      const rel = m.relations.get(key);
      if (rel && rel.kind === 'many') {
        if (!isPlainObject(spec) || (spec._count !== 'asc' && spec._count !== 'desc')) {
          throw errors.invalidArgument(`${m.key}: order a list relation by its count.`, `Example: orderBy: { ${key}: { _count: 'desc' } }.`);
        }
        out.push({ kind: 'relationCount', relation: rel.ir, direction: spec._count });
        continue;
      }
      if (rel && rel.kind === 'one') {
        const target = models.model(rel.targetKey);
        for (const nested of normalizeOrderBy(models, target, spec, `${path}.${key}`)) {
          if (nested.kind === 'column') {
            out.push({ kind: 'relationColumn', path: [rel.ir], column: nested.column, direction: nested.direction, ...(nested.nulls ? { nulls: nested.nulls } : {}) });
          } else if (nested.kind === 'relationColumn') {
            out.push({ ...nested, path: [rel.ir, ...nested.path] });
          } else {
            throw errors.invalidArgument(`${m.key}: ${path}.${key} can only order by fields of ${target.key}.`, `Example: orderBy: { ${key}: { name: 'asc' } }.`);
          }
        }
        continue;
      }
      throw errors.unknownField(m.key, key, [...m.fieldKeys, ...m.relationKeys], path);
    }
  }
  return out;
}

function sortSpec(model: string, path: string, spec: unknown): { direction: 'asc' | 'desc'; nulls?: 'first' | 'last' } {
  if (spec === 'asc' || spec === 'desc') return { direction: spec };
  if (isPlainObject(spec) && (spec.sort === 'asc' || spec.sort === 'desc')) {
    if (spec.nulls !== undefined && spec.nulls !== 'first' && spec.nulls !== 'last') {
      throw errors.invalidArgument(`${model}: ${path}.nulls must be "first" or "last".`, "Example: { sort: 'asc', nulls: 'last' }.");
    }
    return { direction: spec.sort, ...(spec.nulls ? { nulls: spec.nulls as 'first' | 'last' } : {}) };
  }
  throw errors.invalidArgument(`${model}: ${path} must be 'asc' or 'desc'.`, "Example: { createdAt: 'desc' } or { name: { sort: 'asc', nulls: 'last' } }.");
}

function normalizeDistinct(m: ModelMeta, input: unknown): string[] | undefined {
  if (input === undefined || input === null) return undefined;
  const list = Array.isArray(input) ? input : [input];
  return list.map((k) => {
    const f = typeof k === 'string' ? m.fields.get(k) : undefined;
    if (!f) throw errors.unknownField(m.key, String(k), m.fieldKeys, 'distinct');
    return f.column;
  });
}

function counts(models: Models, m: ModelMeta, spec: unknown, withDeleted: unknown): RelationCountIR[] {
  if (spec === undefined || spec === false || spec === null) return [];
  const many = [...m.relations.values()].filter((r) => r.kind === 'many');
  if (spec === true) return many.map((r) => ({ relation: relationFor(r, withDeleted), as: r.key }));
  if (!isPlainObject(spec) || !isPlainObject(spec.select)) {
    throw errors.invalidArgument(`${m.key}: _count must be true or { select: { relation: true } }.`, '_count: { select: { posts: true } }');
  }
  const out: RelationCountIR[] = [];
  for (const [key, v] of Object.entries(spec.select)) {
    if (v === undefined || v === false) continue;
    const rel = m.relations.get(key);
    if (!rel) throw errors.unknownRelation(m.key, key, m.relationKeys);
    if (rel.kind !== 'many') throw errors.invalidArgument(`${m.key}: _count only counts list relations, ${key} is a single relation.`, 'Count list relations such as posts or comments.');
    const target = models.model(rel.targetKey);
    let where: WhereIR | undefined;
    if (isPlainObject(v) && v.where !== undefined) where = normalizeWhere({ models, softDelete: withDeleted !== true }, target, v.where, `_count.select.${key}.where`);
    out.push({ relation: relationFor(rel, withDeleted), as: key, ...(where ? { where } : {}) });
  }
  return out;
}

/**
 * Builds the read for model `m` from arguments. `nested` is set for include
 * levels, where cursor is not allowed and one relations take no paging.
 */
export function buildRead(opts: ReadOptions, m: ModelMeta, args: Record<string, unknown>, nested?: RelationMeta, method = 'findMany'): ReadIR {
  const { models } = opts;
  if (nested) checkKeys(m.key, `include.${nested.key}`, args, nested.kind === 'many' ? MANY_INCLUDE_KEYS : ONE_INCLUDE_KEYS);
  else checkKeys(m.key, method, args, ROOT_KEYS);
  if (args.select !== undefined && args.include !== undefined) {
    throw errors.invalidArgument(`${m.key}: use select or include, not both.`, 'select picks exact fields (relations included), include adds relations to all fields.');
  }
  const withDeleted = args.withDeleted;
  const select: SelectColumnIR[] = [];
  const include: IncludeIR[] = [];
  let countList: RelationCountIR[] = [];

  const addRelation = (key: string, value: unknown): void => {
    const rel = m.relations.get(key);
    if (!rel) throw errors.unknownRelation(m.key, key, m.relationKeys);
    if (value === false || value === undefined) return;
    const childArgs = value === true ? {} : value;
    if (!isPlainObject(childArgs)) throw errors.invalidArgument(`${m.key}: include.${key} must be true or an object.`, `Example: include: { ${key}: { take: 5 } }.`);
    const target = models.model(rel.targetKey);
    include.push({ relation: relationFor(rel, childArgs.withDeleted), read: buildRead(opts, target, childArgs, rel) });
  };

  if (args.select !== undefined) {
    if (!isPlainObject(args.select)) throw errors.invalidArgument(`${m.key}: select must be an object.`, 'Example: select: { id: true, email: true }.');
    for (const [key, value] of Object.entries(args.select)) {
      if (value === undefined || value === false) continue;
      if (key === '_count') {
        countList = counts(models, m, value, withDeleted);
        continue;
      }
      const f = m.fields.get(key);
      if (f) {
        if (value !== true) throw errors.invalidArgument(`${m.key}: select.${key} must be true or false.`, `Example: select: { ${key}: true }.`);
        select.push({ column: f.column, as: key });
        continue;
      }
      if (m.relations.has(key)) {
        addRelation(key, value);
        continue;
      }
      throw errors.unknownField(m.key, key, [...m.fieldKeys, ...m.relationKeys], 'select');
    }
  } else {
    for (const f of m.fields.values()) select.push({ column: f.column, as: f.key });
    if (args.include !== undefined) {
      if (!isPlainObject(args.include)) throw errors.invalidArgument(`${m.key}: include must be an object.`, 'Example: include: { posts: true }.');
      for (const [key, value] of Object.entries(args.include)) {
        if (value === undefined || value === false) continue;
        if (key === '_count') {
          countList = counts(models, m, value, withDeleted);
          continue;
        }
        addRelation(key, value);
      }
    }
  }

  const distinct = normalizeDistinct(m, args.distinct);
  const hidden = new Set<string>();
  const ensureSelected = (column: string): void => {
    if (select.some((s) => s.column === column)) return;
    const alias = `${HIDDEN_PREFIX}${column}`;
    if (!hidden.has(alias)) {
      hidden.add(alias);
      select.push({ column, as: alias });
    }
  };
  if (nested && distinct) for (const c of distinct) ensureSelected(c);
  for (const key of opts.extraFields ?? []) {
    if (!nested) ensureSelected(m.fields.get(key)!.column);
  }

  const where = and(normalizeWhere({ models, softDelete: withDeleted !== true }, m, args.where), nested ? undefined : softDeleteWhere(m, withDeleted));
  const take = checkCount(args.take, 'take', !nested);
  const skip = checkCount(args.skip, 'skip');
  if (nested && nested.kind === 'many' && distinct && take !== undefined) {
    throw errors.unsupported('distinct together with take inside an include', 'any database', 'Drop take, or load the relation with its own findMany.');
  }
  const read: ReadIR = {
    table: m.table,
    select,
    include,
    counts: countList,
    orderBy: normalizeOrderBy(models, m, args.orderBy),
    ...(where ? { where } : {}),
    ...(take !== undefined ? { take } : {}),
    ...(skip ? { skip } : {}),
    ...(distinct ? { distinct } : {}),
  };
  return read;
}

/** Removes kastor's hidden keys from result rows, recursively. */
export function stripHidden(value: unknown): void {
  if (Array.isArray(value)) {
    for (const v of value) stripHidden(v);
    return;
  }
  if (typeof value !== 'object' || value === null || value instanceof Date || value instanceof Uint8Array) return;
  for (const key of Object.keys(value)) {
    if (key.startsWith(HIDDEN_PREFIX)) delete (value as Record<string, unknown>)[key];
    else {
      const v = (value as Record<string, unknown>)[key];
      if (typeof v === 'object' && v !== null && !(v instanceof Date) && !(v instanceof Uint8Array)) stripHidden(v);
    }
  }
}
