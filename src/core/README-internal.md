# kastor core: internal contract

This file is for the people working on kastor itself. It fixes the public
names, the internal types and what each piece must do. The source of truth for
types is `src/core/ir.ts`; this file explains it.

## Public API (`import ... from 'kastor'`)

| Name | What it is |
| --- | --- |
| `kastor(options)` | Creates a client: `{ adapter, schema, relations?, log? }` (type `KastorOptions`). `schema` may be a module namespace; non table exports are ignored |
| `table(name, columns, options?)` | Declares a table. Options: `indexes(cols) => [...]`, `primaryKey(cols) => [cols.a, cols.b]` for composite keys, `softDelete: 'deletedAt'` |
| `t` | Column builders: `id`, `bigId`, `uuid`, `string(len?)`, `text`, `int`, `bigint`, `float`, `decimal(p, s)`, `boolean`, `datetime`, `date`, `time`, `json<T>()`, `bytes`, `enum([...])` |
| column modifiers | `nullable()`, `default(v)`, `defaultNow()`, `defaultRandom()`, `defaultSql('...')`, `unique()`, `primaryKey()`, `references(() => other.col, { onDelete, onUpdate })`, `map('db_name')`, `nativeType('varchar(64)')` |
| `index(...cols)` / `uniqueIndex(...cols)` | Index builders for `table(..., { indexes })`, `.name('custom')` sets the name |
| `one(target, { fields, references }?)` | To-one relation. `fields` are columns of the source table, `references` of the target. Leave the config out on the side without the foreign key |
| `many(target, { fields, references }?)` / `many(target, { through: joinTable })` | To-many and many-to-many relations |
| `sql` | Tagged template for raw SQL fragments (`sql.raw`, `sql.join`, `sql.ident`) usable in `where: { AND: [sql\`...\`] }` and `$sql` |
| `KastorError`, `isKastorError(e)` | Error class with `code`, `message`, `hint`, `meta`, `cause` |
| `toSchemaIR(schema)` | Converts the TypeScript schema object (`{ users, posts }`) to SchemaIR |
| `defineConfig(config)` | Typed identity for `kastor.config.ts` (type `KastorConfigFile`, the same as `KastorConfig` of `kastor/migrate`) |
| `defineSeed(fn)` / `factory(model, build)` | Seed and test factory helpers |
| Types | `InferSelect<typeof users>`, `InferInsert<typeof users>`, `KastorClient<typeof schema, ReturnType<typeof relations>>`, `Payload`, `WhereInput`, `CreateData`, `UpdateData`, `WithIdType` |

`table()` objects expose their columns as properties (`users.email`), plus the
metadata under `users.$table`.

### Client

Every model delegate (`db.users`) has `findMany`, `findFirst`, `findFirstOrThrow`,
`findUnique`, `findUniqueOrThrow`, `findPage` (cursor pagination with opaque
cursors), `create`, `createMany`, `createManyAndReturn`, `update`, `updateMany`,
`upsert`, `delete`, `deleteMany`, `count`, `aggregate`, `groupBy`, and for soft
delete tables `restore`, `hardDelete`, `hardDeleteMany`.

Calls return a lazy `KastorQuery` (a thenable): nothing runs until it is
awaited. `query.toSQL()` returns the statements without running them.

Client level: `$transaction(async (tx) => ...)`, `$transaction([q1, q2])`,
`$sql<Row>\`...\`` (rows), `$execute\`...\`` (affected count), `$schema`
(SchemaIR), `$dialect`, `$disconnect()`.

## Query IR

`QueryIR` is a union keyed by `kind`. Names inside the IR are always database
names (table and column names after `.map()`); output keys are the TypeScript
field names, carried in `SelectColumnIR.as`. Results by kind (`QueryResultMap`):

| kind | resolves to |
| --- | --- |
| `findMany` | `Row[]` |
| `findFirst`, `findUnique` | `Row \| null` (client already sets `take: 1`) |
| `create` | `Row` (the `returning` columns) |
| `createMany`, `updateMany` | `{ count }`, or `Row[]` when `returning` is set |
| `update`, `delete` | `Row \| null` (null when nothing matched) |
| `upsert` | `Row` |
| `deleteMany` | `{ count }` |
| `count` | `number` |
| `aggregate` | `Row` keyed by `AggregateIR.as` |
| `groupBy` | `Row[]` keyed by `by[].as` and `aggregates[].as` |

Rows hold decoded JS values: `boolean`, `Date` for datetime, `bigint` for
bigint, `string` for decimal, `date` (`YYYY-MM-DD`), `time` (`HH:MM:SS`) and uuid,
`Uint8Array` for bytes, parsed values for json. Includes appear under the
relation name (array for many, object or `null` for one), relation counts under
`_count`.

The client handles, so dialects never see them: `cursor` (turned into a where
tree after reading the cursor row), nested writes (split into single table
writes inside a transaction), soft delete filters (added to where trees and
`RelationIR.softDeleteColumn`), `select` vs `include` shaping, key mapping and
validation.

## Dialect contract

`Dialect` in `ir.ts`: `name`, `features`, `execute(query, schema, exec)`,
`compile?(query, schema)`, `ddl(op, schema)`, `introspect(exec)`,
`migrationTable`, `splitScript?`, `mapError?`, `quoteIdent?`, `placeholder?`,
`encodeParam?`. An adapter factory returns `{ dialect, executor }`:

```ts
export function postgres(pool: PgPoolLike): Adapter {
  return { dialect: postgresDialect, executor: pgExecutor(pool) };
}
```

`features.idType` (`'number'` default, `'string'` for MongoDB ObjectId or
UUID ids) makes the client accept strings for id like fields (autoincrement
keys and integer columns with `.references()`); return `Adapter<E, 'string'>`
so the client types them as strings too.

`Executor.query(sql, params)` resolves `{ rows, rowsAffected?, insertId? }`.
`Executor.transaction(fn, options?)` runs `fn(tx)` on one connection and sets
`tx.inTransaction = true`; the client never nests transactions (a nested
`$transaction` reuses the open one).

`mapError(error)` should turn driver errors into `KastorError` with codes
`UNIQUE_VIOLATION`, `FOREIGN_KEY_VIOLATION`, `NOT_NULL_VIOLATION`,
`CHECK_VIOLATION`, `SERIALIZATION_FAILURE`, `DEADLOCK`, `CONNECTION_FAILED`,
`TIMEOUT` (see `src/core/errors.ts`, use the `errors.*` factories so messages and
hints stay consistent).

## Shared SQL base (`src/core/sql/`)

SQL dialects should not compile queries themselves. They call
`createSqlDialect({ name, hooks, ddl, introspect, ... })` and only write hooks:

| Hook | Purpose | Presets |
| --- | --- | --- |
| `quoteIdent(name)` | identifier quoting | `quoteDouble`, `quoteBacktick`, `quoteBracket` |
| `placeholder(i)` | 1 based parameter marker | `$1`, `?`, `@p1`, `:1` |
| `paginate(take, skip, ordered)` | `LIMIT/OFFSET`, `OFFSET FETCH`, `TOP` | `limitOffset`, `offsetFetch` |
| `returning` | `'returning'`, `'output'`, `'into'` (Oracle, with `outParam`) or `'none'` (re-select by key) | |
| `selectColumn?` / `compareColumn?` | wrap columns read into rows / used in comparisons | |
| `upsert` | `'onConflict'`, `'onDuplicateKey'`, `'merge'`, `'none'` | |
| `json` | JSON aggregation flavor for includes, `null` for the IN-list fallback | `jsonPostgres`, `jsonMysql`, `jsonSqlite`, `jsonMssql`, `jsonOracle` |
| `caseInsensitive` | `'ilike'` or `'lower'` | |
| `textMatch?` | override `contains`, `startsWith`, `endsWith` (SQLite GLOB, MySQL binary collation) | |
| `encode(value, column)` / `decode(value, column, source)` | value conversion | `defaultEncode`, `defaultDecode` |
| `insertDefaults(quotedTable, table)` | insert with every column defaulted | |
| `mutationSelfReference` | false when UPDATE/DELETE cannot use subqueries on the same table (MySQL) | |
| `fromDual`, `mergeHint`, `mergeTerminator` | MERGE and constant SELECT details | |
| `nullsOrder` | native `NULLS FIRST/LAST` or emulate with CASE | |
| `lastInsertIdSql?` | statement that reads the last generated id when the driver does not report `insertId` | |
| `maxParams`, `maxInList` | chunk sizes for IN lists | |

`compileQuery(query, schema, hooks)` returns `CompiledQuery[]` for logging and
the docs playground.

## Migrations

`src/migrate/ops.ts` (migrate owns it) defines `MigrationOp`. The core only
uses the structural `MigrationOpLike`. `Dialect.migrationTable` keeps applied
migrations in `_kastor_migrations (id, checksum, applied_at)`; SQL dialects
can use `sqlMigrationTable(hooks)` from the SQL base.

## Conformance suite

`test/helpers/conformance.ts` exports `runConformance(name, makeDb, options)`,
`resetWithDdl(adapter, schemaIR)`, `seed(db)` and `fixture` (tables in
`test/helpers/fixture.ts`). `makeDb()` returns
`{ adapter, reset?(schemaIR), close?() }`; without `reset` the suite drops and
recreates the fixture tables with `dialect.ddl` (`dropTable`, `createEnum`,
`createTable`). Options: `enabled` (pass `!!process.env.KASTOR_X_URL`) and
`skip` (test titles or prefixes, give the reason at the call site).

```ts
runConformance('postgres', async () => {
  const pool = new pg.Pool({ connectionString: process.env.KASTOR_PG_URL });
  return { adapter: postgres(pool), close: () => pool.end() };
}, { enabled: !!process.env.KASTOR_PG_URL });
```

`test/core-engine.test.ts` runs it on in-memory SQLite through the SQL base
in three hook configurations (JSON includes with RETURNING, IN-list includes
with re-select, emulated upsert), which is the reference behaviour.
