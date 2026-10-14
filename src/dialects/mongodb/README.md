# kastor on MongoDB

```ts
import { MongoClient } from 'mongodb'
import { kastor } from 'kastor'
import { mongodb } from 'kastor/mongodb'

const client = new MongoClient(process.env.MONGO_URL!)
export const db = kastor({ adapter: mongodb(client.db('app')), schema, relations })
```

`mongodb(db, options?)` takes a `Db` from the official `mongodb` driver (5.x or
newer; MongoDB server 5.0 or newer). The schema, the query API and the result
types are the same as on the SQL databases. This page lists what works
differently.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `ids` | `'objectId'` | How `t.id()` and `t.bigId()` keys are generated. `'objectId'`: a BSON ObjectId, returned as a 24 character hex string. `'uuid'`: a random UUID string. `'int'`: increasing integers, allocated from the `_kastor_counters` collection, the closest match to SQL identity columns. |
| `sampleSize` | `100` | Documents read per collection by `db pull` when a collection has no validator. |

## How tables map to collections

- One table is one collection. Field names are the database column names (after `.map()`).
- A single column primary key is stored as `_id`. The client still sees it under its own name (`id`). A composite primary key becomes a unique index named `<table>_pkey`, and the document keeps its own generated `_id`.
- Columns that reference a generated key (`authorId: t.int().references(() => users.id)`) hold the same kind of value as the key: an ObjectId in `objectId` mode, a string in `uuid` mode. You always pass and receive them as strings in `objectId` mode.
- Values use native BSON types: `decimal` is Decimal128 (returned as a string, padded to the declared scale), `bigint` is a 64 bit Long (returned as `bigint`), `datetime` is a Date, `date` is a Date at UTC midnight (returned as `YYYY-MM-DD`), `time` is a `HH:MM:SS` string, `bytes` is Binary (returned as `Uint8Array`), `json` is an embedded document or array, `uuid` and `enum` are strings.
- Nullable columns are stored as `null` when you leave them out, so `{ name: null }` filters behave like SQL.

## Queries

- Every read is one `aggregate` call. Includes (with their own `where`, `orderBy`, `take`, `skip`, nested includes) and `_count` are `$lookup` stages inside that call, so a query never runs one request per row. Many to many relations read the join collection and the target in the same `$lookup`.
- Relation filters (`some`, `every`, `none`, `is`, `isNot`) are `$lookup` stages that load at most one matching related document, followed by a `$match` on whether it was found.
- `contains`, `startsWith`, `endsWith` and `mode: 'insensitive'` use regular expressions. The text you pass is escaped, so `.`, `*`, `(` and friends match literally. Insensitive `lt`/`gt` compare `$toLower` values.
- Null handling follows SQL: `not: 'x'`, `notIn` and `NOT (...)` never match documents where the field is null or missing, and `every` treats a related row whose condition is unknown as not matching.
- Without `orderBy` documents come back in the order the server reads them. With `orderBy`, `_id` is added as the final tie breaker. Null and missing values sort first in ascending order and last in descending order, unless you pass `nulls`.
- `groupBy` is a `$group` stage; `having` and ordering by aggregates work. `_sum` of only nulls is `null`, as in SQL.
- `distinct` keeps the first document of each combination (by `orderBy`) with `$group` and `$first`.
- Raw SQL fragments (`sql\`...\`` inside `where`) are not available. Raw queries are database commands written as Extended JSON, with `{"$param": n}` placeholders: `exec.query('{"find": "users", "filter": {"email": {"$param": 1}}}', [email])`.

## Writes

- Updates are pipeline updates: `increment`, `decrement`, `multiply` and `divide` on a null field leave it null (MongoDB's `$inc` would fail or start from zero), and dividing an integer column truncates like SQL integer division.
- The primary key stored as `_id` cannot be changed by `update`; create a new record and delete the old one.
- `upsert` updates the row matching the unique condition, or inserts when there is none (retrying the update when a concurrent insert wins the race).
- `createMany({ skipDuplicates: true })` checks the unique keys first and inserts the rest, so it also works inside a transaction (where a duplicate key error would abort the transaction).
- Nested writes (`create` with nested `create` or `connect`) run as several single collection writes inside one transaction. There are no joins in writes.

## Foreign keys and cascades

MongoDB does not enforce foreign keys. kastor reads them from your schema:

- On delete, kastor applies each foreign key's `onDelete` itself: `cascade` deletes the documents that point to the deleted ones (recursively, self references included), `set null` and `set default` update them, `restrict` and `no action` refuse the delete with `FOREIGN_KEY_VIOLATION` while such documents exist. When the server supports transactions this all runs in one transaction.
- Before an insert, and before an update that sets a reference, kastor checks that the referenced document exists (one query per foreign key) and fails with `FOREIGN_KEY_VIOLATION` otherwise. Outside a transaction a concurrent delete can still slip between the check and the write.
- `onUpdate` is not emulated (keys stored as `_id` never change).
- Documents written by other programs, or by raw commands, bypass all of this.

## Transactions

`$transaction` uses a client session with `readConcern: majority` (or `snapshot` for `repeatable read` and `serializable`) and `writeConcern: majority`. Transactions need a replica set or a sharded cluster; a single node replica set is enough for development:

```sh
docker run -d -p 27017:27017 mongo:7 --replSet rs0
docker exec <container> mongosh --eval "rs.initiate()"
```

On a standalone server single queries still work, cascades run without a transaction, and `$transaction` fails with the driver's error.

## Migrations and `db pull`

- `createTable` creates the collection with a `$jsonSchema` validator: one property per column with its BSON type, `maxLength` for `string(n)`, `enum` for enums, and `required` for every column that is not nullable. Indexes and unique constraints are `createIndexes` commands.
- `addColumn` fills the new field on existing documents (with its default, or null) and updates the validator. `dropColumn` updates the validator and `$unset`s the field. `renameColumn` uses `$rename`. `alterColumn` updates the validator.
- Foreign key and enum type operations produce no commands.
- A migration.sql file for MongoDB holds one JSON command per statement. Applied migrations are kept in `_kastor_migrations`.
- `db pull` reads each collection's validator (kastor keeps the neutral column type, the original primary key name and defaults in the property descriptions) and its indexes. Collections without a validator are described by sampling documents: field types are inferred from the values found, fields missing from some documents become nullable, and mixed or nested values become `json`.
