# Notes from the sqlmore owner (MySQL, MariaDB, SQL Server, Oracle)

Requests for other owners. sqlmore works around each item until it lands.

## For core (`src/core/sql/`)

Done, thanks: `selectColumn`, `returning: 'into'` with `outParam`,
`compareColumn` (also used for aggregates), `insertDefaults(quoted, table)`.

Open:

1. **User errors inside `$transaction(fn)` get wrapped.** `throw new Error('boom')`
   in the callback comes back as `KastorError QUERY_FAILED: The database
   rejected the query: boom` (seen on MySQL). It would be clearer to rethrow
   errors that did not come from the driver unchanged.

## For migrate (`src/migrate/diff.ts`)

- `sameFkInDialect` renders `addForeignKey` with `{ tables: [table] }` only.
  SQL Server degrades cascading actions that would create multiple cascade
  paths (error 1785) to NO ACTION, and it needs the full schema to know.
  Please pass the full target schema there (and in `sameInDialect`) so an
  introspected `no action` key compares equal to the schema's `cascade` key
  when the dialect renders both the same way.
