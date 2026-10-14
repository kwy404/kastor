/**
 * kastor: a TypeScript ORM for almost every database.
 *
 * ```ts
 * import { kastor, table, t, one, many } from 'kastor'
 * import { postgres } from 'kastor/postgres'
 * ```
 */
export { kastor, KastorQuery } from './core/client';
export type { KastorClient, KastorOptions, ModelClient, QueryEvent, TablesOf } from './core/client';
export { table, t, index, uniqueIndex, one, many, Column, IndexBuilder, isTable, isColumn } from './core/schema';
export type {
  AnyColumn,
  AnyRelation,
  AnyTable,
  ColumnConfig,
  ColumnState,
  Many,
  ManyConfig,
  One,
  OneConfig,
  ReferenceOptions,
  Table,
  TableMeta,
  TableOptions,
} from './core/schema';
export { sql, SqlFragment, isSqlFragment } from './core/raw';
export type { SqlTag } from './core/raw';
export { KastorError, isKastorError, errors } from './core/errors';
export type { KastorErrorCode, KastorErrorOptions } from './core/errors';
export { toSchemaIR, tableToIR, sortByDependencies } from './core/schema-ir';
export { defineConfig, defineSeed, factory } from './core/helpers';
export type { Factory, FactoryContext, KastorConfigFile } from './core/helpers';
export type {
  AggregateArgs,
  AggregateResult,
  CountArgs,
  CreateArgs,
  CreateData,
  CreateManyArgs,
  DeleteArgs,
  FindFirstArgs,
  FindManyArgs,
  FindPageArgs,
  FindUniqueArgs,
  GroupByArgs,
  GroupByResult,
  InferInsert,
  InferSelect,
  OrderByInput,
  Page,
  PageInfo,
  Payload,
  SelectInput,
  IncludeInput,
  UpdateArgs,
  UpdateData,
  UpsertArgs,
  WhereInput,
  WhereUniqueInput,
  WithIdType,
} from './core/types';
export type {
  Adapter,
  ColumnIR,
  CompiledQuery,
  Dialect,
  DialectFeatures,
  DialectName,
  IdType,
  ExecResult,
  Executor,
  NeutralType,
  QueryIR,
  SchemaIR,
  TableIR,
  TransactionOptions,
  WhereIR,
} from './core/ir';
