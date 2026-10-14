import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checksum,
  nextId,
  readLock,
  readMigrations,
  renderMigration,
  sanitizeName,
  suggestName,
  timestamp,
  writeLock,
  writeMigration,
} from '../src/migrate/files';
import { BLOCK_MARKER, formatStatement, isBlockStatement, splitStatements, stripLeadingComments } from '../src/migrate/sql-split';
import type { MigrationOp } from '../src/migrate/ops';

describe('splitStatements', () => {
  it('splits on semicolons and drops comments and blank statements', () => {
    const sql = '-- header\nCREATE TABLE a (id int);\n\n-- next\nCREATE INDEX i ON a (id);\n;\n';
    expect(splitStatements(sql)).toEqual(['CREATE TABLE a (id int)', 'CREATE INDEX i ON a (id)']);
  });

  it('keeps semicolons inside strings, quoted names and comments', () => {
    const sql = `INSERT INTO t VALUES ('a;b', 'it''s; fine');\nCREATE TABLE "x;y" ([a;b] int, \`c;d\` int);\nSELECT 1 /* ; */;`;
    expect(splitStatements(sql)).toEqual([`INSERT INTO t VALUES ('a;b', 'it''s; fine')`, 'CREATE TABLE "x;y" ([a;b] int, `c;d` int)', 'SELECT 1 /* ; */']);
  });

  it('keeps dollar quoted bodies together', () => {
    const sql = `CREATE FUNCTION f() RETURNS int AS $body$ BEGIN RETURN 1; END; $body$ LANGUAGE plpgsql;\nDO $$ BEGIN PERFORM 1; END $$;\nSELECT 2`;
    const out = splitStatements(sql);
    expect(out).toHaveLength(3);
    expect(out[0]).toContain('RETURN 1; END;');
    expect(out[2]).toBe('SELECT 2');
  });

  it('does not treat a $1 parameter as a dollar quote', () => {
    expect(splitStatements('SELECT $1; SELECT $2')).toEqual(['SELECT $1', 'SELECT $2']);
  });

  it('reads blocks closed by a slash or GO line', () => {
    const sql = `${BLOCK_MARKER}\nBEGIN\n  EXECUTE IMMEDIATE 'DROP TABLE t';\nEXCEPTION WHEN OTHERS THEN NULL;\nEND;\n/\nCREATE TABLE t (id int);\nBEGIN TRY SELECT 1; END TRY BEGIN CATCH SELECT 2; END CATCH\nGO\n`;
    const out = splitStatements(sql);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatch(/^BEGIN\n {2}EXECUTE IMMEDIATE/);
    expect(out[0]).toMatch(/END;$/);
    expect(out[1]).toBe('CREATE TABLE t (id int)');
    expect(out[2]).toMatch(/^BEGIN TRY/);
  });

  it('handles CRLF files', () => {
    expect(splitStatements('SELECT 1;\r\nSELECT 2;\r\n')).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('round trips statements through formatStatement', () => {
    const statements = ['CREATE TABLE a (id int)', "BEGIN\n  EXECUTE IMMEDIATE 'X';\nEND;", "INSERT INTO a VALUES (';')", 'SELECT 1;'];
    const text = statements.map(formatStatement).join('\n\n');
    expect(splitStatements(text)).toEqual(['CREATE TABLE a (id int)', "BEGIN\n  EXECUTE IMMEDIATE 'X';\nEND;", "INSERT INTO a VALUES (';')", 'SELECT 1']);
    expect(isBlockStatement('CREATE TRIGGER t BEGIN SELECT 1; SELECT 2; END')).toBe(true);
    expect(isBlockStatement('SELECT 1')).toBe(false);
  });

  it('strips leading comments only', () => {
    expect(stripLeadingComments('-- a\n/* b */\n  SELECT 1 -- c')).toBe('SELECT 1 -- c');
    expect(stripLeadingComments('-- only')).toBe('');
  });
});

describe('names and ids', () => {
  it('sanitizes names', () => {
    expect(sanitizeName('Add Posts & Tags!')).toBe('add_posts_tags');
    expect(sanitizeName('Ação rápida')).toBe('acao_rapida');
    expect(sanitizeName('***')).toBe('migration');
    expect(sanitizeName('x'.repeat(80))).toHaveLength(60);
  });

  it('formats UTC timestamps', () => {
    expect(timestamp(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)))).toBe('20260102030405');
  });

  it('suggests names from the ops', () => {
    const table = { name: 'users', columns: [], primaryKey: [], indexes: [], foreignKeys: [] };
    expect(suggestName([])).toBe('empty');
    expect(suggestName([{ kind: 'createTable', table }, { kind: 'createIndex', table: 'users', index: { name: 'i', columns: ['a'], unique: false } }])).toBe('create_users');
    expect(suggestName([{ kind: 'addColumn', table: 'users', column: { name: 'bio', type: 'text', nullable: true } }])).toBe('add_users_bio');
    expect(suggestName([{ kind: 'dropColumn', table: 'users', column: 'bio' }, { kind: 'dropTable', table: 'x' }])).toBe('drop_users_bio_and_more');
    const many: MigrationOp[] = ['a', 'b', 'c', 'd'].map((n) => ({ kind: 'createTable', table: { ...table, name: n } }));
    expect(suggestName(many)).toBe('create_a_b_c_and_more');
  });
});

describe('migration folders', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kastor-files-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes and reads migrations in order, ignoring other folders', () => {
    writeMigration(dir, '20260102000000_second', 'SELECT 2;\n');
    writeMigration(dir, '20260101000000_first', 'SELECT 1;\n');
    mkdirSync(join(dir, 'not_a_migration'));
    mkdirSync(join(dir, '20260103000000_no_file'));
    writeFileSync(join(dir, 'README.txt'), 'hi');
    const list = readMigrations(dir);
    expect(list.map((m) => m.id)).toEqual(['20260101000000_first', '20260102000000_second']);
    expect(list[0]!.name).toBe('first');
    expect(list[0]!.checksum).toBe(checksum('SELECT 1;\n'));
    expect(readMigrations(join(dir, 'missing'))).toEqual([]);
  });

  it('ignores line endings in checksums', () => {
    expect(checksum('a\r\nb\r\n')).toBe(checksum('a\nb\n'));
    expect(checksum('a')).not.toBe(checksum('b'));
    expect(checksum('a')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never reuses or goes back in time for ids', () => {
    const now = new Date(Date.UTC(2026, 4, 1, 10, 0, 0));
    writeMigration(dir, `${timestamp(now)}_a`, '');
    expect(nextId(dir, 'b', now)).toBe('20260501100001_b');
    expect(nextId(dir, 'c', new Date(Date.UTC(2020, 0, 1)))).toBe('20260501100001_c');
    expect(nextId(dir, 'Later One', new Date(Date.UTC(2027, 0, 1)))).toBe('20270101000000_later_one');
  });

  it('writes and reads the lock file', () => {
    expect(readLock(dir)).toBeUndefined();
    writeLock(dir, 'postgres');
    expect(readLock(dir)).toBe('postgres');
    expect(readFileSync(join(dir, 'migration_lock.toml'), 'utf8')).toContain('dialect = "postgres"');
  });
});

describe('renderMigration', () => {
  it('writes a readable header, one comment per change and the statements', () => {
    const sql = renderMigration({
      id: '20260101000000_init',
      dialect: 'postgres',
      version: '0.1.0',
      date: new Date(Date.UTC(2026, 0, 1, 12, 0, 0)),
      steps: [
        { op: { kind: 'dropColumn', table: 'users', column: 'age' }, statements: ['ALTER TABLE "users" DROP COLUMN "age"'] },
        { op: { kind: 'createEnum', enum: { name: 'role', values: ['a'] } }, statements: [] },
        { op: { kind: 'raw', sql: 'x', comment: 'Backfill' }, statements: ["DO $$ BEGIN UPDATE t SET a = 1; END $$"] },
      ],
      warnings: [{ level: 'danger', message: 'Column users.age will be dropped with its data.' }],
    });
    expect(sql).toMatchInlineSnapshot(`
      "-- Migration 20260101000000_init
      -- Written by kastor 0.1.0 for postgres on 2026-01-01 12:00:00 UTC.
      -- Applied by \`kastor migrate deploy\`. Edit it before it is applied if you need to;
      -- after that, the checksum in _kastor_migrations must keep matching.
      --
      -- Changes:
      --   - Drop column users.age  [data loss]
      --   + Create enum role (a)
      --   ~ Backfill
      --
      -- Warnings:
      --   Column users.age will be dropped with its data.

      -- Drop column users.age
      ALTER TABLE "users" DROP COLUMN "age";

      -- Backfill
      DO $$ BEGIN UPDATE t SET a = 1; END $$;
      "
    `);
    expect(splitStatements(sql)).toEqual(['ALTER TABLE "users" DROP COLUMN "age"', 'DO $$ BEGIN UPDATE t SET a = 1; END $$']);
  });

  it('notes an empty migration', () => {
    const sql = renderMigration({ id: 'x', dialect: 'sqlite', version: '0.1.0', steps: [] });
    expect(sql).toContain('This migration is empty');
    expect(splitStatements(sql)).toEqual([]);
  });
});
