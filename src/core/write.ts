/**
 * Writes: data validation and mapping, JS side defaults, and nested writes
 * (create / connect / connectOrCreate / disconnect / set / update / delete
 * through relations), split into single table queries.
 */
import { errors, KastorError } from './errors';
import type { QueryIR, QueryResultMap, RelationIR, Row, RowDataIR, SelectColumnIR, UpdateValueIR, WhereIR } from './ir';
import type { FieldMeta, ModelMeta, Models, RelationMeta } from './model';
import { softDeleteWhere } from './read';
import { and, checkValue, eq, isPlainObject, normalizeWhere, requireUnique } from './where';

export interface Session {
  models: Models;
  /** Runs one query against the current executor (inside the transaction when there is one). */
  run<K extends QueryIR['kind']>(query: QueryIR & { kind: K }, model: string): Promise<QueryResultMap[K]>;
}

export const allFields = (m: ModelMeta): SelectColumnIR[] => [...m.fields.values()].map((f) => ({ column: f.column, as: f.key }));

/* ------------------------------------------------------------------------ */
/* UUIDs and defaults                                                         */
/* ------------------------------------------------------------------------ */

const hex = (n: number): string => n.toString(16).padStart(2, '0');

/** RFC 4122 version 4 UUID using Web Crypto when present. */
export function randomUUID(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string; getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const h = Array.from(bytes, hex).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function nowFor(f: FieldMeta): unknown {
  const now = new Date();
  if (f.ir.type === 'date') return now.toISOString().slice(0, 10);
  if (f.ir.type === 'time') return now.toISOString().slice(11, 19);
  return now;
}

/** Sets `.updatedAt()` columns the update leaves out. No-op for an empty update. */
export function touchUpdatedAt(m: ModelMeta, data: Record<string, UpdateValueIR>): Record<string, UpdateValueIR> {
  if (Object.keys(data).length === 0) return data;
  for (const f of m.fields.values()) {
    if (f.config.updatedAt && data[f.column] === undefined) data[f.column] = { op: 'set', value: nowFor(f) };
  }
  return data;
}

function defaultValue(f: FieldMeta): unknown {
  const c = f.config;
  if (c.defaultFn) return c.defaultFn();
  const d = c.default;
  if (!d) return c.updatedAt ? nowFor(f) : undefined;
  switch (d.kind) {
    case 'random':
      return randomUUID();
    case 'now':
      return nowFor(f);
    case 'value': {
      const v = d.value;
      if (v === null || v === undefined) return v;
      if (f.ir.type === 'datetime' && typeof v === 'string') return new Date(v);
      if (f.ir.type === 'bigint' && typeof v === 'string') return BigInt(v);
      if (f.ir.type === 'bytes' && Array.isArray(v)) return Uint8Array.from(v as number[]);
      return v;
    }
    default:
      // autoincrement and sql defaults are left to the database
      return undefined;
  }
}

/* ------------------------------------------------------------------------ */
/* Data mapping                                                               */
/* ------------------------------------------------------------------------ */

const NUMBER_OPS = ['set', 'increment', 'decrement', 'multiply', 'divide'] as const;

interface SplitData {
  /** Column values for create, keyed by field key. */
  scalars: Map<FieldMeta, unknown>;
  relations: [RelationMeta, Record<string, unknown>][];
}

function split(m: ModelMeta, data: unknown, method: string): SplitData {
  if (!isPlainObject(data)) {
    throw errors.invalidArgument(`${m.key}.${method} needs a data object.`, `Example: ${method}({ data: { ... } }).`);
  }
  const scalars = new Map<FieldMeta, unknown>();
  const relations: [RelationMeta, Record<string, unknown>][] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    const f = m.fields.get(key);
    if (f) {
      scalars.set(f, value);
      continue;
    }
    const rel = m.relations.get(key);
    if (rel) {
      if (!isPlainObject(value)) {
        throw errors.invalidArgument(
          `${m.key}.${method}: ${key} is a relation, pass a nested write.`,
          `Example: ${key}: { connect: { id: 1 } } or ${key}: { create: { ... } }.`,
        );
      }
      relations.push([rel, value]);
      continue;
    }
    throw errors.unknownField(m.key, key, [...m.fieldKeys, ...m.relationKeys], 'data');
  }
  return { scalars, relations };
}

/** Plain create data (no relations) to a database row, with JS defaults filled in. */
export function createRow(m: ModelMeta, data: Record<string, unknown>, method = 'create'): RowDataIR {
  const { scalars, relations } = split(m, data, method);
  if (relations.length > 0) {
    throw errors.invalidArgument(`${m.key}.${method} takes plain columns only.`, `Use create for nested writes through ${relations[0]![0].key}.`);
  }
  return toRow(m, scalars);
}

function toRow(m: ModelMeta, scalars: Map<FieldMeta, unknown>): RowDataIR {
  const row: RowDataIR = {};
  for (const f of m.fields.values()) {
    let value = scalars.has(f) ? scalars.get(f) : defaultValue(f);
    if (value === undefined) continue;
    if (value === null && !f.config.nullable) {
      throw errors.validation(m.key, f.key, 'null is not allowed', `Pass a value, or declare the column with .nullable().`);
    }
    checkValue(m, f, value);
    if (f.ir.type === 'datetime' && typeof value === 'string') value = new Date(value);
    row[f.column] = value;
  }
  return row;
}

export function checkRequired(m: ModelMeta, row: RowDataIR, method: string): void {
  for (const f of m.fields.values()) {
    if (f.config.nullable || f.config.default || f.config.defaultFn || row[f.column] !== undefined) continue;
    const via = [...m.relations.values()].find((r) => r.owner && r.fromFields.includes(f.key));
    throw errors.validation(
      m.key,
      f.key,
      'a value is required',
      via ? `Pass ${f.key}, or connect the relation: ${via.key}: { connect: { ${via.toFields[0]}: ... } }.` : `Pass ${f.key} in ${method}, or give the column a default.`,
    );
  }
}

/** Update data (no relations) to column operations. */
export function updateOps(m: ModelMeta, scalars: Map<FieldMeta, unknown>): Record<string, UpdateValueIR> {
  const out: Record<string, UpdateValueIR> = {};
  for (const [f, value] of scalars) {
    const numeric = ['int', 'bigint', 'float', 'decimal'].includes(f.ir.type);
    if (isPlainObject(value) && f.ir.type !== 'json' && !(value instanceof Date)) {
      const keys = Object.keys(value).filter((k) => value[k] !== undefined);
      if (keys.length !== 1 || !(NUMBER_OPS as readonly string[]).includes(keys[0]!) || (keys[0] !== 'set' && !numeric)) {
        throw errors.invalidArgument(
          `${m.key}.${f.key}: unknown update ${JSON.stringify(Object.keys(value))}.`,
          numeric ? 'Use a value, or one of { set }, { increment }, { decrement }, { multiply }, { divide }.' : 'Use a value or { set: value }.',
        );
      }
      const op = keys[0] as (typeof NUMBER_OPS)[number];
      const arg = value[op];
      if (op === 'set') {
        if (arg === null && !f.config.nullable) throw errors.validation(m.key, f.key, 'null is not allowed', 'Pass a value, or declare the column with .nullable().');
        checkValue(m, f, arg);
        out[f.column] = { op: 'set', value: arg };
      } else {
        if (typeof arg !== 'number' && typeof arg !== 'bigint') throw errors.validation(m.key, f.key, `${op} needs a number`, `Example: { ${op}: 1 }.`);
        out[f.column] = { op, value: arg };
      }
      continue;
    }
    if (value === null && !f.config.nullable) throw errors.validation(m.key, f.key, 'null is not allowed', 'Pass a value, or declare the column with .nullable().');
    checkValue(m, f, value);
    out[f.column] = { op: 'set', value: f.ir.type === 'datetime' && typeof value === 'string' ? new Date(value) : value };
  }
  return touchUpdatedAt(m, out);
}

/* ------------------------------------------------------------------------ */
/* Helpers                                                                    */
/* ------------------------------------------------------------------------ */

function fieldsWhere(m: ModelMeta, fields: readonly string[], values: readonly unknown[]): WhereIR {
  return and(...fields.map((k, i) => eq(m.fields.get(k)!.column, values[i]))) ?? { kind: 'const', value: true };
}

function pkWhere(m: ModelMeta, row: Row): WhereIR {
  const keys = m.primaryKey.length ? m.primaryKey : m.uniques[0] ?? m.fieldKeys;
  return fieldsWhere(m, keys, keys.map((k) => row[k]));
}

/** Where tree for a unique lookup, with the soft delete filter. */
export function uniqueWhere(s: Session, m: ModelMeta, where: unknown, method: string, withDeleted?: unknown): WhereIR {
  requireUnique(m, where, method);
  return and(normalizeWhere({ models: s.models, softDelete: withDeleted !== true }, m, where), softDeleteWhere(m, withDeleted)) ?? { kind: 'const', value: true };
}

async function findOne(s: Session, m: ModelMeta, where: WhereIR): Promise<Row | null> {
  return s.run({ kind: 'findFirst', table: m.table, read: { table: m.table, select: allFields(m), include: [], counts: [], orderBy: [], where, take: 1 } }, m.key);
}

async function findUniqueOrThrow(s: Session, m: ModelMeta, where: unknown, method: string): Promise<Row> {
  const row = await findOne(s, m, uniqueWhere(s, m, where, method));
  if (!row) throw errors.notFound(m.key, method, where);
  return row;
}

/** Deletes rows, or marks them deleted on soft delete tables. Resolves to the count. */
async function removeWhere(s: Session, target: ModelMeta, where: WhereIR): Promise<number> {
  if (target.softDelete) {
    const res = await s.run(
      { kind: 'updateMany', table: target.table, where: and(where, softDeleteWhere(target, false))!, data: touchUpdatedAt(target, { [target.softDelete.column]: { op: 'set', value: new Date() } }) },
      target.key,
    );
    return Array.isArray(res) ? res.length : res.count;
  }
  return (await s.run({ kind: 'deleteMany', table: target.table, where }, target.key)).count;
}

const asList = <T>(v: T | readonly T[]): T[] => (Array.isArray(v) ? [...(v as T[])] : [v as T]);

function checkOps(m: ModelMeta, rel: RelationMeta, ops: Record<string, unknown>, allowed: readonly string[], method: string): void {
  for (const key of Object.keys(ops)) {
    if (ops[key] === undefined) continue;
    if (!allowed.includes(key)) {
      throw errors.invalidArgument(
        `${m.key}.${method}: "${key}" is not a nested write for ${rel.key}.`,
        `Nested writes for ${rel.key}: ${allowed.join(', ')}.`,
      );
    }
  }
}

/** Inverse of a relation (target back to source), used to filter targets linked to a parent. */
function inverse(rel: RelationMeta, source: ModelMeta, target: ModelMeta): RelationIR {
  const ir: RelationIR = {
    name: `${rel.key}__inverse`,
    cardinality: 'one',
    from: target.table,
    to: source.table,
    fromColumns: rel.ir.toColumns,
    toColumns: rel.ir.fromColumns,
  };
  if (rel.ir.through) {
    ir.cardinality = 'many';
    ir.through = { table: rel.ir.through.table, sourceColumns: rel.ir.through.targetColumns, targetColumns: rel.ir.through.sourceColumns };
  }
  return ir;
}

/** Targets of `rel` linked to the parent row. */
function linkedTo(rel: RelationMeta, source: ModelMeta, target: ModelMeta, parent: Row): WhereIR {
  if (!rel.through) return fieldsWhere(target, rel.toFields, rel.fromFields.map((k) => parent[k]));
  return { kind: 'relation', relation: inverse(rel, source, target), op: 'some', where: pkWhere(source, parent) };
}

/* ------------------------------------------------------------------------ */
/* Nested create                                                              */
/* ------------------------------------------------------------------------ */

const CREATE_ONE_OPS = ['create', 'connect', 'connectOrCreate'] as const;

/**
 * Creates one record with its nested writes. `link` presets columns that
 * point at a parent created just before (field key to value).
 * Resolves to the full scalar row keyed by field key.
 */
export async function createRecord(s: Session, m: ModelMeta, data: unknown, link: Record<string, unknown> = {}, method = 'create'): Promise<Row> {
  const { scalars, relations } = split(m, data, method);
  for (const [k, v] of Object.entries(link)) scalars.set(m.fields.get(k)!, v);

  // Relations whose foreign key lives on this row: resolve them first.
  for (const [rel, ops] of relations) {
    if (!rel.owner) continue;
    checkOps(m, rel, ops, CREATE_ONE_OPS, method);
    const target = s.models.model(rel.targetKey);
    let related: Row | null = null;
    if (ops.create !== undefined) related = await createRecord(s, target, ops.create, {}, method);
    else if (ops.connect !== undefined) related = await findUniqueOrThrow(s, target, ops.connect, `${method} (connect ${rel.key})`);
    else if (ops.connectOrCreate !== undefined) related = await connectOrCreate(s, target, ops.connectOrCreate, {}, method);
    if (related) rel.fromFields.forEach((k, i) => scalars.set(m.fields.get(k)!, related![rel.toFields[i]!]));
  }

  const row = toRow(m, scalars);
  checkRequired(m, row, method);
  const created = await s.run({ kind: 'create', table: m.table, data: row, returning: allFields(m) }, m.key);

  for (const [rel, ops] of relations) {
    if (rel.owner) continue;
    await writeChildren(s, m, created, rel, ops, method, false);
  }
  return created;
}

async function connectOrCreate(s: Session, target: ModelMeta, spec: unknown, link: Record<string, unknown>, method: string): Promise<Row> {
  if (!isPlainObject(spec) || spec.where === undefined || spec.create === undefined) {
    throw errors.invalidArgument(`${target.key}: connectOrCreate needs where and create.`, 'Example: connectOrCreate: { where: { email }, create: { email, name } }.');
  }
  const found = await findOne(s, target, uniqueWhere(s, target, spec.where, `${method} (connectOrCreate)`));
  if (found) return found;
  return createRecord(s, target, spec.create, link, method);
}

/** Link values a child needs to point at `parent` through a direct relation. */
function childLink(rel: RelationMeta, parent: Row): Record<string, unknown> {
  return Object.fromEntries(rel.toFields.map((k, i) => [k, parent[rel.fromFields[i]!]]));
}

async function linkThrough(s: Session, m: ModelMeta, rel: RelationMeta, parent: Row, child: Row, skipExisting: boolean): Promise<void> {
  const through = rel.through!;
  const join = s.models.model(through.modelKey);
  const data: RowDataIR = {};
  through.sourceFields.forEach((k, i) => (data[join.fields.get(k)!.column] = parent[rel.fromFields[i]!]));
  through.targetFields.forEach((k, i) => (data[join.fields.get(k)!.column] = child[rel.toFields[i]!]));
  await s.run({ kind: 'createMany', table: join.table, data: [data], skipDuplicates: skipExisting }, join.key);
}

async function unlinkThrough(s: Session, rel: RelationMeta, parent: Row, child?: Row): Promise<number> {
  const through = rel.through!;
  const join = s.models.model(through.modelKey);
  const where = and(
    fieldsWhere(join, through.sourceFields, rel.fromFields.map((k) => parent[k])),
    child ? fieldsWhere(join, through.targetFields, rel.toFields.map((k) => child[k])) : undefined,
  );
  const res = await s.run({ kind: 'deleteMany', table: join.table, ...(where ? { where } : {}) }, join.key);
  return res.count;
}

const CHILD_CREATE_OPS = ['create', 'connect', 'connectOrCreate'];
const CHILD_UPDATE_OPS = ['create', 'connect', 'connectOrCreate', 'disconnect', 'set', 'delete', 'deleteMany', 'update', 'updateMany'];

/** Nested writes on relations whose foreign key lives on the other side. */
async function writeChildren(s: Session, m: ModelMeta, parent: Row, rel: RelationMeta, ops: Record<string, unknown>, method: string, updating: boolean): Promise<void> {
  const target = s.models.model(rel.targetKey);
  checkOps(m, rel, ops, updating ? CHILD_UPDATE_OPS : CHILD_CREATE_OPS, method);
  const many = rel.kind === 'many';
  if (!many && updating) {
    for (const k of Object.keys(ops)) {
      if (['set', 'deleteMany', 'updateMany'].includes(k)) {
        throw errors.invalidArgument(`${m.key}.${method}: ${k} only works on list relations, ${rel.key} is a single relation.`, 'Use create, connect, disconnect, update or delete.');
      }
    }
  }
  const linked = (): WhereIR => linkedTo(rel, m, target, parent);
  const linkChild = async (child: Row): Promise<void> => {
    if (rel.through) await linkThrough(s, m, rel, parent, child, true);
    else {
      const res = await s.run({ kind: 'update', table: target.table, where: pkWhere(target, child), data: touchUpdatedAt(target, Object.fromEntries(Object.entries(childLink(rel, parent)).map(([k, v]) => [target.fields.get(k)!.column, { op: 'set' as const, value: v }]))), returning: [] }, target.key);
      if (!res) throw errors.notFound(target.key, `${method} (connect ${rel.key})`);
    }
  };
  const unlinkWhere = async (where: WhereIR, what: string): Promise<number> => {
    if (rel.through) {
      const rows = await s.run({ kind: 'findMany', table: target.table, read: { table: target.table, select: allFields(target), include: [], counts: [], orderBy: [], where: and(where, linked())! } }, target.key);
      let n = 0;
      for (const r of rows) n += await unlinkThrough(s, rel, parent, r);
      return n;
    }
    const nullable = rel.toFields.every((k) => target.fields.get(k)!.config.nullable);
    if (!nullable) {
      throw errors.invalidArgument(
        `${m.key}.${method}: cannot ${what} ${rel.key} because ${target.key}.${rel.toFields.join(', ')} is required.`,
        `Make the column nullable, or delete the related ${target.key} records instead.`,
      );
    }
    const data = Object.fromEntries(rel.toFields.map((k) => [target.fields.get(k)!.column, { op: 'set' as const, value: null }]));
    const res = await s.run({ kind: 'updateMany', table: target.table, where: and(where, linked())!, data: touchUpdatedAt(target, data) }, target.key);
    return Array.isArray(res) ? res.length : res.count;
  };

  if (ops.set !== undefined) {
    const wanted = asList(ops.set as unknown);
    await unlinkWhere({ kind: 'const', value: true }, 'set');
    for (const w of wanted) await linkChild(await findUniqueOrThrow(s, target, w, `${method} (set ${rel.key})`));
  }
  if (ops.disconnect !== undefined) {
    if (!many) {
      if (ops.disconnect === true) await unlinkWhere({ kind: 'const', value: true }, 'disconnect');
    } else {
      for (const w of asList(ops.disconnect as unknown)) {
        await unlinkWhere(uniqueWhere(s, target, w, `${method} (disconnect ${rel.key})`), 'disconnect');
      }
    }
  }
  if (ops.delete !== undefined) {
    if (!many) {
      if (ops.delete === true) {
        const n = await removeWhere(s, target, linked());
        if (n === 0) throw errors.notFound(target.key, `${method} (delete ${rel.key})`);
      }
    } else {
      for (const w of asList(ops.delete as unknown)) {
        const n = await removeWhere(s, target, and(uniqueWhere(s, target, w, `${method} (delete ${rel.key})`), linked())!);
        if (n === 0) throw errors.notFound(target.key, `${method} (delete ${rel.key})`, w);
      }
    }
  }
  if (ops.deleteMany !== undefined) {
    for (const w of asList(ops.deleteMany as unknown)) {
      await removeWhere(s, target, and(normalizeWhere({ models: s.models, softDelete: true }, target, w), linked())!);
    }
  }
  if (ops.update !== undefined) {
    if (!many) {
      const found = await findOne(s, target, linked());
      if (!found) throw errors.notFound(target.key, `${method} (update ${rel.key})`);
      await updateRecord(s, target, found, ops.update, method);
    } else {
      for (const spec of asList(ops.update as unknown)) {
        if (!isPlainObject(spec) || spec.where === undefined || spec.data === undefined) {
          throw errors.invalidArgument(`${m.key}.${method}: update of ${rel.key} needs where and data.`, `Example: ${rel.key}: { update: { where: { id: 1 }, data: { ... } } }.`);
        }
        const found = await findOne(s, target, and(uniqueWhere(s, target, spec.where, `${method} (update ${rel.key})`), linked())!);
        if (!found) throw errors.notFound(target.key, `${method} (update ${rel.key})`, spec.where);
        await updateRecord(s, target, found, spec.data, method);
      }
    }
  }
  if (ops.updateMany !== undefined) {
    for (const spec of asList(ops.updateMany as unknown)) {
      if (!isPlainObject(spec) || spec.data === undefined) {
        throw errors.invalidArgument(`${m.key}.${method}: updateMany of ${rel.key} needs data.`, `Example: ${rel.key}: { updateMany: { where: { ... }, data: { ... } } }.`);
      }
      const { scalars, relations } = split(target, spec.data, 'updateMany');
      if (relations.length) throw errors.invalidArgument(`${target.key}: updateMany takes plain columns only.`, 'Update related records one by one with update.');
      const where = and(normalizeWhere({ models: s.models, softDelete: true }, target, spec.where), softDeleteWhere(target, false), linked())!;
      await s.run({ kind: 'updateMany', table: target.table, where, data: updateOps(target, scalars) }, target.key);
    }
  }
  if (ops.create !== undefined) {
    const items = many ? asList(ops.create as unknown) : [ops.create];
    if (!many && updating) {
      // Replacing a single child: the old one is unlinked first when possible.
      const existing = await findOne(s, target, linked());
      if (existing) await unlinkWhere(pkWhere(target, existing), 'replace');
    }
    for (const item of items) {
      if (rel.through) {
        const child = await createRecord(s, target, item, {}, method);
        await linkThrough(s, m, rel, parent, child, false);
      } else {
        await createRecord(s, target, item, childLink(rel, parent), method);
      }
    }
  }
  if (ops.connect !== undefined) {
    const items = many ? asList(ops.connect as unknown) : [ops.connect];
    for (const w of items) await linkChild(await findUniqueOrThrow(s, target, w, `${method} (connect ${rel.key})`));
  }
  if (ops.connectOrCreate !== undefined) {
    const items = many ? asList(ops.connectOrCreate as unknown) : [ops.connectOrCreate];
    for (const spec of items) {
      if (!isPlainObject(spec) || spec.where === undefined) {
        throw errors.invalidArgument(`${target.key}: connectOrCreate needs where and create.`, 'Example: connectOrCreate: { where: { email }, create: { email, name } }.');
      }
      const found = await findOne(s, target, uniqueWhere(s, target, spec.where, `${method} (connectOrCreate)`));
      if (found) await linkChild(found);
      else if (rel.through) await linkThrough(s, m, rel, parent, await createRecord(s, target, spec.create, {}, method), false);
      else await createRecord(s, target, spec.create, childLink(rel, parent), method);
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Nested update                                                              */
/* ------------------------------------------------------------------------ */

const UPDATE_ONE_OWNER_OPS = ['create', 'connect', 'connectOrCreate', 'disconnect', 'delete', 'update'] as const;

/** Applies `data` (with nested writes) to an existing row. Resolves to the updated scalar row. */
export async function updateRecord(s: Session, m: ModelMeta, current: Row, data: unknown, method = 'update'): Promise<Row> {
  const { scalars, relations } = split(m, data, method);
  const after: (() => Promise<void>)[] = [];

  for (const [rel, ops] of relations) {
    if (!rel.owner) continue;
    checkOps(m, rel, ops, UPDATE_ONE_OWNER_OPS, method);
    const target = s.models.model(rel.targetKey);
    const setFk = (row: Row | null): void => {
      rel.fromFields.forEach((k, i) => scalars.set(m.fields.get(k)!, row ? row[rel.toFields[i]!] : null));
    };
    const currentTarget = (): WhereIR => fieldsWhere(target, rel.toFields, rel.fromFields.map((k) => current[k]));
    if (ops.create !== undefined) setFk(await createRecord(s, target, ops.create, {}, method));
    if (ops.connect !== undefined) setFk(await findUniqueOrThrow(s, target, ops.connect, `${method} (connect ${rel.key})`));
    if (ops.connectOrCreate !== undefined) setFk(await connectOrCreate(s, target, ops.connectOrCreate, {}, method));
    if (ops.disconnect === true || ops.delete === true) {
      if (!rel.nullable) {
        throw errors.invalidArgument(
          `${m.key}.${method}: cannot ${ops.delete === true ? 'delete' : 'disconnect'} ${rel.key} because ${rel.fromFields.join(', ')} is required.`,
          `Connect another ${target.key} instead, or make ${rel.fromFields.join(', ')} nullable.`,
        );
      }
      if (ops.delete === true) {
        const where = currentTarget();
        after.push(async () => {
          await removeWhere(s, target, where);
        });
      }
      setFk(null);
    }
    if (ops.update !== undefined) {
      const found = await findOne(s, target, currentTarget());
      if (!found) throw errors.notFound(target.key, `${method} (update ${rel.key})`);
      await updateRecord(s, target, found, ops.update, method);
    }
  }

  let updated = current;
  const changes = updateOps(m, scalars);
  if (Object.keys(changes).length > 0) {
    const row = await s.run({ kind: 'update', table: m.table, where: pkWhere(m, current), data: changes, returning: allFields(m) }, m.key);
    if (!row) throw errors.notFound(m.key, method);
    updated = row;
  }
  for (const fn of after) await fn();
  for (const [rel, ops] of relations) {
    if (rel.owner) continue;
    await writeChildren(s, m, updated, rel, ops, method, true);
  }
  return updated;
}

export function hasRelations(m: ModelMeta, data: unknown): boolean {
  return isPlainObject(data) && Object.keys(data).some((k) => data[k] !== undefined && m.relations.has(k));
}

/** Splits update data that holds no relations; throws if it does. */
export function plainUpdate(m: ModelMeta, data: unknown, method: string): Record<string, UpdateValueIR> {
  const { scalars, relations } = split(m, data, method);
  if (relations.length) {
    throw errors.invalidArgument(`${m.key}.${method} takes plain columns only.`, `Use update for nested writes through ${relations[0]![0].key}.`);
  }
  return updateOps(m, scalars);
}

export { pkWhere, findOne };

/** Wraps unexpected shapes coming back from a dialect. */
export function expectRow(value: unknown, m: ModelMeta, method: string): Row {
  if (!value || typeof value !== 'object') {
    throw new KastorError('QUERY_FAILED', `${m.key}.${method} got no row back from the database.`, {
      hint: 'Check for triggers or row level security policies that hide the row.',
    });
  }
  return value as Row;
}
