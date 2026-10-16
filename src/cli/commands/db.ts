import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { QueryEvent } from '../../core/client';
import { KastorError } from '../../core/errors';
import { generateSchema } from '../../migrate/codegen';
import { tablesOf } from '../../core/schema-ir';
import { importModule } from '../../migrate/config';
import { introspect, push } from '../../migrate/engine';
import { header, opt, projectSchema, rel, withProject, type CliContext, type Project } from '../context';
import { changeOptions } from './migrate';

export async function dbPush(ctx: CliContext): Promise<number> {
  return withProject(ctx, async (project) => {
    header(ctx, 'db push', project);
    const { ui } = ctx;
    const target = await projectSchema(project);
    const result = await push(project.adapter, target, changeOptions(ctx, false));
    if (result.kind === 'in-sync') {
      ui.success('Already in sync: the database matches the schema.');
      return 0;
    }
    if (result.kind === 'cancelled') {
      ui.warn('Cancelled. Nothing was changed.');
      return 1;
    }
    ui.success(`Pushed ${result.diff.ops.length} change${result.diff.ops.length === 1 ? '' : 's'}. No migration file was written.`);
    ui.line(`  ${ui.c.gray('When the schema settles, run kastor migrate dev to start tracking migrations.')}`);
    return 0;
  });
}

export async function dbPull(ctx: CliContext): Promise<number> {
  return withProject(ctx, async (project) => {
    const { ui } = ctx;
    const toStdout = opt.bool(ctx, 'print');
    if (!toStdout) header(ctx, 'db pull', project);
    const live = toStdout ? await introspect(project.adapter) : await ui.task('Reading the database', () => introspect(project.adapter), (s) => `Found ${s.tables.length} table${s.tables.length === 1 ? '' : 's'}`);
    if (!live.tables.length) {
      throw new KastorError('INVALID_ARGUMENT', 'The database has no tables to pull.', { hint: 'Point the config at a database with tables, or write the schema by hand and run kastor migrate dev.' });
    }
    const { code, notes } = generateSchema(live, { dialect: project.adapter.dialect, source: project.adapter.dialect.name });
    if (toStdout) {
      ui.write(code);
      return 0;
    }
    const outOpt = opt.str(ctx, 'out');
    const out = outOpt ? resolve(ctx.cwd, outOpt) : project.loaded.schemaPath;
    if (!out) {
      throw new KastorError('INVALID_ARGUMENT', 'The config passes the schema as an object, so db pull does not know where to write.', { hint: 'Pass --out src/db/schema.ts or --print.' });
    }
    if (existsSync(out) && !opt.bool(ctx, 'force')) {
      if (!ctx.prompt) throw new KastorError('INVALID_ARGUMENT', `${rel(ctx, out)} already exists.`, { hint: 'Pass --force to overwrite it, or --out to write somewhere else.' });
      if (!(await ctx.prompt.confirm(`${rel(ctx, out)} exists. Overwrite it?`, false))) {
        ui.line('Nothing was written.');
        return 1;
      }
    }
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, code, 'utf8');
    ui.success(`Wrote ${ui.c.bold(rel(ctx, out))} with ${live.tables.length} table${live.tables.length === 1 ? '' : 's'}.`);
    for (const note of notes) ui.warn(note);
    ui.line();
    ui.box([
      'Next steps',
      `1. Read ${rel(ctx, out)} and rename relations you want named differently.`,
      `2. Baseline: kastor migrate dev --create-only --name baseline`,
      '   writes the current state as the first migration.',
    ]);
    return 0;
  });
}

/** Runs the seed from the config with a client for the project. */
export async function runSeed(ctx: CliContext, project: Project): Promise<void> {
  const { ui } = ctx;
  const seed = project.loaded.config.seed;
  if (!seed) {
    throw new KastorError('INVALID_ARGUMENT', 'The config has no seed.', { hint: "Add seed: './src/db/seed.ts' whose default export receives the client: export default async (db) => { ... }." });
  }
  let fn: unknown = seed;
  if (typeof seed === 'string') {
    const path = resolve(project.loaded.root, seed);
    if (!existsSync(path)) throw new KastorError('INVALID_ARGUMENT', `The seed file ${rel(ctx, path)} does not exist.`, { hint: 'Fix the seed path in kastor.config.ts.' });
    const mod = await importModule(path);
    fn = mod.default ?? mod.seed;
    if (typeof fn !== 'function') {
      ui.success(`Ran ${rel(ctx, path)}.`);
      return;
    }
  }
  const db = await makeClient(project);
  const start = Date.now();
  const spin = ui.spinner('Seeding');
  try {
    await (fn as (db: unknown) => unknown)(db);
    spin.succeed(`Seeded in ${Date.now() - start} ms`);
  } catch (error) {
    spin.fail('The seed failed');
    throw error;
  }
}

/** A kastor client over the project's adapter and schema; `log` sees every statement it runs. */
export async function makeClient(project: Project, options: { log?: (event: QueryEvent) => void } = {}): Promise<unknown> {
  const core = (await import('../../index')) as Record<string, unknown>;
  const create = core.kastor as ((config: Record<string, unknown>) => unknown) | undefined;
  if (typeof create !== 'function') throw new KastorError('UNSUPPORTED', 'This build of kastor has no client.', { hint: 'Reinstall kastor-orm.' });
  const { config, schemaPath } = project.loaded;
  const raw = typeof config.schema === 'string' ? await importModule(schemaPath!) : config.schema;
  const relations = typeof raw.relations === 'function' ? raw.relations : undefined;
  const nested = raw.schema as Record<string, unknown> | undefined;
  const tables = Object.fromEntries(tablesOf(nested && tablesOf(nested).length ? nested : raw));
  return create({ adapter: project.adapter, schema: tables, ...(relations ? { relations } : {}), ...(options.log ? { log: options.log } : {}) });
}

export async function dbSeed(ctx: CliContext): Promise<number> {
  return withProject(ctx, async (project) => {
    header(ctx, 'db seed', project);
    await runSeed(ctx, project);
    return 0;
  });
}
