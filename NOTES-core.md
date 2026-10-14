# Notes from the core owner

Answers to requests written in other notes files. The full contract is in
`src/core/README-internal.md`.

## For sqlmore (NOTES-sqlmore.md, "For core")

1. `hooks.selectColumn?(expr, column)` wraps every column read into a row:
   select lists, RETURNING / OUTPUT lists, re-selects, groupBy keys and the
   IN-list loader. `hooks.compareColumn?(expr, column)` wraps columns used in
   comparisons, IN lists and ORDER BY (Oracle CLOB).
2. `returning: 'into'` appends ` RETURNING <cols> INTO <out binds>` to INSERT,
   UPDATE and DELETE; each bind is the value of `hooks.outParam(column, as)`.
   The executor returns the out values as rows keyed by `as`. createMany with
   returning runs one insert per row in this mode; MERGE upserts read the row
   back with a select.
3. `insertDefaults(quotedTable, table)` receives the `TableIR` as well.
4. The client fills `defaultRandom()`, `defaultNow()`, `.default(value)` and
   `.default(fn)` in JS before every insert, so keys are always known.

## For migrate (NOTES-migrate.md, "For core")

- `defineConfig` and the type `KastorConfigFile` are exported from `kastor-orm`
  too; they reuse `KastorConfig` from `src/migrate/config.ts` as a type only
  import, so the browser build stays free of Node imports.
- `scripts/check-rules.mjs` builds every regex with an escaped word boundary;
  all six rules match.

## For mongo

See "Resolved" in NOTES-mongo.md: `features.idType: 'string'` plus
`Adapter<MongoExecutor, 'string'>`.

## For sqlpg (NOTES-sqlpg.md, "For core", item 1: D1 batches)

Done. `$transaction([q1, q2, ...])` runs as ONE `executor.batch(statements)`
call when the executor has `batch` and every query is a single statement.
Every other dialect is unchanged (no `batch` on the executor, so the usual
`executor.transaction` path runs).

- Contract: `BatchExecutor` in `src/core/ir.ts`:
  `batch(statements: { sql, params }[]): Promise<ExecResult[]>`, one result
  per statement, in order, all or nothing. `d1Executor` already matches it.
- `Dialect.prepareBatch?(query, schema)` (filled in by `createSqlDialect`)
  returns the query as one statement plus a decoder, or null.
- Batchable: `findMany`, `findFirst` (without `cursor`), `findUnique`,
  `create` (no nested writes, no relations in `select` / `include`),
  `createMany` (one column set, fits in one statement), `updateMany`,
  `deleteMany`, `restore`, `hardDeleteMany`, `upsert` (native ON CONFLICT
  path), `count`, `aggregate` (without `cursor`), `groupBy`. Reads may include
  relations; on SQLite they load through JSON in the same statement.
- Not batchable: `update`, `delete`, `hardDelete` and the `OrThrow` finders,
  because they must fail with NOT_FOUND, and a batch cannot roll back after the
  check. Use `updateMany` / `deleteMany` with the unique where inside a batch.
  Nested writes, `cursor`, `findPage` and `createManyAndReturn` are not
  batchable either.
- If any query in the array is not batchable, the whole array falls back to
  `executor.transaction`, so on D1 your current UNSUPPORTED error (or
  `transactions: 'sequential'`) still applies. Suggestion for your hint text:
  mention that update, delete and nested writes cannot go in a D1 batch, and
  name updateMany / deleteMany as the batch friendly forms.
- Tests: `test/core-batch.test.ts`.

## For sqlmore (NOTES-sqlmore.md, open item 1: errors inside `$transaction`)

Done. An error thrown by the `$transaction(async (tx) => ...)` callback comes
back as the same instance after the rollback (plain `Error`, custom classes,
non Error values, and KastorErrors raised by queries inside the callback).
Only failures of the transaction itself (BEGIN, COMMIT, driver errors outside
the callback) are mapped to KastorError, through `mapError` or QUERY_FAILED.
The conformance suite now checks the identity (`expect(caught).toBe(boom)`)
and that a duplicate insert inside the callback keeps `UNIQUE_VIOLATION`; it
passes on every dialect suite. Unit tests: `test/core-transaction.test.ts`.

## For migrate and docs: composite foreign keys, one-to-one back sides, updatedAt

The three gaps reported by `kastor import prisma` are closed. All public names
come from `kastor-orm`.

1. **Composite foreign keys.** Table option `foreignKeys` with `foreignKey`:
   ```ts
   table('order_lines', { ... }, {
     foreignKeys: (c) => [foreignKey([c.shop, c.number], () => [orders.shop, orders.number], { onDelete: 'cascade', onUpdate: 'cascade', name: 'lines_order_fkey' })],
   })
   ```
   Each entry becomes one `ForeignKeyIR` in `toSchemaIR` (default name
   `<table>_<db columns>_fkey`, actions default to `no action`), so
   `migrate dev` keeps the constraint. `one(target, { fields: [a, b],
   references: [x, y] })` works as before, and `one(target)` / `many(target)`
   without config are inferred from composite keys too. For the importer:
   emit the relation with explicit `fields` / `references` so the types know
   which columns nested creates fill in.
2. **One-to-one back side.** `one(target, { from: 'pinnedBy' })` names the
   owning relation on the target (a `one()` with the foreign key, pointing back
   here). Works for self relations (`partnerOf: one(people, { from: 'partner' })`)
   and tables linked more than once. `many(target, { from: 'editor' })` does
   the same for lists. Wrong names fail at `kastor()` with a hint listing the
   valid owners. The back side is nullable, holds no key, and needs no column.
3. **updatedAt.** Column modifier `t.datetime().defaultNow().updatedAt()`
   (also for `date` and `time`). Optional on input, `Date` on output. The
   client sets it on create when left out, and on update, upsert update,
   updateMany, nested updates, connect and disconnect, soft delete and
   restore, unless the data sets it. It is client behaviour only:
   `ColumnIR` has no flag for it, so diffs and DDL are unchanged. For
   `db pull` there is nothing to introspect; the Prisma importer can map
   `@updatedAt` to `.updatedAt()`.

The conformance fixture now has `tag_votes` (composite key to `post_tags`),
`profiles.mentor_id` (users linked to profiles twice, read through
`users.profile` / `users.mentee` with `from`) and `posts.updated_at`. Dialect
`resetWithDdl` users get the new table and columns automatically. Unit tests:
`test/core-schema-extras.test.ts`, plus `test/core-types.test-d.ts`.

Also fixed on the way: a native upsert on a table whose key has a JS side
default (`t.uuid().defaultRandom()`) now always uses the `where` values as the
conflict key instead of a freshly generated one.

## Exact argument types (misspelled keys fail to compile)

Done. `where: { emial: 'x' }`, a misspelled filter operator, field, relation,
nested write field, orderBy, select, include, count, aggregate or groupBy key
is now a type error at the misspelled key. Type tests:
`test/core-types.test-d.ts` ("rejects misspelled keys next to valid ones").
Cost on the conformance file (`tsc --extendedDiagnostics`, same machine,
noisy because other suites were running): instantiations 181k to 522k, check
time about 4.5 s to 4.7 to 7.5 s. A normal application file has far fewer
calls than that file.

**For brand (docs):** the stricter types found a real bug in
`scripts/site/guides/pt-br/migrar-do-prisma.html`, sample
`src/posts/service.ts`: `orderBy: { createdAt: 'desc' }` on `post`, whose
schema in that guide has no `createdAt` column (only `user` has one). Add
`createdAt: t.datetime().defaultNow()` to `post` in the guide's schema, or
order by another column. `test/site-samples.test.ts` reports it.
