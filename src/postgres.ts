/**
 * kastor/postgres: PostgreSQL through the `pg` package (also Neon, Supabase,
 * Vercel Postgres and any other pg compatible pool) or through postgres.js.
 *
 * ```ts
 * import pg from 'pg'
 * import { postgres } from 'kastor/postgres'
 * const db = kastor({ adapter: postgres(new pg.Pool({ connectionString })), schema })
 * ```
 */
import type { Adapter } from './core/ir';
import { pgFamilyExecutor } from './dialects/postgres/adapter';
import { postgresDialect } from './dialects/postgres/dialect';
import type { PgDriver } from './dialects/postgres/executor-pg';
import { postgresJsExecutor, type PostgresJsLike } from './dialects/postgres/executor-postgresjs';

/** Adapter for a `pg` Pool or Client. A postgres.js instance works here too. */
export function postgres(driver: PgDriver | PostgresJsLike): Adapter {
  return { dialect: postgresDialect, executor: pgFamilyExecutor(driver, 'postgres') };
}

/** Adapter for a postgres.js (`postgres` package) instance. */
export function postgresJs(sql: PostgresJsLike): Adapter {
  return { dialect: postgresDialect, executor: postgresJsExecutor(sql) };
}

export { postgresDialect, postgresHooks } from './dialects/postgres/dialect';
export { pgExecutor } from './dialects/postgres/executor-pg';
export { postgresJsExecutor } from './dialects/postgres/executor-postgresjs';
export type { PgClientLike, PgDriver, PgPoolClientLike, PgPoolLike, PgQueryable } from './dialects/postgres/executor-pg';
export type { PostgresJsLike, PostgresJsTxLike } from './dialects/postgres/executor-postgresjs';
