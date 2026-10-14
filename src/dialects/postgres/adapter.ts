import { errors } from '../../core/errors';
import type { Adapter, Dialect, Executor } from '../../core/ir';
import { pgExecutor, type PgDriver } from './executor-pg';
import { postgresJsExecutor, type PostgresJsLike } from './executor-postgresjs';

/** True for a postgres.js `sql` instance (a function with `unsafe` and `begin`). */
export function isPostgresJs(driver: unknown): driver is PostgresJsLike {
  if (typeof driver !== 'function') return false;
  const d = driver as unknown as Partial<PostgresJsLike>;
  return typeof d.unsafe === 'function' && typeof d.begin === 'function';
}

function isPg(driver: unknown): driver is PgDriver {
  return !!driver && typeof driver === 'object' && typeof (driver as { query?: unknown }).query === 'function';
}

/** Picks the executor for a `pg` Pool/Client or a postgres.js instance. */
export function pgFamilyExecutor(driver: unknown, adapter: string): Executor {
  if (isPostgresJs(driver)) return postgresJsExecutor(driver);
  if (isPg(driver)) return pgExecutor(driver);
  throw errors.invalidArgument(
    `${adapter}() did not receive a supported Postgres driver.`,
    `Pass a pg Pool or Client (new pg.Pool({ connectionString })) or a postgres.js instance (postgres(url)).`,
  );
}

export function makeAdapter(dialect: Dialect, executor: Executor): Adapter {
  return { dialect, executor };
}
