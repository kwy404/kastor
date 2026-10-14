/**
 * kastor/mariadb: MariaDB through the mariadb package or mysql2.
 *
 * ```ts
 * import * as mariadbDriver from 'mariadb'
 * import { mariadb } from 'kastor/mariadb'
 * const db = kastor({ adapter: mariadb(mariadbDriver.createPool(process.env.DATABASE_URL)), schema })
 * ```
 */
import type { Adapter } from './core/ir';
import { mariadbDialect } from './dialects/mariadb';
import { mysqlExecutor, type MysqlCallbackLike, type MysqlPoolLike } from './dialects/mysql/executor';

/** Adapter for a mariadb pool or connection, or a mysql2 pool connected to MariaDB. */
export function mariadb(pool: MysqlPoolLike | MysqlCallbackLike): Adapter {
  return { dialect: mariadbDialect, executor: mysqlExecutor(pool) };
}

export { mariadbDialect, mariadbHooks } from './dialects/mariadb';
export { mysqlExecutor as mariadbExecutor } from './dialects/mysql/executor';
export type { MysqlCallbackLike, MysqlConnectionLike, MysqlPoolLike, MysqlQueryable } from './dialects/mysql/executor';
