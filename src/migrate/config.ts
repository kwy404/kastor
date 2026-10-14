/**
 * Finds and loads `kastor.config.ts` (or .mts, .cts, .js, .mjs, .cjs), the
 * schema module and the seed script. TypeScript is loaded with jiti, so no
 * build step and no extra flags are needed on Node 18 and later.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { createJiti } from 'jiti';
import { KastorError } from '../core/errors';
import type { Adapter, SchemaIR } from '../core/ir';
import { tablesOf, toSchemaIR } from '../core/schema-ir';

export interface KastorConfig {
  /** Path to the schema module (relative to the config file), or the schema object itself. */
  schema: string | Record<string, unknown>;
  /** The adapter, or a function that creates it (called once per command). */
  adapter: Adapter | (() => Adapter | Promise<Adapter>);
  /** Folder for migration files. Default `./kastor/migrations`. */
  migrations?: string;
  /** Seed script path whose default export receives the client, or the seed function itself. */
  seed?: string | ((db: any) => unknown);
  /** Studio settings. */
  studio?: { port?: number };
}

/** Identity helper that types the config file. */
export function defineConfig(config: KastorConfig): KastorConfig {
  return config;
}

export const CONFIG_FILES = ['kastor.config.ts', 'kastor.config.mts', 'kastor.config.cts', 'kastor.config.js', 'kastor.config.mjs', 'kastor.config.cjs'];

export interface LoadedConfig {
  /** Absolute path of the config file. */
  file: string;
  /** Folder of the config file; relative paths resolve from here. */
  root: string;
  config: KastorConfig;
  /** Absolute migrations folder. */
  migrationsDir: string;
  /** Absolute schema path, when the schema is a path. */
  schemaPath?: string;
}

/** Looks for a config file in `cwd` and its parents. */
export function findConfig(cwd: string): string | undefined {
  let dir = resolve(cwd);
  for (;;) {
    for (const name of CONFIG_FILES) {
      const file = resolve(dir, name);
      if (existsSync(file)) return file;
    }
    if (existsSync(resolve(dir, 'package.json'))) return undefined;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Imports a TypeScript or JavaScript module and returns its namespace. */
export async function importModule(file: string): Promise<Record<string, unknown>> {
  const jiti = createJiti(file, { moduleCache: false, fsCache: false, interopDefault: false });
  return (await jiti.import(file)) as Record<string, unknown>;
}

/** Reads `.env` next to the config (never overriding variables already set). */
export function loadEnvFile(dir: string, env: Record<string, string | undefined> = process.env): string[] {
  const file = resolve(dir, '.env');
  if (!existsSync(file)) return [];
  const set: string[] = [];
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/.exec(raw);
    if (!m) continue;
    let value = (m[2] ?? '').trim();
    const quoted = /^(['"`])([\s\S]*)\1$/.exec(value);
    if (quoted) {
      value = quoted[2]!;
      if (quoted[1] === '"') value = value.replace(/\\n/g, '\n');
    } else value = value.replace(/\s+#.*$/, '');
    if (env[m[1]!] === undefined) {
      env[m[1]!] = value;
      set.push(m[1]!);
    }
  }
  return set;
}

export async function loadConfig(options: { cwd?: string; file?: string } = {}): Promise<LoadedConfig> {
  const cwd = options.cwd ?? process.cwd();
  const file = options.file ? resolve(cwd, options.file) : findConfig(cwd);
  if (!file) {
    throw new KastorError('INVALID_ARGUMENT', `No kastor.config.ts found in ${cwd}.`, {
      hint: 'Run kastor init to create one, or pass --config <path>.',
    });
  }
  if (!existsSync(file)) {
    throw new KastorError('INVALID_ARGUMENT', `The config file ${file} does not exist.`, { hint: 'Check the --config path.' });
  }
  const root = dirname(file);
  loadEnvFile(root);
  let mod: Record<string, unknown>;
  try {
    mod = await importModule(file);
  } catch (error) {
    throw new KastorError('INVALID_ARGUMENT', `Could not load ${file}: ${error instanceof Error ? error.message : String(error)}`, {
      hint: 'Fix the error above in the config file. It must export default defineConfig({ schema, adapter }).',
      cause: error,
    });
  }
  const config = (mod.default ?? mod.config) as KastorConfig | undefined;
  if (!config || typeof config !== 'object') {
    throw new KastorError('INVALID_ARGUMENT', `${file} has no default export.`, {
      hint: 'Export the config: export default defineConfig({ schema: "./src/db/schema.ts", adapter: () => ... }).',
    });
  }
  if (!config.schema) throw new KastorError('INVALID_ARGUMENT', `The config in ${file} has no schema.`, { hint: 'Add schema: "./src/db/schema.ts".' });
  if (!config.adapter) throw new KastorError('INVALID_ARGUMENT', `The config in ${file} has no adapter.`, { hint: 'Add adapter: () => postgres(new pg.Pool({ connectionString: process.env.DATABASE_URL })).' });
  const migrationsDir = resolve(root, config.migrations ?? './kastor/migrations');
  const schemaPath = typeof config.schema === 'string' ? (isAbsolute(config.schema) ? config.schema : resolve(root, config.schema)) : undefined;
  return { file, root, config, migrationsDir, schemaPath };
}

/** Loads the schema module (or object) and returns its tables, keyed by export name. */
export async function loadSchemaObject(loaded: LoadedConfig): Promise<Record<string, unknown>> {
  const { config } = loaded;
  if (typeof config.schema !== 'string') return config.schema;
  const path = loaded.schemaPath!;
  if (!existsSync(path)) {
    throw new KastorError('INVALID_ARGUMENT', `The schema file ${path} does not exist.`, {
      hint: 'Fix the schema path in kastor.config.ts, or run kastor db pull to create it from the database.',
    });
  }
  const mod = await importModule(path);
  const nested = mod.schema;
  if (nested && typeof nested === 'object' && tablesOf(nested as Record<string, unknown>).length) return nested as Record<string, unknown>;
  return mod;
}

export async function loadSchema(loaded: LoadedConfig): Promise<SchemaIR> {
  const obj = await loadSchemaObject(loaded);
  if (!tablesOf(obj).length) {
    throw new KastorError('SCHEMA_INVALID', `The schema ${loaded.schemaPath ?? ''} exports no tables.`, {
      hint: "Export each table: export const users = table('users', { id: t.id() }).",
    });
  }
  return toSchemaIR(obj);
}

export async function createAdapter(loaded: LoadedConfig): Promise<Adapter> {
  const a = loaded.config.adapter;
  const adapter = typeof a === 'function' ? await a() : a;
  if (!adapter || typeof adapter !== 'object' || !adapter.dialect || !adapter.executor) {
    throw new KastorError('INVALID_ARGUMENT', 'The adapter in the config is not a kastor adapter.', {
      hint: "Return an adapter from a kastor driver entry: adapter: () => postgres(pool) from 'kastor-orm/postgres'.",
    });
  }
  return adapter;
}
