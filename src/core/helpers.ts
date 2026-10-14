/**
 * Config, seed and test factory helpers.
 */
import { errors } from './errors';
import type { KastorQuery, ModelClient } from './client';
import type { KastorConfig as ConfigFile } from '../migrate/config';
import type { CreateData, Payload, SchemaShape } from './types';

/** Shape of `kastor.config.ts`. */
export type KastorConfigFile = ConfigFile;

/**
 * Types `kastor.config.ts`:
 *
 * ```ts
 * export default defineConfig({ schema: './src/db/schema.ts', adapter: () => postgres(pool) })
 * ```
 */
export function defineConfig(config: KastorConfigFile): KastorConfigFile {
  return config;
}

/** Types a seed script: `export default defineSeed(async (db) => { ... })`. */
export function defineSeed<DB>(seed: (db: DB) => Promise<void> | void): (db: DB) => Promise<void> | void {
  if (typeof seed !== 'function') throw errors.invalidArgument('defineSeed takes a function.', 'Example: export default defineSeed(async (db) => { await db.users.create(...) }).');
  return seed;
}

type CreateDataOf<M> = M extends ModelClient<infer S extends SchemaShape, infer R, infer K> ? CreateData<S, R, K> : never;
type RowOf<M> = M extends ModelClient<infer S extends SchemaShape, infer R, infer K> ? Payload<S, R, K, {}> : never;

export interface FactoryContext {
  /** 1, 2, 3, ... per factory, reset with `factory.reset()`. */
  seq: number;
}

export interface Factory<M> {
  /** Builds the data for one record without saving it. */
  build(overrides?: Partial<CreateDataOf<M>>): CreateDataOf<M>;
  /** Builds the data for `count` records without saving them. */
  buildMany(count: number, overrides?: Partial<CreateDataOf<M>> | ((index: number) => Partial<CreateDataOf<M>>)): CreateDataOf<M>[];
  /** Creates one record and returns it. */
  create(overrides?: Partial<CreateDataOf<M>>): Promise<RowOf<M>>;
  /** Creates `count` records one by one (nested writes allowed) and returns them. */
  createMany(count: number, overrides?: Partial<CreateDataOf<M>> | ((index: number) => Partial<CreateDataOf<M>>)): Promise<RowOf<M>[]>;
  /** Restarts the sequence at 1. */
  reset(): void;
}

/**
 * Test and seed factory for a model:
 *
 * ```ts
 * const users = factory(db.users, ({ seq }) => ({ email: `user${seq}@acme.com`, name: `User ${seq}` }))
 * const ada = await users.create({ name: 'Ada' })
 * const many = await users.createMany(10)
 * ```
 */
export function factory<M extends ModelClient<any, any, any>>(model: M, defaults: (ctx: FactoryContext) => Partial<CreateDataOf<M>>): Factory<M> {
  if (!model || typeof (model as { create?: unknown }).create !== 'function') {
    throw errors.invalidArgument('factory() takes a model of the client.', 'Example: factory(db.users, ({ seq }) => ({ email: `u${seq}@acme.com` })).');
  }
  let seq = 0;
  const build = (overrides: Partial<CreateDataOf<M>> = {}): CreateDataOf<M> => {
    seq += 1;
    return { ...defaults({ seq }), ...overrides } as CreateDataOf<M>;
  };
  const resolve = (o: Partial<CreateDataOf<M>> | ((index: number) => Partial<CreateDataOf<M>>) | undefined, i: number) =>
    typeof o === 'function' ? o(i) : (o ?? {});
  const createOne = (data: CreateDataOf<M>): Promise<RowOf<M>> =>
    (model.create as unknown as (args: { data: unknown }) => KastorQuery<RowOf<M>>)({ data }).then((r) => r);
  return {
    build,
    buildMany: (count, overrides) => Array.from({ length: count }, (_, i) => build(resolve(overrides, i))),
    create: (overrides) => createOne(build(overrides)),
    async createMany(count, overrides) {
      const out: RowOf<M>[] = [];
      for (let i = 0; i < count; i++) out.push(await createOne(build(resolve(overrides, i))));
      return out;
    },
    reset() {
      seq = 0;
    },
  };
}
