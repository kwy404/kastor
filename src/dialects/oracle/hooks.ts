import type { ColumnIR } from '../../core/ir';
import { q, type Sql } from '../../core/sql/frag';
import { defineHooks, offsetFetch, placeholderColon, quoteDouble, type SqlHooks } from '../../core/sql/hooks';
import { jsonOracle, type JsonFlavor } from '../../core/sql/json';
import { decodeValue, encodeValue, type CodecOptions } from '../../core/sql/values';
import { OracleOutBind } from './executor';

const codecOptions: CodecOptions = {
  boolean: 'int',
  // oracledb binds a Date as a point in time; TIMESTAMP WITH TIME ZONE keeps it exact.
  datetime: 'date',
  json: 'string',
  bigint: 'string',
  bytes: (value) => Buffer.from(value.buffer, value.byteOffset, value.byteLength),
};

const pad = (n: number) => String(n).padStart(2, '0');

/** `HH:MM:SS` as an INTERVAL DAY TO SECOND literal Oracle converts implicitly. */
function timeToInterval(value: string): string {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(value.trim());
  if (!m) return value;
  return `0 ${pad(Number(m[1]))}:${m[2]}:${m[3] ?? '00'}`;
}

/** `YYYY-MM-DD` as a Date at local midnight: oracledb writes DATE values in the session time zone. */
function dateOnly(value: string): Date | string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : value;
}

export function oracleEncode(value: unknown, column: ColumnIR | undefined): unknown {
  if (value === null || value === undefined) return null;
  if (column?.type === 'date') {
    const text = value instanceof Date ? (encodeValue(value, column, codecOptions) as string) : value;
    return typeof text === 'string' ? dateOnly(text) : text;
  }
  if (column?.type === 'time') {
    const text = value instanceof Date ? (encodeValue(value, column, codecOptions) as string) : value;
    return typeof text === 'string' ? timeToInterval(text) : text;
  }
  if (column?.type === 'datetime' && typeof value === 'string') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return encodeValue(value, column, codecOptions);
}

interface IntervalLike {
  days?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
}

/** `PT3H4M5S` (interval inside JSON) to `03:04:05`. */
function isoDurationToTime(value: string): string | undefined {
  const m = /^P(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)(?:\.\d+)?S)?$/.exec(value);
  if (!m) return undefined;
  return `${pad(Number(m[1] ?? 0))}:${pad(Number(m[2] ?? 0))}:${pad(Number(m[3] ?? 0))}`;
}

export function oracleDecode(value: unknown, column: ColumnIR, source: 'row' | 'json'): unknown {
  if (value === null || value === undefined) return null;
  if (column.type === 'time') {
    if (typeof value === 'object' && !(value instanceof Date)) {
      const iv = value as IntervalLike;
      return `${pad(iv.hours ?? 0)}:${pad(iv.minutes ?? 0)}:${pad(iv.seconds ?? 0)}`;
    }
    if (typeof value === 'string') {
      const fromIso = isoDurationToTime(value);
      if (fromIso) return fromIso;
      const m = /^[+-]?\d+ (\d{2}:\d{2}:\d{2})/.exec(value);
      if (m) return m[1];
    }
  }
  if (column.type === 'bytes' && Buffer.isBuffer(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (column.type === 'uuid' && typeof value === 'string') return value.trim().toLowerCase();
  return decodeValue(value, column.type, source, 'string');
}

/**
 * jsonOracle with BLOB columns passed straight to JSON_OBJECT, which writes
 * them as hex (RAWTOHEX does not take a BLOB).
 */
export const jsonOracleKastor: JsonFlavor = {
  ...jsonOracle,
  field(expr: Sql, column: ColumnIR): Sql {
    if (column.type === 'bytes' && !column.nativeType) return expr;
    return jsonOracle.field(expr, column);
  },
};

/**
 * CLOB columns (`text`, `json`) cannot be compared or sorted directly
 * (ORA-22848). Comparisons and ORDER BY look at their first 1000 characters,
 * which always fits a VARCHAR2 whatever the character set.
 */
export function oracleCompareColumn(expr: Sql, column: ColumnIR): Sql {
  if ((column.type === 'text' || column.type === 'json') && (!column.nativeType || /clob/i.test(column.nativeType))) {
    return q`DBMS_LOB.SUBSTR(${expr}, 1000, 1)`;
  }
  return expr;
}

export const oracleHooks: SqlHooks = defineHooks({
  quoteIdent: quoteDouble,
  placeholder: placeholderColon,
  paginate: offsetFetch,
  orderFallback: '(SELECT NULL FROM DUAL)',
  returning: 'into',
  outParam: (column, as) => new OracleOutBind(column, as),
  compareColumn: oracleCompareColumn,
  upsert: 'merge',
  json: jsonOracleKastor,
  caseInsensitive: 'lower',
  likeEscape: '!',
  likeSpecials: '%_',
  nullsOrder: true,
  encode: oracleEncode,
  decode: oracleDecode,
  insertDefaults: (table) => `INSERT INTO ${table} VALUES (DEFAULT)`,
  fromDual: ' FROM DUAL',
  mergeHint: '',
  mergeTerminator: '',
  mutationSelfReference: true,
  maxParams: 65535,
  // ORA-01795: at most 1000 expressions in a list.
  maxInList: 1000,
  // Multi row VALUES needs Oracle 23; one INSERT per row works everywhere.
  multiRowInsert: false,
});
