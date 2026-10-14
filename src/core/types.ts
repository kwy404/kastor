/**
 * Type level layer of the client: everything here is erased at runtime.
 *
 * S is the schema object (`{ users, posts }`), R the object returned by the
 * relations callback, K a model key of S. Result types follow the arguments:
 * `select` picks fields, `include` adds relations, nullable columns read as
 * `T | null`, create inputs require only columns without a default.
 */
import type { AnyRelation, AnyTable, Column, ColumnMap, ColumnState, Many, One, Table, TableMeta } from './schema';
import type { SqlFragment } from './raw';

/* ------------------------------------------------------------------------ */
/* Helpers                                                                    */
/* ------------------------------------------------------------------------ */

export type Simplify<T> = { [K in keyof T]: T[K] } & {};
type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;
type OneOrMany<T> = T | readonly T[];
type Falsy = false | undefined | null;

export type SchemaShape = Record<string, AnyTable>;

/* ------------------------------------------------------------------------ */
/* String ids                                                                 */
/* ------------------------------------------------------------------------ */

type IsIdState<St extends ColumnState> = St['type'] extends 'int' | 'bigint'
  ? St['primaryKey'] extends true
    ? St['hasDefault'] extends true
      ? true
      : false
    : St['references'] extends ''
      ? false
      : true
  : false;

type StringIdColumns<C> = {
  [K in keyof C]: C[K] extends Column<infer St> ? (IsIdState<St> extends true ? Column<Omit<St, 'data'> & { data: string }> : C[K]) : C[K];
};

type StringIdTable<T> = T extends { $table: TableMeta<infer N, infer C> } ? Table<N, StringIdColumns<C> & ColumnMap> : T;

/**
 * The schema as the client sees it for a dialect id type: with `'string'`,
 * auto increment keys and integer foreign keys read and write as strings
 * (MongoDB ObjectIds, UUID ids).
 */
export type WithIdType<S extends SchemaShape, Ids> = Ids extends 'string' ? { [K in keyof S]: StringIdTable<S[K]> } extends infer X extends SchemaShape ? X : S : S;
export type RelationsShape<S extends SchemaShape = SchemaShape> = { [K in keyof S]?: Record<string, AnyRelation> };

/* ------------------------------------------------------------------------ */
/* Columns and tables                                                         */
/* ------------------------------------------------------------------------ */

export type ColumnsOf<T extends AnyTable> = T['$table']['columns'];
export type StateOf<C> = C extends Column<infer S> ? S : never;

/** Value type of a column as read from the database. */
export type ColumnValue<C> = C extends Column<infer S> ? (S['notNull'] extends true ? S['data'] : S['data'] | null) : never;

type OptionalOnInsert<C> = {
  [K in keyof C]: C[K] extends Column<infer S> ? (S['notNull'] extends false ? K : S['hasDefault'] extends true ? K : never) : never;
}[keyof C];

/** Row type of a table. */
export type InferSelect<T extends AnyTable> = Simplify<{ -readonly [K in keyof ColumnsOf<T>]: ColumnValue<ColumnsOf<T>[K]> }>;

/** Insert type of a table: columns without a default are required. */
export type InferInsert<T extends AnyTable> = Simplify<
  { -readonly [K in Exclude<keyof ColumnsOf<T>, OptionalOnInsert<ColumnsOf<T>>>]: ColumnValue<ColumnsOf<T>[K]> } & {
    -readonly [K in OptionalOnInsert<ColumnsOf<T>>]?: ColumnValue<ColumnsOf<T>[K]>;
  }
>;

type FieldKey<S extends SchemaShape, K extends keyof S> = keyof ColumnsOf<S[K]> & string;
type Field<S extends SchemaShape, K extends keyof S, F> = F extends keyof ColumnsOf<S[K]> ? ColumnsOf<S[K]>[F] : never;
type FieldValue<S extends SchemaShape, K extends keyof S, F> = ColumnValue<Field<S, K, F>>;
type FieldData<S extends SchemaShape, K extends keyof S, F> = StateOf<Field<S, K, F>>['data'];

type UniqueFieldKeys<S extends SchemaShape, K extends keyof S> = {
  [F in keyof ColumnsOf<S[K]>]: StateOf<ColumnsOf<S[K]>[F]> extends infer St extends ColumnState
    ? St['primaryKey'] extends true
      ? F
      : St['unique'] extends true
        ? F
        : never
    : never;
}[keyof ColumnsOf<S[K]>] &
  string;

type NumericFieldKeys<S extends SchemaShape, K extends keyof S> = {
  [F in keyof ColumnsOf<S[K]>]: StateOf<ColumnsOf<S[K]>[F]>['type'] extends 'int' | 'bigint' | 'float' | 'decimal' ? F : never;
}[keyof ColumnsOf<S[K]>] &
  string;

/** Keys of the source table whose `.references()` points at table `Name`. */
type RefKeys<T extends AnyTable, Name extends string> = {
  [F in keyof ColumnsOf<T>]: StateOf<ColumnsOf<T>[F]>['references'] extends infer Ref extends string ? (string extends Ref ? never : Ref extends Name ? F : never) : never;
}[keyof ColumnsOf<T>] &
  string;

type HasNullable<T extends AnyTable, Keys> = true extends {
  [F in keyof ColumnsOf<T>]: F extends Keys ? (StateOf<ColumnsOf<T>[F]>['notNull'] extends false ? true : false) : false;
}[keyof ColumnsOf<T>]
  ? true
  : false;

/* ------------------------------------------------------------------------ */
/* Relations                                                                  */
/* ------------------------------------------------------------------------ */

export type RelationsOf<R, K> = K extends keyof R ? (NonNullable<R[K]> extends Record<string, AnyRelation> ? NonNullable<R[K]> : {}) : {};
type RelKey<R, K> = keyof RelationsOf<R, K> & string;
type Rel<R, K, Name> = Name extends keyof RelationsOf<R, K> ? RelationsOf<R, K>[Name] : never;

/** Model key of S holding table T. */
export type ModelKeyOf<S extends SchemaShape, T> = {
  [K in keyof S]: T extends AnyTable ? (S[K]['$table']['name'] extends T['$table']['name'] ? K : never) : never;
}[keyof S];

type TargetOf<S extends SchemaShape, Rl> = Rl extends One<infer T, any> ? ModelKeyOf<S, T> : Rl extends Many<infer T, any> ? ModelKeyOf<S, T> : never;
type TargetName<Rl> = Rl extends One<infer T, any> | Many<infer T, any> ? T['$table']['name'] : never;

type ManyKeys<R, K> = { [N in RelKey<R, K>]: Rel<R, K, N> extends Many<any, any> ? N : never }[RelKey<R, K>];
type OneKeys<R, K> = { [N in RelKey<R, K>]: Rel<R, K, N> extends One<any, any> ? N : never }[RelKey<R, K>];

/** Foreign key fields of the source for a to-one relation, never when the source does not hold them. */
type OwnedFields<Src extends AnyTable, Rl> =
  Rl extends One<infer T, infer F> ? (F extends readonly [] ? RefKeys<Src, T['$table']['name']> : F[number] & keyof ColumnsOf<Src> & string) : never;

type OwnerOneKeys<S extends SchemaShape, R, K extends keyof S> = {
  [N in OneKeys<R, K>]: [OwnedFields<S[K], Rel<R, K, N>>] extends [never] ? never : N;
}[OneKeys<R, K>];

type OneIsNullable<S extends SchemaShape, K extends keyof S, Rl> = [OwnedFields<S[K], Rl>] extends [never] ? true : HasNullable<S[K], OwnedFields<S[K], Rl>>;

/* ------------------------------------------------------------------------ */
/* Filters                                                                    */
/* ------------------------------------------------------------------------ */

export type QueryMode = 'default' | 'insensitive';

type Comparable = number | bigint | Date | string;

export type ScalarFilter<V, Nullable extends boolean> = {
  equals?: V | (Nullable extends true ? null : never);
  not?: V | (Nullable extends true ? null : never) | ScalarFilter<V, Nullable>;
  in?: readonly V[];
  notIn?: readonly V[];
} & ([V] extends [Comparable] ? { lt?: V; lte?: V; gt?: V; gte?: V } : {}) &
  ([V] extends [string] ? { contains?: string; startsWith?: string; endsWith?: string; mode?: QueryMode } : {});

type FieldFilter<C> = C extends Column<infer St>
  ? St['notNull'] extends true
    ? St['data'] | ScalarFilter<St['data'], false>
    : St['data'] | null | ScalarFilter<St['data'], true>
  : never;

type RelationFilter<S extends SchemaShape, R, Rl> =
  Rl extends Many<any, any>
    ? { some?: WhereInput<S, R, TargetOf<S, Rl>>; every?: WhereInput<S, R, TargetOf<S, Rl>>; none?: WhereInput<S, R, TargetOf<S, Rl>> }
    : Rl extends One<any, any>
      ? WhereInput<S, R, TargetOf<S, Rl>> | null | { is?: WhereInput<S, R, TargetOf<S, Rl>> | null; isNot?: WhereInput<S, R, TargetOf<S, Rl>> | null }
      : never;

export type WhereInput<S extends SchemaShape, R, K extends keyof S> = {
  [F in keyof ColumnsOf<S[K]>]?: FieldFilter<ColumnsOf<S[K]>[F]>;
} & {
  [N in RelKey<R, K>]?: RelationFilter<S, R, Rel<R, K, N>>;
} & {
  AND?: OneOrMany<WhereInput<S, R, K> | SqlFragment>;
  OR?: readonly (WhereInput<S, R, K> | SqlFragment)[];
  NOT?: OneOrMany<WhereInput<S, R, K> | SqlFragment>;
};

/** A where clause that names at least one unique field (primary key or `.unique()`). */
export type WhereUniqueInput<S extends SchemaShape, R, K extends keyof S> = [UniqueFieldKeys<S, K>] extends [never]
  ? WhereInput<S, R, K>
  : { [U in UniqueFieldKeys<S, K>]: { [P in U]: FieldData<S, K, P> } & Omit<WhereInput<S, R, K>, U> }[UniqueFieldKeys<S, K>];

/* ------------------------------------------------------------------------ */
/* Ordering                                                                   */
/* ------------------------------------------------------------------------ */

export type SortOrder = 'asc' | 'desc';
export type SortSpec = SortOrder | { sort: SortOrder; nulls?: 'first' | 'last' };

export type OrderByInput<S extends SchemaShape, R, K extends keyof S> = {
  [F in keyof ColumnsOf<S[K]>]?: SortSpec;
} & {
  [N in ManyKeys<R, K>]?: { _count: SortOrder };
} & {
  [N in OneKeys<R, K>]?: OrderByInput<S, R, TargetOf<S, Rel<R, K, N>>>;
};

/* ------------------------------------------------------------------------ */
/* Select and include                                                         */
/* ------------------------------------------------------------------------ */

type CountInput<S extends SchemaShape, R, K extends keyof S> =
  | boolean
  | { select: { [N in ManyKeys<R, K>]?: boolean | { where?: WhereInput<S, R, TargetOf<S, Rel<R, K, N>>> } } };

type ManyRelationArgs<S extends SchemaShape, R, TK extends keyof S> = {
  where?: WhereInput<S, R, TK>;
  orderBy?: OneOrMany<OrderByInput<S, R, TK>>;
  take?: number;
  skip?: number;
  distinct?: OneOrMany<FieldKey<S, TK>>;
  withDeleted?: boolean;
} & SelectOrInclude<S, R, TK>;

type OneRelationArgs<S extends SchemaShape, R, TK extends keyof S> = { withDeleted?: boolean } & SelectOrInclude<S, R, TK>;

type RelationArgs<S extends SchemaShape, R, Rl> =
  Rl extends Many<any, any> ? ManyRelationArgs<S, R, TargetOf<S, Rl>> : OneRelationArgs<S, R, TargetOf<S, Rl>>;

export type SelectInput<S extends SchemaShape, R, K extends keyof S> = {
  [F in keyof ColumnsOf<S[K]>]?: boolean;
} & {
  [N in RelKey<R, K>]?: boolean | RelationArgs<S, R, Rel<R, K, N>>;
} & { _count?: CountInput<S, R, K> };

export type IncludeInput<S extends SchemaShape, R, K extends keyof S> = {
  [N in RelKey<R, K>]?: boolean | RelationArgs<S, R, Rel<R, K, N>>;
} & { _count?: CountInput<S, R, K> };

export type SelectOrInclude<S extends SchemaShape, R, K extends keyof S> =
  | { select?: SelectInput<S, R, K>; include?: never }
  | { include?: IncludeInput<S, R, K>; select?: never };

/* ------------------------------------------------------------------------ */
/* Result payloads                                                            */
/* ------------------------------------------------------------------------ */

type ScalarRow<S extends SchemaShape, K extends keyof S> = InferSelect<S[K]>;

type CountPayload<R, K, Arg> = Arg extends { select: infer Sel }
  ? { [N in keyof Sel as Sel[N] extends Falsy ? never : N]: number }
  : { [N in ManyKeys<R, K>]: number };

type RelationPayload<S extends SchemaShape, R, K extends keyof S, Rl, Arg> =
  Rl extends Many<any, any>
    ? Payload<S, R, TargetOf<S, Rl>, Arg extends object ? Arg : {}>[]
    : Rl extends One<any, any>
      ? Payload<S, R, TargetOf<S, Rl>, Arg extends object ? Arg : {}> | (OneIsNullable<S, K, Rl> extends true ? null : never)
      : never;

type IncludePayload<S extends SchemaShape, R, K extends keyof S, Inc> = {
  [N in keyof Inc as Inc[N] extends Falsy ? never : N]: N extends '_count'
    ? CountPayload<R, K, Inc[N]>
    : N extends RelKey<R, K>
      ? RelationPayload<S, R, K, Rel<R, K, N>, Inc[N]>
      : never;
};

type SelectPayload<S extends SchemaShape, R, K extends keyof S, Sel> = {
  [N in keyof Sel as Sel[N] extends Falsy ? never : N]: N extends keyof ColumnsOf<S[K]>
    ? FieldValue<S, K, N>
    : N extends '_count'
      ? CountPayload<R, K, Sel[N]>
      : N extends RelKey<R, K>
        ? RelationPayload<S, R, K, Rel<R, K, N>, Sel[N]>
        : never;
};

/** Result row for model K given call arguments A. */
export type Payload<S extends SchemaShape, R, K extends keyof S, A> = A extends { select: infer Sel extends object }
  ? Simplify<SelectPayload<S, R, K, Sel>>
  : A extends { include: infer Inc extends object }
    ? Simplify<ScalarRow<S, K> & IncludePayload<S, R, K, Inc>>
    : ScalarRow<S, K>;

/* ------------------------------------------------------------------------ */
/* Write inputs                                                               */
/* ------------------------------------------------------------------------ */

type InsertValue<S extends SchemaShape, K extends keyof S, F> = FieldValue<S, K, F>;

type ConnectOrCreate<S extends SchemaShape, R, TK extends keyof S, Parent extends string> = {
  where: WhereUniqueInput<S, R, TK>;
  create: CreateData<S, R, TK, Parent>;
};

type NestedOneCreate<S extends SchemaShape, R, TK extends keyof S> = {
  create?: CreateData<S, R, TK>;
  connect?: WhereUniqueInput<S, R, TK>;
  connectOrCreate?: ConnectOrCreate<S, R, TK, never>;
};

type NestedChildCreate<S extends SchemaShape, R, TK extends keyof S, Parent extends string> = {
  create?: OneOrMany<CreateData<S, R, TK, Parent>>;
  connect?: OneOrMany<WhereUniqueInput<S, R, TK>>;
  connectOrCreate?: OneOrMany<ConnectOrCreate<S, R, TK, Parent>>;
};

/** Owned relation keys whose target is the parent of a nested create. */
type ParentOwnedKeys<S extends SchemaShape, R, K extends keyof S, Parent extends string> = {
  [N in OwnerOneKeys<S, R, K>]: TargetName<Rel<R, K, N>> extends Parent ? N : never;
}[OwnerOneKeys<S, R, K>];

type ActiveOwnedKeys<S extends SchemaShape, R, K extends keyof S, Parent extends string> = Exclude<OwnerOneKeys<S, R, K>, ParentOwnedKeys<S, R, K, Parent>>;

type FkFieldsOf<S extends SchemaShape, R, K extends keyof S, Keys> = Keys extends string ? OwnedFields<S[K], Rel<R, K, Keys>> : never;

/** Columns a nested create under `Parent` leaves to kastor. */
type ParentFkFields<S extends SchemaShape, R, K extends keyof S, Parent extends string> =
  | FkFieldsOf<S, R, K, ParentOwnedKeys<S, R, K, Parent>>
  | ([Parent] extends [never] ? never : RefKeys<S[K], Parent>);

type OptionalInsertKeys<S extends SchemaShape, K extends keyof S> = OptionalOnInsert<ColumnsOf<S[K]>> & string;

type ScalarCreate<S extends SchemaShape, K extends keyof S, Omitted> = {
  [F in Exclude<FieldKey<S, K>, OptionalInsertKeys<S, K> | Omitted>]: InsertValue<S, K, F>;
} & {
  [F in Exclude<OptionalInsertKeys<S, K>, Omitted>]?: InsertValue<S, K, F>;
};

/** Either the foreign key columns or the relation, for one owned relation. */
type OwnedChoice<S extends SchemaShape, R, K extends keyof S, N extends string> =
  OwnedFields<S[K], Rel<R, K, N>> extends infer Fk extends string
    ? Exclude<Fk, OptionalInsertKeys<S, K>> extends never
      ? { [P in Fk]?: InsertValue<S, K, P> } & { [P in N]?: NestedOneCreate<S, R, TargetOf<S, Rel<R, K, N>>> }
      :
          | ({ [P in Fk]: InsertValue<S, K, P> } & { [P in N]?: never })
          | ({ [P in Fk]?: never } & { [P in N]: NestedOneCreate<S, R, TargetOf<S, Rel<R, K, N>>> })
    : never;

type OwnedChoices<S extends SchemaShape, R, K extends keyof S, Parent extends string> = [ActiveOwnedKeys<S, R, K, Parent>] extends [never]
  ? {}
  : UnionToIntersection<{ [N in ActiveOwnedKeys<S, R, K, Parent>]: [OwnedChoice<S, R, K, N & string>] }[ActiveOwnedKeys<S, R, K, Parent>]> extends infer I
    ? I extends [unknown]
      ? I[0]
      : {}
    : {};

type OtherRelationCreates<S extends SchemaShape, R, K extends keyof S> = {
  [N in ManyKeys<R, K>]?: NestedChildCreate<S, R, TargetOf<S, Rel<R, K, N>>, S[K]['$table']['name']>;
} & {
  [N in Exclude<OneKeys<R, K>, OwnerOneKeys<S, R, K>>]?: NestedChildCreate<S, R, TargetOf<S, Rel<R, K, N>>, S[K]['$table']['name']>;
};

/**
 * Data for `create`. Columns with a default are optional; a foreign key can be
 * given directly or through its relation (`author: { connect: { id } }`).
 * `Parent` is the table name of the enclosing nested create, whose link
 * columns kastor fills in.
 */
export type CreateData<S extends SchemaShape, R, K extends keyof S, Parent extends string = never> = ScalarCreate<
  S,
  K,
  FkFieldsOf<S, R, K, ActiveOwnedKeys<S, R, K, Parent>> | ParentFkFields<S, R, K, Parent>
> &
  OwnedChoices<S, R, K, Parent> &
  OtherRelationCreates<S, R, K> & { [P in ParentOwnedKeys<S, R, K, Parent>]?: never };

/** Data for `createMany`: plain columns only. */
export type CreateManyData<S extends SchemaShape, K extends keyof S> = InferInsert<S[K]>;

type NumberOps<V> = { set?: V; increment?: V; decrement?: V; multiply?: V; divide?: V };

type FieldUpdate<C> = C extends Column<infer St>
  ?
      | (St['notNull'] extends true ? St['data'] : St['data'] | null)
      | (St['type'] extends 'int' | 'float' | 'bigint'
          ? NumberOps<St['data']>
          : { set: St['notNull'] extends true ? St['data'] : St['data'] | null })
  : never;

type NestedManyUpdate<S extends SchemaShape, R, TK extends keyof S, Parent extends string> = NestedChildCreate<S, R, TK, Parent> & {
  disconnect?: OneOrMany<WhereUniqueInput<S, R, TK>>;
  set?: readonly WhereUniqueInput<S, R, TK>[];
  delete?: OneOrMany<WhereUniqueInput<S, R, TK>>;
  deleteMany?: OneOrMany<WhereInput<S, R, TK>>;
  update?: OneOrMany<{ where: WhereUniqueInput<S, R, TK>; data: UpdateData<S, R, TK> }>;
  updateMany?: OneOrMany<{ where?: WhereInput<S, R, TK>; data: UpdateData<S, R, TK> }>;
};

type NestedOneUpdate<S extends SchemaShape, R, TK extends keyof S, Parent extends string> = {
  create?: CreateData<S, R, TK, Parent>;
  connect?: WhereUniqueInput<S, R, TK>;
  connectOrCreate?: ConnectOrCreate<S, R, TK, Parent>;
  disconnect?: boolean;
  delete?: boolean;
  update?: UpdateData<S, R, TK>;
};

/** Data for `update` and `updateMany`. Numbers accept `{ increment: 1 }` and friends. */
export type UpdateData<S extends SchemaShape, R, K extends keyof S> = {
  [F in keyof ColumnsOf<S[K]>]?: FieldUpdate<ColumnsOf<S[K]>[F]>;
} & {
  [N in ManyKeys<R, K>]?: NestedManyUpdate<S, R, TargetOf<S, Rel<R, K, N>>, S[K]['$table']['name']>;
} & {
  [N in OneKeys<R, K>]?: NestedOneUpdate<S, R, TargetOf<S, Rel<R, K, N>>, S[K]['$table']['name']>;
};

export type UpdateManyData<S extends SchemaShape, K extends keyof S> = {
  [F in keyof ColumnsOf<S[K]>]?: FieldUpdate<ColumnsOf<S[K]>[F]>;
};

/* ------------------------------------------------------------------------ */
/* Method arguments                                                           */
/* ------------------------------------------------------------------------ */

type ReadOptions = {
  /** Include soft deleted rows. */
  withDeleted?: boolean;
};

export type FindManyArgs<S extends SchemaShape, R, K extends keyof S> = {
  where?: WhereInput<S, R, K>;
  orderBy?: OneOrMany<OrderByInput<S, R, K>>;
  take?: number;
  skip?: number;
  /** Start at the row matching this unique condition (inclusive), in `orderBy` order. */
  cursor?: WhereUniqueInput<S, R, K>;
  distinct?: OneOrMany<FieldKey<S, K>>;
} & ReadOptions &
  SelectOrInclude<S, R, K>;

export type FindFirstArgs<S extends SchemaShape, R, K extends keyof S> = FindManyArgs<S, R, K>;

export type FindUniqueArgs<S extends SchemaShape, R, K extends keyof S> = {
  where: WhereUniqueInput<S, R, K>;
} & ReadOptions &
  SelectOrInclude<S, R, K>;

export type FindPageArgs<S extends SchemaShape, R, K extends keyof S> = {
  where?: WhereInput<S, R, K>;
  orderBy?: OneOrMany<{ [F in keyof ColumnsOf<S[K]>]?: SortOrder }>;
  /** Page size, 1 to 1000. */
  first: number;
  /** Opaque cursor from `pageInfo.endCursor` to read the next page. */
  after?: string | null;
  /** Opaque cursor from `pageInfo.startCursor` to read the previous page. */
  before?: string | null;
} & ReadOptions &
  SelectOrInclude<S, R, K>;

export interface PageInfo {
  startCursor: string | null;
  endCursor: string | null;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface Page<T> {
  items: T[];
  pageInfo: PageInfo;
}

export type CreateArgs<S extends SchemaShape, R, K extends keyof S> = { data: CreateData<S, R, K> } & SelectOrInclude<S, R, K>;

export type CreateManyArgs<S extends SchemaShape, K extends keyof S> = {
  data: readonly CreateManyData<S, K>[];
  /** Skip rows that break a unique constraint instead of failing. */
  skipDuplicates?: boolean;
};

export type CreateManyAndReturnArgs<S extends SchemaShape, K extends keyof S> = CreateManyArgs<S, K> & {
  select?: { [F in keyof ColumnsOf<S[K]>]?: boolean };
};

export type UpdateArgs<S extends SchemaShape, R, K extends keyof S> = {
  where: WhereUniqueInput<S, R, K>;
  data: UpdateData<S, R, K>;
} & SelectOrInclude<S, R, K>;

export type UpdateManyArgs<S extends SchemaShape, R, K extends keyof S> = {
  where?: WhereInput<S, R, K>;
  data: UpdateManyData<S, K>;
};

export type UpsertArgs<S extends SchemaShape, R, K extends keyof S> = {
  where: WhereUniqueInput<S, R, K>;
  create: CreateData<S, R, K>;
  update: UpdateData<S, R, K>;
} & SelectOrInclude<S, R, K>;

export type DeleteArgs<S extends SchemaShape, R, K extends keyof S> = {
  where: WhereUniqueInput<S, R, K>;
} & SelectOrInclude<S, R, K>;

export type DeleteManyArgs<S extends SchemaShape, R, K extends keyof S> = {
  where?: WhereInput<S, R, K>;
};

export type CountArgs<S extends SchemaShape, R, K extends keyof S> = {
  where?: WhereInput<S, R, K>;
  orderBy?: OneOrMany<OrderByInput<S, R, K>>;
  take?: number;
  skip?: number;
  cursor?: WhereUniqueInput<S, R, K>;
  distinct?: OneOrMany<FieldKey<S, K>>;
  /** Count non null values per field: `{ _all: true, name: true }`. */
  select?: { _all?: boolean } & { [F in keyof ColumnsOf<S[K]>]?: boolean };
} & ReadOptions;

export type CountResult<A> = A extends { select: infer Sel } ? Simplify<{ [P in keyof Sel as Sel[P] extends Falsy ? never : P]: number }> : number;

type FieldFlags<Keys extends string> = { [F in Keys]?: boolean };

export type AggregateSpec<S extends SchemaShape, K extends keyof S> = {
  _count?: boolean | ({ _all?: boolean } & FieldFlags<FieldKey<S, K>>);
  _sum?: FieldFlags<NumericFieldKeys<S, K>>;
  _avg?: FieldFlags<NumericFieldKeys<S, K>>;
  _min?: FieldFlags<FieldKey<S, K>>;
  _max?: FieldFlags<FieldKey<S, K>>;
};

export type AggregateArgs<S extends SchemaShape, R, K extends keyof S> = {
  where?: WhereInput<S, R, K>;
  orderBy?: OneOrMany<OrderByInput<S, R, K>>;
  take?: number;
  skip?: number;
  cursor?: WhereUniqueInput<S, R, K>;
} & ReadOptions &
  AggregateSpec<S, K>;

type SumValue<S extends SchemaShape, K extends keyof S, F> = StateOf<Field<S, K, F>>['type'] extends 'bigint'
  ? bigint
  : StateOf<Field<S, K, F>>['type'] extends 'decimal'
    ? string
    : number;
type AvgValue<S extends SchemaShape, K extends keyof S, F> = StateOf<Field<S, K, F>>['type'] extends 'decimal' ? string : number;

type Picked<A, P extends string> = P extends keyof A ? { [F in keyof A[P] as A[P][F] extends Falsy ? never : F]: true } : never;

export type AggregateResult<S extends SchemaShape, K extends keyof S, A> = Simplify<
  ('_count' extends keyof A
    ? A['_count'] extends Falsy
      ? {}
      : { _count: A['_count'] extends true ? number : { [F in keyof Picked<A, '_count'>]: number } }
    : {}) &
    ('_sum' extends keyof A ? { _sum: { [F in keyof Picked<A, '_sum'>]: SumValue<S, K, F> | null } } : {}) &
    ('_avg' extends keyof A ? { _avg: { [F in keyof Picked<A, '_avg'>]: AvgValue<S, K, F> | null } } : {}) &
    ('_min' extends keyof A ? { _min: { [F in keyof Picked<A, '_min'>]: FieldData<S, K, F> | null } } : {}) &
    ('_max' extends keyof A ? { _max: { [F in keyof Picked<A, '_max'>]: FieldData<S, K, F> | null } } : {})
>;

type AggregateFilter<V> = ScalarFilter<V, true>;

export type HavingInput<S extends SchemaShape, K extends keyof S> = {
  [F in keyof ColumnsOf<S[K]>]?:
    | FieldFilter<ColumnsOf<S[K]>[F]>
    | {
        _count?: AggregateFilter<number>;
        _sum?: AggregateFilter<FieldData<S, K, F>>;
        _avg?: AggregateFilter<number>;
        _min?: AggregateFilter<FieldData<S, K, F>>;
        _max?: AggregateFilter<FieldData<S, K, F>>;
      };
} & {
  _count?: { _all?: AggregateFilter<number> };
  AND?: OneOrMany<HavingInput<S, K>>;
  OR?: readonly HavingInput<S, K>[];
  NOT?: OneOrMany<HavingInput<S, K>>;
};

type GroupOrderBy<S extends SchemaShape, K extends keyof S> = {
  [F in keyof ColumnsOf<S[K]>]?: SortSpec;
} & {
  _count?: { _all?: SortOrder } & { [F in keyof ColumnsOf<S[K]>]?: SortOrder };
  _sum?: { [F in NumericFieldKeys<S, K>]?: SortOrder };
  _avg?: { [F in NumericFieldKeys<S, K>]?: SortOrder };
  _min?: { [F in keyof ColumnsOf<S[K]>]?: SortOrder };
  _max?: { [F in keyof ColumnsOf<S[K]>]?: SortOrder };
};

export type GroupByArgs<S extends SchemaShape, R, K extends keyof S> = {
  by: OneOrMany<FieldKey<S, K>>;
  where?: WhereInput<S, R, K>;
  having?: HavingInput<S, K>;
  orderBy?: OneOrMany<GroupOrderBy<S, K>>;
  take?: number;
  skip?: number;
} & ReadOptions &
  AggregateSpec<S, K>;

type ByKeys<A> = A extends { by: infer B } ? (B extends readonly (infer X)[] ? X : B) : never;

export type GroupByResult<S extends SchemaShape, K extends keyof S, A> = Simplify<
  { [F in ByKeys<A> & keyof ColumnsOf<S[K]>]: FieldValue<S, K, F> } & AggregateResult<S, K, A>
>;

/* ------------------------------------------------------------------------ */
/* Strictness                                                                 */
/* ------------------------------------------------------------------------ */

type KeysOfUnion<T> = T extends unknown ? keyof T : never;

/**
 * Keeps inference on the literal argument while rejecting unknown top level
 * keys and unknown keys in `select` / `include` with a compile error.
 */
export type Strict<A, Shape> = {
  [P in keyof A]: P extends KeysOfUnion<Shape>
    ? P extends 'select' | 'include'
      ? StrictKeys<A[P], Extract<Shape, { [Q in P]?: unknown }>[P & keyof Extract<Shape, { [Q in P]?: unknown }>]>
      : A[P]
    : never;
};

type StrictKeys<A, Shape> = A extends object ? { [P in keyof A]: P extends KeysOfUnion<NonNullable<Shape>> ? A[P] : never } : A;
