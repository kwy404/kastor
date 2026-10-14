/**
 * Dialect hooks for the shared SQL compiler. A SQL dialect fills a SqlHooks
 * object (mostly from the presets below) and gets query compilation,
 * includes, upserts, returning emulation and value conversion for free.
 */
import type { ColumnIR, TableIR } from '../ir';
import type { Sql } from './frag';
import type { JsonFlavor } from './json';
import { defaultCodec } from './values';

export interface Pagination {
  /** Text right after SELECT, e.g. `TOP 10`. */
  prefix?: string;
  /** Text after ORDER BY, e.g. `LIMIT 10 OFFSET 5`. */
  suffix?: string;
  /** The suffix needs an ORDER BY (SQL Server OFFSET FETCH). */
  requiresOrder?: boolean;
}

export type TextMatchMode = 'contains' | 'startsWith' | 'endsWith';

export interface SqlHooks {
  /** Quotes one identifier. */
  quoteIdent(name: string): string;
  /** Placeholder for the n-th parameter, 1 based. */
  placeholder(index: number): string;
  /** LIMIT/OFFSET text. `take` and `skip` are validated non negative integers. */
  paginate(take: number | undefined, skip: number | undefined): Pagination;
  /** ORDER BY used when pagination requires one and the query has none. */
  orderFallback: string;
  /**
   * How INSERT/UPDATE/DELETE return rows: `returning` (RETURNING list),
   * `output` (SQL Server OUTPUT), `into` (Oracle `RETURNING ... INTO` with out
   * binds made by `outParam`) or `none` (re-select by primary key).
   */
  returning: 'returning' | 'output' | 'into' | 'none';
  /**
   * Out bind marker for `returning: 'into'`. The executor binds it as an out
   * parameter and returns the out values as rows keyed by `as`.
   */
  outParam?(column: ColumnIR, as: string): unknown;
  /** Wraps a column when it is read into a row (e.g. decimals as text on SQL Server). */
  selectColumn?(expr: Sql, column: ColumnIR): Sql;
  /** Wraps a column used in comparisons, IN lists and ORDER BY (e.g. Oracle CLOB). */
  compareColumn?(expr: Sql, column: ColumnIR): Sql;
  /** Native upsert syntax, `none` runs select then insert or update in a transaction. */
  upsert: 'onConflict' | 'onDuplicateKey' | 'merge' | 'none';
  /** JSON aggregation for includes; null loads includes with one IN-list query per level. */
  json: JsonFlavor | null;
  /** Case insensitive matching: native ILIKE or LOWER() on both sides. */
  caseInsensitive: 'ilike' | 'lower';
  /** Escape character used with LIKE. */
  likeEscape: string;
  /** Characters to escape inside LIKE patterns (the escape character is always escaped). */
  likeSpecials: string;
  /**
   * Optional override for contains / startsWith / endsWith. Receives the
   * column expression and the parameter fragment holding the raw (unescaped)
   * text. Return null to use the LIKE based default.
   */
  textMatch?(column: Sql, mode: TextMatchMode, value: Sql, insensitive: boolean, raw: string): Sql | null;
  /** Native NULLS FIRST / NULLS LAST; otherwise emulated with CASE. */
  nullsOrder: boolean;
  /** Encodes a JS value for a column (column is undefined for raw parameters). */
  encode(value: unknown, column: ColumnIR | undefined): unknown;
  /** Decodes a value read from a row or from aggregated JSON. */
  decode(value: unknown, column: ColumnIR, source: 'row' | 'json'): unknown;
  /** INSERT for a row that sets no column. */
  insertDefaults(quotedTable: string, table: TableIR): string;
  /** Statement returning the last generated id as column `id`, for drivers without insertId. */
  lastInsertIdSql?: string;
  /** Suffix for SELECT without a table (Oracle needs ` FROM DUAL`). */
  fromDual: string;
  /** Table hint after MERGE INTO target (SQL Server: `WITH (HOLDLOCK)`). */
  mergeHint: string;
  /** Statement terminator required after MERGE (SQL Server: `;`). */
  mergeTerminator: string;
  /**
   * UPDATE/DELETE may reference the same table in a subquery of the WHERE
   * clause (false on MySQL: error 1093). When false, kastor selects the keys first.
   */
  mutationSelfReference: boolean;
  /** Maximum bound parameters per statement. */
  maxParams: number;
  /** Maximum values in one IN list (Oracle: 1000). */
  maxInList: number;
  /** Multi row VALUES lists in INSERT. */
  multiRowInsert: boolean;
  /** Literal for `count(*)` type alias wrapping, rarely needed. */
  castCountToInt?(expr: Sql): Sql;
}

/* ------------------------------------------------------------------------ */
/* Presets                                                                    */
/* ------------------------------------------------------------------------ */

export const quoteDouble = (name: string): string => `"${name.replace(/"/g, '""')}"`;
export const quoteBacktick = (name: string): string => `\`${name.replace(/`/g, '``')}\``;
export const quoteBracket = (name: string): string => `[${name.replace(/]/g, ']]')}]`;

export const placeholderDollar = (i: number): string => `$${i}`;
export const placeholderQuestion = (): string => '?';
export const placeholderAtP = (i: number): string => `@p${i}`;
export const placeholderColon = (i: number): string => `:${i}`;

/** `LIMIT n OFFSET m` (Postgres, MySQL, SQLite). `limitAll` is used for an offset without a limit. */
export function limitOffset(limitAll = 'ALL') {
  return (take: number | undefined, skip: number | undefined): Pagination => {
    if (take === undefined && !skip) return {};
    if (take === undefined) return { suffix: `LIMIT ${limitAll} OFFSET ${skip}` };
    return { suffix: skip ? `LIMIT ${take} OFFSET ${skip}` : `LIMIT ${take}` };
  };
}

/** SQL Server: `TOP n` without offset, `OFFSET m ROWS FETCH NEXT n ROWS ONLY` with one. */
export function offsetFetchTop(take: number | undefined, skip: number | undefined): Pagination {
  if (take === undefined && !skip) return {};
  if (!skip) return { prefix: `TOP (${take})` };
  return {
    suffix: take === undefined ? `OFFSET ${skip} ROWS` : `OFFSET ${skip} ROWS FETCH NEXT ${take} ROWS ONLY`,
    requiresOrder: true,
  };
}

/** Standard SQL (Oracle 12c+): `OFFSET m ROWS FETCH NEXT n ROWS ONLY`. */
export function offsetFetch(take: number | undefined, skip: number | undefined): Pagination {
  if (take === undefined && !skip) return {};
  const parts: string[] = [];
  if (skip) parts.push(`OFFSET ${skip} ROWS`);
  if (take !== undefined) parts.push(`FETCH NEXT ${take} ROWS ONLY`);
  return { suffix: parts.join(' ') };
}

/** A complete hook set with ANSI choices; dialects spread it and override. */
export const ansiHooks: SqlHooks = {
  quoteIdent: quoteDouble,
  placeholder: placeholderQuestion,
  paginate: limitOffset(),
  orderFallback: '(SELECT NULL)',
  returning: 'none',
  upsert: 'none',
  json: null,
  caseInsensitive: 'lower',
  likeEscape: '!',
  likeSpecials: '%_',
  nullsOrder: true,
  encode: defaultCodec.encode,
  decode: defaultCodec.decode,
  insertDefaults: (quotedTable) => `INSERT INTO ${quotedTable} DEFAULT VALUES`,
  fromDual: '',
  mergeHint: '',
  mergeTerminator: '',
  mutationSelfReference: true,
  maxParams: 32766,
  maxInList: 1000,
  multiRowInsert: true,
};

export function defineHooks(overrides: Partial<SqlHooks>): SqlHooks {
  return { ...ansiHooks, ...overrides };
}

/** Escapes LIKE wildcards in user text. */
export function escapeLike(value: string, hooks: Pick<SqlHooks, 'likeEscape' | 'likeSpecials'>): string {
  const specials = new Set([hooks.likeEscape, ...hooks.likeSpecials]);
  let out = '';
  for (const ch of value) out += specials.has(ch) ? hooks.likeEscape + ch : ch;
  return out;
}
