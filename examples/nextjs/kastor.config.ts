import Database from 'better-sqlite3';
import { defineConfig } from 'kastor-orm';
import { sqlite } from 'kastor-orm/sqlite';

export default defineConfig({
  schema: './src/db/schema.ts',
  adapter: () => sqlite(new Database(process.env.DATABASE_URL ?? 'dev.db')),
  migrations: './kastor/migrations',
  seed: './src/db/seed.ts',
});
