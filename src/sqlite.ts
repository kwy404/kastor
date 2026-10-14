/**
 * kastor/sqlite: SQLite through better-sqlite3, node:sqlite (`DatabaseSync`)
 * or bun:sqlite. The driver is detected from the object you pass.
 *
 * ```ts
 * import Database from 'better-sqlite3'
 * import { sqlite } from 'kastor/sqlite'
 * const db = kastor({ adapter: sqlite(new Database('app.db')), schema })
 * ```
 */
import type { Adapter } from './core/ir';
import { sqliteDialect } from './dialects/sqlite/dialect';
import { syncConnection, type SyncSqliteDriver } from './dialects/sqlite/drivers';
import { syncExecutor } from './dialects/sqlite/executor-sync';

export interface SqliteOptions {
  /**
   * Turn on foreign key enforcement (`PRAGMA foreign_keys = ON`), which SQLite
   * leaves off by default. Default `true`.
   */
  foreignKeys?: boolean;
}

/** Adapter for a better-sqlite3 Database, a node:sqlite DatabaseSync or a bun:sqlite Database. */
export function sqlite(db: SyncSqliteDriver, options: SqliteOptions = {}): Adapter {
  const connection = syncConnection(db);
  if (options.foreignKeys !== false) connection.execute('PRAGMA foreign_keys = ON', []);
  return { dialect: sqliteDialect, executor: syncExecutor(connection) };
}

export { sqliteDialect, sqliteHooks } from './dialects/sqlite/dialect';
export { detectSyncDriver, syncConnection } from './dialects/sqlite/drivers';
export { syncExecutor } from './dialects/sqlite/executor-sync';
export { needsForeignKeysOff } from './dialects/sqlite/ddl';
export type {
  BetterSqliteLike,
  BunSqliteLike,
  NodeSqliteLike,
  SyncSqliteDriver,
  SyncSqliteKind,
} from './dialects/sqlite/drivers';
export type { SyncSqliteConnection } from './dialects/sqlite/executor-sync';
