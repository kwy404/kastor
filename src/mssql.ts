/**
 * kastor/mssql: SQL Server and Azure SQL through the mssql package (tedious).
 *
 * ```ts
 * import sql from 'mssql'
 * import { mssql } from 'kastor/mssql'
 * const db = kastor({ adapter: mssql(new sql.ConnectionPool(process.env.DATABASE_URL)), schema })
 * ```
 */
import type { Adapter } from './core/ir';
import { mssqlDialect } from './dialects/mssql/dialect';
import { mssqlExecutor, type MssqlPoolLike } from './dialects/mssql/executor';

/** Adapter for an mssql ConnectionPool. It connects on first use when needed. */
export function mssql(pool: MssqlPoolLike): Adapter {
  return { dialect: mssqlDialect, executor: mssqlExecutor(pool) };
}

export { mssqlDialect } from './dialects/mssql/dialect';
export { mssqlHooks } from './dialects/mssql/hooks';
export { mssqlExecutor, MssqlTypedParam } from './dialects/mssql/executor';
export { mapMssqlError } from './dialects/mssql/errors';
export type { MssqlPoolLike, MssqlRequestLike, MssqlTransactionLike } from './dialects/mssql/executor';
