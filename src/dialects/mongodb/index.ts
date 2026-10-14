/**
 * The MongoDB dialect: runs QueryIR against the official `mongodb` driver.
 *
 * Reads are single aggregation pipelines (includes and relation filters are
 * `$lookup` stages), writes use the collection methods, and migrations are
 * database commands written as JSON. See README.md in this folder for what
 * behaves differently from the SQL dialects.
 */
import { BSON, type Db } from 'mongodb';
import type { Adapter, CompiledQuery, Dialect, IdType, QueryIR, SchemaIR } from '../../core/ir';
import { mapMongoError, mongoError } from './errors';
import { mongoExecutor, type MongoExecutor } from './executor';
import { introspectDb, mongoDdl, mongoMigrationTable, splitCommands } from './ddl';
import { buildUpdate, create, createMany, deleteMany, deleteOne, update, updateMany, upsert } from './write';
import {
  aggregatePipeline,
  countPipeline,
  decodeAggregateRow,
  decodeGroupRow,
  decodeRow,
  findPipeline,
  groupByPipeline,
  type Pipeline,
} from './read';
import { compileWhere } from './filter';
import { getModel, tableInfo, type IdMode } from './model';

export interface MongoOptions {
  /**
   * How generated primary keys (`t.id()`, `t.bigId()`) are stored:
   * `objectId` (default, exposed as 24 character hex strings), `uuid` (random
   * UUID strings) or `int` (increasing integers kept in `_kastor_counters`).
   */
  ids?: IdMode;
  /** Documents sampled per collection by `introspect` when a collection has no validator. Default 100. */
  sampleSize?: number;
}

const ejson = (value: unknown): string => BSON.EJSON.stringify(value as BSON.Document, { relaxed: true });

function pipelineText(p: Pipeline): CompiledQuery {
  return { sql: ejson({ aggregate: p.collection, pipeline: p.pipeline, cursor: {} }), params: [] };
}

export function createMongoDialect(options: MongoOptions = {}): Dialect<MongoExecutor> {
  const ids: IdMode = options.ids ?? 'objectId';

  async function run(query: QueryIR, schema: SchemaIR, exec: MongoExecutor): Promise<unknown> {
    const model = getModel(schema, ids);
    switch (query.kind) {
      case 'findMany':
      case 'findFirst':
      case 'findUnique': {
        tableInfo(model, query.table);
        const p = findPipeline(model, query.read);
        const docs = await exec.db.collection(p.collection).aggregate(p.pipeline, exec.session ? { session: exec.session } : {}).toArray();
        const rows = docs.map((d) => decodeRow(model, query.read, d));
        return query.kind === 'findMany' ? rows : (rows[0] ?? null);
      }
      case 'count': {
        const p = countPipeline(model, query);
        const [doc] = await exec.db.collection(p.collection).aggregate(p.pipeline, exec.session ? { session: exec.session } : {}).toArray();
        return Number(doc?.n ?? 0);
      }
      case 'aggregate': {
        const p = aggregatePipeline(model, query);
        const [doc] = await exec.db.collection(p.collection).aggregate(p.pipeline, exec.session ? { session: exec.session } : {}).toArray();
        return decodeAggregateRow(model, query.table, query.aggregates, doc);
      }
      case 'groupBy': {
        const p = groupByPipeline(model, query);
        const docs = await exec.db.collection(p.collection).aggregate(p.pipeline, exec.session ? { session: exec.session } : {}).toArray();
        return docs.map((d) => decodeGroupRow(model, query, d));
      }
      case 'create':
        return create(model, query, exec);
      case 'createMany':
        return createMany(model, query, exec);
      case 'update':
        return update(model, query, exec);
      case 'updateMany':
        return updateMany(model, query, exec);
      case 'upsert':
        return upsert(model, query, exec);
      case 'delete':
        return deleteOne(model, query, exec);
      case 'deleteMany':
        return deleteMany(model, query, exec);
      default:
        throw mongoError('UNSUPPORTED', `Unknown query kind "${(query as { kind: string }).kind}".`, 'Update kastor-orm/mongodb to the same version as kastor.');
    }
  }

  /** The commands a query sends, for logging and `toSQL()`. Writes show their main command. */
  function compile(query: QueryIR, schema: SchemaIR): CompiledQuery[] {
    const model = getModel(schema, ids);
    const filterOf = (table: string, where: Parameters<typeof compileWhere>[0]) => {
      const { stages, match } = compileWhere(where, { model, table, counter: { n: 0 } });
      return stages.length > 0 ? { $lookupFirst: stages, filter: match } : match;
    };
    switch (query.kind) {
      case 'findMany':
      case 'findFirst':
      case 'findUnique':
        return [pipelineText(findPipeline(model, query.read))];
      case 'count':
        return [pipelineText(countPipeline(model, query))];
      case 'aggregate':
        return [pipelineText(aggregatePipeline(model, query))];
      case 'groupBy':
        return [pipelineText(groupByPipeline(model, query))];
      case 'create':
      case 'createMany': {
        const info = tableInfo(model, query.table);
        const rows = query.kind === 'create' ? [query.data] : query.data;
        // ids are generated when the query runs; show the documents without them.
        const preview = rows.map((r) => {
          const doc: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(r)) doc[info.columns.get(k)?.field ?? k] = v;
          return doc;
        });
        return [{ sql: ejson({ insert: query.table, documents: preview }), params: [] }];
      }
      case 'update':
      case 'updateMany':
        return [
          {
            sql: ejson({ update: query.table, updates: [{ q: filterOf(query.table, query.where), u: buildUpdate(model, query.table, query.data), multi: query.kind === 'updateMany' }] }),
            params: [],
          },
        ];
      case 'upsert':
        return [
          {
            sql: ejson({ findAndModify: query.table, query: filterOf(query.table, query.where), update: buildUpdate(model, query.table, query.update), new: true }),
            params: [],
          },
        ];
      case 'delete':
      case 'deleteMany':
        return [{ sql: ejson({ delete: query.table, deletes: [{ q: filterOf(query.table, query.where), limit: query.kind === 'delete' ? 1 : 0 }] }), params: [] }];
      default:
        return [];
    }
  }

  return {
    name: 'mongodb',
    features: {
      returning: true,
      jsonAggregation: true,
      upsert: true,
      ilike: false,
      transactions: true,
      namedEnums: false,
      transactionalDdl: false,
      rawSql: false,
      // ObjectId and UUID keys reach the client as strings.
      idType: ids === 'int' ? 'number' : 'string',
    },
    async execute(query, schema, exec) {
      try {
        return await run(query, schema, exec);
      } catch (error) {
        throw mapMongoError(error) ?? error;
      }
    },
    compile,
    ddl: (op, schema) => mongoDdl(op, schema, ids),
    introspect: (exec) => introspectDb(exec, options.sampleSize),
    migrationTable: mongoMigrationTable,
    splitScript: splitCommands,
    mapError: mapMongoError,
    quoteIdent: (name) => JSON.stringify(name),
    placeholder: (index) => `{"$param": ${index}}`,
    encodeParam: (value) => value,
  };
}

/** The default dialect (ObjectId ids). */
export const mongoDialect = createMongoDialect();

/**
 * Adapter for MongoDB. Pass a `Db` from the official driver:
 *
 *   const client = new MongoClient(url)
 *   const db = kastor({ adapter: mongodb(client.db('app')), schema })
 *
 * With the default ObjectId ids (and with `ids: 'uuid'`) `t.id()` keys and the
 * columns that reference them are strings in results, filters and data. With
 * `ids: 'int'` they stay numbers. Transactions need a replica set or a sharded
 * cluster (a single node replica set is enough for development).
 */
export function mongodb(db: Db, options: MongoOptions & { ids: 'int' }): Adapter<MongoExecutor>;
export function mongodb(db: Db, options?: MongoOptions & { ids?: 'objectId' | 'uuid' }): Adapter<MongoExecutor, 'string'>;
export function mongodb(db: Db, options?: MongoOptions): Adapter<MongoExecutor, IdType>;
export function mongodb(db: Db, options: MongoOptions = {}): Adapter<MongoExecutor, IdType> {
  return { dialect: options.ids || options.sampleSize ? createMongoDialect(options) : mongoDialect, executor: mongoExecutor(db) };
}

export type { MongoExecutor } from './executor';
export type { IdMode } from './model';
export { mongoExecutor } from './executor';
