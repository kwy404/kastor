/**
 * Migration files on disk: `kastor/migrations/<timestamp>_<name>/migration.sql`,
 * readable SQL with a commented header, and a lock file that records which
 * database the folder targets.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeOp, isDestructive, type MigrationOp } from './ops';
import { formatStatement } from './sql-split';
import type { DiffWarning } from './diff';

export const MIGRATION_FILE = 'migration.sql';
export const LOCK_FILE = 'migration_lock.toml';

export interface LocalMigration {
  /** Folder name, `<timestamp>_<name>`. */
  id: string;
  name: string;
  dir: string;
  file: string;
  sql: string;
  checksum: string;
}

/** sha256 of the file with line endings normalized, so a checkout with CRLF matches. */
export function checksum(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n?/g, '\n'), 'utf8').digest('hex');
}

/** `20261013224700`, UTC. */
export function timestamp(date = new Date()): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`;
}

/** Lower snake case, letters, digits and underscores, at most 60 characters. */
export function sanitizeName(name: string): string {
  const clean = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
    .replace(/_+$/, '');
  return clean || 'migration';
}

/** A short name that says what the migration does, used when `--name` is left out. */
export function suggestName(ops: MigrationOp[]): string {
  if (!ops.length) return 'empty';
  const created = ops.filter((o) => o.kind === 'createTable').map((o) => (o.kind === 'createTable' ? o.table.name : ''));
  if (created.length && created.length === ops.filter((o) => o.kind !== 'createIndex' && o.kind !== 'createEnum' && o.kind !== 'addForeignKey').length) {
    return sanitizeName(`create_${created.slice(0, 3).join('_')}${created.length > 3 ? '_and_more' : ''}`);
  }
  const first = ops.find((o) => o.kind !== 'createIndex' && o.kind !== 'createEnum') ?? ops[0]!;
  const base = (() => {
    switch (first.kind) {
      case 'addColumn':
        return `add_${first.table}_${first.column.name}`;
      case 'dropColumn':
        return `drop_${first.table}_${first.column}`;
      case 'alterColumn':
        return `alter_${first.table}_${first.column}`;
      case 'renameColumn':
        return `rename_${first.table}_${first.from}`;
      case 'renameTable':
        return `rename_${first.from}`;
      case 'dropTable':
        return `drop_${first.table}`;
      case 'createTable':
        return `create_${first.table.name}`;
      case 'createIndex':
      case 'dropIndex':
        return `${first.kind === 'createIndex' ? 'add' : 'drop'}_index_${first.table}`;
      case 'addForeignKey':
      case 'dropForeignKey':
        return `${first.kind === 'addForeignKey' ? 'add' : 'drop'}_fk_${first.table}`;
      case 'alterEnum':
        return `alter_enum_${first.name}`;
      case 'createEnum':
      case 'dropEnum':
        return `${first.kind === 'createEnum' ? 'create' : 'drop'}_enum_${first.enum.name}`;
      default:
        return 'custom';
    }
  })();
  return sanitizeName(ops.length > 1 ? `${base}_and_more` : base);
}

export interface RenderInput {
  id: string;
  dialect: string;
  version: string;
  /** Statements per op, in op order. */
  steps: Array<{ op: MigrationOp; statements: string[] }>;
  warnings?: DiffWarning[];
  date?: Date;
  /** Extra comment lines for the header, without the leading `--`. */
  note?: string[];
}

/** The migration.sql text: a header with a summary, then one commented block per op. */
export function renderMigration(input: RenderInput): string {
  const date = (input.date ?? new Date()).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  const lines: string[] = [
    `-- Migration ${input.id}`,
    `-- Written by kastor ${input.version} for ${input.dialect} on ${date}.`,
    '-- Applied by `kastor migrate deploy`. Edit it before it is applied if you need to;',
    '-- after that, the checksum in _kastor_migrations must keep matching.',
  ];
  if (input.note?.length) lines.push('--', ...input.note.map((l) => (l ? `-- ${l}` : '--')));
  if (input.steps.length) {
    lines.push('--', '-- Changes:');
    for (const { op } of input.steps) lines.push(`--   ${symbolFor(op)} ${describeOp(op)}${isDestructive(op) ? '  [data loss]' : ''}`);
  }
  if (input.warnings?.length) {
    lines.push('--', '-- Warnings:');
    for (const w of input.warnings) lines.push(`--   ${w.message}`);
  }
  lines.push('');
  for (const { op, statements } of input.steps) {
    if (!statements.length) continue;
    lines.push(`-- ${describeOp(op)}`);
    for (const s of statements) lines.push(formatStatement(s));
    lines.push('');
  }
  if (!input.steps.some((s) => s.statements.length)) lines.push('-- This migration is empty. Add your own SQL below.', '');
  return lines.join('\n');
}

export function symbolFor(op: MigrationOp): string {
  if (op.kind.startsWith('create') || op.kind.startsWith('add')) return '+';
  if (op.kind.startsWith('drop')) return '-';
  if (op.kind.startsWith('rename')) return '>';
  return '~';
}

/** Lists the migrations in a folder, oldest first. */
export function readMigrations(dir: string): LocalMigration[] {
  if (!existsSync(dir)) return [];
  const out: LocalMigration[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (!statSync(path).isDirectory()) continue;
    const m = /^(\d{14})_(.+)$/.exec(entry);
    if (!m) continue;
    const file = join(path, MIGRATION_FILE);
    if (!existsSync(file)) continue;
    const sql = readFileSync(file, 'utf8');
    out.push({ id: entry, name: m[2]!, dir: path, file, sql, checksum: checksum(sql) });
  }
  return out;
}

/** A new folder id after every existing one, even when two run in the same second. */
export function nextId(dir: string, name: string, date = new Date()): string {
  const existing = readMigrations(dir).map((m) => m.id.slice(0, 14));
  let stamp = timestamp(date);
  const last = existing.at(-1);
  if (last && last >= stamp) stamp = bumpStamp(last);
  return `${stamp}_${sanitizeName(name)}`;
}

function bumpStamp(stamp: string): string {
  const d = new Date(Date.UTC(+stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8), +stamp.slice(8, 10), +stamp.slice(10, 12), +stamp.slice(12, 14) + 1));
  return timestamp(d);
}

export function writeMigration(dir: string, id: string, sql: string): LocalMigration {
  const folder = join(dir, id);
  mkdirSync(folder, { recursive: true });
  const file = join(folder, MIGRATION_FILE);
  writeFileSync(file, sql, 'utf8');
  return { id, name: id.slice(15), dir: folder, file, sql, checksum: checksum(sql) };
}

/** Reads the dialect recorded in the lock file, if any. */
export function readLock(dir: string): string | undefined {
  const file = join(dir, LOCK_FILE);
  if (!existsSync(file)) return undefined;
  const m = /^\s*dialect\s*=\s*"([^"]+)"/m.exec(readFileSync(file, 'utf8'));
  return m?.[1];
}

export function writeLock(dir: string, dialect: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, LOCK_FILE),
    `# Written by kastor. The migrations in this folder are SQL for this database.\n# Commit this file with the migrations.\ndialect = "${dialect}"\n`,
    'utf8',
  );
}
