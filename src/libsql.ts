/**
 * kastor/libsql: libSQL and Turso through `@libsql/client` (local files,
 * embedded replicas and remote databases).
 *
 * ```ts
 * import { createClient } from '@libsql/client'
 * import { libsql } from 'kastor/libsql'
 * const db = kastor({ adapter: libsql(createClient({ url: process.env.TURSO_URL, authToken })), schema })
 * ```
 */
import type { Adapter } from './core/ir';
import { sqliteDialect } from './dialects/sqlite/dialect';
import { libsqlExecutor, type LibsqlClientLike } from './dialects/sqlite/executor-libsql';

/** Adapter for an `@libsql/client` Client. */
export function libsql(client: LibsqlClientLike): Adapter {
  return { dialect: sqliteDialect, executor: libsqlExecutor(client) };
}

export { sqliteDialect as libsqlDialect } from './dialects/sqlite/dialect';
export { libsqlExecutor } from './dialects/sqlite/executor-libsql';
export type { LibsqlClientLike, LibsqlResultLike, LibsqlStatementLike, LibsqlTransactionLike, LibsqlValue } from './dialects/sqlite/executor-libsql';
