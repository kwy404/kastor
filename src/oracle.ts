/**
 * kastor/oracle: Oracle Database through node-oracledb in thin mode (no
 * Instant Client needed).
 *
 * ```ts
 * import oracledb from 'oracledb'
 * import { oracle } from 'kastor/oracle'
 * const pool = await oracledb.createPool({ user, password, connectString: 'localhost:1521/FREEPDB1' })
 * const db = kastor({ adapter: oracle(pool), schema })
 * ```
 */
import type { Adapter } from './core/ir';
import { oracleDialect } from './dialects/oracle/dialect';
import { oracleExecutor, type OracleConnectionLike, type OraclePoolLike } from './dialects/oracle/executor';

/** Adapter for an oracledb pool, or a single connection. */
export function oracle(pool: OraclePoolLike | OracleConnectionLike): Adapter {
  return { dialect: oracleDialect, executor: oracleExecutor(pool) };
}

export { oracleDialect } from './dialects/oracle/dialect';
export { oracleHooks } from './dialects/oracle/hooks';
export { oracleExecutor, OracleOutBind } from './dialects/oracle/executor';
export { mapOracleError } from './dialects/oracle/errors';
export type { OracleConnectionLike, OraclePoolLike } from './dialects/oracle/executor';
