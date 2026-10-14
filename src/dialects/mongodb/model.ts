/**
 * Schema lookups and value conversion for MongoDB.
 *
 * Documents keep the database column names as field names, with one rule:
 * a single column primary key is stored as `_id`. Values are stored as native
 * BSON types (ObjectId, Decimal128, Long, Date, Binary) and converted back to
 * the plain JS values the client expects on the way out.
 */
import { randomUUID } from 'node:crypto';
import { Binary, Decimal128, Long, ObjectId } from 'mongodb';
import type { ColumnIR, SchemaIR, TableIR } from '../../core/ir';
import { mongoError } from './errors';

/**
 * How generated primary keys (`t.id()`, `t.bigId()`) are stored.
 * - `objectId`: a BSON ObjectId, returned to the client as a 24 character hex string (default)
 * - `uuid`: a random UUID string
 * - `int`: an increasing integer from the `_kastor_counters` collection, like SQL identity columns
 */
export type IdMode = 'objectId' | 'uuid' | 'int';

export interface ColumnInfo {
  column: ColumnIR;
  /** Document field name (`_id` for a single column primary key). */
  field: string;
  /** The value is stored as an ObjectId and exposed as a hex string. */
  objectId: boolean;
  /** The column gets a generated id when an insert leaves it out. */
  generated?: IdMode;
  /** The column holds a generated uuid string id (its own, or one it references). */
  uuidRef?: boolean;
}

export interface TableInfo {
  table: TableIR;
  columns: Map<string, ColumnInfo>;
  /** Column stored as `_id`, when the primary key has a single column. */
  idColumn?: string;
}

export interface Model {
  schema: SchemaIR;
  ids: IdMode;
  tables: Map<string, TableInfo>;
}

export const COUNTERS = '_kastor_counters';
export const MIGRATIONS = '_kastor_migrations';

const cache = new WeakMap<SchemaIR, Map<IdMode, Model>>();

/** Builds (and caches per schema object) the lookup tables for one schema. */
export function getModel(schema: SchemaIR, ids: IdMode): Model {
  let byMode = cache.get(schema);
  if (!byMode) {
    byMode = new Map();
    cache.set(schema, byMode);
  }
  let model = byMode.get(ids);
  if (!model) {
    model = buildModel(schema, ids);
    byMode.set(ids, model);
  }
  return model;
}

function isGeneratedId(column: ColumnIR): boolean {
  return column.default?.kind === 'autoincrement';
}

function buildModel(schema: SchemaIR, ids: IdMode): Model {
  const tables = new Map<string, TableInfo>();
  for (const table of schema.tables) {
    const idColumn = table.primaryKey.length === 1 ? table.primaryKey[0] : undefined;
    const columns = new Map<string, ColumnInfo>();
    for (const column of table.columns) {
      const isId = column.name === idColumn;
      const info: ColumnInfo = {
        column,
        field: isId ? '_id' : column.name,
        objectId: (column.nativeType ?? '').toLowerCase() === 'objectid',
      };
      if (isId && isGeneratedId(column)) {
        info.generated = ids;
        if (ids === 'objectId') info.objectId = true;
        if (ids === 'uuid') info.uuidRef = true;
      }
      columns.set(column.name, info);
    }
    tables.set(table.name, { table, columns, idColumn });
  }
  // Foreign key columns that point at a generated ObjectId or uuid id hold the same kind of value.
  // Repeat until stable so chains (a -> b -> c) resolve.
  let changed = true;
  while (changed) {
    changed = false;
    for (const info of tables.values()) {
      for (const fk of info.table.foreignKeys) {
        const target = tables.get(fk.refTable);
        if (!target) continue;
        fk.columns.forEach((name, i) => {
          const col = info.columns.get(name);
          const ref = target.columns.get(fk.refColumns[i] ?? '');
          if (col && ref?.objectId && !col.objectId) {
            col.objectId = true;
            changed = true;
          }
          if (col && ref?.uuidRef && !col.uuidRef) {
            col.uuidRef = true;
            changed = true;
          }
        });
      }
    }
  }
  return { schema, ids, tables };
}

export function tableInfo(model: Model, name: string): TableInfo {
  const info = model.tables.get(name);
  if (!info) {
    throw mongoError('UNKNOWN_TABLE', `The collection "${name}" is not part of the schema.`, 'Add the table to the schema passed to kastor().');
  }
  return info;
}

/** Document field for a column. Unknown columns map to themselves. */
export function fieldOf(model: Model, table: string, column: string): string {
  return model.tables.get(table)?.columns.get(column)?.field ?? column;
}

export function columnOf(model: Model, table: string, column: string): ColumnInfo | undefined {
  return model.tables.get(table)?.columns.get(column);
}

/* ------------------------------------------------------------------------ */
/* Encoding (JS -> BSON)                                                      */
/* ------------------------------------------------------------------------ */

const hex24 = /^[0-9a-fA-F]{24}$/;

/** Rounds a decimal string to `scale` digits (half away from zero) and pads it. */
export function fixScale(value: string, scale: number): string {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(value.trim());
  if (!m) return value;
  const sign = m[1] === '-' ? '-' : '';
  const intPart = m[2] || '0';
  const frac = m[3] ?? '';
  if (scale <= 0) {
    let n = BigInt(intPart);
    if ((frac[0] ?? '0') >= '5') n += 1n;
    return n === 0n ? '0' : sign + n.toString();
  }
  if (frac.length <= scale) return `${sign}${BigInt(intPart).toString()}.${frac.padEnd(scale, '0')}`;
  let digits = BigInt(intPart + frac.slice(0, scale));
  if ((frac[scale] ?? '0') >= '5') digits += 1n;
  const s = digits.toString().padStart(scale + 1, '0');
  const out = `${s.slice(0, -scale)}.${s.slice(-scale)}`;
  return /^0\.0*$/.test(out) ? out : sign + out;
}

function toDateOnly(value: unknown): Date {
  if (value instanceof Date) return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const s = String(value);
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00.000Z` : s);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Converts a JS value to the BSON value stored for `info`. */
export function encodeValue(value: unknown, info: ColumnInfo | undefined): unknown {
  if (value === null || value === undefined) return null;
  if (!info) return value;
  if (info.objectId) {
    if (value instanceof ObjectId) return value;
    if (typeof value === 'string' && hex24.test(value)) return new ObjectId(value);
    return value;
  }
  const col = info.column;
  switch (col.type) {
    case 'bigint':
      if (typeof value === 'bigint') return Long.fromBigInt(value);
      if (typeof value === 'number') return Long.fromNumber(Math.trunc(value));
      if (typeof value === 'string' && /^-?\d+$/.test(value)) return Long.fromString(value);
      return value;
    case 'int':
      if (typeof value === 'bigint') return Number(value);
      if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value);
      return value;
    case 'float':
      if (typeof value === 'bigint') return Number(value);
      if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value);
      return value;
    case 'decimal': {
      if (value instanceof Decimal128) return value;
      if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'string') {
        let s = String(value);
        if (col.scale !== undefined && /^[+-]?\d*(\.\d*)?$/.test(s)) s = fixScale(s, col.scale);
        return Decimal128.fromString(s);
      }
      return value;
    }
    case 'datetime':
      if (value instanceof Date) return value;
      if (typeof value === 'string' || typeof value === 'number') return new Date(value);
      return value;
    case 'date':
      if (value instanceof Date || typeof value === 'string') return toDateOnly(value);
      return value;
    case 'time':
      if (value instanceof Date) return `${pad2(value.getUTCHours())}:${pad2(value.getUTCMinutes())}:${pad2(value.getUTCSeconds())}`;
      return value;
    case 'bytes':
      if (value instanceof Binary) return value;
      if (value instanceof Uint8Array) return new Binary(value);
      if (value instanceof ArrayBuffer) return new Binary(new Uint8Array(value));
      return value;
    default:
      return value;
  }
}

/* ------------------------------------------------------------------------ */
/* Decoding (BSON -> JS)                                                      */
/* ------------------------------------------------------------------------ */

function isLong(value: unknown): value is Long {
  return value instanceof Long || (typeof value === 'object' && value !== null && (value as { _bsontype?: string })._bsontype === 'Long');
}

function isDecimal(value: unknown): value is Decimal128 {
  return value instanceof Decimal128 || (typeof value === 'object' && value !== null && (value as { _bsontype?: string })._bsontype === 'Decimal128');
}

function isObjectId(value: unknown): value is ObjectId {
  return value instanceof ObjectId || (typeof value === 'object' && value !== null && (value as { _bsontype?: string })._bsontype === 'ObjectId');
}

function isBinary(value: unknown): value is Binary {
  return value instanceof Binary || (typeof value === 'object' && value !== null && (value as { _bsontype?: string })._bsontype === 'Binary');
}

function binaryBytes(value: Binary): Uint8Array {
  return Uint8Array.from(value.buffer.subarray(0, value.length()));
}

function formatUuid(bytes: Uint8Array): string {
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Turns stray BSON wrappers inside json values into plain JS values. */
function plain(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (isObjectId(value)) return value.toHexString();
  if (isDecimal(value)) return value.toString();
  if (isLong(value)) return value.toNumber();
  if (isBinary(value)) return binaryBytes(value);
  if (Array.isArray(value)) return value.map(plain);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = plain(v);
  return out;
}

/** Converts a stored BSON value back to the JS value the client expects. */
export function decodeValue(value: unknown, info: ColumnInfo | undefined): unknown {
  if (value === null || value === undefined) return null;
  if (isObjectId(value)) return value.toHexString();
  if (!info) return plain(value);
  const col = info.column;
  switch (col.type) {
    case 'bigint':
      if (isLong(value)) return value.toBigInt();
      if (typeof value === 'number') return BigInt(Math.trunc(value));
      if (isDecimal(value)) return BigInt(value.toString().split('.')[0] ?? '0');
      if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
      return value;
    case 'int':
    case 'float':
      if (isLong(value)) return value.toNumber();
      if (isDecimal(value)) return Number(value.toString());
      return value;
    case 'decimal': {
      let s: string;
      if (isDecimal(value)) s = value.toString();
      else if (typeof value === 'number' || typeof value === 'bigint') s = String(value);
      else if (isLong(value)) s = value.toString();
      else return value;
      if (/[eE]/.test(s) && Number.isFinite(Number(s))) s = expandExponent(s);
      return col.scale !== undefined ? fixScale(s, col.scale) : s;
    }
    case 'datetime':
      if (value instanceof Date) return value;
      if (typeof value === 'string' || typeof value === 'number') return new Date(value);
      return value;
    case 'date':
      if (value instanceof Date) return value.toISOString().slice(0, 10);
      return value;
    case 'time':
      if (value instanceof Date) return `${pad2(value.getUTCHours())}:${pad2(value.getUTCMinutes())}:${pad2(value.getUTCSeconds())}`;
      return value;
    case 'bytes':
      if (isBinary(value)) return binaryBytes(value);
      if (value instanceof Uint8Array) return Uint8Array.from(value);
      return value;
    case 'uuid':
      if (isBinary(value)) return formatUuid(binaryBytes(value));
      return value;
    case 'boolean':
      if (typeof value === 'number') return value !== 0;
      return value;
    case 'json':
      return plain(value);
    default:
      return plain(value);
  }
}

/** Expands `1.5E+3` style decimal strings to plain digits. */
function expandExponent(s: string): string {
  const m = /^([+-]?)(\d+)(?:\.(\d*))?[eE]([+-]?\d+)$/.exec(s);
  if (!m) return s;
  const sign = m[1] === '-' ? '-' : '';
  const digits = (m[2] ?? '') + (m[3] ?? '');
  const point = (m[2] ?? '').length + Number(m[4]);
  let out: string;
  if (point <= 0) out = `0.${'0'.repeat(-point)}${digits}`;
  else if (point >= digits.length) out = digits + '0'.repeat(point - digits.length);
  else out = `${digits.slice(0, point)}.${digits.slice(point)}`;
  out = out.replace(/^0+(?=\d)/, '');
  return sign + out;
}

/* ------------------------------------------------------------------------ */
/* Defaults                                                                   */
/* ------------------------------------------------------------------------ */

export function newObjectId(): ObjectId {
  return new ObjectId();
}

export function newUuid(): string {
  return randomUUID();
}

/** Value for a column default (not ids, they need the counter). */
export function defaultValue(info: ColumnInfo): unknown {
  const def = info.column.default;
  if (!def) return null;
  switch (def.kind) {
    case 'value':
      return encodeValue(def.value, info);
    case 'now':
      return encodeValue(new Date(), info);
    case 'random':
      return info.objectId ? newObjectId() : newUuid();
    case 'sql': {
      const text = String(def.value ?? '').toLowerCase();
      if (/current_timestamp|now\(\)|getdate|sysdate|systimestamp/.test(text)) return encodeValue(new Date(), info);
      if (/gen_random_uuid|uuid\(\)|newid/.test(text)) return newUuid();
      return null;
    }
    default:
      return null;
  }
}
