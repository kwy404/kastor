// Database support: the matrix on the home page, the 60 second starts and the
// adapter table in the API reference. Keep in sync with src/dialects (the
// site tests check the entry points and adapter names exist).

export const DB_INFO = {
  postgres: {
    driver: 'pg',
    install: 'npm i kastor pg',
    adapter: 'postgres',
    includes: 'json_agg + json_build_object',
    returning: 'RETURNING',
    upsert: 'ON CONFLICT',
    insensitive: 'ILIKE',
    pagination: 'LIMIT / OFFSET',
    note: 'Also Neon, Supabase and Vercel Postgres through pg compatible pools.',
    setup: `import pg from 'pg'
import { kastor } from 'kastor'
import { postgres } from 'kastor/postgres'
import { schema, relations } from './schema'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

export const db = kastor({ adapter: postgres(pool), schema, relations })`,
    env: 'DATABASE_URL=postgres://user:pass@localhost:5432/app',
  },
  cockroach: {
    driver: 'pg',
    install: 'npm i kastor pg',
    adapter: 'cockroach',
    includes: 'json_agg + json_build_object',
    returning: 'RETURNING',
    upsert: 'ON CONFLICT',
    insensitive: 'ILIKE',
    pagination: 'LIMIT / OFFSET',
    note: 'Serializable by default: kastor surfaces retry errors as SERIALIZATION_FAILURE.',
    setup: `import pg from 'pg'
import { kastor } from 'kastor'
import { cockroach } from 'kastor/cockroach'
import { schema, relations } from './schema'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

export const db = kastor({ adapter: cockroach(pool), schema, relations })`,
    env: 'DATABASE_URL=postgres://root@localhost:26257/defaultdb?sslmode=disable',
  },
  mysql: {
    driver: 'mysql2',
    install: 'npm i kastor mysql2',
    adapter: 'mysql',
    includes: 'JSON_ARRAYAGG + JSON_OBJECT',
    returning: 'Re-select by key',
    upsert: 'ON DUPLICATE KEY UPDATE',
    insensitive: 'LOWER() comparison',
    pagination: 'LIMIT / OFFSET',
    note: 'PlanetScale works through mysql2.',
    setup: `import mysql2 from 'mysql2/promise'
import { kastor } from 'kastor'
import { mysql } from 'kastor/mysql'
import { schema, relations } from './schema'

const pool = mysql2.createPool(process.env.DATABASE_URL!)

export const db = kastor({ adapter: mysql(pool), schema, relations })`,
    env: 'DATABASE_URL=mysql://root:pass@localhost:3306/app',
  },
  mariadb: {
    driver: 'mariadb',
    install: 'npm i kastor mariadb',
    adapter: 'mariadb',
    includes: 'JSON_ARRAYAGG + JSON_OBJECT',
    returning: 'Re-select by key',
    upsert: 'ON DUPLICATE KEY UPDATE',
    insensitive: 'LOWER() comparison',
    pagination: 'LIMIT / OFFSET',
    note: 'Works with the mariadb driver, or with mysql2 against a MariaDB server.',
    setup: `import * as mariadbDriver from 'mariadb'
import { kastor } from 'kastor'
import { mariadb } from 'kastor/mariadb'
import { schema, relations } from './schema'

const pool = mariadbDriver.createPool(process.env.DATABASE_URL!)

export const db = kastor({ adapter: mariadb(pool), schema, relations })`,
    env: 'DATABASE_URL=mariadb://root:pass@localhost:3306/app',
  },
  sqlite: {
    driver: 'better-sqlite3',
    install: 'npm i kastor better-sqlite3',
    adapter: 'sqlite',
    includes: 'json_group_array + json_object',
    returning: 'RETURNING',
    upsert: 'ON CONFLICT',
    insensitive: 'LOWER() comparison',
    pagination: 'LIMIT / OFFSET',
    note: 'Also node:sqlite and bun:sqlite with the same adapter.',
    setup: `import Database from 'better-sqlite3'
import { kastor } from 'kastor'
import { sqlite } from 'kastor/sqlite'
import { schema, relations } from './schema'

export const db = kastor({ adapter: sqlite(new Database('app.db')), schema, relations })`,
    env: '# no server needed: the database is the file app.db',
  },
  libsql: {
    driver: '@libsql/client',
    install: 'npm i kastor @libsql/client',
    adapter: 'libsql',
    includes: 'json_group_array + json_object',
    returning: 'RETURNING',
    upsert: 'ON CONFLICT',
    insensitive: 'LOWER() comparison',
    pagination: 'LIMIT / OFFSET',
    note: 'Turso in the cloud, file: URLs and embedded replicas locally.',
    setup: `import { createClient } from '@libsql/client'
import { kastor } from 'kastor'
import { libsql } from 'kastor/libsql'
import { schema, relations } from './schema'

const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN })

export const db = kastor({ adapter: libsql(client), schema, relations })`,
    env: 'TURSO_DATABASE_URL=libsql://app-you.turso.io\nTURSO_AUTH_TOKEN=...',
  },
  d1: {
    driver: 'D1 binding',
    install: 'npm i kastor',
    adapter: 'd1',
    includes: 'json_group_array + json_object',
    returning: 'RETURNING',
    upsert: 'ON CONFLICT',
    insensitive: 'LOWER() comparison',
    pagination: 'LIMIT / OFFSET',
    note: 'D1 has no interactive transactions: the array form of $transaction runs as one D1 batch, the callback form is refused by default.',
    setup: `import { kastor } from 'kastor'
import { d1 } from 'kastor/d1'
import { schema, relations } from './schema'

export default {
  async fetch(request: Request, env: { DB: D1Database }) {
    const db = kastor({ adapter: d1(env.DB), schema, relations })
    return Response.json(await db.users.findMany({ take: 10 }))
  },
}`,
    env: '# wrangler.toml: [[d1_databases]] binding = "DB"',
  },
  mssql: {
    driver: 'mssql',
    install: 'npm i kastor mssql',
    adapter: 'mssql',
    includes: 'FOR JSON PATH',
    returning: 'OUTPUT',
    upsert: 'MERGE',
    insensitive: 'LOWER() comparison',
    pagination: 'TOP / OFFSET FETCH',
    note: 'Azure SQL works with the same driver.',
    setup: `import sql from 'mssql'
import { kastor } from 'kastor'
import { mssql } from 'kastor/mssql'
import { schema, relations } from './schema'

const pool = await new sql.ConnectionPool(process.env.DATABASE_URL!).connect()

export const db = kastor({ adapter: mssql(pool), schema, relations })`,
    env: 'DATABASE_URL=Server=localhost,1433;Database=app;User Id=sa;Password=...;TrustServerCertificate=true',
  },
  oracle: {
    driver: 'oracledb',
    install: 'npm i kastor oracledb',
    adapter: 'oracle',
    includes: 'JSON_ARRAYAGG + JSON_OBJECT',
    returning: 'RETURNING INTO',
    upsert: 'MERGE',
    insensitive: 'LOWER() comparison',
    pagination: 'OFFSET / FETCH NEXT',
    note: 'node-oracledb thin mode: no Instant Client to install.',
    setup: `import oracledb from 'oracledb'
import { kastor } from 'kastor'
import { oracle } from 'kastor/oracle'
import { schema, relations } from './schema'

const pool = await oracledb.createPool({ user: 'app', password: process.env.ORACLE_PASSWORD, connectString: 'localhost:1521/FREEPDB1' })

export const db = kastor({ adapter: oracle(pool), schema, relations })`,
    env: 'ORACLE_PASSWORD=...',
  },
  mongodb: {
    driver: 'mongodb',
    install: 'npm i kastor mongodb',
    adapter: 'mongodb',
    includes: '$lookup pipeline',
    returning: 'Native documents',
    upsert: 'findAndModify, then insert',
    insensitive: 'Regex with i flag',
    pagination: '$skip / $limit',
    note: "Keys are ObjectIds exposed as strings by default; `mongodb(db, { ids: 'int' })` keeps numbers like SQL. Transactions need a replica set (a single node one works locally).",
    setup: `import { MongoClient } from 'mongodb'
import { kastor } from 'kastor'
import { mongodb } from 'kastor/mongodb'
import { schema, relations } from './schema'

const client = await new MongoClient(process.env.MONGO_URL!).connect()

export const db = kastor({ adapter: mongodb(client.db('app')), schema, relations })`,
    env: 'MONGO_URL=mongodb://localhost:27017/?replicaSet=rs0',
  },
};
