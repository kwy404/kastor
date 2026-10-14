/**
 * kastor-orm/cockroach: CockroachDB through the `pg` package or postgres.js.
 *
 * ```ts
 * import pg from 'pg'
 * import { cockroach } from 'kastor-orm/cockroach'
 * const db = kastor({ adapter: cockroach(new pg.Pool({ connectionString })), schema })
 * ```
 */
import type { Adapter } from './core/ir';
import { pgFamilyExecutor } from './dialects/postgres/adapter';
import { cockroachDialect } from './dialects/postgres/dialect';
import type { PgDriver } from './dialects/postgres/executor-pg';
import type { PostgresJsLike } from './dialects/postgres/executor-postgresjs';

/** Adapter for a `pg` Pool or Client (or a postgres.js instance) connected to CockroachDB. */
export function cockroach(driver: PgDriver | PostgresJsLike): Adapter {
  return { dialect: cockroachDialect, executor: pgFamilyExecutor(driver, 'cockroach') };
}

export { cockroachDialect, cockroachHooks } from './dialects/postgres/dialect';
