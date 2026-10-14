/**
 * Browser build (`dist/kastor.browser.js` and the `Kastor` global in
 * `dist/kastor.js`): the whole core plus the shared SQL base, so a page can
 * build queries and compile them to SQL with `compileOnlyDialect(name, hooks)`
 * and `query.toSQL()`. No Node imports.
 */
export * from '../index';
export {
  ansiHooks,
  codec,
  compileOnlyDialect,
  createSqlDialect,
  defineHooks,
  jsonMariadb,
  jsonMssql,
  jsonMysql,
  jsonOracle,
  jsonPostgres,
  jsonSqlite,
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
  splitSqlScript,
} from './sql';
export type { SqlHooks, JsonFlavor, CodecOptions } from './sql';
