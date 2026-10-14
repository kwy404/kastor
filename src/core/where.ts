/**
 * Turns user filters (`where: { email: { endsWith: '@acme.com' } }`) into the
 * normalized WhereIR tree, with readable errors for unknown fields, bad
 * operators and values of the wrong type.
 */
import { closest, errors } from './errors';
import type { CompareOp, WhereIR } from './ir';
import type { FieldMeta, ModelMeta, Models, RelationMeta } from './model';
import { isSqlFragment } from './raw';

const SCALAR_FILTER_KEYS = ['equals', 'not', 'in', 'notIn', 'lt', 'lte', 'gt', 'gte', 'contains', 'startsWith', 'endsWith', 'mode'] as const;
const COMPARE: Record<string, CompareOp> = { lt: 'lt', lte: 'lte', gt: 'gt', gte: 'gte' };

export const TRUE: WhereIR = { kind: 'const', value: true };
export const FALSE: WhereIR = { kind: 'const', value: false };

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function and(...items: (WhereIR | undefined | null)[]): WhereIR | undefined {
  const list = items.filter((i): i is WhereIR => !!i && !(i.kind === 'const' && i.value));
  if (list.length === 0) return undefined;
  if (list.length === 1) return list[0];
  return { kind: 'and', items: list.flatMap((i) => (i.kind === 'and' ? i.items : [i])) };
}

export function eq(column: string, value: unknown): WhereIR {
  return value === null || value === undefined ? { kind: 'null', column, negate: false } : { kind: 'compare', column, op: 'eq', value };
}

/* ------------------------------------------------------------------------ */
/* Value checks                                                               */
/* ------------------------------------------------------------------------ */

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (value instanceof Date) return 'a Date';
  if (value instanceof Uint8Array) return 'bytes';
  if (typeof value === 'object') return 'an object';
  if (typeof value === 'string') return `the string "${value.length > 40 ? `${value.slice(0, 40)}...` : value}"`;
  return `${typeof value} ${String(value)}`;
}

/** Checks that a value fits a column, throwing VALIDATION_FAILED with a hint otherwise. */
export function checkValue(m: ModelMeta, f: FieldMeta, value: unknown): void {
  if (value === null || value === undefined) return;
  const type = f.ir.type;
  if (f.stringId && typeof value === 'string') {
    if (value.length === 0) throw errors.validation(m.key, f.key, 'expected an id, got an empty string', 'Pass the id returned by the database.');
    return;
  }
  const fail = (expected: string, hint: string): never => {
    throw errors.validation(m.key, f.key, `expected ${expected}, got ${describe(value)}`, hint);
  };
  switch (type) {
    case 'int':
      if (typeof value === 'bigint') return;
      if (typeof value !== 'number' || !Number.isInteger(value)) fail('an integer', 'Pass a whole number, for example 42.');
      return;
    case 'float':
      if (typeof value !== 'number' || Number.isNaN(value)) fail('a number', 'Pass a number, for example 3.14.');
      return;
    case 'bigint':
      if (typeof value === 'bigint' || (typeof value === 'number' && Number.isInteger(value))) return;
      if (typeof value === 'string' && /^-?\d+$/.test(value)) return;
      fail('a bigint', 'Pass a bigint, for example 42n.');
      return;
    case 'decimal':
      if (typeof value === 'number' && Number.isFinite(value)) return;
      if (typeof value === 'string' && /^-?(\d+\.?\d*|\.\d+)$/.test(value.trim())) return;
      fail('a decimal string', "Pass a string like '19.99' to keep every digit.");
      return;
    case 'boolean':
      if (typeof value !== 'boolean') fail('a boolean', 'Pass true or false.');
      return;
    case 'datetime':
      if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) fail('a valid Date', 'The Date is invalid; check how it was built.');
        return;
      }
      if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return;
      fail('a Date', 'Pass a Date, or an ISO 8601 string such as 2026-01-31T12:00:00Z.');
      return;
    case 'date':
      if (value instanceof Date || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))) return;
      fail('a date', "Pass 'YYYY-MM-DD', for example '2026-01-31'.");
      return;
    case 'time':
      if (typeof value === 'string' && /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value)) return;
      fail('a time', "Pass 'HH:MM:SS', for example '09:30:00'.");
      return;
    case 'uuid':
      if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
        fail('a UUID', "Pass a UUID string such as '0f8fad5b-d9cb-469f-a165-70867728950e'.");
      }
      return;
    case 'enum':
      if (typeof value !== 'string' || !f.ir.enumValues?.includes(value)) {
        fail(`one of ${f.ir.enumValues?.map((v) => `"${v}"`).join(', ')}`, 'Use one of the values declared in t.enum([...]).');
      }
      return;
    case 'string':
    case 'text':
      if (typeof value !== 'string') fail('a string', 'Pass text.');
      if (f.ir.length !== undefined && typeof value === 'string' && value.length > f.ir.length) {
        fail(`at most ${f.ir.length} characters`, `Shorten the text, or raise the limit with t.string(${f.ir.length * 2}).`);
      }
      return;
    case 'bytes':
      if (!(value instanceof Uint8Array)) fail('bytes', 'Pass a Uint8Array (a Node Buffer works too).');
      return;
    case 'json':
      return;
  }
}

/* ------------------------------------------------------------------------ */
/* Where                                                                      */
/* ------------------------------------------------------------------------ */

export interface WhereContext {
  models: Models;
  /** Applies soft delete filters in relation filters (true unless withDeleted). */
  softDelete: boolean;
}

/** Normalizes a where input; undefined when it filters nothing. */
export function normalizeWhere(ctx: WhereContext, m: ModelMeta, input: unknown, path = 'where'): WhereIR | undefined {
  if (input === undefined || input === null) return undefined;
  if (isSqlFragment(input)) return { kind: 'raw', sql: { strings: input.strings, params: input.params } };
  if (!isPlainObject(input)) {
    throw errors.invalidArgument(`${m.key}: ${path} must be an object, got ${describe(input)}.`, `Example: ${path}: { id: 1 }.`);
  }
  const items: WhereIR[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (key === 'AND') {
      const list = Array.isArray(value) ? value : [value];
      const nested = list.map((v, i) => normalizeWhere(ctx, m, v, `${path}.AND[${i}]`) ?? TRUE);
      items.push(nested.length === 0 ? TRUE : { kind: 'and', items: nested });
      continue;
    }
    if (key === 'OR') {
      if (!Array.isArray(value)) throw errors.invalidArgument(`${m.key}: ${path}.OR must be an array.`, 'Example: OR: [{ role: "admin" }, { email: { endsWith: "@acme.com" } }].');
      items.push({ kind: 'or', items: value.map((v, i) => normalizeWhere(ctx, m, v, `${path}.OR[${i}]`) ?? TRUE) });
      continue;
    }
    if (key === 'NOT') {
      const list = Array.isArray(value) ? value : [value];
      for (const [i, v] of list.entries()) {
        const inner = normalizeWhere(ctx, m, v, `${path}.NOT[${i}]`);
        items.push(inner ? { kind: 'not', item: inner } : FALSE);
      }
      continue;
    }
    const field = m.fields.get(key);
    if (field) {
      items.push(fieldFilter(m, field, value, `${path}.${key}`));
      continue;
    }
    const rel = m.relations.get(key);
    if (rel) {
      items.push(relationFilter(ctx, m, rel, value, `${path}.${key}`));
      continue;
    }
    throw errors.unknownField(m.key, key, [...m.fieldKeys, ...m.relationKeys], path);
  }
  if (items.length === 0) return undefined;
  return items.length === 1 ? items[0] : { kind: 'and', items };
}

function isFilterObject(f: FieldMeta, value: unknown): value is Record<string, unknown> {
  if (!isPlainObject(value)) return false;
  if (f.ir.type !== 'json') return true;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((k) => (SCALAR_FILTER_KEYS as readonly string[]).includes(k));
}

/** Normalizes one field filter (also used for groupBy `having`). */
export function fieldFilter(m: ModelMeta, f: FieldMeta, value: unknown, path: string): WhereIR {
  const column = f.column;
  if (value === null) return { kind: 'null', column, negate: false };
  if (!isFilterObject(f, value)) {
    checkValue(m, f, value);
    return { kind: 'compare', column, op: 'eq', value };
  }
  const insensitive = value.mode === 'insensitive';
  if (value.mode !== undefined && value.mode !== 'insensitive' && value.mode !== 'default') {
    throw errors.invalidArgument(`${m.key}: ${path}.mode must be "default" or "insensitive".`, "Use mode: 'insensitive' for case insensitive matching.");
  }
  const items: WhereIR[] = [];
  for (const [op, arg] of Object.entries(value)) {
    if (arg === undefined || op === 'mode') continue;
    switch (op) {
      case 'equals':
        if (arg === null) items.push({ kind: 'null', column, negate: false });
        else {
          checkValue(m, f, arg);
          items.push({ kind: 'compare', column, op: 'eq', value: arg, ...(insensitive ? { insensitive } : {}) });
        }
        break;
      case 'not': {
        if (arg === null) {
          items.push({ kind: 'null', column, negate: true });
        } else if (isFilterObject(f, arg)) {
          const inner = fieldFilter(m, f, insensitive && arg.mode === undefined ? { ...arg, mode: 'insensitive' } : arg, `${path}.not`);
          items.push(f.config.nullable ? { kind: 'or', items: [{ kind: 'not', item: inner }, { kind: 'null', column, negate: false }] } : { kind: 'not', item: inner });
        } else {
          checkValue(m, f, arg);
          const ne: WhereIR = { kind: 'compare', column, op: 'ne', value: arg, ...(insensitive ? { insensitive } : {}) };
          // `not: x` keeps rows where the column is NULL: NULL is not x.
          items.push(f.config.nullable ? { kind: 'or', items: [ne, { kind: 'null', column, negate: false }] } : ne);
        }
        break;
      }
      case 'in':
      case 'notIn': {
        if (!Array.isArray(arg)) throw errors.invalidArgument(`${m.key}: ${path}.${op} must be an array.`, `Example: ${op}: [1, 2, 3].`);
        for (const v of arg) checkValue(m, f, v);
        const node: WhereIR = { kind: 'in', column, values: arg, negate: op === 'notIn', ...(insensitive ? { insensitive } : {}) };
        items.push(op === 'notIn' && f.config.nullable && !arg.includes(null) ? { kind: 'or', items: [node, { kind: 'null', column, negate: false }] } : node);
        break;
      }
      case 'lt':
      case 'lte':
      case 'gt':
      case 'gte':
        if (arg === null) throw errors.invalidArgument(`${m.key}: ${path}.${op} cannot be null.`, 'Use { equals: null } or { not: null } to test for null.');
        checkValue(m, f, arg);
        items.push({ kind: 'compare', column, op: COMPARE[op]!, value: arg, ...(insensitive ? { insensitive } : {}) });
        break;
      case 'contains':
      case 'startsWith':
      case 'endsWith':
        if (typeof arg !== 'string') throw errors.invalidArgument(`${m.key}: ${path}.${op} needs a string.`, `Example: ${op}: 'acme'.`);
        if (!['string', 'text', 'enum', 'uuid'].includes(f.ir.type)) {
          throw errors.invalidArgument(`${m.key}: ${op} only works on text fields, ${f.key} is ${f.ir.type}.`, 'Use equals, in, lt or gt for this field.');
        }
        items.push({ kind: 'like', column, mode: op, value: arg, insensitive, negate: false });
        break;
      default: {
        const guess = closest(op, SCALAR_FILTER_KEYS);
        throw errors.invalidArgument(
          `${m.key}: "${op}" is not a filter (in ${path}).`,
          `${guess ? `Did you mean "${guess}"? ` : ''}Filters: ${SCALAR_FILTER_KEYS.join(', ')}.`,
        );
      }
    }
  }
  if (items.length === 0) return TRUE;
  return items.length === 1 ? items[0]! : { kind: 'and', items };
}

function relationIR(ctx: WhereContext, rel: RelationMeta) {
  if (ctx.softDelete || !rel.ir.softDeleteColumn) return rel.ir;
  const { softDeleteColumn: _drop, ...rest } = rel.ir;
  return rest;
}

function relationFilter(ctx: WhereContext, m: ModelMeta, rel: RelationMeta, value: unknown, path: string): WhereIR {
  const target = ctx.models.model(rel.targetKey);
  const sub = (v: unknown, p: string): WhereIR | null => normalizeWhere(ctx, target, v, p) ?? null;
  const relation = relationIR(ctx, rel);
  if (rel.kind === 'many') {
    if (!isPlainObject(value)) {
      throw errors.invalidArgument(`${m.key}: ${path} needs some, every or none.`, `Example: ${rel.key}: { some: { published: true } }.`);
    }
    const items: WhereIR[] = [];
    for (const [op, arg] of Object.entries(value)) {
      if (arg === undefined) continue;
      if (op !== 'some' && op !== 'every' && op !== 'none') {
        throw errors.invalidArgument(
          `${m.key}: "${op}" is not a filter for the list relation ${rel.key}.`,
          `Wrap the condition: ${rel.key}: { some: { ... } }, or use every / none.`,
        );
      }
      items.push({ kind: 'relation', relation, op, where: sub(arg, `${path}.${op}`) });
    }
    if (items.length === 0) return TRUE;
    return items.length === 1 ? items[0]! : { kind: 'and', items };
  }
  if (value === null) return { kind: 'relation', relation, op: 'is', where: null };
  if (!isPlainObject(value)) {
    throw errors.invalidArgument(`${m.key}: ${path} must be an object or null.`, `Example: ${rel.key}: { is: { name: 'Ada' } }.`);
  }
  const keys = Object.keys(value).filter((k) => value[k] !== undefined);
  if (keys.length > 0 && keys.every((k) => k === 'is' || k === 'isNot')) {
    const items: WhereIR[] = keys.map((op) => ({
      kind: 'relation' as const,
      relation,
      op: op as 'is' | 'isNot',
      where: value[op] === null ? null : (sub(value[op], `${path}.${op}`) ?? TRUE),
    }));
    return items.length === 1 ? items[0]! : { kind: 'and', items };
  }
  return { kind: 'relation', relation, op: 'is', where: sub(value, path) ?? TRUE };
}

/**
 * Top level equality conditions (`{ id: 1 }`, `{ id: { equals: 1 } }`, also
 * inside a top level AND), used to check unique lookups.
 */
export function equalityFields(m: ModelMeta, input: unknown): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const visit = (w: unknown): void => {
    if (!isPlainObject(w)) return;
    for (const [key, value] of Object.entries(w)) {
      if (value === undefined) continue;
      if (key === 'AND') {
        for (const v of Array.isArray(value) ? value : [value]) visit(v);
        continue;
      }
      const f = m.fields.get(key);
      if (!f) continue;
      if (value !== null && !isPlainObject(value)) out.set(key, value);
      else if (isPlainObject(value) && f.ir.type !== 'json' && value.equals !== undefined && value.equals !== null && value.mode !== 'insensitive') out.set(key, value.equals);
      else if (f.ir.type === 'json' && value !== null && !isFilterObject(f, value)) out.set(key, value);
    }
  };
  visit(input);
  return out;
}

/** The unique field set a where clause pins down, or throws MISSING_UNIQUE_FIELD. */
export function requireUnique(m: ModelMeta, input: unknown, method: string): { fields: string[]; values: Map<string, unknown> } {
  if (!isPlainObject(input)) {
    throw errors.missingUnique(m.key, method, m.uniques);
  }
  const values = equalityFields(m, input);
  const set = m.uniques.find((u) => u.every((k) => values.has(k)));
  if (!set) throw errors.missingUnique(m.key, method, m.uniques);
  return { fields: set, values };
}
