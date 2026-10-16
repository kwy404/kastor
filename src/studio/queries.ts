/**
 * The studio query log: every statement the studio sends to the database,
 * with its parameters, timing and the action that caused it, so the SQL that
 * kastor generates is never hidden.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Adapter, Executor } from '../core/ir';

export interface QueryEntry {
  id: number;
  /** ISO time the statement finished. */
  at: string;
  /** What the studio was doing, for example "Browse users". */
  action: string;
  sql: string;
  params: unknown[];
  durationMs: number;
  error?: string;
}

/** Longest string parameter kept in the log; longer ones are cut. */
export const MAX_PARAM_LENGTH = 200;
/** Parameters kept per statement; the rest are summarized. */
export const MAX_PARAMS = 50;
/** Longest SQL text kept in the log. */
export const MAX_SQL_LENGTH = 20_000;

/** A readable, JSON safe copy of one parameter. */
export function logParam(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (value instanceof Uint8Array) return `<${value.length} bytes>`;
  if (typeof value === 'string') return value.length > MAX_PARAM_LENGTH ? `${value.slice(0, MAX_PARAM_LENGTH)}... (${value.length} chars)` : value;
  if (typeof value === 'object') {
    let text: string;
    try {
      text = JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)) ?? String(value);
    } catch {
      text = String(value);
    }
    return text.length > MAX_PARAM_LENGTH ? `${text.slice(0, MAX_PARAM_LENGTH)}... (${text.length} chars)` : text;
  }
  return value;
}

function logParams(params: unknown[] | undefined): unknown[] {
  const list = Array.isArray(params) ? params : [];
  const kept = list.slice(0, MAX_PARAMS).map(logParam);
  if (list.length > MAX_PARAMS) kept.push(`... ${list.length - MAX_PARAMS} more`);
  return kept;
}

interface Scope {
  action: string;
  seen: QueryEntry[];
}

/** A ring buffer of recent statements, newest last. */
export class QueryLog {
  private entries: QueryEntry[] = [];
  private nextId = 1;
  private readonly scope = new AsyncLocalStorage<Scope>();
  private readonly wrapped = new WeakMap<object, Executor>();

  constructor(readonly limit = 200) {}

  /** Runs `fn` and labels every statement it sends with `action`; also returns those statements. */
  async run<T>(action: string, fn: () => Promise<T>): Promise<{ result: T; queries: QueryEntry[] }> {
    const scope: Scope = { action, seen: [] };
    const result = await this.scope.run(scope, fn);
    return { result, queries: scope.seen };
  }

  record(sql: string, params: unknown[] | undefined, durationMs: number, error?: unknown): QueryEntry {
    const scope = this.scope.getStore();
    const entry: QueryEntry = {
      id: this.nextId++,
      at: new Date().toISOString(),
      action: scope?.action ?? 'Other',
      sql: sql.length > MAX_SQL_LENGTH ? `${sql.slice(0, MAX_SQL_LENGTH)}\n-- cut at ${MAX_SQL_LENGTH} characters` : sql,
      params: logParams(params),
      durationMs,
    };
    if (error !== undefined) entry.error = error instanceof Error ? error.message : String(error);
    this.entries.push(entry);
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
    scope?.seen.push(entry);
    return entry;
  }

  /** Newest first. `after` keeps only entries with a larger id. */
  list(after = 0): QueryEntry[] {
    return this.entries.filter((e) => e.id > after).reverse();
  }

  clear(): void {
    this.entries = [];
  }

  get size(): number {
    return this.entries.length;
  }

  /** The executor with every `query` call recorded, transactions included. */
  executor<E extends object>(exec: E): E {
    const known = this.wrapped.get(exec);
    if (known) return known as unknown as E;
    const base = exec as unknown as Executor;
    if (typeof base.query !== 'function') return exec;
    const wrapped = Object.create(exec) as Executor;
    wrapped.query = async (sql, params) => {
      const start = Date.now();
      try {
        const result = await base.query(sql, params);
        this.record(sql, params, Date.now() - start);
        return result;
      } catch (error) {
        this.record(sql, params, Date.now() - start, error);
        throw error;
      }
    };
    if (typeof base.transaction === 'function') {
      wrapped.transaction = (fn, options) => base.transaction((tx) => fn(this.executor(tx)), options);
    }
    this.wrapped.set(exec, wrapped);
    return wrapped as unknown as E;
  }

  /** The adapter with its executor recorded. */
  adapter(adapter: Adapter): Adapter {
    return { ...adapter, executor: this.executor(adapter.executor as object) as Adapter['executor'] };
  }
}
