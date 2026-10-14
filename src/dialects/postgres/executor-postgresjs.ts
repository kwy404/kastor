import type { ExecResult, Executor } from '../../core/ir';
import { beginStatement } from './lock';
import { JsonParam, normalizeRows, type FieldLike } from './values';

/** The rows array `postgres` resolves to, with its extra properties. */
export interface PostgresJsResultLike extends ReadonlyArray<Record<string, unknown>> {
  count?: number | null;
  columns?: readonly FieldLike[];
}

/** The part of a `postgres` (postgres.js) `sql` instance kastor uses. */
export interface PostgresJsLike {
  unsafe(query: string, params?: unknown[], options?: { prepare?: boolean }): PromiseLike<PostgresJsResultLike>;
  begin<T>(fn: (tx: PostgresJsTxLike) => T | Promise<T>): Promise<T>;
  begin<T>(options: string, fn: (tx: PostgresJsTxLike) => T | Promise<T>): Promise<T>;
  json?(value: unknown): unknown;
  end?(options?: { timeout?: number }): Promise<void>;
}

/** A transaction scoped `sql` from `sql.begin()`. */
export interface PostgresJsTxLike {
  unsafe(query: string, params?: unknown[], options?: { prepare?: boolean }): PromiseLike<PostgresJsResultLike>;
  savepoint<T>(fn: (tx: PostgresJsTxLike) => T | Promise<T>): Promise<T>;
  json?(value: unknown): unknown;
}

function toParams(sql: Pick<PostgresJsLike, 'json'>, params: unknown[]): unknown[] {
  return params.map((value) => {
    if (value instanceof JsonParam) {
      // postgres.js serializes json parameters itself; hand it the parsed value.
      const parsed: unknown = JSON.parse(value.text);
      return typeof sql.json === 'function' ? sql.json(parsed) : parsed;
    }
    if (typeof value === 'bigint') return value.toString();
    return value;
  });
}

async function run(sql: PostgresJsLike | PostgresJsTxLike, text: string, params: unknown[]): Promise<ExecResult> {
  const result = await sql.unsafe(text, toParams(sql, params));
  const rows = normalizeRows(Array.from(result), result.columns, true);
  return { rows, rowsAffected: typeof result.count === 'number' ? result.count : undefined };
}

function txExecutor(tx: PostgresJsTxLike): Executor {
  return {
    inTransaction: true,
    query: (text, params) => run(tx, text, params),
    transaction: (fn) => tx.savepoint((inner) => fn(txExecutor(inner))),
  };
}

/**
 * Wraps a `postgres` (postgres.js) instance. Transactions use `sql.begin()`,
 * which reserves one connection for the callback.
 */
export function postgresJsExecutor(sql: PostgresJsLike): Executor {
  return {
    query: (text, params) => run(sql, text, params),
    transaction(fn, options) {
      const begin = beginStatement(options?.isolationLevel);
      // `sql.begin('isolation level serializable', fn)` takes the text after BEGIN.
      const mode = begin === 'BEGIN' ? undefined : begin.slice('BEGIN '.length).toLowerCase();
      const body = (tx: PostgresJsTxLike) => fn(txExecutor(tx));
      return mode ? sql.begin(mode, body) : sql.begin(body);
    },
    async close() {
      await sql.end?.({ timeout: 5 });
    },
  };
}
