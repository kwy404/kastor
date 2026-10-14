/**
 * What every command gets: output, prompts (on a TTY), options and helpers
 * that load the project once.
 */
import { relative } from 'node:path';
import type { Adapter, SchemaIR } from '../core/ir';
import { createAdapter, loadConfig, loadSchema, type LoadedConfig } from '../migrate/config';
import type { ParsedArgs } from './args';
import type { Prompter } from './prompt';
import type { Ui } from './ui';

export interface CliContext {
  ui: Ui;
  /** Null when stdin or stdout is not a TTY: commands must not ask anything. */
  prompt: Prompter | null;
  cwd: string;
  env: Record<string, string | undefined>;
  version: string;
  options: ParsedArgs['options'];
  /** Opens a URL in the browser (studio). */
  openUrl?: (url: string) => void;
  /** Called with the running studio, so tests can stop it. */
  onStudio?: (studio: { url: string; close(): Promise<void> }) => void;
}

export interface Project {
  loaded: LoadedConfig;
  adapter: Adapter;
  close(): Promise<void>;
}

export const opt = {
  str: (ctx: CliContext, name: string): string | undefined => (typeof ctx.options[name] === 'string' ? (ctx.options[name] as string) : undefined),
  bool: (ctx: CliContext, name: string): boolean => ctx.options[name] === true,
  num: (ctx: CliContext, name: string): number | undefined => (typeof ctx.options[name] === 'number' ? (ctx.options[name] as number) : undefined),
  list: (ctx: CliContext, name: string): string[] => (Array.isArray(ctx.options[name]) ? (ctx.options[name] as string[]) : []),
};

export async function openProject(ctx: CliContext): Promise<Project> {
  const loaded = await loadConfig({ cwd: ctx.cwd, file: opt.str(ctx, 'config') });
  const adapter = await createAdapter(loaded);
  return {
    loaded,
    adapter,
    close: async () => {
      await adapter.executor.close?.();
    },
  };
}

export async function projectSchema(project: Project): Promise<SchemaIR> {
  return loadSchema(project.loaded);
}

/** A path relative to the working folder, for output. */
export function rel(ctx: CliContext, path: string): string {
  const r = relative(ctx.cwd, path);
  return r && !r.startsWith('..') ? r.replace(/\\/g, '/') : path;
}

export function header(ctx: CliContext, title: string, project?: Project): void {
  ctx.ui.title(title);
  if (!project) return;
  const rows: Array<[string, string]> = [
    ['Config', rel(ctx, project.loaded.file)],
    ['Database', project.adapter.dialect.name],
  ];
  if (project.loaded.schemaPath) rows.push(['Schema', rel(ctx, project.loaded.schemaPath)]);
  rows.push(['Migrations', rel(ctx, project.loaded.migrationsDir)]);
  ctx.ui.keyValues(rows);
  ctx.ui.line();
}

/** Runs `fn` with the project and always closes the connection. */
export async function withProject<T>(ctx: CliContext, fn: (project: Project) => Promise<T>): Promise<T> {
  const project = await openProject(ctx);
  try {
    return await fn(project);
  } finally {
    await project.close().catch(() => undefined);
  }
}
