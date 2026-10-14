import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, describe, expect, it } from 'vitest';
import { baseline, prismaDate, readPrismaMigrationRow } from '../src/migrate/baseline';
import { status } from '../src/migrate/engine';
import { sqlite } from '../src/sqlite';

const dir = mkdtempSync(join(tmpdir(), 'kastor-baseline-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const ms = Date.UTC(2024, 0, 1);

describe('reading _prisma_migrations rows', () => {
  it('reads every date form drivers return', () => {
    expect(prismaDate(new Date(ms))?.getTime()).toBe(ms);
    expect(prismaDate(ms)?.getTime()).toBe(ms);
    expect(prismaDate(BigInt(ms))?.getTime()).toBe(ms);
    expect(prismaDate(String(ms))?.getTime()).toBe(ms);
    expect(prismaDate('2024-01-01 00:00:00')?.getTime()).toBe(ms);
    expect(prismaDate('2024-01-01 00:00:00.000')?.getTime()).toBe(ms);
    expect(prismaDate('2024-01-01T00:00:00.000Z')?.getTime()).toBe(ms);
    expect(prismaDate('2024-01-01T03:00:00+03:00')?.getTime()).toBe(ms);
    expect(prismaDate(null)).toBeUndefined();
    expect(prismaDate(undefined)).toBeUndefined();
    expect(prismaDate('not a date')).toBeUndefined();
  });

  it('counts any non-null finished_at and rolled_back_at, whatever the form', () => {
    const forms: unknown[] = [ms, BigInt(ms), String(ms), '2024-01-01 00:00:00', new Date(ms)];
    for (const value of forms) {
      const row = readPrismaMigrationRow({ migration_name: '20240101000000_init', finished_at: value, rolled_back_at: null });
      expect(row).toEqual({ name: '20240101000000_init', finished: true, rolledBack: false, finishedAt: new Date(ms) });
      expect(readPrismaMigrationRow({ migration_name: 'x', finished_at: null, rolled_back_at: value })).toEqual({ name: 'x', finished: false, rolledBack: true });
    }
    // Unreadable but present still means finished; the date is just unknown.
    expect(readPrismaMigrationRow({ migration_name: 'x', finished_at: 'garbage', rolled_back_at: null })).toEqual({ name: 'x', finished: true, rolledBack: false });
    expect(readPrismaMigrationRow({ migration_name: 'x', finished_at: 0, rolled_back_at: undefined })).toEqual({ name: 'x', finished: true, rolledBack: false, finishedAt: new Date(0) });
    expect(readPrismaMigrationRow({ MIGRATION_NAME: 'upper', FINISHED_AT: ms, ROLLED_BACK_AT: null })).toMatchObject({ name: 'upper', finished: true });
  });
});

describe('migrate baseline --from-prisma on SQLite with Prisma timestamps', () => {
  it('records migrations whose finished_at is Unix milliseconds, skips rolled back and unfinished ones', async () => {
    const prisma = join(dir, 'prisma', 'migrations');
    const folders = ['20240101000000_init', '20240102000000_add', '20240103000000_rolled_back', '20240104000000_failed', '20240105000000_retried'];
    for (const f of folders) {
      mkdirSync(join(prisma, f), { recursive: true });
      writeFileSync(join(prisma, f, 'migration.sql'), `-- ${f}\n`);
    }
    const db = new Database(':memory:');
    db.exec('CREATE TABLE "User" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "email" TEXT NOT NULL)');
    // The table and values as Prisma Migrate writes them on SQLite: DateTime columns hold Unix milliseconds.
    db.exec(`CREATE TABLE "_prisma_migrations" ("id" TEXT PRIMARY KEY NOT NULL, "checksum" TEXT NOT NULL, "finished_at" DATETIME, "migration_name" TEXT NOT NULL, "logs" TEXT, "rolled_back_at" DATETIME, "started_at" DATETIME NOT NULL DEFAULT current_timestamp, "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0)`);
    const insert = db.prepare('INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, rolled_back_at, started_at, applied_steps_count) VALUES (?, ?, ?, ?, ?, ?, ?)');
    insert.run('1', 'a', ms, '20240101000000_init', null, ms - 50, 1);
    insert.run('2', 'b', ms + 86_400_000, '20240102000000_add', null, ms + 86_400_000 - 50, 1);
    insert.run('3', 'c', null, '20240103000000_rolled_back', ms + 2 * 86_400_000, ms + 2 * 86_400_000 - 50, 0);
    insert.run('4', 'd', null, '20240104000000_failed', null, ms + 3 * 86_400_000, 0);
    insert.run('5', 'e', null, '20240105000000_retried', ms + 4 * 86_400_000, ms + 4 * 86_400_000, 0);
    insert.run('6', 'e', ms + 4 * 86_400_000 + 10, '20240105000000_retried', null, ms + 4 * 86_400_000 + 5, 1);
    const adapter = sqlite(db);
    const migrations = join(dir, 'kastor', 'migrations');
    const result = await baseline(adapter, migrations, { version: 'test', fromPrisma: prisma });
    expect(result.history.map((h) => [h.folder, h.state])).toEqual([
      ['20240101000000_init', 'recorded'],
      ['20240102000000_add', 'recorded'],
      ['20240103000000_rolled_back', 'not applied'],
      ['20240104000000_failed', 'failed'],
      ['20240105000000_retried', 'recorded'],
    ]);
    const st = await status(adapter, migrations);
    expect(st.history.map((h) => h.id)).toEqual(['prisma/20240101000000_init', 'prisma/20240102000000_add', 'prisma/20240105000000_retried']);
    expect(st.history[0]!.appliedAt.getTime()).toBe(ms);
    expect(result.notes.join('\n')).toContain('did not finish (20240104000000_failed)');
    db.close();
  });
});
