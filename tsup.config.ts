import { defineConfig } from 'tsup';

// Every public entry point. Owners fill the files; the list lives here so the
// build, the exports map in package.json and the docs never drift apart.
export const entries = {
  index: 'src/index.ts',
  postgres: 'src/postgres.ts',
  cockroach: 'src/cockroach.ts',
  sqlite: 'src/sqlite.ts',
  libsql: 'src/libsql.ts',
  d1: 'src/d1.ts',
  mysql: 'src/mysql.ts',
  mariadb: 'src/mariadb.ts',
  mssql: 'src/mssql.ts',
  oracle: 'src/oracle.ts',
  mongodb: 'src/mongodb.ts',
  migrate: 'src/migrate/index.ts',
};

const drivers = [
  'pg',
  'postgres',
  'better-sqlite3',
  '@libsql/client',
  'mysql2',
  'mysql2/promise',
  'mariadb',
  'mssql',
  'tedious',
  'oracledb',
  'mongodb',
  'bun:sqlite',
  'node:sqlite',
];

export default defineConfig([
  {
    entry: entries,
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    splitting: true,
    treeshake: true,
    target: 'node18',
    platform: 'node',
    external: drivers,
  },
  {
    entry: { cli: 'src/cli/index.ts' },
    format: ['esm'],
    target: 'node18',
    platform: 'node',
    external: drivers,
  },
  {
    // Core only, no Node imports: lets the docs playground compile queries
    // to SQL in the browser.
    entry: { 'kastor.browser': 'src/index.ts' },
    format: ['esm'],
    target: 'es2020',
    platform: 'browser',
    minify: true,
    outExtension: () => ({ js: '.js' }),
  },
  {
    // Script tag build: exposes the core as the global `Kastor`.
    entry: { kastor: 'src/index.ts' },
    format: ['iife'],
    globalName: 'Kastor',
    target: 'es2020',
    platform: 'browser',
    minify: true,
    outExtension: () => ({ js: '.js' }),
  },
]);
