/**
 * kastor/mysql: MySQL 8 through mysql2 (also PlanetScale and other MySQL
 * compatible servers). The mariadb package works too.
 *
 * ```ts
 * import mysql2 from 'mysql2/promise'
 * import { mysql } from 'kastor/mysql'
 * const db = kastor({ adapter: mysql(mysql2.createPool(process.env.DATABASE_URL)), schema })
 * ```
 */
import type { Adapter } from './core/ir';
import { mysqlDialect } from './dialects/mysql/dialect';
import { mysqlExecutor, type MysqlCallbackLike, type MysqlPoolLike } from './dialects/mysql/executor';

/** Adapter for a mysql2 pool or connection (promise or callback API) or a mariadb pool. */
export function mysql(pool: MysqlPoolLike | MysqlCallbackLike): Adapter {
  return { dialect: mysqlDialect, executor: mysqlExecutor(pool) };
}

export { mysqlDialect } from './dialects/mysql/dialect';
export { mysqlHooks } from './dialects/mysql/hooks';
export { mysqlExecutor } from './dialects/mysql/executor';
export { mapMysqlError } from './dialects/mysql/errors';
export type { MysqlCallbackLike, MysqlConnectionLike, MysqlPoolLike, MysqlQueryable } from './dialects/mysql/executor';
