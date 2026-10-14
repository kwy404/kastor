import { errors } from '../../core/errors';
import type { ExecResult } from '../../core/ir';
import { StatementCache, looksLikeReader, normalizeIntegers, smallInt, toSqliteParams, type SyncSqliteConnection } from './executor-sync';

/* better-sqlite3 ----------------------------------------------------------- */

export interface BetterSqliteStatementLike {
  reader: boolean;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  safeIntegers(toggle?: boolean): unknown;
}

export interface BetterSqliteLike {
  prepare(sql: string): BetterSqliteStatementLike;
  pragma(source: string, options?: { simple?: boolean }): unknown;
  close(): unknown;
  open?: boolean;
}

/* node:sqlite -------------------------------------------------------------- */

export interface NodeSqliteStatementLike {
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  columns?(): unknown[];
  setReadBigInts?(enabled: boolean): void;
}

export interface NodeSqliteLike {
  prepare(sql: string): NodeSqliteStatementLike;
  exec(sql: string): void;
  close(): void;
}

/* bun:sqlite --------------------------------------------------------------- */

export interface BunSqliteStatementLike {
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } | undefined;
  columnNames?: string[];
  safeIntegers?(toggle?: boolean): unknown;
}

export interface BunSqliteLike {
  query(sql: string): BunSqliteStatementLike;
  prepare(sql: string): BunSqliteStatementLike;
  close(throwOnError?: boolean): void;
}

export type SyncSqliteDriver = BetterSqliteLike | NodeSqliteLike | BunSqliteLike;

export type SyncSqliteKind = 'better-sqlite3' | 'node:sqlite' | 'bun:sqlite';

/** Tells the three synchronous drivers apart by the methods only each one has. */
export function detectSyncDriver(db: unknown): SyncSqliteKind | null {
  if (!db || typeof db !== 'object') return null;
  const d = db as Record<string, unknown>;
  if (typeof d.prepare !== 'function') return null;
  if (typeof d.pragma === 'function') return 'better-sqlite3';
  if (typeof d.query === 'function' && typeof d.run === 'function') return 'bun:sqlite';
  if (typeof d.exec === 'function') return 'node:sqlite';
  return null;
}

const rowsOf = (rows: unknown[]) => normalizeIntegers(rows as Record<string, unknown>[]);

export function betterSqliteConnection(db: BetterSqliteLike): SyncSqliteConnection {
  const cache = new StatementCache<BetterSqliteStatementLike>();
  const prepare = (sql: string) => {
    const statement = db.prepare(sql);
    // Read integers exactly; small ones become numbers again in normalizeIntegers.
    if (statement.reader) statement.safeIntegers(true);
    return statement;
  };
  return {
    execute(sql, params): ExecResult {
      const statement = cache.get(sql, prepare);
      const values = toSqliteParams(params, true);
      if (statement.reader) return { rows: rowsOf(statement.all(...values)) };
      const info = statement.run(...values);
      return { rows: [], rowsAffected: Number(info.changes), insertId: smallInt(info.lastInsertRowid) };
    },
    close() {
      cache.clear();
      db.close();
    },
  };
}

export function nodeSqliteConnection(db: NodeSqliteLike): SyncSqliteConnection {
  const cache = new StatementCache<{ statement: NodeSqliteStatementLike; reader: boolean }>();
  const prepare = (sql: string) => {
    const statement = db.prepare(sql);
    // `columns()` (Node 22.16+) is empty for statements without a result set.
    const reader = typeof statement.columns === 'function' ? statement.columns().length > 0 : looksLikeReader(sql);
    statement.setReadBigInts?.(true);
    return { statement, reader };
  };
  return {
    execute(sql, params): ExecResult {
      const { statement, reader } = cache.get(sql, prepare);
      const values = toSqliteParams(params, false);
      if (reader) return { rows: rowsOf(statement.all(...values).map((row) => ({ ...(row as object) }))) };
      const info = statement.run(...values);
      return { rows: [], rowsAffected: Number(info.changes), insertId: smallInt(info.lastInsertRowid) };
    },
    close() {
      cache.clear();
      db.close();
    },
  };
}

export function bunSqliteConnection(db: BunSqliteLike): SyncSqliteConnection {
  const prepare = (sql: string) => {
    // `query()` caches the prepared statement inside bun:sqlite.
    const statement = db.query(sql);
    statement.safeIntegers?.(true);
    return statement;
  };
  return {
    execute(sql, params): ExecResult {
      const statement = prepare(sql);
      const values = toSqliteParams(params, false);
      const reader = Array.isArray(statement.columnNames) ? statement.columnNames.length > 0 : looksLikeReader(sql);
      if (reader) return { rows: rowsOf(statement.all(...values)) };
      const info = statement.run(...values);
      if (!info) return { rows: [] };
      return { rows: [], rowsAffected: Number(info.changes), insertId: smallInt(info.lastInsertRowid) };
    },
    close() {
      db.close();
    },
  };
}

export function syncConnection(db: SyncSqliteDriver): SyncSqliteConnection {
  switch (detectSyncDriver(db)) {
    case 'better-sqlite3':
      return betterSqliteConnection(db as BetterSqliteLike);
    case 'bun:sqlite':
      return bunSqliteConnection(db as BunSqliteLike);
    case 'node:sqlite':
      return nodeSqliteConnection(db as NodeSqliteLike);
    default:
      throw errors.invalidArgument(
        'sqlite() did not receive a supported SQLite driver.',
        'Pass a better-sqlite3 Database, a node:sqlite DatabaseSync or a bun:sqlite Database. Use libsql() for @libsql/client and d1() for Cloudflare D1.',
      );
  }
}
