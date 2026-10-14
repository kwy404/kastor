/**
 * kastor-orm/d1: Cloudflare D1 from a Worker binding.
 *
 * ```ts
 * import { d1 } from 'kastor-orm/d1'
 * export default {
 *   async fetch(request, env) {
 *     const db = kastor({ adapter: d1(env.DB), schema })
 *   },
 * }
 * ```
 *
 * D1 has no interactive transactions. `$transaction([q1, q2])` runs as one
 * atomic batch; callback transactions throw unless you opt into
 * `{ transactions: 'sequential' }` (no atomicity). See `D1Options`.
 */
import type { Adapter } from './core/ir';
import { d1Dialect } from './dialects/sqlite/dialect';
import { d1Executor, type D1DatabaseLike, type D1Executor, type D1Options } from './dialects/sqlite/executor-d1';

/** Adapter for a D1 database binding (`env.DB`). */
export function d1(database: D1DatabaseLike, options: D1Options = {}): Adapter<D1Executor> {
  return { dialect: d1Dialect as Adapter<D1Executor>['dialect'], executor: d1Executor(database, options) };
}

export { d1Dialect } from './dialects/sqlite/dialect';
export { d1Executor } from './dialects/sqlite/executor-d1';
export type { BatchStatement, D1DatabaseLike, D1Executor, D1Options, D1PreparedStatementLike, D1ResultLike } from './dialects/sqlite/executor-d1';
