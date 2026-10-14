import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { createClient } from '@libsql/client';
import { afterAll } from 'vitest';
import { libsql } from '../src/libsql';
import { sqlite } from '../src/sqlite';
import { runConformance } from './helpers/conformance';

const dir = mkdtempSync(join(tmpdir(), 'kastor-sqlite-conformance-'));
afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows may keep a database file open a little longer
  }
});

let nodeSqlite: { DatabaseSync: new (path: string) => unknown } | undefined;
try {
  const specifier = 'node:sqlite';
  nodeSqlite = (await import(/* @vite-ignore */ specifier)) as never;
} catch {
  nodeSqlite = undefined;
}

runConformance('sqlite (better-sqlite3, memory)', () => {
  const adapter = sqlite(new Database(':memory:'));
  return { adapter, close: () => adapter.executor.close!() };
});

runConformance('sqlite (better-sqlite3, file)', () => {
  const adapter = sqlite(new Database(join(dir, 'better.db')));
  return { adapter, close: () => adapter.executor.close!() };
});

runConformance(
  'sqlite (node:sqlite)',
  () => {
    const adapter = sqlite(new nodeSqlite!.DatabaseSync(join(dir, 'node.db')) as never);
    return { adapter, close: () => adapter.executor.close!() };
  },
  { enabled: !!nodeSqlite },
);

runConformance('sqlite (libsql, local file)', () => {
  const adapter = libsql(createClient({ url: pathToFileURL(join(dir, 'libsql.db')).href }));
  return { adapter, close: () => adapter.executor.close!() };
});
