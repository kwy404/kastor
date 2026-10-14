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
