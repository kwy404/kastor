import type { ColumnIR, Dialect } from '../../core/ir';
import {
  createSqlDialect,
  decodeValue,
  defineHooks,
  encodeValue,
  jsonSqlite,
  limitOffset,
  placeholderQuestion,
  q,
  quoteDouble,
  type Sql,
  type SqlHooks,
  type TextMatchMode,
} from '../../core/sql';
import { sqliteDdl } from './ddl';
import { mapSqliteError } from './errors';
import { sqliteIntrospect } from './introspect';

export function encodeSqlite(value: unknown, column: ColumnIR | undefined): unknown {
  return encodeValue(value, column, { boolean: 'int', datetime: 'iso', json: 'string', bigint: 'bigint' });
}

/** Restores the scale of a decimal that SQLite stored as a number (`1.5` back to `1.50`). */
function withScale(value: string, scale: number | undefined): string {
  if (scale === undefined || !/^-?\d+(\.\d+)?$/.test(value)) return value;
  const [whole, fraction = ''] = value.split('.');
  if (scale === 0) return whole!;
  return `${whole}.${fraction.padEnd(scale, '0').slice(0, Math.max(scale, fraction.length))}`;
}

export function decodeSqlite(value: unknown, column: ColumnIR, source: 'row' | 'json'): unknown {
  if (value === null || value === undefined) return null;
  if (column.type === 'decimal') {
    const text = typeof value === 'number' && !Number.isInteger(value) ? String(value) : String(decodeValue(value, 'decimal', source));
    return withScale(text, column.scale);
  }
  if (column.type === 'json' && source === 'row' && typeof value !== 'string' && !(value instanceof Uint8Array)) {
    // A JSON column has NUMERIC affinity: a bare number or boolean comes back already parsed.
    return value;
  }
  const decoded = decodeValue(value, column.type, source, 'string');
  if (decoded instanceof Uint8Array && decoded.constructor !== Uint8Array) {
    return new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength);
  }
  return decoded;
}

/**
 * SQLite LIKE ignores ASCII case, so case sensitive `contains`, `startsWith`
 * and `endsWith` use instr() and substr() instead (no wildcard escaping
 * needed either). Case insensitive matching keeps the LIKE based default.
 */
export function sqliteTextMatch(column: Sql, mode: TextMatchMode, value: Sql, insensitive: boolean, raw: string): Sql | null {
  if (insensitive) return null;
  switch (mode) {
    case 'contains':
      return q`instr(${column}, ${value}) > 0`;
    case 'startsWith':
      return q`substr(${column}, 1, length(${value})) = ${value}`;
    case 'endsWith':
      if (raw === '') return q`${column} IS NOT NULL`;
      return q`substr(${column}, -length(${value})) = ${value}`;
  }
}

export interface SqliteHookOptions {
  maxParams?: number;
  maxInList?: number;
  /**
   * Read bigint columns as text. For drivers that turn every INTEGER into a JS
   * number (libSQL in its default `intMode`, D1), so values past 2^53 neither
   * throw nor lose digits.
   */
  bigintAsText?: boolean;
}

export function sqliteHooks(options: SqliteHookOptions = {}): SqlHooks {
  return defineHooks({
    ...(options.bigintAsText
      ? { selectColumn: (expr: Sql, column: ColumnIR) => (column.type === 'bigint' ? q`CAST(${expr} AS TEXT)` : expr) }
      : {}),
    quoteIdent: quoteDouble,
    placeholder: placeholderQuestion,
    paginate: limitOffset('-1'),
    returning: 'returning',
    upsert: 'onConflict',
    json: jsonSqlite,
    caseInsensitive: 'lower',
    textMatch: sqliteTextMatch,
    nullsOrder: true,
    encode: encodeSqlite,
    decode: decodeSqlite,
    maxParams: options.maxParams ?? 32766,
    maxInList: options.maxInList ?? 10000,
    multiRowInsert: true,
    mutationSelfReference: true,
  });
}

export function makeSqliteDialect(hooks: SqlHooks, transactions = true): Dialect {
  return createSqlDialect({
    name: 'sqlite',
    hooks,
    features: { namedEnums: false, transactionalDdl: true, transactions },
    ddl: sqliteDdl,
    introspect: sqliteIntrospect,
    timestampType: 'DATETIME',
    mapError: mapSqliteError,
  });
}

/** SQLite 3.35+ (RETURNING) through better-sqlite3, node:sqlite or bun:sqlite. */
export const sqliteDialect: Dialect = makeSqliteDialect(sqliteHooks());

/** libSQL and Turso: bigint columns are read as text, whatever `intMode` the client uses. */
export const libsqlDialect: Dialect = makeSqliteDialect(sqliteHooks({ bigintAsText: true }));

/** Cloudflare D1 caps a statement at 100 bound parameters, returns integers as doubles and has no interactive transactions. */
export const d1Dialect: Dialect = makeSqliteDialect(sqliteHooks({ maxParams: 100, maxInList: 90, bigintAsText: true }), false);
