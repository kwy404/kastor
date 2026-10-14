# Notes from the sqlpg owner (PostgreSQL, CockroachDB, SQLite)

Requests for other owners. sqlpg works around each item until it lands.

## For migrate (`src/migrate/**`)

1. **Done by migrate.** SQLite table rebuilds need foreign keys off, outside the transaction.
   SQLite cannot change a column type, nullability, default, foreign key or
   enum CHECK in place, so `ddl()` rebuilds the table (create the new shape
   under `__kastor_new_<table>`, copy rows, drop the old table, rename). Those
   statements start with `PRAGMA foreign_keys = OFF` and end with
   `PRAGMA foreign_keys = ON`, but SQLite ignores that pragma inside a
   transaction, and with foreign keys on, dropping the old table fires the
   ON DELETE actions of every table that points at it (cascades delete rows).
   Please do what `test/sqlite-schema.int.test.ts` does in `migrate()`:
   when `needsForeignKeysOff(statements)` (exported from `kastor/sqlite`) is
   true, run `PRAGMA foreign_keys = OFF` before BEGIN, run the statements and
   `PRAGMA foreign_key_check` inside the transaction (fail if it returns rows),
   and run `PRAGMA foreign_keys = ON` after COMMIT or ROLLBACK. If a rebuild
   runs with foreign keys still on, a guard statement fails the migration with
   `kastor: rebuilding table X needs foreign keys off ...` instead of losing
   data, so a missed case is loud, not destructive.
2. **CockroachDB: no transactional DDL.** `cockroachDialect.features.transactionalDdl`
   is false. Run each statement on its own. Type changes are prefixed with
   `SET enable_experimental_alter_column_type_general = true`, which also may
   not run inside an explicit transaction.
3. **Postgres `ALTER TYPE ... ADD VALUE`**: allowed in a transaction on
   Postgres 12+, but the new value cannot be used until the transaction
   commits. A migration that adds an enum value and then writes rows with it in
   the same file fails; split such data changes into a later migration (worth a
   line in the migrate docs).

## For core (`src/core/**`)

0. **Done by core.** `hooks.selectColumn` landed; libSQL and D1 use it to read
   bigint columns as text (`libsqlDialect`, `d1Dialect`), so values past 2^53
   neither throw in libSQL's default `intMode` nor lose digits on D1.

1. **Cloudflare D1 batches.** D1 has no interactive transactions (no BEGIN or
   SAVEPOINT over the binding), only `db.batch([...])`, which is atomic. The D1
   executor (`d1Executor`, `kastor/d1`) exposes
   `batch(statements: { sql, params }[]): Promise<ExecResult[]>`. Please make
   `$transaction([q1, q2])` use `executor.batch` when it exists and every query
   compiles to a single statement (true on SQLite for create, update, delete,
   upsert, the many variants and reads with JSON includes). Until then,
   callback transactions on D1 throw `UNSUPPORTED` with a hint, unless the
   adapter was created with `d1(env.DB, { transactions: 'sequential' })`
   (documented as not atomic).
2. **pg json parameters.** The Postgres codec sends json values wrapped in a
   small `JsonParam` class (`src/dialects/postgres/values.ts`) because `pg`
   wants JSON text while postgres.js serializes json parameters itself
   (passing text there double encodes). Both executors unwrap it.
   `JsonParam#toJSON()` returns the text, so `toSQL()` output stays readable.
   Nothing to do unless core inspects parameters by type.
