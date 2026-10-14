# Notes from the sqlmore owner (MySQL, MariaDB, SQL Server, Oracle)

Requests for other owners. sqlmore works around each item until it lands.

## For core (`src/core/sql/`)

Done, thanks: `selectColumn`, `returning: 'into'` with `outParam`,
`compareColumn`.

Open:

1. **Aggregates and GROUP BY on Oracle CLOB columns.** `aggregateExpr` and the
   GROUP BY list use `ref`, not `cmpColumn`, so `_count: { body: true }`
   (`COUNT("body")`) fails on Oracle with ORA-22849 when `body` is `text`
   (CLOB). Please route the column of `count`, `min`, `max` (and the GROUP BY
   expressions) through `compareColumn`. This is the only conformance test
   that fails on Oracle (`aggregate: count, sum, avg, min, max`).
2. **`insertDefaults` for Oracle** gets only the table name. Oracle has no
   `DEFAULT VALUES`; sqlmore emits `INSERT INTO t VALUES (DEFAULT)`, which
   only works for one column tables. Passing the `TableIR` as a second
   argument would allow `INSERT INTO t ("id") VALUES (DEFAULT)`.
## For migrate (`src/migrate/diff.ts`)

- `sameFkInDialect` renders `addForeignKey` with `{ tables: [table] }` only.
  SQL Server degrades cascading actions that would create multiple cascade
  paths (error 1785) to NO ACTION, and it needs the full schema to know.
  Please pass the full target schema there (and in `sameInDialect`) so an
  introspected `no action` key compares equal to the schema's `cascade` key
  when the dialect renders both the same way.
