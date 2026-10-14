/**
 * The migration engine: status, deploy, dev, push and reset on top of a
 * dialect, an executor and a folder of migration files. It prints nothing;
 * the CLI and the studio render what it returns and the hooks it calls.
 */
import { KastorError } from '../core/errors';
import type { Adapter, AppliedMigration, Dialect, Executor, MigrationOpLike, SchemaIR } from '../core/ir';
import {
  diffSchemas,
  findColumnRenameCandidates,
  findTableRenameCandidates,
  type DiffResult,
  type Rename,
  type RenameCandidate,
} from './diff';
import { nextId, readLock, readMigrations, renderMigration, suggestName, writeLock, writeMigration, type LocalMigration } from './files';
import { applyOp, rawSqlFor, type MigrationOp } from './ops';
import { splitStatements, stripLeadingComments } from './sql-split';

export const MIGRATIONS_TABLE = '_kastor_migrations';

export interface MigrationHooks {
  /** Called before each migration runs. */
  onApply?(migration: LocalMigration): void;
  /** Called after each migration ran and was recorded. */
  onApplied?(migration: LocalMigration, ms: number): void;
}

const isMigrationsTable = (name: string): boolean => name.toLowerCase() === MIGRATIONS_TABLE;

/**
 * Bookkeeping tables of other migration tools. kastor never declares, diffs or
 * drops them, so a project can move to kastor (or run both for a while)
 * without losing the other tool's history. Generic names such as `migrations`
 * (Laravel, TypeORM) are not listed because they could be real tables.
 */
export const FOREIGN_HISTORY_TABLES: readonly string[] = [
  '_prisma_migrations',
  '__drizzle_migrations',
  'knex_migrations',
  'knex_migrations_lock',
  'sequelizemeta',
  'schema_migrations',
  'ar_internal_metadata',
  'django_migrations',
  '__efmigrationshistory',
  'flyway_schema_history',
  'databasechangelog',
  'databasechangeloglock',
];

/** True for kastor's own table and the history tables of other tools. */
export function isBookkeepingTable(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === MIGRATIONS_TABLE || FOREIGN_HISTORY_TABLES.includes(lower);
}

/** The live schema without kastor's own bookkeeping table and the history tables of other migration tools. */
export async function introspect(adapter: Adapter): Promise<SchemaIR> {
  const schema = await adapter.dialect.introspect(adapter.executor);
  return { ...schema, tables: schema.tables.filter((t) => !isBookkeepingTable(t.name)) };
}

/** Prefix of the ids under which `migrate baseline --from-prisma` records Prisma migrations. */
export const PRISMA_HISTORY_PREFIX = 'prisma/';

/** Applied ids that record another tool's migrations: history, not kastor folders. */
export const isHistoryId = (id: string): boolean => id.startsWith(PRISMA_HISTORY_PREFIX);

export interface PlannedStep {
  op: MigrationOp;
  statements: string[];
}

/** Turns ops into DDL, handing every op the schema as it is after that op. */
export function planStatements(dialect: Pick<Dialect, 'name' | 'ddl'>, current: SchemaIR, ops: MigrationOp[]): PlannedStep[] {
  let state = current;
  const steps: PlannedStep[] = [];
  for (const op of ops) {
    state = applyOp(state, op);
    const statements = op.kind === 'raw' ? rawSqlFor(op, dialect.name) : dialect.ddl(op as unknown as MigrationOpLike, state);
    steps.push({ op, statements });
  }
  return steps;
}

/* ------------------------------------------------------------------------ */
/* Status                                                                    */
/* ------------------------------------------------------------------------ */

export interface MigrationStatus {
  local: LocalMigration[];
  applied: AppliedMigration[];
  /** Local migrations not applied yet, oldest first. */
  pending: LocalMigration[];
  /** Applied migrations whose file changed afterwards. */
  modified: Array<{ local: LocalMigration; applied: AppliedMigration }>;
  /** Applied migrations whose folder is gone. */
  missing: AppliedMigration[];
  /** Migrations of another tool recorded as history by `migrate baseline --from-prisma`. */
  history: AppliedMigration[];
  /** Dialect written in the lock file, if any. */
  lockDialect?: string;
}

export async function status(adapter: Adapter, dir: string): Promise<MigrationStatus> {
  const { dialect, executor } = adapter;
  await dialect.migrationTable.ensure(executor);
  const all = (await dialect.migrationTable.list(executor)).sort((a, b) => a.id.localeCompare(b.id));
  const applied = all.filter((a) => !isHistoryId(a.id));
  const local = readMigrations(dir);
  const byId = new Map(applied.map((a) => [a.id, a]));
  const localIds = new Set(local.map((m) => m.id));
  return {
    local,
    applied,
    pending: local.filter((m) => !byId.has(m.id)),
    modified: local.filter((m) => byId.has(m.id) && byId.get(m.id)!.checksum !== m.checksum).map((m) => ({ local: m, applied: byId.get(m.id)! })),
    missing: applied.filter((a) => !localIds.has(a.id)),
    history: all.filter((a) => isHistoryId(a.id)),
    lockDialect: readLock(dir),
  };
}

function checkLock(adapter: Adapter, st: MigrationStatus, dir: string): void {
  if (st.lockDialect && st.lockDialect !== adapter.dialect.name) {
    throw new KastorError('MIGRATION_FAILED', `The migrations in ${dir} were written for ${st.lockDialect}, but the config connects to ${adapter.dialect.name}.`, {
      hint: 'Point the config at the right database, or move the old migrations away and create new ones with kastor migrate dev.',
      meta: { lock: st.lockDialect, dialect: adapter.dialect.name },
    });
  }
}

function checkModified(st: MigrationStatus, dev: boolean): void {
  if (!st.modified.length) return;
  const ids = st.modified.map((m) => m.local.id);
  throw new KastorError('MIGRATION_DRIFT', `Migration${ids.length > 1 ? 's' : ''} ${ids.join(', ')} changed after ${ids.length > 1 ? 'they were' : 'it was'} applied.`, {
    hint: dev
      ? 'Restore the file from version control, or run kastor migrate reset to rebuild the development database from the files.'
      : 'Restore the file from version control. Applied migrations must not change; write a new migration instead.',
    meta: { migrations: ids },
  });
}

/* ------------------------------------------------------------------------ */
/* Apply                                                                     */
/* ------------------------------------------------------------------------ */

/**
 * Statements of a migration file. SQL files are written by `renderMigration`,
 * so the shared splitter (which understands its block markers) reads them;
 * databases without SQL bring their own `splitScript`.
 */
export function statementsOf(dialect: Pick<Dialect, 'name' | 'splitScript'>, sql: string): string[] {
  return dialect.name === 'mongodb' && dialect.splitScript ? dialect.splitScript(sql) : splitStatements(sql);
}

/** Runs one migration file and records it, inside a transaction where DDL is transactional. */
export async function applyMigration(adapter: Adapter, migration: LocalMigration): Promise<void> {
  const { dialect } = adapter;
  const statements = statementsOf(dialect, migration.sql);
  await runScript(adapter, statements, migration.id, async (exec) => {
    await dialect.migrationTable.record(exec, { id: migration.id, checksum: migration.checksum, appliedAt: new Date() });
  });
}

const FK_OFF = /^\s*PRAGMA\s+foreign_keys\s*=\s*(OFF|0|false)\b/i;

/**
 * Runs statements as one unit: inside a transaction where DDL is
 * transactional, statement by statement otherwise. SQLite table rebuilds need
 * foreign keys off, which only works outside a transaction, so they are turned
 * off around it and checked with `PRAGMA foreign_key_check` before commit.
 */
async function runScript(adapter: Adapter, statements: string[], label: string, after?: (exec: Executor) => Promise<void>): Promise<void> {
  const { dialect, executor } = adapter;
  const run = async (exec: Executor): Promise<void> => {
    await runStatements(exec, statements, label);
    if (fkOff) {
      const broken = await exec.query('PRAGMA foreign_key_check', []);
      if (broken.rows.length) {
        const first = broken.rows[0]!;
        throw new KastorError('MIGRATION_FAILED', `${label} leaves ${broken.rows.length} row(s) whose foreign key points nowhere, for example in ${String(first.table)} (to ${String(first.parent)}).`, {
          hint: 'Fix or delete those rows in the migration before the tables are rebuilt.',
          meta: { migration: label, rows: broken.rows.slice(0, 20) },
        });
      }
    }
    await after?.(exec);
  };
  const fkOff = dialect.name === 'sqlite' && statements.some((s) => FK_OFF.test(stripLeadingComments(s)));
  if (fkOff) await executor.query('PRAGMA foreign_keys = OFF', []);
  try {
    if (dialect.features.transactionalDdl && dialect.features.transactions) await executor.transaction(run);
    else await run(executor);
  } finally {
    if (fkOff) await executor.query('PRAGMA foreign_keys = ON', []);
  }
}

async function runStatements(exec: Executor, statements: string[], label: string): Promise<void> {
  for (let i = 0; i < statements.length; i++) {
    const sql = statements[i]!;
    try {
      await exec.query(sql, []);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new KastorError('MIGRATION_FAILED', `${label} failed at statement ${i + 1} of ${statements.length}: ${reason}`, {
        hint: 'Fix the SQL or the data it trips on, then run the command again. Databases without transactional DDL keep the statements that already ran.',
        meta: { migration: label, statement: sql, index: i },
        cause: error,
      });
    }
  }
}

/** Applies every pending migration. The deploy command for CI and production. */
export async function deploy(adapter: Adapter, dir: string, hooks: MigrationHooks = {}): Promise<{ applied: LocalMigration[]; status: MigrationStatus }> {
  const st = await status(adapter, dir);
  checkLock(adapter, st, dir);
  checkModified(st, false);
  const applied: LocalMigration[] = [];
  for (const m of st.pending) {
    hooks.onApply?.(m);
    const start = Date.now();
    await applyMigration(adapter, m);
    hooks.onApplied?.(m, Date.now() - start);
    applied.push(m);
  }
  return { applied, status: st };
}

/* ------------------------------------------------------------------------ */
/* Renames                                                                   */
/* ------------------------------------------------------------------------ */

export interface RenameResolution {
  renames: Rename[];
  /** Candidates nobody answered (no flag, no prompt). */
  unresolved: RenameCandidate[];
}

/**
 * Settles possible renames: `flags` first, then `ask` for each remaining
 * candidate (return the new name, or null for drop and create). Without `ask`
 * the remaining candidates come back as unresolved.
 */
export async function resolveRenames(
  live: SchemaIR,
  target: SchemaIR,
  flags: Rename[] = [],
  ask?: (candidate: RenameCandidate) => Promise<string | null>,
): Promise<RenameResolution> {
  const renames: Rename[] = [];
  const unresolved: RenameCandidate[] = [];
  const settle = async (candidates: RenameCandidate[], kind: 'table' | 'column'): Promise<void> => {
    const taken = new Set(renames.filter((r) => r.kind === kind).map((r) => `${r.table ?? ''}.${r.to}`));
    for (const cand of candidates) {
      const options = cand.to.filter((name) => !taken.has(`${cand.table ?? ''}.${name}`));
      if (!options.length) continue;
      if (!ask) {
        unresolved.push({ ...cand, to: options });
        continue;
      }
      const answer = await ask({ ...cand, to: options });
      if (answer) {
        renames.push({ kind, table: cand.table, from: cand.from, to: answer });
        taken.add(`${cand.table ?? ''}.${answer}`);
      }
    }
  };
  const tableFlags = flags.filter((f) => f.kind === 'table');
  renames.push(...tableFlags);
  const flaggedTables = new Set(tableFlags.map((f) => f.from));
  await settle(
    findTableRenameCandidates(live, target).filter((c) => !flaggedTables.has(c.from)),
    'table',
  );
  const columnFlags = flags.filter((f) => f.kind === 'column');
  renames.push(...columnFlags);
  const flaggedColumns = new Set(columnFlags.map((f) => `${f.table}.${f.from}`));
  const tableRenames = renames.filter((r) => r.kind === 'table');
  await settle(
    findColumnRenameCandidates(live, target, tableRenames).filter((c) => !flaggedColumns.has(`${c.table}.${c.from}`)),
    'column',
  );
  return { renames, unresolved };
}

/* ------------------------------------------------------------------------ */
/* Dev, push, reset                                                          */
/* ------------------------------------------------------------------------ */

export interface ChangeOptions {
  /** `--rename` answers. */
  renames?: Rename[];
  /** Interactive rename question; see `resolveRenames`. */
  askRename?: (candidate: RenameCandidate) => Promise<string | null>;
  /** Allow drops without asking. */
  acceptDataLoss?: boolean;
  /** Asked before writing destructive changes when `acceptDataLoss` is off; return false to stop. */
  confirmDataLoss?: (diff: DiffResult) => Promise<boolean>;
  /** Shown the planned changes before anything is written; return false to stop. */
  review?: (diff: DiffResult, steps: PlannedStep[]) => Promise<boolean>;
}

export interface DevOptions extends ChangeOptions, MigrationHooks {
  name?: string;
  createOnly?: boolean;
  /** kastor version, written in the file header. */
  version: string;
  /** Called once the new migration file is on disk, before it is applied. */
  onWritten?(migration: LocalMigration): void;
}

export type DevResult =
  | { kind: 'in-sync'; appliedPending: LocalMigration[] }
  | { kind: 'cancelled'; diff: DiffResult; appliedPending: LocalMigration[] }
  | { kind: 'created'; migration: LocalMigration; diff: DiffResult; steps: PlannedStep[]; applied: boolean; appliedPending: LocalMigration[] };

async function computeChanges(adapter: Adapter, target: SchemaIR, options: ChangeOptions): Promise<{ live: SchemaIR; diff: DiffResult; steps: PlannedStep[] } | null> {
  const live = await introspect(adapter);
  const { renames, unresolved } = await resolveRenames(live, target, options.renames ?? [], options.askRename);
  if (unresolved.length && !options.acceptDataLoss) {
    const c = unresolved[0]!;
    const what = c.kind === 'table' ? `table ${c.from}` : `column ${c.table}.${c.from}`;
    const flag = c.kind === 'table' ? `--rename ${c.from}:${c.to[0]}` : `--rename ${c.table}.${c.from}:${c.to[0]}`;
    throw new KastorError('MIGRATION_FAILED', `The ${what} is gone from the schema and ${c.to.join(' or ')} appeared. kastor cannot tell whether it was renamed.`, {
      hint: `If it was renamed, pass ${flag}. To drop it and lose its data, pass --accept-data-loss.`,
      meta: { unresolved },
    });
  }
  const diff = diffSchemas(live, target, { renames, dialect: adapter.dialect });
  if (!diff.ops.length) return null;
  const steps = planStatements(adapter.dialect, live, diff.ops);
  return { live, diff, steps };
}

async function gate(diff: DiffResult, steps: PlannedStep[], options: ChangeOptions): Promise<boolean> {
  if (options.review && !(await options.review(diff, steps))) return false;
  if (diff.destructive && !options.acceptDataLoss) {
    if (!options.confirmDataLoss) {
      throw new KastorError('MIGRATION_FAILED', 'These changes drop data and nobody confirmed them.', {
        hint: 'Run the command in a terminal to confirm, or pass --accept-data-loss.',
      });
    }
    if (!(await options.confirmDataLoss(diff))) return false;
  }
  return true;
}

/**
 * `migrate dev`: applies pending migrations, diffs the database against the
 * schema, writes a new migration file and applies it.
 */
export async function dev(adapter: Adapter, target: SchemaIR, dir: string, options: DevOptions): Promise<DevResult> {
  const st = await status(adapter, dir);
  checkLock(adapter, st, dir);
  checkModified(st, true);
  const appliedPending: LocalMigration[] = [];
  for (const m of st.pending) {
    options.onApply?.(m);
    const start = Date.now();
    await applyMigration(adapter, m);
    options.onApplied?.(m, Date.now() - start);
    appliedPending.push(m);
  }
  const changes = await computeChanges(adapter, target, options);
  if (!changes) return { kind: 'in-sync', appliedPending };
  const { diff, steps } = changes;
  if (!(await gate(diff, steps, options))) return { kind: 'cancelled', diff, appliedPending };
  const id = nextId(dir, options.name ? options.name : suggestName(diff.ops));
  const sql = renderMigration({ id, dialect: adapter.dialect.name, version: options.version, steps, warnings: diff.warnings });
  const migration = writeMigration(dir, id, sql);
  if (!st.lockDialect) writeLock(dir, adapter.dialect.name);
  options.onWritten?.(migration);
  if (options.createOnly) return { kind: 'created', migration, diff, steps, applied: false, appliedPending };
  options.onApply?.(migration);
  const start = Date.now();
  await applyMigration(adapter, migration);
  options.onApplied?.(migration, Date.now() - start);
  return { kind: 'created', migration, diff, steps, applied: true, appliedPending };
}

export type PushResult = { kind: 'in-sync' } | { kind: 'cancelled'; diff: DiffResult } | { kind: 'pushed'; diff: DiffResult; steps: PlannedStep[] };

/** `db push`: makes the database match the schema without writing files. */
export async function push(adapter: Adapter, target: SchemaIR, options: ChangeOptions = {}): Promise<PushResult> {
  const changes = await computeChanges(adapter, target, options);
  if (!changes) return { kind: 'in-sync' };
  const { diff, steps } = changes;
  if (!(await gate(diff, steps, options))) return { kind: 'cancelled', diff };
  await runScript(adapter, steps.flatMap((s) => s.statements), 'db push');
  return { kind: 'pushed', diff, steps };
}

/** Drops every table and enum kastor can see, including the bookkeeping table. */
export async function dropEverything(adapter: Adapter): Promise<PlannedStep[]> {
  const live = await adapter.dialect.introspect(adapter.executor);
  const { ops } = diffSchemas(live, { tables: [] }, { dialect: adapter.dialect });
  const steps = planStatements(adapter.dialect, live, ops);
  await runScript(adapter, steps.flatMap((s) => s.statements), 'reset');
  // Some dialects hide the bookkeeping table from introspection: make sure it
  // exists, then drop it, so the history starts over too.
  if (!live.tables.some((t) => isMigrationsTable(t.name))) {
    const { dialect, executor } = adapter;
    await dialect.migrationTable.ensure(executor);
    const op: MigrationOp = { kind: 'dropTable', table: MIGRATIONS_TABLE };
    const drop = dialect.ddl(op as unknown as MigrationOpLike, { tables: [] });
    await runStatements(executor, drop, 'reset');
    steps.push({ op, statements: drop });
  }
  return steps;
}

/** `migrate reset`: drops everything and applies every migration from scratch. */
export async function reset(adapter: Adapter, dir: string, hooks: MigrationHooks = {}): Promise<{ dropped: PlannedStep[]; applied: LocalMigration[] }> {
  const dropped = await dropEverything(adapter);
  const { applied } = await deploy(adapter, dir, hooks);
  return { dropped, applied };
}

/** Differences between the live database and the schema, for `doctor` and `migrate status`. */
export async function drift(adapter: Adapter, target: SchemaIR): Promise<DiffResult> {
  const live = await introspect(adapter);
  return diffSchemas(live, target, { dialect: adapter.dialect });
}
