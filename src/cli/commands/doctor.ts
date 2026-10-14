import type { Adapter, SchemaIR } from '../../core/ir';
import { createAdapter, loadConfig, loadSchema, type LoadedConfig } from '../../migrate/config';
import { diffSchemas } from '../../migrate/diff';
import { introspect, status, type MigrationStatus } from '../../migrate/engine';
import { opt, rel, type CliContext } from '../context';

export interface Check {
  name: string;
  state: 'ok' | 'warn' | 'error' | 'skip';
  detail: string;
  hint?: string;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const hintOf = (e: unknown): string | undefined => {
  const h = (e as { hint?: string } | null)?.hint;
  return typeof h === 'string' && h ? h : undefined;
};

/** Runs every check it can, skipping the ones whose prerequisites failed. */
export async function runChecks(ctx: CliContext): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (c: Check): void => {
    checks.push(c);
  };
  const [major, minor] = process.versions.node.split('.').map(Number) as [number, number];
  add(
    major > 18 || (major === 18 && minor >= 18)
      ? { name: 'Node.js', state: 'ok', detail: `v${process.versions.node}` }
      : { name: 'Node.js', state: 'error', detail: `v${process.versions.node}`, hint: 'kastor needs Node.js 18.18 or later.' },
  );

  let loaded: LoadedConfig | undefined;
  try {
    loaded = await loadConfig({ cwd: ctx.cwd, file: opt.str(ctx, 'config') });
    add({ name: 'Config', state: 'ok', detail: rel(ctx, loaded.file) });
  } catch (e) {
    add({ name: 'Config', state: 'error', detail: message(e), hint: hintOf(e) });
  }

  let schema: SchemaIR | undefined;
  if (loaded) {
    try {
      schema = await loadSchema(loaded);
      add({ name: 'Schema', state: 'ok', detail: `${schema.tables.length} table${schema.tables.length === 1 ? '' : 's'}${loaded.schemaPath ? ` in ${rel(ctx, loaded.schemaPath)}` : ''}` });
    } catch (e) {
      add({ name: 'Schema', state: 'error', detail: message(e), hint: hintOf(e) });
    }
  } else add({ name: 'Schema', state: 'skip', detail: 'needs a config' });

  let adapter: Adapter | undefined;
  let live: SchemaIR | undefined;
  try {
    if (loaded) {
      try {
        adapter = await createAdapter(loaded);
      } catch (e) {
        add({ name: 'Connection', state: 'error', detail: message(e), hint: hintOf(e) ?? 'Check that the database driver is installed and the adapter function returns an adapter.' });
      }
    }
    if (adapter) {
      const start = Date.now();
      try {
        live = await introspect(adapter);
        add({ name: 'Connection', state: 'ok', detail: `${adapter.dialect.name}, ${live.tables.length} table${live.tables.length === 1 ? '' : 's'}, ${Date.now() - start} ms` });
      } catch (e) {
        add({ name: 'Connection', state: 'error', detail: message(e), hint: 'Is the database running and DATABASE_URL right?' });
      }
    } else if (!loaded) add({ name: 'Connection', state: 'skip', detail: 'needs a config' });

    let st: MigrationStatus | undefined;
    if (adapter && live && loaded) {
      try {
        st = await status(adapter, loaded.migrationsDir);
        if (st.lockDialect && st.lockDialect !== adapter.dialect.name) {
          add({ name: 'Migrations', state: 'error', detail: `written for ${st.lockDialect}, connected to ${adapter.dialect.name}`, hint: 'Point the config at the right database.' });
        } else if (st.modified.length) {
          add({ name: 'Migrations', state: 'error', detail: `${st.modified.length} applied migration(s) changed on disk`, hint: 'Restore them from version control.' });
        } else if (st.pending.length) {
          add({ name: 'Migrations', state: 'warn', detail: `${st.pending.length} pending of ${st.local.length}`, hint: 'Run kastor migrate deploy.' });
        } else if (!st.local.length) {
          add({ name: 'Migrations', state: 'warn', detail: `none in ${rel(ctx, loaded.migrationsDir)}`, hint: 'Create the first one with kastor migrate dev --name init.' });
        } else add({ name: 'Migrations', state: 'ok', detail: `${st.applied.length} applied, none pending` });
        if (st.missing.length) add({ name: 'Migration files', state: 'warn', detail: `${st.missing.length} applied migration(s) have no folder`, hint: 'Pull the latest code.' });
      } catch (e) {
        add({ name: 'Migrations', state: 'error', detail: message(e), hint: hintOf(e) });
      }
    } else add({ name: 'Migrations', state: 'skip', detail: 'needs a connection' });

    if (schema && live && adapter) {
      const diff = diffSchemas(live, schema, { dialect: adapter.dialect });
      if (!diff.ops.length) add({ name: 'Drift', state: 'ok', detail: 'the database matches the schema' });
      else {
        add({
          name: 'Drift',
          state: 'warn',
          detail: `${diff.ops.length} difference${diff.ops.length === 1 ? '' : 's'} between the schema and the database`,
          hint: st?.pending.length ? 'Apply the pending migrations first.' : 'Run kastor migrate dev to write a migration for them.',
        });
      }
    } else add({ name: 'Drift', state: 'skip', detail: 'needs the schema and a connection' });
  } finally {
    await adapter?.executor.close?.().catch(() => undefined);
  }
  return checks;
}

export async function doctor(ctx: CliContext): Promise<number> {
  const checks = await runChecks(ctx);
  const failed = checks.some((c) => c.state === 'error');
  if (opt.bool(ctx, 'json')) {
    ctx.ui.line(JSON.stringify({ ok: !failed, checks }, null, 2));
    return failed ? 1 : 0;
  }
  const { ui } = ctx;
  const { c } = ui;
  ui.title('doctor');
  const width = Math.max(...checks.map((x) => x.name.length));
  for (const check of checks) {
    const tag = { ok: c.green('ok   '), warn: c.yellow('warn '), error: c.red('error'), skip: c.gray('skip ') }[check.state];
    ui.line(`  ${tag}  ${check.name.padEnd(width)}  ${check.state === 'skip' ? c.gray(check.detail) : check.detail}`);
    if (check.hint && check.state !== 'ok') ui.line(`  ${' '.repeat(5)}  ${' '.repeat(width)}  ${c.cyan('hint')} ${check.hint}`);
  }
  ui.line();
  const warns = checks.filter((x) => x.state === 'warn').length;
  if (failed) ui.line(`  ${c.red(c.bold('Something needs fixing.'))} Start with the first error above.`);
  else if (warns) ui.line(`  ${c.yellow('Working, with')} ${warns} ${c.yellow(`warning${warns === 1 ? '' : 's'}.`)}`);
  else ui.line(`  ${c.green(c.bold('Everything looks good.'))}`);
  return failed ? 1 : 0;
}
