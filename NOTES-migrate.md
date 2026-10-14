# Notes from the migrate owner

Requests and contract notes for other owners. The migrate owner works around
each item until it lands.

## For every dialect owner: `ddl(op, schema)` and `introspect`

- `src/migrate/ops.ts` holds the `MigrationOp` union and its contract (header
  comment). Short version: return complete statements without a trailing
  semicolon; `schema` is the state AFTER the op; `createTable` takes a full
  `TableIR` and emits the table, its primary key, its foreign keys and then one
  CREATE INDEX per entry of `table.indexes`; return `[]` for ops that mean
  nothing to your database (for example `createEnum` without named enums).
- Every op kind must be handled: `createTable`, `dropTable`, `renameTable`,
  `addColumn`, `dropColumn`, `renameColumn`, `alterColumn` (look at
  `op.changes` to see whether type, nullability or default changed),
  `createIndex`, `dropIndex`, `addForeignKey`, `dropForeignKey`, `createEnum`,
  `dropEnum`, `alterEnum` (`added`, `removed` and the `columns` that use the
  enum, for recreating the type), `raw` (`rawSqlFor(op, name)` in ops.ts).
- Round trip: `introspect` after running `ddl(createTable)` should give back a
  `TableIR` the diff engine sees as equal. The engine already tolerates:
  index and foreign key names that differ, `restrict` vs `no action`, a missing
  string length meaning 255, defaults returned as `{ kind: 'sql' }` holding
  `now()`, `CURRENT_TIMESTAMP`, `gen_random_uuid()`, `nextval(...)`, quoted
  literals with casts (`'user'::text`), numbers and booleans, `nativeType` set
  by introspection (only compared when the schema sets one), and the extra non
  unique index MySQL creates for a foreign key. As a last resort, two columns
  whose `ddl({ kind: 'addColumn' })` output is identical are treated as equal,
  so introspecting a uuid as `string(36)` on a database without a uuid type is
  fine as long as `addColumn` renders both the same way.
- Please leave `_kastor_migrations` in the `introspect` result; the engine
  filters it out where needed (and drops it on `migrate reset`).
- Migration files are split with `src/migrate/sql-split.ts`: statements end with
  `;`, and statements that contain semicolons of their own (PL/SQL or T-SQL
  blocks) are written after a `-- kastor:block` line and closed with a line
  holding only `/`. If you implement `splitScript`, it must understand that
  format too, or leave `splitScript` out and the shared splitter is used.
- MongoDB: the engine runs every statement of a migration file with
  `executor.query(statement, [])`. Make `ddl` return one line JSON commands
  (for example `{"createCollection":"users"}`) and have the Mongo executor run
  a JSON command string through `db.command`, so migration files work there
  too.

## For core

- `defineConfig`: the CLI accepts `{ schema, adapter, migrations?, seed? }`
  where `schema` is a path (or the schema object itself), `adapter` an
  `Adapter`, or a function returning one (sync or async), `migrations` a folder
  (default `./kastor/migrations`) and `seed` a path to a script whose default
  export receives the client, or a function `(db) => Promise<void>`. The type
  is exported as `KastorConfig` from `kastor/migrate`; feel free to import it
  for `defineConfig` so both stay in sync.
- `scripts/check-rules.mjs`: the framework and assistant rules build their
  regex from a template literal with `\b`, which becomes a backspace character,
  so those two rules never match. `\\b` (as in the last rule) fixes it.
- package.json: the migrate owner added `jiti` as the only runtime dependency.
  It loads `kastor.config.ts`, the schema and the seed script on Node 18 and
  later without a build step (extensionless relative imports, TypeScript
  syntax, ESM and CJS). It has no dependencies of its own.
