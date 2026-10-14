/**
 * How migration plans, warnings and errors look in the terminal.
 */
import { isKastorError } from '../core/errors';
import type { DiffResult, DiffWarning, RenameCandidate } from '../migrate/diff';
import type { PlannedStep } from '../migrate/engine';
import { symbolFor } from '../migrate/files';
import { describeOp, isDestructive, type MigrationOp } from '../migrate/ops';
import { ArgsError } from './args';
import { PromptCancelled } from './prompt';
import type { Ui } from './ui';

export function opLine(ui: Ui, op: MigrationOp): string {
  const { c } = ui;
  const sym = symbolFor(op);
  const paint = sym === '+' ? c.green : sym === '-' ? c.red : sym === '>' ? c.blue : c.yellow;
  const loss = isDestructive(op) ? `  ${c.red('data loss')}` : '';
  return `  ${paint(sym)} ${describeOp(op)}${loss}`;
}

/** The list of changes, with SQL under each change when `sql` is set. */
export function printPlan(ui: Ui, diff: DiffResult, steps: PlannedStep[] = [], options: { sql?: boolean } = {}): void {
  const { c } = ui;
  const counts = { add: 0, change: 0, drop: 0 };
  for (const op of diff.ops) {
    const s = symbolFor(op);
    if (s === '+') counts.add++;
    else if (s === '-') counts.drop++;
    else counts.change++;
  }
  ui.line(
    `${c.bold('Changes')}  ${c.green(`${counts.add} to add`)}${c.gray(',')} ${c.yellow(`${counts.change} to change`)}${c.gray(',')} ${c.red(`${counts.drop} to drop`)}`,
  );
  ui.line();
  for (const op of diff.ops) {
    ui.line(opLine(ui, op));
    if (options.sql) {
      const step = steps.find((s) => s.op === op);
      for (const stmt of step?.statements ?? []) for (const l of stmt.split('\n')) ui.line(`      ${c.gray(l)}`);
    }
  }
  if (diff.warnings.length) {
    ui.line();
    printWarnings(ui, diff.warnings);
  }
  ui.line();
}

export function printWarnings(ui: Ui, warnings: DiffWarning[]): void {
  const { c } = ui;
  for (const w of warnings) {
    const tag = w.level === 'danger' ? c.red(c.bold('data loss')) : c.yellow('warn');
    ui.line(`  ${tag}  ${w.message}`);
    if (w.hint) ui.line(`        ${c.gray(w.hint)}`);
  }
}

export function renameQuestion(candidate: RenameCandidate): string {
  return candidate.kind === 'table'
    ? `Table ${candidate.from} is gone from the schema. Was it renamed?`
    : `Column ${candidate.table}.${candidate.from} is gone from the schema. Was it renamed?`;
}

/** Prints any thrown value as a readable error and returns the exit code. */
export function printError(ui: Ui, error: unknown): number {
  if (error instanceof PromptCancelled) {
    ui.error('Cancelled. Nothing was changed.');
    return 130;
  }
  if (error instanceof ArgsError) {
    ui.error(error.message, error.hint);
    return 2;
  }
  if (isKastorError(error)) {
    const statement = typeof error.meta.statement === 'string' ? `${error.meta.statement}` : undefined;
    ui.error(error.message, error.hint || undefined, statement);
    return 1;
  }
  if (error instanceof Error) {
    const code = (error as { code?: string }).code;
    const hint = connectionHint(code, error.message);
    ui.error(error.message, hint, ui.env.KASTOR_DEBUG ? error.stack : undefined);
    return 1;
  }
  ui.error(String(error));
  return 1;
}

function connectionHint(code: string | undefined, message: string): string | undefined {
  if (code === 'ECONNREFUSED' || /ECONNREFUSED/.test(message)) return 'Nothing answers at that address. Is the database running? With docker: docker compose up -d';
  if (code === 'ENOTFOUND' || /ENOTFOUND/.test(message)) return 'The host name in the connection string does not resolve. Check DATABASE_URL.';
  if (code === '28P01' || /password authentication failed|Access denied/i.test(message)) return 'The database rejected the user or password. Check DATABASE_URL.';
  if (code === '3D000' || /database .* does not exist|Unknown database/i.test(message)) return 'The database in the connection string does not exist yet. Create it first.';
  if (code === 'ERR_MODULE_NOT_FOUND' || /Cannot find (module|package)/.test(message)) return 'A package is missing. Install the database driver, for example npm install pg.';
  return 'Set KASTOR_DEBUG=1 to see the stack trace.';
}
