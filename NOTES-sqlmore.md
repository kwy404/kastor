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

## For brand (docs): facts about the four dialects

What the adapters really do, so guides and the README can quote them.

### MySQL 8.0.14+ and PlanetScale (`kastor/mysql`, mysql2)
- `mysql(pool)` takes a mysql2 pool or connection, promise or callback API
  (callback objects are switched to `.promise()`). The mariadb package works
  too. Transactions take one pooled connection (`START TRANSACTION`, optional
  `SET TRANSACTION ISOLATION LEVEL` first).
- No RETURNING: inserts read the row back by `insertId` (or the key the
  client generated, `defaultRandom` UUIDs are made in JS), updates and
  deletes select the key first. Upsert is `INSERT ... ON DUPLICATE KEY
  UPDATE`; `createMany({ skipDuplicates })` is `INSERT IGNORE`.
- Includes: `JSON_ARRAYAGG(JSON_OBJECT(...))` in correlated subqueries; paged
  includes use a correlated derived table (MySQL 8.0.14+). Bigint and decimal
  values are embedded as text, bytes as hex, so nothing loses precision.
- Types: `VARCHAR(n)`, `LONGTEXT`, `INT`, `BIGINT`, `DOUBLE`, `DECIMAL(p, s)`
  (default 65, 30), `TINYINT(1)` booleans, `DATETIME(3)`, `DATE`, `TIME`,
  `JSON`, `LONGBLOB`, `CHAR(36)` uuids, native `ENUM(...)`.
- Datetimes are stored as UTC wall time whatever the session time zone:
  values are sent as `YYYY-MM-DD HH:MM:SS.mmm` in UTC and `defaultNow()` is
  `DEFAULT (UTC_TIMESTAMP(3))`. The adapter reads DATETIME, DECIMAL, BIGINT
  and JSON as text per query, so pool options like `dateStrings` or
  `decimalNumbers` do not matter.
- Case: the default `_ci` collations make `equals` case insensitive.
  `contains`, `startsWith`, `endsWith` are exact (they compare with
  `COLLATE utf8mb4_bin`); `mode: 'insensitive'` lowers both sides.
- `ON DELETE SET DEFAULT` is not supported by InnoDB.
- DDL is not transactional: a failed migration can leave earlier statements
  applied.

### MariaDB 10.6+ (`kastor/mariadb`, mariadb package or mysql2)
- Everything above, plus: JSON columns are `LONGTEXT` with a `json_valid`
  check (MariaDB does this itself) and introspect back as `json`.
- MariaDB cannot reference the outer row inside a derived table, so ordered
  and paged includes use `JSON_ARRAYAGG(... ORDER BY ... LIMIT ...)` (10.5+)
  instead, still one statement per root call.

### SQL Server 2017+ and Azure SQL (`kastor/mssql`, mssql/tedious)
- `mssql(pool)` takes an `mssql` ConnectionPool and connects it on first use
  if needed. Transactions use the driver's Transaction object (one
  connection, statements queued one at a time), with isolation levels.
- `OUTPUT INSERTED.*` / `DELETED.*` return rows; upsert is `MERGE ... WITH
  (HOLDLOCK)`; `TOP (n)` without skip, `OFFSET ... FETCH NEXT` with skip.
  Includes use `FOR JSON PATH`.
- Types: `NVARCHAR(n)`, `NVARCHAR(MAX)` text, `INT`, `BIGINT`, `FLOAT`,
  `DECIMAL(p, s)` (default 38, 10), `BIT`, `DATETIME2(3)`, `DATE`, `TIME(0)`,
  `NVARCHAR(MAX)` json with an `ISJSON` check, `VARBINARY(MAX)`,
  `UNIQUEIDENTIFIER`, enums as `NVARCHAR` plus a `CHECK (... IN (...))`.
  Defaults are named constraints (`DF_<table>_<column>`), `defaultNow()` is
  `SYSUTCDATETIME()`, `defaultRandom()` is `NEWID()`.
- Decimals are read as text (tedious would round them to a double);
  datetimes are sent as text so DATETIME2 keeps milliseconds exactly.
- Unique indexes on nullable columns are filtered (`WHERE col IS NOT NULL`)
  so several NULLs are allowed, as on every other database.
- SQL Server refuses cascading foreign keys that point to their own table or
  that would give a row two cascade paths (errors 1785 and 1787). kastor
  writes those keys with `NO ACTION`; deleting a parent then fails with
  FOREIGN_KEY_VIOLATION while children exist.
- Altering a column first drops its default and check constraints (and
  indexes on it), then recreates them.
- Default collations ignore case; `contains`, `startsWith`, `endsWith` are
  exact (`COLLATE Latin1_General_100_BIN2`), `[` is escaped in LIKE.

### Oracle 19c+ (23ai tested) (`kastor/oracle`, oracledb thin mode)
- `oracle(pool)` takes an oracledb pool (or one connection). Thin mode, no
  Instant Client. Outside a transaction each statement autocommits; inside,
  one connection with `commit`/`rollback`. Isolation levels: read committed
  and serializable (the others map to the nearest stronger one).
- `RETURNING ... INTO` out binds return rows from writes; upsert is `MERGE
  ... USING (SELECT ... FROM DUAL)`; `OFFSET ... ROWS FETCH NEXT ... ROWS
  ONLY`; includes are `JSON_ARRAYAGG(JSON_OBJECT(...) RETURNING CLOB)`.
- Types: `VARCHAR2(n CHAR)`, `CLOB` text, `NUMBER(10)`, `NUMBER(19)`,
  `BINARY_DOUBLE`, `NUMBER(p, s)`, booleans as `NUMBER(1)` with a check,
  `TIMESTAMP(3) WITH TIME ZONE` datetimes (exact instants, unaffected by the
  session time zone), `DATE`, times as `INTERVAL DAY(0) TO SECOND(0)`, json as
  `CLOB` with an `IS JSON` check, `BLOB`, `CHAR(36 CHAR)` uuids, enums as
  `VARCHAR2` plus a check. Identity columns: `GENERATED BY DEFAULT ON NULL AS
  IDENTITY`. `defaultNow()` is `SYSTIMESTAMP`, `defaultRandom()` is built
  from `SYS_GUID()` (the client usually sends its own UUID anyway).
- The adapter imports the user's `oracledb` package once to read wide
  NUMBER columns (bigint, decimal) as text and to type out binds.
- Empty string equals NULL: Oracle stores `''` as NULL, so writing `''` to a
  required column is a NOT_NULL_VIOLATION and `equals: ''` matches nothing.
- Identifiers: up to 128 bytes (12.2+). kastor shortens generated constraint
  and index names that are longer, with a stable hash suffix. Names are
  quoted, so they keep their case (`"users"`, not `USERS`).
- CLOB columns (`text`, `json`) cannot be compared directly: equality, IN,
  ORDER BY and aggregates use their first 1000 characters
  (`DBMS_LOB.SUBSTR`). `contains`, `startsWith`, `endsWith` see the whole
  value.
- Oracle foreign keys support `ON DELETE CASCADE` and `SET NULL` only; other
  actions (and every `onUpdate`) behave as NO ACTION.
- `createMany` sends one INSERT per row (multi row VALUES needs 23ai).
- DDL commits implicitly: a failed migration can leave earlier statements
  applied.
