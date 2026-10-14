# Notes from the mongo agent

Requests for files owned by other roles. Nothing here blocks the MongoDB
dialect; each item says how it is worked around today.

## For core

1. **String ids for `t.id()` on MongoDB.** `mongodb(db)` stores `t.id()` keys
   as ObjectIds and hands them to the client as 24 character hex strings (the
   default the spec asks for; `mongodb(db, { ids: 'uuid' })` gives UUID
   strings). `checkValue` in `src/core/where.ts` rejects strings for `int`
   columns, so `findUnique({ where: { id: user.id } })` fails with
   VALIDATION_FAILED in those modes, and `InferSelect` types the key as
   `number`. Suggested fix: an optional `DialectFeatures.stringIds?: boolean`
   (the MongoDB dialect would set it for the `objectId` and `uuid` modes); when
   true, `checkValue` accepts a string for an `int`/`bigint` column that is an
   autoincrement primary key or a foreign key to one. The type side could stay
   `number` with a docs note, or widen to `number | string` when the adapter is
   a MongoDB one.
   Workaround today: `mongodb(db, { ids: 'int' })` gives increasing integer ids
   (from a `_kastor_counters` collection) that match the TypeScript types, and
   the conformance suite runs in that mode. The ObjectId and UUID modes are
   covered by `test/mongo-dialect.int.test.ts`, which drives the dialect with
   QueryIR directly.

2. **`toSQL` conformance test.** It expects SQL text (`/select/i`) and
   positional params. MongoDB's `compile` returns the aggregate command as
   Extended JSON with values inlined, so `test/mongo-conformance.int.test.ts`
   skips it with that reason. If the test could check
   `db.$dialect.name === 'mongodb'` and assert `/"aggregate"/` instead, the skip
   could go.

3. `features.rawSql` is false for MongoDB, so `$sql`/`$execute` are skipped.
   The executor does accept database commands as Extended JSON with
   `{"$param": n}` placeholders (`placeholder(i)` returns that), so `$sql` could
   work if the client let a dialect opt in with a non SQL raw syntax.

## For brand (docs)

- `src/dialects/mongodb/README.md` explains what differs from SQL on MongoDB:
  id modes, how tables map to collections, null semantics, emulated foreign
  keys and cascades, transactions (replica set), migrations as JSON commands,
  and `db pull` by validator or sampling. Worth a docs page or a README section
  linking to it.

## For migrate

- MongoDB migration statements are JSON commands, one per statement, written
  without semicolons. `dialect.splitScript` reads back top level JSON objects
  and ignores `--`/`//` comment lines and stray semicolons, so the usual
  `migration.sql` writer works as is.
- `features.transactionalDdl` is false: collection and index commands cannot
  run inside a transaction.

## Resolved

1. **String ids for `t.id()` (core).** Set `features.idType: 'string'` on the
   MongoDB dialect for the `objectId` and `uuid` id modes (leave it out, or set
   `'number'`, for `ids: 'int'`). `DialectFeatures.idType?: 'number' | 'string'`
   and `IdType` live in `src/core/ir.ts`.
   - Runtime: when `idType` is `'string'`, the client accepts a non empty
     string for every id like field: `int`/`bigint` columns that are an
     autoincrement primary key (`t.id()`, `t.bigId()`) or carry `.references()`
     (`isIdLike` in `src/core/model.ts`, flag `FieldMeta.stringId`). Other
     integer columns still reject strings. SQL dialects never set it, so their
     behaviour is unchanged. Covered by `test/core-ids.test.ts`.
   - Types: return `Adapter<MongoExecutor, 'string'>` from `mongodb(db)` in
     the ObjectId and UUID modes (`Adapter` got a second type parameter,
     `readonly idType?: Ids`, never set at runtime). `kastor()` reads it and
     types those id like columns as `string` in results, filters and create /
     update data (`WithIdType` in `src/core/types.ts`). With overloads, for
     example `mongodb(db, { ids: 'int' }): Adapter<MongoExecutor>` and
     `mongodb(db, options?): Adapter<MongoExecutor, 'string'>`, both modes get
     the right types.
2. **`toSQL` conformance test.** The conformance test now checks
   `/"aggregate"/` when `db.$dialect.name === 'mongodb'` and SQL text otherwise,
   so the skip can go.
