# Changelog

All notable changes to kastor are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-10-14

### Fixed

- README badges: removed download and size badges that cannot render for a brand new package, and the install size link that pointed at the wrong package name.

## [0.1.0] - 2026-10-13

Published on npm as `kastor-orm` (`npm i kastor-orm`, imports from `kastor-orm` and `kastor-orm/<adapter>`). The project, the repository and the CLI keep the name kastor: the package installs both a `kastor` and a `kastor-orm` command.

### Added

- Schema in plain TypeScript: `table()`, the `t` column builders (`id`, `bigId`, `uuid`, `string`, `text`, `int`, `bigint`, `float`, `decimal`, `boolean`, `datetime`, `date`, `time`, `json`, `bytes`, `enum`), modifiers, indexes, composite primary keys, soft delete and relations with `one()` and `many()`, including many to many through a join table.
- Types inferred from the schema with no generate step: `InferSelect`, `InferInsert` and fully typed results for `select` and nested `include`.
- The client: `findMany`, `findFirst`, `findFirstOrThrow`, `findUnique`, `findUniqueOrThrow`, `findPage`, `create`, `createMany`, `createManyAndReturn`, `update`, `updateMany`, `upsert`, `delete`, `deleteMany`, `count`, `aggregate` and `groupBy`, with filters, relation filters, ordering, pagination, cursors, distinct and nested writes.
- Nested includes in one query per root call with JSON aggregation, and an IN list fallback with one query per include level.
- Transactions (callback and batch), typed raw SQL with `$sql` and `$execute`, the `sql` fragment tag, lazy queries with `toSQL()`.
- `KastorError` with stable codes, plain English messages and hints, the same on every database.
- Adapters for PostgreSQL, CockroachDB, MySQL, MariaDB, SQLite (better-sqlite3, node:sqlite, bun:sqlite), libSQL and Turso, Cloudflare D1, SQL Server, Oracle and MongoDB. No bundled drivers.
- Migrations: schema diff with rename detection, readable `migration.sql` files, `migrate dev`, `migrate deploy`, `migrate status`, `migrate reset`, `db push`, `db pull` (introspection into a TypeScript schema) and `db seed`.
- `npx kastor studio`, a local web UI to browse and edit data with an ER diagram, and `npx kastor doctor`.
- `defineConfig`, `defineSeed` and `factory` for configuration, seeds and test data.
- Browser builds of the core: `dist/kastor.browser.js` (ESM) and `dist/kastor.js` (global `Kastor`).
- Docs site with a live playground, 14 guides in English and 4 in Portuguese, and Kas the beaver.

[Unreleased]: https://github.com/kwy404/kastor/compare/v0.1.0...HEAD
[0.1.1]: https://github.com/kwy404/kastor/releases/tag/v0.1.1
[0.1.0]: https://github.com/kwy404/kastor/releases/tag/v0.1.0
