import type { ColumnIR } from '../../core/ir';
import { p, q, type Sql } from '../../core/sql/frag';
import { defineHooks, escapeLike, limitOffset, placeholderQuestion, quoteBacktick, type SqlHooks, type TextMatchMode } from '../../core/sql/hooks';
import { jsonMariadb, jsonMysql } from '../../core/sql/json';
import { decodeValue, encodeValue, type CodecOptions } from '../../core/sql/values';

/** MySQL's LIMIT has no ALL; the largest unsigned BIGINT means "no limit". */
const NO_LIMIT = '18446744073709551615';

const codecOptions: CodecOptions = {
  boolean: 'int',
  datetime: 'naive',
  json: 'string',
  bigint: 'string',
  bytes: (value) => Buffer.from(value.buffer, value.byteOffset, value.byteLength),
};

export function mysqlEncode(value: unknown, column: ColumnIR | undefined): unknown {
  return encodeValue(value, column, codecOptions);
}

/**
 * Decodes MySQL and MariaDB values. The executor hands datetimes, decimals,
 * 64 bit integers and JSON over as text, so nothing depends on the session
 * time zone or on how the user configured the pool.
 */
export function mysqlDecode(value: unknown, column: ColumnIR, source: 'row' | 'json'): unknown {
  if (value === null || value === undefined) return null;
  if (column.type === 'json') {
    if (typeof value === 'string' && source === 'row') {
      try {
        return JSON.parse(value);
      } catch {
        // mysql2 already parsed a JSON string scalar on MariaDB
        return value;
      }
    }
    if (Buffer.isBuffer(value)) return JSON.parse(value.toString('utf8'));
    return value;
  }
  if (column.type === 'bytes' && source === 'json' && typeof value === 'string' && value.startsWith('base64:')) {
    // MySQL embeds raw binary columns as "base64:type15:<data>"
    return new Uint8Array(Buffer.from(value.slice(value.lastIndexOf(':') + 1), 'base64'));
  }
  if (column.type === 'bytes' && Buffer.isBuffer(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return decodeValue(value, column.type, source, 'string');
}

/**
 * Case sensitive `contains`, `startsWith` and `endsWith`. The default MySQL
 * and MariaDB collations ignore case, so plain LIKE would match "ADA" for
 * "ada"; a binary collation on the pattern makes the match exact. The
 * insensitive mode lower cases both sides and works under any collation.
 */
export function mysqlTextMatch(binaryCollation: string) {
  return (column: Sql, mode: TextMatchMode, _value: Sql, insensitive: boolean, raw: string): Sql | null => {
    const escaped = escapeLike(raw, { likeEscape: '!', likeSpecials: '%_' });
    const pattern = mode === 'contains' ? `%${escaped}%` : mode === 'startsWith' ? `${escaped}%` : `%${escaped}`;
    if (insensitive) return q`LOWER(${column}) LIKE LOWER(${p(pattern)}) ESCAPE '!'`;
    return q`${column} LIKE ${p(pattern)} COLLATE ${binaryCollation} ESCAPE '!'`;
  };
}

const shared: Partial<SqlHooks> = {
  quoteIdent: quoteBacktick,
  placeholder: placeholderQuestion,
  paginate: limitOffset(NO_LIMIT),
  orderFallback: '(SELECT NULL)',
  returning: 'none',
  upsert: 'onDuplicateKey',
  caseInsensitive: 'lower',
  likeEscape: '!',
  likeSpecials: '%_',
  textMatch: mysqlTextMatch('utf8mb4_bin'),
  nullsOrder: false,
  encode: mysqlEncode,
  decode: mysqlDecode,
  insertDefaults: (table) => `INSERT INTO ${table} () VALUES ()`,
  lastInsertIdSql: 'SELECT LAST_INSERT_ID() AS `id`',
  fromDual: '',
  mergeHint: '',
  mergeTerminator: '',
  // MySQL error 1093: an UPDATE or DELETE cannot read its own table in a subquery.
  mutationSelfReference: false,
  maxParams: 65535,
  maxInList: 10000,
  multiRowInsert: true,
};

export const mysqlHooks: SqlHooks = defineHooks({ ...shared, json: jsonMysql });

/**
 * MariaDB: JSON aggregation without outer references in derived tables, so
 * includes with take or skip load through the IN-list path.
 */
export const mariadbHooks: SqlHooks = defineHooks({ ...shared, json: jsonMariadb });
