/**
 * Writes: inserts with defaults and generated ids, pipeline updates, upserts
 * and deletes with emulated referential actions.
 *
 * MongoDB has no foreign keys. kastor reads the foreign keys of the schema and
 * applies `onDelete` itself when a row is deleted: `cascade` deletes the rows
 * that point to it (recursively), `set null` and `set default` update them,
 * `restrict` and `no action` refuse the delete with FOREIGN_KEY_VIOLATION
 * while such rows exist. All of it runs in one transaction when the server
 * supports transactions. Before inserts and updates that set a reference,
 * kastor checks that the referenced row exists (one query per foreign key).
 */
import type { Document, Filter } from 'mongodb';
import { errors } from '../../core/errors';
import type {
  CreateManyQueryIR,
  CreateQueryIR,
  DeleteManyQueryIR,
  DeleteQueryIR,
  Row,
  RowDataIR,
  SelectColumnIR,
  TableIR,
  UpdateManyQueryIR,
  UpdateQueryIR,
  UpdateValueIR,
  UpsertQueryIR,
  WhereIR,
} from '../../core/ir';
import { mongoError } from './errors';
import { atomically, opts, type MongoExecutor } from './executor';
import { compileWhere, hasRelationFilter, type Doc } from './filter';
import {
  COUNTERS,
  decodeValue,
  defaultValue,
  encodeValue,
  newObjectId,
  newUuid,
  tableInfo,
  type ColumnInfo,
  type Model,
  type TableInfo,
} from './model';

/* ------------------------------------------------------------------------ */
/* Filters for writes                                                         */
/* ------------------------------------------------------------------------ */

/**
 * A filter usable by find, update and delete. Relation filters need an
 * aggregation, so those are resolved to a list of `_id` values first.
 */
export async function writeFilter(model: Model, table: string, where: WhereIR | undefined, exec: MongoExecutor): Promise<Filter<Document>> {
  if (!where) return {};
  const { stages, match } = compileWhere(where, { model, table, counter: { n: 0 } });
  if (!hasRelationFilter(where) || stages.length === 0) return match;
  const pipeline: Doc[] = [...stages];
  if (Object.keys(match).length > 0) pipeline.push({ $match: match });
  pipeline.push({ $project: { _id: 1 } });
  const docs = await exec.db.collection(table).aggregate(pipeline, opts(exec)).toArray();
  return { _id: { $in: docs.map((d) => d._id) } };
}

/* ------------------------------------------------------------------------ */
/* Inserts                                                                    */
/* ------------------------------------------------------------------------ */

/** Reserves `count` consecutive integers for `table`, returns the first. */
async function reserveIds(exec: MongoExecutor, table: string, count: number): Promise<number> {
  const res = await exec.db
    .collection<{ _id: string; seq: number }>(COUNTERS)
    .findOneAndUpdate({ _id: table }, { $inc: { seq: count } }, { upsert: true, returnDocument: 'after', includeResultMetadata: true, ...opts(exec) });
  const seq = Number(res.value?.seq ?? count);
  return seq - count + 1;
}

/** Builds the documents to insert: encoded values, defaults, nulls and generated ids. */
export async function buildDocs(model: Model, info: TableInfo, rows: RowDataIR[], exec: MongoExecutor | null): Promise<Doc[]> {
  let nextInt = 0;
  const idInfo = info.idColumn ? info.columns.get(info.idColumn) : undefined;
  if (idInfo?.generated === 'int') {
    const missing = rows.filter((r) => r[idInfo.column.name] === undefined || r[idInfo.column.name] === null).length;
    if (missing > 0) {
      if (!exec) throw mongoError('UNSUPPORTED', 'Integer ids need the database to allocate them.', 'Run the query instead of compiling it.');
      nextInt = await reserveIds(exec, info.table.name, missing);
    }
  }
  return rows.map((row) => {
    const doc: Doc = {};
    for (const col of info.columns.values()) {
      const value = row[col.column.name];
      if (value !== undefined) {
        doc[col.field] = encodeValue(value, col);
        continue;
      }
      if (col.generated) {
        doc[col.field] = col.generated === 'objectId' ? newObjectId() : col.generated === 'uuid' ? newUuid() : nextInt++;
        if (col.generated === 'int' && col.column.type === 'bigint') doc[col.field] = encodeValue(doc[col.field], col);
        continue;
      }
      if (col.column.default) {
        doc[col.field] = defaultValue(col);
        continue;
      }
      if (col.field === '_id') continue;
      doc[col.field] = null;
    }
    // A required column that ended up null fails here with the same error SQL gives.
    for (const col of info.columns.values()) {
      if (!col.column.nullable && (doc[col.field] === null || doc[col.field] === undefined)) {
        throw errors.notNullViolation(col.column.name, undefined, { table: info.table.name, dialect: 'mongodb' });
      }
    }
    for (const key of Object.keys(row)) {
      if (!info.columns.has(key)) doc[key] = row[key];
    }
    return doc;
  });
}

function pick(model: Model, table: string, doc: Doc, returning: SelectColumnIR[]): Row {
  const info = tableInfo(model, table);
  const row: Row = {};
  for (const sel of returning) {
    const col = info.columns.get(sel.column);
    row[sel.as] = decodeValue(doc[col?.field ?? sel.column], col);
  }
  return row;
}

export async function create(model: Model, q: CreateQueryIR, exec: MongoExecutor): Promise<Row> {
  const info = tableInfo(model, q.table);
  const [doc] = await buildDocs(model, info, [q.data], exec);
  await checkReferences(model, info, [doc as Doc], exec);
  await exec.db.collection(q.table).insertOne(doc as Document, opts(exec));
  return pick(model, q.table, doc as Doc, q.returning);
}

/** Unique keys of a table as lists of fields: primary key and unique indexes. */
function uniqueKeys(info: TableInfo): string[][] {
  const keys: string[][] = [];
  const field = (c: string) => info.columns.get(c)?.field ?? c;
  if (info.table.primaryKey.length > 0) keys.push(info.table.primaryKey.map(field));
  for (const idx of info.table.indexes) if (idx.unique) keys.push(idx.columns.map(field));
  return keys;
}

const keyOf = (doc: Doc, fields: string[]): string | null => {
  const parts = fields.map((f) => doc[f]);
  if (parts.some((p) => p === null || p === undefined)) return null;
  return JSON.stringify(parts.map((p) => (typeof p === 'object' && p !== null ? String(p) : p)));
};

/**
 * Drops documents that would break a unique key: ones that collide with rows
 * already stored and later duplicates inside the batch. Works inside
 * transactions, where a duplicate key error would abort the whole transaction.
 */
async function withoutDuplicates(info: TableInfo, docs: Doc[], exec: MongoExecutor): Promise<Doc[]> {
  const keys = uniqueKeys(info);
  if (keys.length === 0) return docs;
  const seen = keys.map(() => new Set<string>());
  const or: Doc[] = [];
  for (const fields of keys) {
    const values = docs.map((d) => fields.map((f) => d[f]));
    if (fields.length === 1) {
      const vals = values.map((v) => v[0]).filter((v) => v !== null && v !== undefined);
      if (vals.length > 0) or.push({ [fields[0]!]: { $in: vals } });
    } else {
      for (const v of values) if (v.every((x) => x !== null && x !== undefined)) or.push(Object.fromEntries(fields.map((f, i) => [f, v[i]])));
    }
  }
  if (or.length > 0) {
    const projection = Object.fromEntries(keys.flat().map((f) => [f, 1]));
    const existing = await exec.db
      .collection(info.table.name)
      .find({ $or: or }, { projection, ...opts(exec) })
      .toArray();
    for (const doc of existing) keys.forEach((fields, i) => {
      const k = keyOf(doc as Doc, fields);
      if (k !== null) seen[i]!.add(k);
    });
  }
  const out: Doc[] = [];
  for (const doc of docs) {
    const ks = keys.map((fields) => keyOf(doc, fields));
    if (ks.some((k, i) => k !== null && seen[i]!.has(k))) continue;
    ks.forEach((k, i) => {
      if (k !== null) seen[i]!.add(k);
    });
    out.push(doc);
  }
  return out;
}

export async function createMany(model: Model, q: CreateManyQueryIR, exec: MongoExecutor): Promise<{ count: number } | Row[]> {
  const info = tableInfo(model, q.table);
  if (q.data.length === 0) return q.returning ? [] : { count: 0 };
  let docs = await buildDocs(model, info, q.data, exec);
  if (q.skipDuplicates) docs = await withoutDuplicates(info, docs, exec);
  await checkReferences(model, info, docs, exec);
  if (docs.length > 0) await exec.db.collection(q.table).insertMany(docs as Document[], { ordered: true, ...opts(exec) });
  if (q.returning) return docs.map((d) => pick(model, q.table, d, q.returning as SelectColumnIR[]));
  return { count: docs.length };
}

/* ------------------------------------------------------------------------ */
/* Foreign key checks                                                         */
/* ------------------------------------------------------------------------ */

/**
 * The server does not know foreign keys, so kastor checks them before a write:
 * every non null reference in `docs` must match a row of the referenced table
 * (or a document of the same batch, for self references). One query per
 * foreign key.
 */
async function checkReferences(model: Model, info: TableInfo, docs: Doc[], exec: MongoExecutor): Promise<void> {
  for (const fk of info.table.foreignKeys) {
    const target = model.tables.get(fk.refTable);
    if (!target) continue;
    const fields = fk.columns.map((c) => info.columns.get(c)?.field ?? c);
    const refFields = fk.refColumns.map((c) => target.columns.get(c)?.field ?? c);
    const wanted = new Map<string, unknown[]>();
    for (const doc of docs) {
      if (!fields.every((f) => f in doc)) continue;
      const values = fields.map((f) => doc[f]);
      if (values.some((v) => v === null || v === undefined)) continue;
      wanted.set(keyOf(Object.fromEntries(fields.map((f, i) => [f, values[i]])), fields) as string, values);
    }
    if (wanted.size === 0) continue;
    if (fk.refTable === info.table.name) {
      for (const doc of docs) {
        const k = keyOf(Object.fromEntries(refFields.map((f, i) => [fields[i]!, doc[f]])), fields);
        if (k !== null) wanted.delete(k);
      }
      if (wanted.size === 0) continue;
    }
    const lists = [...wanted.values()];
    const filter: Doc =
      refFields.length === 1 ? { [refFields[0]!]: { $in: lists.map((v) => v[0]) } } : { $or: lists.map((v) => Object.fromEntries(refFields.map((f, i) => [f, v[i]]))) };
    const projection = Object.fromEntries(refFields.map((f) => [f, 1]));
    const found = await exec.db.collection(fk.refTable).find(filter, { projection, ...opts(exec) }).toArray();
    for (const row of found) {
      const k = keyOf(Object.fromEntries(refFields.map((f, i) => [fields[i]!, (row as Doc)[f]])), fields);
      if (k !== null) wanted.delete(k);
    }
    if (wanted.size > 0) {
      throw errors.foreignKeyViolation(fk.name, undefined, { table: info.table.name, references: fk.refTable, dialect: 'mongodb' });
    }
  }
}

/** The references an update sets: FK columns assigned with `set`, as document fields. */
function updatedReferences(info: TableInfo, data: Record<string, UpdateValueIR>): Doc[] {
  const doc: Doc = {};
  for (const fk of info.table.foreignKeys) {
    if (!fk.columns.every((c) => data[c]?.op === 'set')) continue;
    for (const c of fk.columns) {
      const col = info.columns.get(c);
      doc[col?.field ?? c] = encodeValue((data[c] as { value: unknown }).value, col);
    }
  }
  return Object.keys(doc).length > 0 ? [doc] : [];
}

/* ------------------------------------------------------------------------ */
/* Updates                                                                    */
/* ------------------------------------------------------------------------ */

/** Pipeline update (`[{ $set }]`): arithmetic on null stays null, like SQL. */
export function buildUpdate(model: Model, table: string, data: Record<string, UpdateValueIR>): Doc[] {
  const info = tableInfo(model, table);
  const set: Doc = {};
  for (const [column, change] of Object.entries(data)) {
    const col = info.columns.get(column);
    const field = col?.field ?? column;
    if (field === '_id') {
      throw mongoError(
        'UNSUPPORTED',
        `The primary key "${column}" of ${table} is stored as _id, which MongoDB never changes.`,
        'Create a new record with the new key and delete the old one.',
        { table, column },
      );
    }
    if (change.op === 'set') {
      set[field] = { $literal: encodeValue(change.value, col) };
      continue;
    }
    const operand = encodeValue(change.value, col);
    const ref = `$${field}`;
    let expr: Doc;
    switch (change.op) {
      case 'increment':
        expr = { $add: [ref, operand] };
        break;
      case 'decrement':
        expr = { $subtract: [ref, operand] };
        break;
      case 'multiply':
        expr = { $multiply: [ref, operand] };
        break;
      case 'divide':
        expr = { $divide: [ref, operand] };
        break;
    }
    const type = col?.column.type;
    if ((change.op === 'divide' || change.op === 'multiply') && (type === 'int' || type === 'bigint')) {
      // Integer columns stay integers (SQL integer division truncates).
      expr = { [type === 'int' ? '$toInt' : '$toLong']: { $trunc: [expr, 0] } };
    }
    set[field] = { $cond: [{ $eq: [{ $ifNull: [ref, null] }, null] }, null, expr] };
  }
  return Object.keys(set).length > 0 ? [{ $set: set }] : [];
}

export async function update(model: Model, q: UpdateQueryIR, exec: MongoExecutor): Promise<Row | null> {
  const filter = await writeFilter(model, q.table, q.where, exec);
  const pipeline = buildUpdate(model, q.table, q.data);
  await checkReferences(model, tableInfo(model, q.table), updatedReferences(tableInfo(model, q.table), q.data), exec);
  const coll = exec.db.collection(q.table);
  let doc: Document | null;
  if (pipeline.length === 0) {
    doc = await coll.findOne(filter, opts(exec));
  } else {
    const res = await coll.findOneAndUpdate(filter, pipeline as Document[], { returnDocument: 'after', includeResultMetadata: true, ...opts(exec) });
    doc = res.value;
  }
  return doc ? pick(model, q.table, doc as Doc, q.returning) : null;
}

export async function updateMany(model: Model, q: UpdateManyQueryIR, exec: MongoExecutor): Promise<{ count: number } | Row[]> {
  const filter = await writeFilter(model, q.table, q.where, exec);
  const pipeline = buildUpdate(model, q.table, q.data);
  await checkReferences(model, tableInfo(model, q.table), updatedReferences(tableInfo(model, q.table), q.data), exec);
  const coll = exec.db.collection(q.table);
  if (!q.returning) {
    if (pipeline.length === 0) return { count: await coll.countDocuments(filter, opts(exec)) };
    const res = await coll.updateMany(filter, pipeline as Document[], opts(exec));
    return { count: res.matchedCount };
  }
  const returning = q.returning;
  return atomically(exec, async (tx) => {
    const c = tx.db.collection(q.table);
    const ids = (await c.find(filter, { projection: { _id: 1 }, ...opts(tx) }).toArray()).map((d) => d._id);
    if (ids.length === 0) return [];
    if (pipeline.length > 0) await c.updateMany({ _id: { $in: ids } }, pipeline as Document[], opts(tx));
    const docs = await c.find({ _id: { $in: ids } }, opts(tx)).toArray();
    const byId = new Map(docs.map((d) => [String(d._id), d]));
    return ids.map((id) => byId.get(String(id))).filter(Boolean).map((d) => pick(model, q.table, d as Doc, returning));
  });
}

function isDuplicateKey(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  return code === 11000 || code === 11001;
}

/** Update the row matching the unique condition, or insert `create` when there is none. */
export async function upsert(model: Model, q: UpsertQueryIR, exec: MongoExecutor): Promise<Row> {
  const info = tableInfo(model, q.table);
  const filter = await writeFilter(model, q.table, q.where, exec);
  const pipeline = buildUpdate(model, q.table, q.update);
  const coll = exec.db.collection(q.table);
  const tryUpdate = async (): Promise<Document | null> => {
    if (pipeline.length === 0) return coll.findOne(filter, opts(exec));
    const res = await coll.findOneAndUpdate(filter, pipeline as Document[], { returnDocument: 'after', includeResultMetadata: true, ...opts(exec) });
    return res.value;
  };
  await checkReferences(model, info, updatedReferences(info, q.update), exec);
  const existing = await tryUpdate();
  if (existing) return pick(model, q.table, existing as Doc, q.returning);
  const [doc] = await buildDocs(model, info, [{ ...q.conflict, ...q.create }], exec);
  await checkReferences(model, info, [doc as Doc], exec);
  try {
    await coll.insertOne(doc as Document, opts(exec));
    return pick(model, q.table, doc as Doc, q.returning);
  } catch (error) {
    // Another writer inserted the same key between the update and the insert.
    if (!isDuplicateKey(error) || exec.inTransaction) throw error;
    const again = await tryUpdate();
    if (!again) throw error;
    return pick(model, q.table, again as Doc, q.returning);
  }
}

/* ------------------------------------------------------------------------ */
/* Deletes and referential actions                                            */
/* ------------------------------------------------------------------------ */

interface Referrer {
  table: TableIR;
  info: TableInfo;
  columns: ColumnInfo[];
  refColumns: ColumnInfo[];
  onDelete: string;
  name: string;
}

/** Foreign keys of other tables (or the same one) that point at `table`. */
function referrers(model: Model, table: string): Referrer[] {
  const target = tableInfo(model, table);
  const out: Referrer[] = [];
  for (const info of model.tables.values()) {
    for (const fk of info.table.foreignKeys) {
      if (fk.refTable !== table) continue;
      const columns = fk.columns.map((c) => info.columns.get(c)).filter((c): c is ColumnInfo => !!c);
      const refColumns = fk.refColumns.map((c) => target.columns.get(c)).filter((c): c is ColumnInfo => !!c);
      if (columns.length !== fk.columns.length || refColumns.length !== fk.refColumns.length) continue;
      out.push({ table: info.table, info, columns, refColumns, onDelete: fk.onDelete, name: fk.name });
    }
  }
  return out;
}

/** Filter for the rows of `ref.table` that point at any of `docs`. */
function referrerFilter(ref: Referrer, docs: Doc[]): Filter<Document> | null {
  if (ref.columns.length === 1) {
    const values = docs.map((d) => d[ref.refColumns[0]!.field]).filter((v) => v !== null && v !== undefined);
    return values.length > 0 ? { [ref.columns[0]!.field]: { $in: values } } : null;
  }
  const or = docs
    .map((d) => ref.refColumns.map((c) => d[c.field]))
    .filter((vals) => vals.every((v) => v !== null && v !== undefined))
    .map((vals) => Object.fromEntries(ref.columns.map((c, i) => [c.field, vals[i]])));
  return or.length > 0 ? { $or: or } : null;
}

/** Rows a delete removes, per table: `_id` as a string to the original `_id` value. */
type Deleting = Map<string, Map<string, unknown>>;

/**
 * Applies `onDelete` of every foreign key that points at `docs` (rows of
 * `table` about to be deleted). `deleting` holds every row this delete
 * removes, so cycles and self references terminate.
 */
async function applyReferentialActions(model: Model, table: string, docs: Doc[], exec: MongoExecutor, deleting: Deleting): Promise<void> {
  if (docs.length === 0) return;
  for (const ref of referrers(model, table)) {
    const filter = referrerFilter(ref, docs);
    if (!filter) continue;
    const coll = exec.db.collection(ref.table.name);
    let gone = deleting.get(ref.table.name);
    if (!gone) {
      gone = new Map();
      deleting.set(ref.table.name, gone);
    }
    switch (ref.onDelete) {
      case 'cascade': {
        const children = (await coll.find(filter, opts(exec)).toArray()).filter((d) => !gone.has(String(d._id)));
        if (children.length === 0) break;
        for (const c of children) gone.set(String(c._id), c._id);
        await applyReferentialActions(model, ref.table.name, children as Doc[], exec, deleting);
        await coll.deleteMany({ _id: { $in: children.map((c) => c._id) } }, opts(exec));
        break;
      }
      case 'set null':
      case 'set default': {
        const set: Doc = {};
        for (const c of ref.columns) set[c.field] = ref.onDelete === 'set null' ? null : defaultValue(c);
        await coll.updateMany(filter, { $set: set }, opts(exec));
        break;
      }
      default: {
        // restrict / no action: refuse while rows outside this delete point here.
        const outside = (gone.size > 0 ? { $and: [filter, { _id: { $nin: [...gone.values()] } }] } : filter) as Filter<Document>;
        const blocker = await coll.findOne(outside, { projection: { _id: 1 }, ...opts(exec) });
        if (blocker) throw errors.foreignKeyViolation(ref.name, undefined, { table: ref.table.name, references: table, dialect: 'mongodb' });
      }
    }
  }
}

async function deleteDocs(model: Model, table: string, docs: Doc[], exec: MongoExecutor): Promise<number> {
  if (docs.length === 0) return 0;
  const deleting: Deleting = new Map([[table, new Map(docs.map((d) => [String(d._id), d._id]))]]);
  await applyReferentialActions(model, table, docs, exec, deleting);
  const res = await exec.db.collection(table).deleteMany({ _id: { $in: docs.map((d) => d._id) } } as Filter<Document>, opts(exec));
  return res.deletedCount;
}

export async function deleteOne(model: Model, q: DeleteQueryIR, exec: MongoExecutor): Promise<Row | null> {
  const hasRefs = referrers(model, q.table).length > 0;
  const run = async (tx: MongoExecutor): Promise<Row | null> => {
    const filter = await writeFilter(model, q.table, q.where, tx);
    if (!hasRefs) {
      const res = await tx.db.collection(q.table).findOneAndDelete(filter, { includeResultMetadata: true, ...opts(tx) });
      return res.value ? pick(model, q.table, res.value as Doc, q.returning) : null;
    }
    const doc = await tx.db.collection(q.table).findOne(filter, opts(tx));
    if (!doc) return null;
    await deleteDocs(model, q.table, [doc as Doc], tx);
    return pick(model, q.table, doc as Doc, q.returning);
  };
  return hasRefs ? atomically(exec, run) : run(exec);
}

export async function deleteMany(model: Model, q: DeleteManyQueryIR, exec: MongoExecutor): Promise<{ count: number }> {
  const hasRefs = referrers(model, q.table).length > 0;
  if (!hasRefs) {
    const filter = await writeFilter(model, q.table, q.where, exec);
    const res = await exec.db.collection(q.table).deleteMany(filter, opts(exec));
    return { count: res.deletedCount };
  }
  return atomically(exec, async (tx) => {
    const filter = await writeFilter(model, q.table, q.where, tx);
    const docs = await tx.db.collection(q.table).find(filter, opts(tx)).toArray();
    return { count: await deleteDocs(model, q.table, docs as Doc[], tx) };
  });
}
