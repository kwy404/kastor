import { KastorError } from '../../core/errors';
import type { ExecResult, Executor } from '../../core/ir';
import { smallInt, toSqliteParams } from './executor-sync';

/** The part of a Cloudflare D1 result kastor reads. */
export interface D1ResultLike {
  results?: Record<string, unknown>[];
  success?: boolean;
  meta?: { changes?: number; last_row_id?: number | bigint; rows_written?: number };
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  all(): Promise<D1ResultLike>;
  run?(): Promise<D1ResultLike>;
}

/** A D1 binding (`env.DB`) as passed to a Worker. */
export interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatementLike;
  batch(statements: D1PreparedStatementLike[]): Promise<D1ResultLike[]>;
}

export interface D1Options {
  /**
   * What `$transaction(async (tx) => ...)` does. D1 has no interactive
   * transactions (no BEGIN, no SAVEPOINT over the binding), only atomic
   * batches.
   * - `'error'` (default): callback transactions throw `UNSUPPORTED` with a
   *   hint. Use `$transaction([q1, q2])`, which runs as one atomic D1 batch.
   * - `'sequential'`: run the callback statement by statement WITHOUT
   *   atomicity. Only for code that tolerates partial writes, for example
   *   nested creates you are happy to clean up by hand.
   */
  transactions?: 'error' | 'sequential';
}

/** A statement for {@link D1Executor.batch}. */
export interface BatchStatement {
  sql: string;
  params: unknown[];
}

/** The D1 executor adds `batch`, which runs statements atomically in one round trip. */
export interface D1Executor extends Executor {
  batch(statements: BatchStatement[]): Promise<ExecResult[]>;
}

/** D1 binds numbers, strings, null and ArrayBuffers; 64 bit values that do not fit a double go as text. */
function toD1Params(params: unknown[]): unknown[] {
  return toSqliteParams(params, false).map((value) => {
    if (typeof value === 'bigint') {
      const small = smallInt(value);
      return typeof small === 'bigint' ? small.toString() : small;
    }
    if (value instanceof Uint8Array) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    return value;
  });
}

function toBytes(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      const value = row[key];
      if (value instanceof ArrayBuffer) row[key] = new Uint8Array(value);
    }
  }
  return rows;
}

function toResult(result: D1ResultLike): ExecResult {
  const meta = result.meta ?? {};
  return {
    rows: toBytes(result.results ?? []),
    rowsAffected: typeof meta.changes === 'number' ? meta.changes : undefined,
    insertId: meta.last_row_id === undefined ? undefined : smallInt(meta.last_row_id),
  };
}

function prepare(db: D1DatabaseLike, sql: string, params: unknown[]): D1PreparedStatementLike {
  const statement = db.prepare(sql);
  return params.length > 0 ? statement.bind(...toD1Params(params)) : statement;
}

export function d1Executor(db: D1DatabaseLike, options: D1Options = {}): D1Executor {
  const mode = options.transactions ?? 'error';
  const query = async (sql: string, params: unknown[]) => toResult(await prepare(db, sql, params).all());
  const batch = async (statements: BatchStatement[]) => {
    if (statements.length === 0) return [];
    const results = await db.batch(statements.map((s) => prepare(db, s.sql, s.params)));
    return results.map(toResult);
  };
  const executor: D1Executor = {
    query,
    batch,
    async transaction(fn) {
      if (mode === 'sequential') {
        const tx: D1Executor = { query, batch, inTransaction: true, transaction: (inner) => inner(tx) };
        return fn(tx);
      }
      throw new KastorError('UNSUPPORTED', 'Cloudflare D1 does not support interactive transactions.', {
        hint:
          'Pass an array to $transaction([q1, q2]) to run the queries as one atomic D1 batch, or create the adapter with ' +
          "d1(env.DB, { transactions: 'sequential' }) to run callbacks without atomicity.",
        meta: { dialect: 'sqlite', driver: 'd1' },
      });
    },
  };
  return executor;
}
