/**
 * `kastor init`: a short wizard. Pick a database, write the config, a sample
 * schema and a seed, install the packages, then create the tables and run a
 * first query so the first success happens in one command.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { inspect } from 'node:util';
import type { QueryEvent } from '../../core/client';
import { KastorError } from '../../core/errors';
import { ArgsError } from '../args';
import { opt, rel, withProject, type CliContext } from '../context';
import { printError } from '../render';
import { makeClient, runSeed } from './db';
import { migrateDev } from './migrate';

export interface DatabaseTemplate {
  id: string;
  label: string;
  /** Shown next to the label in the wizard. */
  hint?: string;
  /** Runs without a database server (a local file), so the first query works right away. */
  local?: boolean;
  /** npm packages to install next to kastor. */
  packages: string[];
  imports: string[];
  adapter: string;
  env: string;
}

export const DATABASES: DatabaseTemplate[] = [
  {
    id: 'postgres',
    label: 'PostgreSQL (also Neon, Supabase, Vercel Postgres)',
    packages: ['pg'],
    imports: ["import pg from 'pg';", "import { postgres } from 'kastor-orm/postgres';"],
    adapter: 'adapter: () => postgres(new pg.Pool({ connectionString: process.env.DATABASE_URL })),',
    env: 'DATABASE_URL=postgres://postgres:postgres@localhost:5432/app',
  },
  {
    id: 'cockroach',
    label: 'CockroachDB',
    packages: ['pg'],
    imports: ["import pg from 'pg';", "import { cockroach } from 'kastor-orm/cockroach';"],
    adapter: 'adapter: () => cockroach(new pg.Pool({ connectionString: process.env.DATABASE_URL })),',
    env: 'DATABASE_URL=postgres://root@localhost:26257/defaultdb?sslmode=disable',
  },
  {
    id: 'mysql',
    label: 'MySQL (also PlanetScale)',
    packages: ['mysql2'],
    imports: ["import { createPool } from 'mysql2/promise';", "import { mysql } from 'kastor-orm/mysql';"],
    adapter: 'adapter: () => mysql(createPool(process.env.DATABASE_URL!)),',
    env: 'DATABASE_URL=mysql://root:root@localhost:3306/app',
  },
  {
    id: 'mariadb',
    label: 'MariaDB',
    packages: ['mariadb'],
    imports: ["import { createPool } from 'mariadb';", "import { mariadb } from 'kastor-orm/mariadb';"],
    adapter: 'adapter: () => mariadb(createPool(process.env.DATABASE_URL!)),',
    env: 'DATABASE_URL=mariadb://root:root@localhost:3306/app',
  },
  {
    id: 'sqlite',
    label: 'SQLite (better-sqlite3)',
    hint: 'no server needed, the quickest start',
    local: true,
    packages: ['better-sqlite3'],
    imports: ["import Database from 'better-sqlite3';", "import { sqlite } from 'kastor-orm/sqlite';"],
    adapter: "adapter: () => sqlite(new Database(process.env.DATABASE_URL ?? 'dev.db')),",
    env: 'DATABASE_URL=dev.db',
  },
  {
    id: 'libsql',
    label: 'libSQL and Turso',
    hint: 'a local file, or Turso later',
    local: true,
    packages: ['@libsql/client'],
    imports: ["import { createClient } from '@libsql/client';", "import { libsql } from 'kastor-orm/libsql';"],
    adapter: "adapter: () => libsql(createClient({ url: process.env.DATABASE_URL ?? 'file:dev.db', authToken: process.env.DATABASE_TOKEN })),",
    env: 'DATABASE_URL=file:dev.db',
  },
  {
    id: 'd1',
    label: 'Cloudflare D1 (through wrangler)',
    packages: ['wrangler'],
    imports: ["import { getPlatformProxy } from 'wrangler';", "import { d1 } from 'kastor-orm/d1';"],
    adapter: 'adapter: async () => {\n    const { env } = await getPlatformProxy<{ DB: D1Database }>();\n    return d1(env.DB);\n  },',
    env: '# D1 uses the binding named DB in wrangler.toml',
  },
  {
    id: 'mssql',
    label: 'SQL Server',
    packages: ['mssql'],
    imports: ["import sql from 'mssql';", "import { mssql } from 'kastor-orm/mssql';"],
    adapter: 'adapter: async () => mssql(await new sql.ConnectionPool(process.env.DATABASE_URL!).connect()),',
    env: 'DATABASE_URL=Server=localhost,1433;Database=app;User Id=sa;Password=yourStrong(!)Password;Encrypt=false',
  },
  {
    id: 'oracle',
    label: 'Oracle',
    packages: ['oracledb'],
    imports: ["import oracledb from 'oracledb';", "import { oracle } from 'kastor-orm/oracle';"],
    adapter:
      'adapter: async () =>\n    oracle(await oracledb.createPool({ user: process.env.ORACLE_USER, password: process.env.ORACLE_PASSWORD, connectString: process.env.ORACLE_CONNECT })),',
    env: 'ORACLE_USER=app\nORACLE_PASSWORD=app\nORACLE_CONNECT=localhost:1521/FREEPDB1',
  },
  {
    id: 'mongodb',
    label: 'MongoDB',
    packages: ['mongodb'],
    imports: ["import { MongoClient } from 'mongodb';", "import { mongodb } from 'kastor-orm/mongodb';"],
    adapter: 'adapter: async () => mongodb((await new MongoClient(process.env.DATABASE_URL!).connect()).db()),',
    env: 'DATABASE_URL=mongodb://localhost:27017/app',
  },
];

export function configTemplate(db: DatabaseTemplate): string {
  return `${db.imports.join('\n')}
import { defineConfig } from 'kastor-orm';

export default defineConfig({
  schema: './src/db/schema.ts',
  ${db.adapter}
  migrations: './kastor/migrations',
  seed: './src/db/seed.ts',
});
`;
}

export const SCHEMA_TEMPLATE = `import { table, t, index, many, one } from 'kastor-orm';

export const users = table('users', {
  id: t.id(),
  email: t.string(255).unique(),
  name: t.string().nullable(),
  role: t.enum(['user', 'admin']).default('user'),
  createdAt: t.datetime().defaultNow(),
});

export const posts = table(
  'posts',
  {
    id: t.id(),
    title: t.string(200),
    body: t.text().nullable(),
    published: t.boolean().default(false),
    authorId: t.int().references(() => users.id, { onDelete: 'cascade' }),
  },
  { indexes: (p) => [index(p.authorId)] },
);

export const schema = { users, posts };

export const relations = ({ users, posts }: typeof schema) => ({
  users: { posts: many(posts) },
  posts: { author: one(users, { fields: ['authorId'], references: ['id'] }) },
});
`;

export const SEED_TEMPLATE = `// Runs with: npx kastor db seed (and after kastor migrate reset).
export default async function seed(db: any) {
  const ada = await db.users.upsert({
    where: { email: 'ada@example.com' },
    create: { email: 'ada@example.com', name: 'Ada', role: 'admin' },
    update: {},
  });
  await db.posts.create({ data: { title: 'Hello kastor', authorId: ada.id, published: true } });
}
`;

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

const LOCKFILES: Array<[string, PackageManager]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['package-lock.json', 'npm'],
];

/** The package manager of the project: a lockfile in the folder or a parent, else the one that runs this command, else npm. */
export function detectPackageManager(cwd: string, env: Record<string, string | undefined> = {}): PackageManager {
  let dir = resolve(cwd);
  for (;;) {
    for (const [file, pm] of LOCKFILES) if (existsSync(join(dir, file))) return pm;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const agent = env.npm_config_user_agent ?? '';
  for (const pm of ['pnpm', 'yarn', 'bun'] as const) if (agent.startsWith(`${pm}/`)) return pm;
  return 'npm';
}

export function installCommand(pm: PackageManager, packages: string[]): [string, string[]] {
  return pm === 'npm' ? ['npm', ['install', ...packages]] : [pm, ['add', ...packages]];
}

/** The packages that no node_modules folder, from `cwd` up, contains. */
export function missingPackages(cwd: string, packages: string[]): string[] {
  return packages.filter((name) => {
    let dir = resolve(cwd);
    for (;;) {
      if (existsSync(join(dir, 'node_modules', ...name.split('/'), 'package.json'))) return false;
      const parent = dirname(dir);
      if (parent === dir) return true;
      dir = parent;
    }
  });
}

/** Runs a program with the terminal attached and resolves with its exit code. */
export function spawnProgram(command: string, args: string[], cwd: string): Promise<number> {
  return new Promise((done) => {
    // Package managers are .cmd scripts on Windows, which need a shell. The arguments are package names from DATABASES.
    const child = process.platform === 'win32' ? spawn([command, ...args].join(' '), { cwd, stdio: 'inherit', shell: true }) : spawn(command, args, { cwd, stdio: 'inherit' });
    child.on('error', () => done(127));
    child.on('close', (code) => done(code ?? 1));
  });
}

/** A flag wins, then --yes, then a question on a terminal; without a terminal the answer is no. */
async function decide(ctx: CliContext, flag: 'install' | 'run', question: string, initial: boolean): Promise<boolean> {
  const value = ctx.options[flag];
  if (typeof value === 'boolean') return value;
  if (opt.bool(ctx, 'yes')) return true;
  if (!ctx.prompt) return false;
  return ctx.prompt.confirm(question, initial);
}

function packageName(cwd: string): string {
  return (
    basename(resolve(cwd))
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^[._-]+|[._-]+$/g, '') || 'app'
  );
}

/** A label from DATABASES without the part in parentheses, for questions. */
const shortLabel = (db: DatabaseTemplate): string => db.label.replace(/\s*\(.*\)$/, '');

export const FIRST_QUERY = 'await db.users.findMany({ include: { posts: true } })';

export async function init(ctx: CliContext): Promise<number> {
  const { ui } = ctx;
  const { c } = ui;
  ui.title('init');
  let id = opt.str(ctx, 'db');
  if (!id) {
    if (!ctx.prompt) throw new ArgsError('Which database? Pass --db.', `One of: ${DATABASES.map((d) => d.id).join(', ')}.`);
    id = await ctx.prompt.select(
      'Which database do you use?',
      DATABASES.map((d) => ({ label: d.label, value: d.id, hint: d.hint })),
      Math.max(0, DATABASES.findIndex((d) => d.id === 'sqlite')),
    );
  }
  const db = DATABASES.find((d) => d.id === id);
  if (!db) throw new ArgsError(`Unknown database "${id}".`, `Use one of: ${DATABASES.map((d) => d.id).join(', ')}.`);

  const configPath = join(ctx.cwd, 'kastor.config.ts');
  const force = opt.bool(ctx, 'force');
  if (existsSync(configPath) && !force) {
    throw new KastorError('INVALID_ARGUMENT', 'kastor.config.ts already exists.', { hint: 'Pass --force to overwrite it.' });
  }
  const step = (n: number, text: string): void => {
    ui.line();
    ui.line(`${c.cyan(`Step ${n} of 3`)}  ${c.bold(text)}`);
  };

  /* 1. files */
  step(1, 'Write the config and a sample schema');
  const written: string[] = [];
  const write = (path: string, text: string, overwrite: boolean): void => {
    if (existsSync(path) && !overwrite) {
      ui.line(`  ${c.gray('skip')}   ${rel(ctx, path)} ${c.gray('(exists)')}`);
      return;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf8');
    written.push(path);
    ui.line(`  ${c.green('create')} ${rel(ctx, path)}`);
  };
  const schemaPath = join(ctx.cwd, 'src/db/schema.ts');
  write(configPath, configTemplate(db), true);
  write(schemaPath, SCHEMA_TEMPLATE, false);
  write(join(ctx.cwd, 'src/db/seed.ts'), SEED_TEMPLATE, false);
  const envPath = join(ctx.cwd, '.env');
  const envLines = db.env.split('\n');
  const key = envLines[0]!.split('=')[0]!;
  if (!existsSync(envPath)) write(envPath, `${db.env}\n`, false);
  else if (!readFileSync(envPath, 'utf8').includes(`${key}=`) && !key.startsWith('#')) {
    appendFileSync(envPath, `\n${db.env}\n`);
    ui.line(`  ${c.yellow('update')} ${rel(ctx, envPath)} ${c.gray(`(added ${key})`)}`);
  }
  ensureGitignore(ctx, ['.env']);
  const sample = written.includes(schemaPath);

  /* 2. packages */
  step(2, 'Install the packages');
  const pm = detectPackageManager(ctx.cwd, ctx.env);
  const wanted = ['kastor-orm', ...db.packages];
  let missing = missingPackages(ctx.cwd, wanted);
  let failed = false;
  if (!missing.length) ui.success(`${wanted.join(', ')} ${wanted.length === 1 ? 'is' : 'are'} installed.`);
  else if (await decide(ctx, 'install', `Install ${missing.join(' ')} with ${pm} now?`, true)) {
    const pkgPath = join(ctx.cwd, 'package.json');
    if (!existsSync(pkgPath)) write(pkgPath, `${JSON.stringify({ name: packageName(ctx.cwd), private: true }, null, 2)}\n`, false);
    const [cmd, args] = installCommand(pm, missing);
    ui.info(`Running ${c.bold(`${cmd} ${args.join(' ')}`)}`);
    const code = await (ctx.exec ?? spawnProgram)(cmd, args, ctx.cwd);
    missing = missingPackages(ctx.cwd, wanted);
    if (code === 0 && !missing.length) ui.success(`Installed ${wanted.join(', ')}.`);
    else {
      failed = true;
      ui.warn(`${cmd} stopped with exit code ${code}${missing.length ? ` and ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} still missing` : ''}.`);
    }
  } else ui.line(`  ${c.gray('skip')}   ${c.gray('install them yourself, the command is below')}`);

  /* 3. first query */
  step(3, sample ? 'Create the tables and run a first query' : 'Create the tables');
  let ran = false;
  if (missing.length) {
    ui.line(`  ${c.gray('skip')}   ${c.gray(`needs ${missing.join(', ')} from step 2`)}`);
    if (ctx.options.run === true) failed = true;
  } else {
    const question = db.local
      ? sample
        ? 'Create the tables, add sample rows and run a first query?'
        : 'Create the tables now?'
      : `Is ${shortLabel(db)} running at the address in .env? Create the tables${sample ? ' and run a first query' : ''}?`;
    if (await decide(ctx, 'run', question, Boolean(db.local))) {
      ran = await firstRun(ctx, sample);
      if (!ran) failed = true;
    } else ui.line(`  ${c.gray('skip')}   ${c.gray('the commands below do it when you are ready')}`);
  }

  /* summary */
  ui.line();
  const next: string[] = [];
  if (missing.length) {
    const [cmd, args] = installCommand(pm, missing);
    next.push(`${cmd} ${args.join(' ')}`);
  }
  if (!ran) {
    if (!db.local) next.push('Set the connection in .env');
    next.push('npx kastor migrate dev --name init');
    if (sample) next.push('npx kastor db seed');
  }
  next.push(`npx kastor studio ${c.gray('(browse rows and the SQL of each query)')}`);
  next.push(`Edit src/db/schema.ts, then npx kastor migrate dev`);
  ui.box([c.bold(ran ? 'You are set up. Next' : 'Next steps'), ...next.map((line, i) => `${i + 1}. ${line}`)], failed ? 'yellow' : 'cyan');
  return failed ? 1 : 0;
}

/** migrate dev, the seed and the first query. Errors are printed here so the summary still shows. */
async function firstRun(ctx: CliContext, sample: boolean): Promise<boolean> {
  const { ui } = ctx;
  const { c } = ui;
  const options: CliContext['options'] = { ...ctx.options, name: 'init' };
  delete options.yes;
  delete options['accept-data-loss'];
  // No prompt: the wizard never confirms dropping data in an existing database.
  const sub: CliContext = { ...ctx, prompt: null, options };
  try {
    if ((await migrateDev(sub)) !== 0) return false;
    if (!sample) return true;
    await withProject(sub, (project) => runSeed(sub, project));
    const events: QueryEvent[] = [];
    const rows = await withProject(sub, async (project) => {
      const client = (await makeClient(project, { log: (e) => events.push(e) })) as { users?: { findMany(args: unknown): Promise<unknown[]> } };
      if (!client.users) throw new KastorError('INVALID_ARGUMENT', 'The schema has no users table for the first query.', { hint: 'Run your own query with the client.' });
      return client.users.findMany({ include: { posts: true } });
    });
    ui.line();
    ui.line(c.bold('First query'));
    ui.line(`  ${c.cyan(FIRST_QUERY)}`);
    ui.line();
    ui.line(`  ${c.gray(`SQL (${events.length} statement${events.length === 1 ? '' : 's'})`)}`);
    for (const e of events) {
      for (const l of e.sql.split('\n')) ui.line(`  ${l}`);
      if (e.params.length) ui.line(`  ${c.gray(`params ${inspect(e.params, { colors: false, breakLength: Infinity })}`)}`);
    }
    ui.line();
    ui.line(`  ${c.gray(`Result (${rows.length} row${rows.length === 1 ? '' : 's'})`)}`);
    for (const l of inspect(rows, { depth: 4, colors: c.enabled, breakLength: 100 }).split('\n')) ui.line(`  ${l}`);
    return true;
  } catch (error) {
    printError(ui, error);
    return false;
  }
}

function ensureGitignore(ctx: CliContext, entries: string[]): void {
  const path = join(ctx.cwd, '.gitignore');
  const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const lines = new Set(current.split(/\r?\n/).map((l) => l.trim()));
  const missing = entries.filter((e) => !lines.has(e));
  if (!missing.length) return;
  appendFileSync(path, `${current && !current.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`);
  ctx.ui.line(`  ${ctx.ui.c.yellow('update')} ${rel(ctx, path)} ${ctx.ui.c.gray(`(ignore ${missing.join(', ')})`)}`);
}
