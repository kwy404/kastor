/**
 * `migrate baseline`: adopts a database that already has tables (made by
 * Prisma, Drizzle, TypeORM, Sequelize, Knex, Laravel, Django, Rails or by
 * hand). It writes the current schema as the first migration and records it
 * as applied without running it, so `migrate dev` only diffs what changes
 * afterwards, and `migrate deploy` on an empty database recreates everything.
 *
 * With `fromPrisma`, the folders of `prisma/migrations` are recorded as
 * history in `_kastor_migrations` (under `prisma/<folder>`), the files stay
 * where they are, and `_prisma_migrations` is never touched.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { KastorError } from '../core/errors';
import type { Adapter, SchemaIR } from '../core/ir';
import { diffSchemas } from './diff';
import { introspect, isHistoryId, planStatements, PRISMA_HISTORY_PREFIX, status, type PlannedStep } from './engine';
import { checksum, MIGRATION_FILE, nextId, renderMigration, writeLock, writeMigration, type LocalMigration } from './files';

/** First line of the note that marks a baseline migration file. */
export const BASELINE_MARKER = 'Baseline: the schema of the database when kastor took over.';

export interface BaselineOptions {
  /** Name of the migration. Default `baseline`. */
  name?: string;
  /** kastor version for the file header. */
  version: string;
  /** Folder of Prisma migrations to record as history. */
  fromPrisma?: string;
  date?: Date;
}

export interface HistoryEntry {
  /** Folder name in the Prisma migrations folder. */
  folder: string;
  /** Id in `_kastor_migrations`. */
  id: string;
  state: 'recorded' | 'already recorded' | 'not applied' | 'failed';
}

export interface BaselineResult {
  /** `created`: a new baseline file; `adopted`: the existing baseline file was marked as applied. */
  kind: 'created' | 'adopted';
  migration: LocalMigration;
  schema: SchemaIR;
  steps: PlannedStep[];
  history: HistoryEntry[];
  /** Things the user should know, as plain sentences. */
  notes: string[];
}

export interface PrismaMigrationFolder {
  folder: string;
  file: string;
  sql: string;
  checksum: string;
}

/** The Prisma migration folders (`<timestamp>_<name>/migration.sql`), oldest first. */
export function readPrismaMigrations(dir: string): PrismaMigrationFolder[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new KastorError('INVALID_ARGUMENT', `The Prisma migrations folder ${dir} does not exist.`, {
      hint: 'Pass the folder that holds the Prisma migration folders, usually --from-prisma prisma/migrations.',
    });
  }
  const out: PrismaMigrationFolder[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (!statSync(path).isDirectory()) continue;
    const file = join(path, MIGRATION_FILE);
    if (!existsSync(file)) continue;
    const sql = readFileSync(file, 'utf8');
    out.push({ folder: entry, file, sql, checksum: checksum(sql) });
  }
  return out;
}

export interface PrismaMigrationRow {
  name: string;
  /** `finished_at` is set: the migration ran to the end. */
  finished: boolean;
  /** `rolled_back_at` is set. */
  rolledBack: boolean;
  /** When it finished, when the value can be read as a date. */
  finishedAt?: Date;
}

/**
 * Reads a date the way drivers hand back Prisma's timestamps: a Date, text
 * (`2024-01-01 00:00:00`, ISO 8601), or Unix milliseconds as a number, bigint
 * or digit string (Prisma's default on SQLite). Undefined when unreadable.
 */
export function prismaDate(value: unknown): Date | undefined {
  if (value === null || value === undefined) return undefined;
  let date: Date;
  if (value instanceof Date) date = value;
  else if (typeof value === 'number' || typeof value === 'bigint') date = new Date(Number(value));
  else {
    const text = String(value).trim();
    if (/^-?\d+(\.\d+)?$/.test(text)) date = new Date(Number(text));
    else date = new Date(/^\d{4}-\d{2}-\d{2}[ T]\d/.test(text) && !/([zZ]|[+-]\d{2}:?\d{2})$/.test(text) ? `${text.replace(' ', 'T')}Z` : text);
  }
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** One row of `_prisma_migrations`. Any non-null `finished_at` or `rolled_back_at` counts, whatever its form. */
export function readPrismaMigrationRow(row: Record<string, unknown>): PrismaMigrationRow {
  const get = (key: string): unknown => (key in row ? row[key] : row[key.toUpperCase()]);
  const finished = get('finished_at');
  const rolledBack = get('rolled_back_at');
  const finishedAt = prismaDate(finished);
  return {
    name: String(get('migration_name')),
    finished: finished !== null && finished !== undefined,
    rolledBack: rolledBack !== null && rolledBack !== undefined,
    ...(finishedAt ? { finishedAt } : {}),
  };
}

/** Rows of `_prisma_migrations`, or undefined when the table cannot be read. */
async function prismaApplied(adapter: Adapter): Promise<Map<string, PrismaMigrationRow> | undefined> {
  if (adapter.dialect.name === 'mongodb') return undefined;
  try {
    const res = await adapter.executor.query('SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations', []);
    const map = new Map<string, PrismaMigrationRow>();
    for (const raw of res.rows) {
      const row = readPrismaMigrationRow(raw);
      // A migration Prisma retried keeps the old failed row next to the new one: the finished one wins.
      const known = map.get(row.name);
      if (!known || (row.finished && !row.rolledBack)) map.set(row.name, row);
    }
    return map;
  } catch {
    return undefined;
  }
}

/** Writes the current schema as the first migration and records it as applied without running it. */
export async function baseline(adapter: Adapter, dir: string, options: BaselineOptions): Promise<BaselineResult> {
  const { dialect, executor } = adapter;
  const st = await status(adapter, dir);
  if (st.lockDialect && st.lockDialect !== dialect.name) {
    throw new KastorError('MIGRATION_FAILED', `The migrations in ${dir} were written for ${st.lockDialect}, but the config connects to ${dialect.name}.`, {
      hint: 'Point the config at the right database, or baseline into an empty migrations folder.',
    });
  }
  if (st.applied.length) {
    throw new KastorError('MIGRATION_FAILED', `The database already has ${st.applied.length} kastor migration${st.applied.length === 1 ? '' : 's'} applied, so it needs no baseline.`, {
      hint: 'Use kastor migrate dev for new changes, and kastor migrate status to see where it stands.',
      meta: { applied: st.applied.map((a) => a.id) },
    });
  }
  const first = st.local[0];
  if (first && !first.sql.includes(BASELINE_MARKER)) {
    throw new KastorError('MIGRATION_FAILED', `${dir} already has migrations, and the first one (${first.id}) is not a baseline.`, {
      hint: 'A baseline must be the first migration. Use kastor migrate deploy to apply the existing migrations instead.',
    });
  }
  const notes: string[] = [];
  const history = options.fromPrisma ? await recordPrismaHistory(adapter, options.fromPrisma, notes) : [];

  // A teammate already committed the baseline: this database only has to be marked.
  if (first) {
    await dialect.migrationTable.record(executor, { id: first.id, checksum: first.checksum, appliedAt: new Date() });
    if (st.local.length > 1) notes.push(`${st.local.length - 1} later migration(s) are pending; apply them with kastor migrate deploy.`);
    return { kind: 'adopted', migration: first, schema: await introspect(adapter), steps: [], history, notes };
  }

  const live = await introspect(adapter);
  if (!live.tables.length) {
    throw new KastorError('MIGRATION_FAILED', 'The database has no tables, so there is nothing to baseline.', {
      hint: 'Run kastor migrate dev --name init to create the first migration from the schema.',
    });
  }
  const diff = diffSchemas({ tables: [] }, live, { dialect });
  const steps = planStatements(dialect, { tables: [] }, diff.ops);
  const id = nextId(dir, options.name ?? 'baseline', options.date);
  const sql = renderMigration({
    id,
    dialect: dialect.name,
    version: options.version,
    steps,
    ...(options.date ? { date: options.date } : {}),
    note: [
      BASELINE_MARKER,
      'It was recorded as applied without running. On an empty database, kastor migrate deploy',
      'runs it to create every table.',
    ],
  });
  const migration = writeMigration(dir, id, sql);
  writeLock(dir, dialect.name);
  await dialect.migrationTable.record(executor, { id: migration.id, checksum: migration.checksum, appliedAt: new Date() });
  return { kind: 'created', migration, schema: live, steps, history, notes };
}

async function recordPrismaHistory(adapter: Adapter, folder: string, notes: string[]): Promise<HistoryEntry[]> {
  const { dialect, executor } = adapter;
  const folders = readPrismaMigrations(folder);
  if (!folders.length) notes.push(`${folder} has no Prisma migrations (folders with a migration.sql).`);
  const applied = await prismaApplied(adapter);
  if (!applied) notes.push('The database has no _prisma_migrations table, so every Prisma migration folder was recorded as applied.');
  const recorded = new Set((await dialect.migrationTable.list(executor)).filter((a) => isHistoryId(a.id)).map((a) => a.id));
  const out: HistoryEntry[] = [];
  for (const f of folders) {
    const id = `${PRISMA_HISTORY_PREFIX}${f.folder}`;
    if (recorded.has(id)) {
      out.push({ folder: f.folder, id, state: 'already recorded' });
      continue;
    }
    const row = applied?.get(f.folder);
    if (applied && (!row || row.rolledBack)) {
      out.push({ folder: f.folder, id, state: 'not applied' });
      continue;
    }
    if (applied && row && !row.finished) {
      out.push({ folder: f.folder, id, state: 'failed' });
      continue;
    }
    await dialect.migrationTable.record(executor, { id, checksum: f.checksum, appliedAt: row?.finishedAt ?? new Date() });
    out.push({ folder: f.folder, id, state: 'recorded' });
  }
  if (applied) {
    const known = new Set(folders.map((f) => f.folder));
    const extra = [...applied.keys()].filter((name) => !known.has(name));
    if (extra.length) notes.push(`_prisma_migrations lists ${extra.length} migration(s) that are not in ${folder}: ${extra.join(', ')}.`);
  }
  const pending = out.filter((h) => h.state === 'not applied');
  if (pending.length) notes.push(`${pending.length} Prisma migration(s) were never applied to this database (${pending.map((p) => p.folder).join(', ')}); they were not recorded and are not part of the baseline.`);
  const failed = out.filter((h) => h.state === 'failed');
  if (failed.length) notes.push(`${failed.length} Prisma migration(s) did not finish (${failed.map((p) => p.folder).join(', ')}); check the tables they touch.`);
  return out;
}
