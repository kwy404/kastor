import type { ColumnIR } from '../../core/ir';
import { p, q, type Sql } from '../../core/sql/frag';
import { defineHooks, escapeLike, offsetFetchTop, placeholderAtP, quoteBracket, type SqlHooks, type TextMatchMode } from '../../core/sql/hooks';
import { jsonMssql } from '../../core/sql/json';
import { decodeValue, encodeValue, type CodecOptions } from '../../core/sql/values';
import { MssqlTypedParam } from './executor';

const codecOptions: CodecOptions = {
  boolean: 'native',
  // A Date would be sent as DATETIME (3.33 ms steps); text converts to DATETIME2 exactly.
  datetime: 'naive',
  json: 'string',
  bigint: 'string',
  bytes: (value) => Buffer.from(value.buffer, value.byteOffset, value.byteLength),
};

export function mssqlEncode(value: unknown, column: ColumnIR | undefined): unknown {
  // NULL is sent as NVARCHAR, which SQL Server refuses to convert to VARBINARY.
  if ((value === null || value === undefined) && column?.type === 'bytes') return new MssqlTypedParam(null, 'VARBINARY(MAX)');
  return encodeValue(value, column, codecOptions);
}

export function mssqlDecode(value: unknown, column: ColumnIR, source: 'row' | 'json'): unknown {
  if (value === null || value === undefined) return null;
  if (column.type === 'bytes' && Buffer.isBuffer(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (column.type === 'decimal' && typeof value === 'number') return String(value);
  return decodeValue(value, column.type, source, 'string');
}

/**
 * LIKE in T-SQL also treats `[` as a wildcard. Case sensitive matching
 * applies a binary collation, because the default collations ignore case.
 */
export function mssqlTextMatch(column: Sql, mode: TextMatchMode, _value: Sql, insensitive: boolean, raw: string): Sql | null {
  const escaped = escapeLike(raw, { likeEscape: '!', likeSpecials: '%_[' });
  const pattern = mode === 'contains' ? `%${escaped}%` : mode === 'startsWith' ? `${escaped}%` : `%${escaped}`;
  if (insensitive) return q`LOWER(${column}) LIKE LOWER(${p(pattern)}) ESCAPE '!'`;
  return q`${column} COLLATE Latin1_General_100_BIN2 LIKE ${p(pattern)} ESCAPE '!'`;
}

export const mssqlHooks: SqlHooks = defineHooks({
  quoteIdent: quoteBracket,
  placeholder: placeholderAtP,
  paginate: offsetFetchTop,
  orderFallback: '(SELECT NULL)',
  returning: 'output',
  upsert: 'merge',
  json: jsonMssql,
  caseInsensitive: 'lower',
  likeEscape: '!',
  likeSpecials: '%_[',
  textMatch: mssqlTextMatch,
  nullsOrder: false,
  encode: mssqlEncode,
  decode: mssqlDecode,
  insertDefaults: (table) => `INSERT INTO ${table} DEFAULT VALUES`,
  fromDual: '',
  mergeHint: 'WITH (HOLDLOCK)',
  mergeTerminator: ';',
  mutationSelfReference: true,
  // SQL Server takes at most 2100 parameters per request.
  maxParams: 2000,
  maxInList: 1000,
  multiRowInsert: true,
});
