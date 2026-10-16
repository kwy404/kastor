import Database from 'better-sqlite3';
import { kastor } from 'kastor-orm';
import { sqlite } from 'kastor-orm/sqlite';
import { relations, schema } from './schema';

const create = () => kastor({ adapter: sqlite(new Database(process.env.DATABASE_URL ?? 'dev.db')), schema, relations });

export type Db = ReturnType<typeof create>;

// One client for the whole server, kept across hot reloads in development.
const cache = globalThis as unknown as { kastorDb?: Db };
export const db: Db = cache.kastorDb ?? create();
if (process.env.NODE_ENV !== 'production') cache.kastorDb = db;
