/**
 * Driver level value plumbing shared by the `pg` and `postgres` executors.
 */

/** A json parameter, already serialized. Each driver unwraps it its own way. */
export class JsonParam {
  constructor(readonly text: string) {}

  /** Logs and `toSQL()` show the JSON text. */
  toJSON(): string {
    return this.text;
  }
}

const hasBuffer = typeof Buffer !== 'undefined';

/** Converts encoded parameters into what `pg` accepts. */
export function toDriverParams(params: unknown[]): unknown[] {
  return params.map(toDriverParam);
}

function toDriverParam(value: unknown): unknown {
  if (value instanceof JsonParam) return value.text;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array && hasBuffer && !Buffer.isBuffer(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  return value;
}

/** Postgres type oids that drivers parse in a time zone dependent way. */
const DATE_OID = 1082;
const TIMESTAMP_OID = 1114;

export interface FieldLike {
  name: string;
  /** `pg` */
  dataTypeID?: number;
  /** `postgres` */
  type?: number;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/**
 * Undoes the local time zone guesses drivers make: `date` becomes a plain
 * `YYYY-MM-DD` string and `timestamp` (without time zone) is read as UTC. Both
 * drivers build these Date objects from the local clock fields, so reading
 * the same local fields back is lossless.
 */
export function normalizeRows(
  rows: Record<string, unknown>[],
  fields: readonly FieldLike[] | undefined,
  /** `postgres` parses a bare date as UTC midnight, `pg` as local midnight. */
  dateParsedAsUtc = false,
): Record<string, unknown>[] {
  if (!fields || rows.length === 0) return rows;
  const dates: string[] = [];
  const stamps: string[] = [];
  for (const field of fields) {
    const oid = field.dataTypeID ?? field.type;
    if (oid === DATE_OID) dates.push(field.name);
    else if (oid === TIMESTAMP_OID) stamps.push(field.name);
  }
  if (dates.length === 0 && stamps.length === 0) return rows;
  for (const row of rows) {
    for (const name of dates) {
      const value = row[name];
      if (value instanceof Date && !Number.isNaN(value.getTime())) row[name] = dateParsedAsUtc ? utcDate(value) : localDate(value);
    }
    for (const name of stamps) {
      const value = row[name];
      if (value instanceof Date && !Number.isNaN(value.getTime())) row[name] = localAsUtc(value);
    }
  }
  return rows;
}

function localDate(d: Date): string {
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localAsUtc(d: Date): Date {
  return new Date(
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()),
  );
}

/** Same as {@link localDate} but with UTC fields, for drivers that parse `date` as UTC midnight. */
export function utcDate(d: Date): string {
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
