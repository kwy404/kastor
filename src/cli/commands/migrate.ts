import { KastorError } from '../../core/errors';
import type { Rename, RenameCandidate } from '../../migrate/diff';
import { deploy, dev, drift, reset, status, type ChangeOptions, type MigrationHooks } from '../../migrate/engine';
import { sanitizeName, suggestName } from '../../migrate/files';
import { parseRenameFlags } from '../args';
import { header, opt, projectSchema, rel, withProject, type CliContext } from '../context';
import { printPlan, renameQuestion } from '../render';
import { runSeed } from './db';

/** Rename answers from flags and, on a TTY, from questions. */
export function renameOptions(ctx: CliContext): Pick<ChangeOptions, 'renames' | 'askRename'> {
  const renames: Rename[] = parseRenameFlags(opt.list(ctx, 'rename'));
  const prompt = ctx.prompt;
  if (!prompt) return { renames };
  return {
    renames,
    askRename: async (cand: RenameCandidate) => {
      const choices = [
        ...cand.to.map((to) => ({ label: `Renamed to ${to}`, value: to as string | null, hint: 'keeps the data' })),
        { label: `Dropped (create ${cand.to.length > 1 ? 'the new ones' : cand.to[0]} from scratch)`, value: null as string | null, hint: 'deletes the data' },
      ];
      return prompt.select(renameQuestion(cand), choices);
    },
  };
}

/** Review and data loss confirmation shared by migrate dev and db push. */
export function changeOptions(ctx: CliContext, sql: boolean): ChangeOptions {
  const accept = opt.bool(ctx, 'accept-data-loss') || opt.bool(ctx, 'yes');
  const prompt = ctx.prompt;
  return {
    ...renameOptions(ctx),
    acceptDataLoss: accept,
    review: async (diff, steps) => {
      printPlan(ctx.ui, diff, steps, { sql });
      return true;
    },
    confirmDataLoss: prompt ? (diff) => prompt.confirm(`These changes delete data (${diff.warnings.filter((w) => w.level === 'danger').length} warning(s) above). Continue?`, false) : undefined,
  };
}

function hooks(ctx: CliContext): MigrationHooks & { count: number } {
  const state = { count: 0 };
  let spinner: ReturnType<CliContext['ui']['spinner']> | null = null;
  return {
    get count() {
      return state.count;
    },
    onApply: (m) => {
      spinner = ctx.ui.spinner(`Applying ${m.id}`);
    },
    onApplied: (m, ms) => {
      state.count++;
      spinner?.succeed(`Applied ${ctx.ui.c.bold(m.id)} ${ctx.ui.c.gray(`${ms} ms`)}`);
      spinner = null;
    },
  } as MigrationHooks & { count: number };
}

export async function migrateDev(ctx: CliContext): Promise<number> {
  return withProject(ctx, async (project) => {
    header(ctx, 'migrate dev', project);
    const target = await ctx.ui.task('Loading the schema', () => projectSchema(project), (s) => `Loaded ${s.tables.length} table${s.tables.length === 1 ? '' : 's'} from the schema`);
    let name = opt.str(ctx, 'name');
    const base = changeOptions(ctx, false);
    const h = hooks(ctx);
    const result = await dev(project.adapter, target, project.loaded.migrationsDir, {
      ...base,
      ...h,
      version: ctx.version,
      onWritten: (m) => ctx.ui.success(`Wrote ${ctx.ui.c.bold(rel(ctx, m.file))}`),
      createOnly: opt.bool(ctx, 'create-only'),
      get name() {
        return name;
      },
      review: async (diff, steps) => {
        await base.review!(diff, steps);
        if (!name && ctx.prompt) {
          const suggested = suggestName(diff.ops);
          name = sanitizeName(await ctx.prompt.text('Name of the migration', suggested));
        }
        return true;
      },
    });
    const { ui } = ctx;
    if (result.kind === 'in-sync') {
      ui.success(result.appliedPending.length ? 'The database now matches the schema.' : 'Already in sync: the database matches the schema.');
      return 0;
    }
    if (result.kind === 'cancelled') {
      ui.warn('Cancelled. No migration was written.');
      return 1;
    }
    if (!result.applied) {
      ui.line();
      ui.box([`Review the SQL, then apply it with ${ui.c.cyan('kastor migrate dev')}`, `or ${ui.c.cyan('kastor migrate deploy')}.`]);
      return 0;
    }
    ui.line();
    ui.success(`The database matches the schema. Commit ${rel(ctx, result.migration.dir)} with your code.`);
    return 0;
  });
}

export async function migrateDeploy(ctx: CliContext): Promise<number> {
  return withProject(ctx, async (project) => {
    header(ctx, 'migrate deploy', project);
    const { ui } = ctx;
    const { applied, status: st } = await deploy(project.adapter, project.loaded.migrationsDir, hooks(ctx));
    if (!st.local.length) {
      ui.warn(`No migrations in ${rel(ctx, project.loaded.migrationsDir)}. Create one with kastor migrate dev.`);
      return 0;
    }
    if (!applied.length) ui.success(`No pending migrations. ${st.applied.length} already applied.`);
    else ui.success(`Applied ${applied.length} migration${applied.length === 1 ? '' : 's'}.`);
    if (st.missing.length) ui.warn(`${st.missing.length} applied migration(s) have no folder here: ${st.missing.map((m) => m.id).join(', ')}.`);
    return 0;
  });
}

export async function migrateStatus(ctx: CliContext): Promise<number> {
  return withProject(ctx, async (project) => {
    const st = await status(project.adapter, project.loaded.migrationsDir);
    let driftOps: number | null = null;
    let driftError: string | undefined;
    if (!st.pending.length) {
      try {
        const target = await projectSchema(project);
        driftOps = (await drift(project.adapter, target)).ops.length;
      } catch (error) {
        driftError = error instanceof Error ? error.message : String(error);
      }
    }
    const upToDate = !st.pending.length && !st.modified.length && !st.missing.length;
    if (opt.bool(ctx, 'json')) {
      ctx.ui.line(
        JSON.stringify(
          {
            dialect: project.adapter.dialect.name,
            applied: st.applied.map((a) => ({ id: a.id, appliedAt: a.appliedAt })),
            pending: st.pending.map((m) => m.id),
            modified: st.modified.map((m) => m.local.id),
            missing: st.missing.map((m) => m.id),
            drift: driftOps,
            upToDate,
          },
          null,
          2,
        ),
      );
      return upToDate ? 0 : 1;
    }
    header(ctx, 'migrate status', project);
    const { ui } = ctx;
    const { c } = ui;
    const appliedById = new Map(st.applied.map((a) => [a.id, a]));
    const modified = new Set(st.modified.map((m) => m.local.id));
    const rows: string[][] = [];
    for (const m of st.local) {
      const a = appliedById.get(m.id);
      const state = modified.has(m.id) ? c.red('modified') : a ? c.green('applied') : c.yellow('pending');
      rows.push([m.id, state, a ? formatDate(a.appliedAt) : c.gray('-')]);
    }
    for (const m of st.missing) rows.push([m.id, c.red('missing'), formatDate(m.appliedAt)]);
    if (rows.length) ui.table(['Migration', 'State', 'Applied at'], rows);
    else ui.line(`  ${c.gray('No migrations yet.')}`);
    ui.line();
    if (st.pending.length) ui.warn(`${st.pending.length} pending. Apply with kastor migrate deploy (or migrate dev while developing).`);
    if (st.modified.length) ui.error(`${st.modified.length} applied migration(s) changed on disk.`, 'Restore them from version control; applied migrations must not change.');
    if (st.missing.length) ui.warn('Some applied migrations have no folder here. Pull the latest code or check the migrations path.');
    if (driftOps) ui.warn(`The schema has ${driftOps} change(s) the database does not have yet. Run kastor migrate dev to write a migration.`);
    if (driftError) ui.warn(`Could not compare with the schema: ${driftError}`);
    if (upToDate && !driftOps) ui.success('Database is up to date.');
    return upToDate ? 0 : 1;
  });
}

function formatDate(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? String(d) : date.toISOString().replace('T', ' ').slice(0, 19);
}

export async function migrateReset(ctx: CliContext): Promise<number> {
  return withProject(ctx, async (project) => {
    header(ctx, 'migrate reset', project);
    const { ui } = ctx;
    const force = opt.bool(ctx, 'force') || opt.bool(ctx, 'yes');
    if (!force) {
      if (!ctx.prompt) {
        throw new KastorError('INVALID_ARGUMENT', 'migrate reset deletes every table and row and needs confirmation.', {
          hint: 'Run it in a terminal, or pass --force when you are sure (never against production).',
        });
      }
      ui.warn(`This drops every table in the ${project.adapter.dialect.name} database and all of its data.`);
      if (!(await ctx.prompt.confirm('Reset the database?', false))) {
        ui.line('Nothing was changed.');
        return 1;
      }
    }
    const h = hooks(ctx);
    const spin = ui.spinner('Dropping every table');
    const result = await reset(project.adapter, project.loaded.migrationsDir, {
      onApply: (m) => {
        spin.stop();
        h.onApply?.(m);
      },
      onApplied: h.onApplied,
    });
    spin.stop();
    ui.success(`Dropped ${result.dropped.filter((s) => s.op.kind === 'dropTable').length} table(s).`);
    ui.success(`Applied ${result.applied.length} migration(s).`);
    if (!opt.bool(ctx, 'skip-seed') && project.loaded.config.seed) await runSeed(ctx, project);
    return 0;
  });
}
