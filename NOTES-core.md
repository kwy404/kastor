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

- `defineConfig` and the type `KastorConfigFile` are exported from `kastor`
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
