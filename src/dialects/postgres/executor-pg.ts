import type { ExecResult, Executor, TransactionOptions } from '../../core/ir';
import { Lock, beginStatement, nextSavepoint } from './lock';
import { normalizeRows, toDriverParams } from './values';

/** The part of a `pg` result kastor reads. */
export interface PgResultLike {
  rows: Record<string, unknown>[];
  rowCount: number | null;
  fields?: { name: string; dataTypeID: number }[];
}

/** Anything with `pg` style `query(text, values)`: a `Pool`, a `Client` or a pooled client. */
export interface PgQueryable {
  query(text: string, values?: unknown[]): Promise<PgResultLike>;
}

/** A pooled client, as handed out by `pool.connect()`. */
export interface PgPoolClientLike extends PgQueryable {
  release(error?: Error | boolean): void;
}

/** A `pg.Pool` (also `@neondatabase/serverless` Pool, `@vercel/postgres` pools, Supabase). */
export interface PgPoolLike extends PgQueryable {
  connect(): Promise<PgPoolClientLike>;
  end?(): Promise<void>;
  totalCount?: number;
  idleCount?: number;
}

/** A single `pg.Client` connection. */
export interface PgClientLike extends PgQueryable {
  end?(): Promise<void>;
}

export type PgDriver = PgPoolLike | PgClientLike;

/**
 * True for pools. Pools expose connection counters; a plain `Client` has a
 * `connect()` too, but it resolves to nothing instead of a pooled client.
 */
export function isPgPool(driver: PgDriver): driver is PgPoolLike {
  const d = driver as Partial<PgPoolLike>;
  return typeof d.connect === 'function' && (typeof d.totalCount === 'number' || typeof d.idleCount === 'number');
}

async function run(conn: PgQueryable, sql: string, params: unknown[]): Promise<ExecResult> {
  const result = await conn.query(sql, toDriverParams(params));
  // A multi statement string (only from raw SQL) resolves to an array of results.
  const last = (Array.isArray(result) ? result[result.length - 1] : result) as PgResultLike | undefined;
  if (!last) return { rows: [] };
  const rows = normalizeRows(last.rows ?? [], last.fields);
  return { rows, rowsAffected: last.rowCount ?? undefined };
}

/** An executor bound to one connection inside a transaction. */
function connectionExecutor(conn: PgQueryable): Executor {
  const tx: Executor = {
    inTransaction: true,
    query: (sql, params) => run(conn, sql, params),
    transaction: <T>(fn: (inner: Executor) => Promise<T>) => savepoint(conn, tx, fn),
  };
  return tx;
}

/** Nested transaction on an open one: a savepoint. */
async function savepoint<T>(conn: PgQueryable, tx: Executor, fn: (tx: Executor) => Promise<T>): Promise<T> {
  const name = nextSavepoint();
  await conn.query(`SAVEPOINT ${name}`);
  try {
    const value = await fn(tx);
    await conn.query(`RELEASE SAVEPOINT ${name}`);
    return value;
  } catch (error) {
    await conn.query(`ROLLBACK TO SAVEPOINT ${name}`).catch(() => undefined);
    throw error;
  }
}

async function inTransaction<T>(conn: PgQueryable, fn: (tx: Executor) => Promise<T>, options?: TransactionOptions): Promise<T> {
  await conn.query(beginStatement(options?.isolationLevel));
  let value: T;
  try {
    value = await fn(connectionExecutor(conn));
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
  try {
    await conn.query('COMMIT');
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
  return value;
}

/**
 * Wraps a `pg` Pool or Client. With a pool every transaction checks out its own
 * connection; with a single client, statements are queued behind an open
 * transaction so they never leak into it.
 */
export function pgExecutor(driver: PgDriver): Executor {
  if (isPgPool(driver)) {
    const pool = driver;
    return {
      query: (sql, params) => run(pool, sql, params),
      async transaction(fn, options) {
        const client = await pool.connect();
        let broken: Error | undefined;
        try {
          return await inTransaction(client, fn, options);
        } catch (error) {
          // A connection error leaves the client unusable: tell the pool to drop it.
          if (isConnectionError(error)) broken = error as Error;
          throw error;
        } finally {
          client.release(broken);
        }
      },
      async close() {
        await pool.end?.();
      },
    };
  }
  const client = driver;
  const lock = new Lock();
  return {
    query: (sql, params) => lock.run(() => run(client, sql, params)),
    transaction: (fn, options) => lock.run(() => inTransaction(client, fn, options)),
    async close() {
      await (client as PgClientLike).end?.();
    },
  };
}

function isConnectionError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && (code.startsWith('08') || code === 'ECONNRESET' || code === 'EPIPE' || code === 'ECONNREFUSED');
}
