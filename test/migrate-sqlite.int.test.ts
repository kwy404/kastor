import Database from 'better-sqlite3';
import { createClient } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { libsql } from '../src/libsql';
import { sqlite } from '../src/sqlite';
import { runMigrateSuite } from './migrate-suite';

// SQLite needs no server, so these always run.
runMigrateSuite(
  'sqlite (better-sqlite3)',
  async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kastor-mig-sqlite-'));
    const db = new Database(join(dir, 'dev.db'));
    return {
      adapter: sqlite(db),
      close: async () => {
        db.close();
        rmSync(dir, { recursive: true, force: true });
      },
    };
  },
  { enabled: true },
);

runMigrateSuite(
  'sqlite (libSQL file)',
  async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kastor-mig-libsql-'));
    const client = createClient({ url: `file:${join(dir, 'dev.db').replace(/\\/g, '/')}` });
    return {
      adapter: libsql(client),
      close: async () => {
        client.close();
        // Windows keeps the file locked for a moment after close.
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          /* left in the temp folder */
        }
      },
    };
  },
  { enabled: true },
);
