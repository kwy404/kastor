/**
 * Shared SQL base for the SQL dialects. Dialects import from here:
 *
 * ```ts
 * import { createSqlDialect, defineHooks, jsonPostgres, quoteDouble, placeholderDollar, codec } from '../../core/sql';
 * ```
 */
export { Sql, q, p, text, join, empty, type SqlPart, type Param } from './frag';
export {
  ansiHooks,
  defineHooks,
  escapeLike,
  limitOffset,
  offsetFetch,
  offsetFetchTop,
  placeholderAtP,
  placeholderColon,
  placeholderDollar,
  placeholderQuestion,
  quoteBacktick,
  quoteBracket,
  quoteDouble,
  type Pagination,
  type SqlHooks,
  type TextMatchMode,
} from './hooks';
export {
  jsonMariadb,
  jsonMssql,
  jsonMysql,
  jsonOracle,
  jsonPostgres,
  jsonSqlite,
  pagedSelect,
  ORDER_KEY,
  type JsonChild,
  type JsonEntry,
  type JsonFlavor,
} from './json';
export {
  bytesToHex,
  codec,
  decodeValue,
  defaultCodec,
  defaultDecode,
  defaultEncode,
  encodeValue,
  formatDateOnly,
  formatNaiveUtc,
  hexToBytes,
  parseDateTime,
  type Codec,
  type CodecOptions,
} from './values';
export { SqlCompiler, type LevelPlan, type Scope } from './compile';
export { compileSql, compilerFor, executeSql } from './execute';
export { splitSqlScript, type SplitOptions } from './script';
export {
  MIGRATIONS_TABLE,
  compileOnlyDialect,
  createSqlDialect,
  sqlMigrationTable,
  type SqlDialectOptions,
  type SqlMigrationTableOptions,
} from './dialect';
