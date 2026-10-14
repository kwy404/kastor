import type { ExecResult, Executor } from '../../core/ir';
import { Lock, nextSavepoint } from '../postgres/lock';

/**
 * The common shape of the synchronous SQLite drivers (better-sqlite3,
 * node:sqlite, bun:sqlite) after a thin per driver wrapper.
 */
export interface SyncSqliteConnection {
  /** Runs one statement. Statements that return rows resolve `rows`. */
  execute(sql: string, params: unknown[]): ExecResult;
  close?(): void;
}

const hasBuffer = typeof Buffer !== 'undefined';

/** Converts parameters to values every SQLite driver binds. */
export function toSqliteParams(params: unknown[], buffers: boolean): unknown[] {
  return params.map((value) => {
    if (value === undefined) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (value instanceof Date) return value.toISOString();
    if (buffers && value instanceof Uint8Array && hasBuffer && !Buffer.isBuffer(value)) {
      return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    }
    if (value !== null && typeof value === 'object' && !(value instanceof Uint8Array)) return JSON.stringify(value);
    return value;
  });
}

/** Turns `bigint` values that fit a JS number back into numbers. */
export function smallInt(value: unknown): unknown {
  if (typeof value === 'bigint' && value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)) {
    return Number(value);
  }
  return value;
}

/** Applies {@link smallInt} to every column, in place. Drivers run with safe integers so nothing is rounded. */
export function normalizeIntegers(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      const value = row[key];
      if (typeof value === 'bigint') row[key] = smallInt(value);
    }
  }
  return rows;
}

/** Statements that return rows even though they do not start with SELECT. */
const readerRe = /^\s*(?:select|with|pragma|values|explain)\b|\breturning\b/i;

/** Fallback guess for drivers that cannot say whether a statement returns rows. */
export function looksLikeReader(sql: string): boolean {
  return readerRe.test(sql);
}

/** Small bounded statement cache: preparing is the slow part of a SQLite query. */
export class StatementCache<S> {
  private readonly map = new Map<string, S>();
  constructor(private readonly limit = 200) {}

  get(sql: string, prepare: (sql: string) => S): S {
    const hit = this.map.get(sql);
    if (hit !== undefined) {
      this.map.delete(sql);
      this.map.set(sql, hit);
      return hit;
    }
    const statement = prepare(sql);
    if (/^\s*(?:select|insert|update|delete|with|replace)\b/i.test(sql)) {
      this.map.set(sql, statement);
      if (this.map.size > this.limit) {
        const oldest = this.map.keys().next().value as string;
        this.map.delete(oldest);
      }
    }
    return statement;
  }

  clear(): void {
    this.map.clear();
  }
}

/**
 * Builds an async Executor over a synchronous connection. A transaction holds
 * the lock from BEGIN to COMMIT, so statements from outside it wait instead of
 * joining it by accident.
 */
export function syncExecutor(conn: SyncSqliteConnection): Executor {
  const lock = new Lock();
  const exec = (sql: string, params: unknown[]) => conn.execute(sql, params);

  const txExecutor: Executor = {
    inTransaction: true,
    query: async (sql, params) => exec(sql, params),
    async transaction(fn) {
      const name = nextSavepoint();
      exec(`SAVEPOINT ${name}`, []);
      try {
        const value = await fn(txExecutor);
        exec(`RELEASE ${name}`, []);
        return value;
      } catch (error) {
        try {
          exec(`ROLLBACK TO ${name}`, []);
          exec(`RELEASE ${name}`, []);
        } catch {
          // the outer rollback cleans up
        }
        throw error;
      }
    },
  };

  return {
    query: (sql, params) => lock.run(() => exec(sql, params)),
    transaction: (fn) =>
      lock.run(async () => {
        exec('BEGIN IMMEDIATE', []);
        let value;
        try {
          value = await fn(txExecutor);
        } catch (error) {
          rollback(exec);
          throw error;
        }
        try {
          exec('COMMIT', []);
        } catch (error) {
          rollback(exec);
          throw error;
        }
        return value;
      }),
    async close() {
      await lock.run(() => conn.close?.());
    },
  };
}

function rollback(exec: (sql: string, params: unknown[]) => ExecResult): void {
  try {
    exec('ROLLBACK', []);
  } catch {
    // SQLite already rolled back (for example after SQLITE_FULL)
  }
}
