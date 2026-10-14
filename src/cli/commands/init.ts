import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ArgsError } from '../args';
import { opt, rel, type CliContext } from '../context';
import { KastorError } from '../../core/errors';

export interface DatabaseTemplate {
  id: string;
  label: string;
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
    imports: ["import pg from 'pg';", "import { postgres } from 'kastor/postgres';"],
    adapter: 'adapter: () => postgres(new pg.Pool({ connectionString: process.env.DATABASE_URL })),',
    env: 'DATABASE_URL=postgres://postgres:postgres@localhost:5432/app',
  },
  {
    id: 'cockroach',
    label: 'CockroachDB',
    packages: ['pg'],
    imports: ["import pg from 'pg';", "import { cockroach } from 'kastor/cockroach';"],
    adapter: 'adapter: () => cockroach(new pg.Pool({ connectionString: process.env.DATABASE_URL })),',
    env: 'DATABASE_URL=postgres://root@localhost:26257/defaultdb?sslmode=disable',
  },
  {
    id: 'mysql',
    label: 'MySQL (also PlanetScale)',
    packages: ['mysql2'],
    imports: ["import { createPool } from 'mysql2/promise';", "import { mysql } from 'kastor/mysql';"],
    adapter: 'adapter: () => mysql(createPool(process.env.DATABASE_URL!)),',
    env: 'DATABASE_URL=mysql://root:root@localhost:3306/app',
  },
  {
    id: 'mariadb',
    label: 'MariaDB',
    packages: ['mariadb'],
    imports: ["import { createPool } from 'mariadb';", "import { mariadb } from 'kastor/mariadb';"],
    adapter: 'adapter: () => mariadb(createPool(process.env.DATABASE_URL!)),',
    env: 'DATABASE_URL=mariadb://root:root@localhost:3306/app',
  },
  {
    id: 'sqlite',
    label: 'SQLite (better-sqlite3)',
    packages: ['better-sqlite3'],
    imports: ["import Database from 'better-sqlite3';", "import { sqlite } from 'kastor/sqlite';"],
    adapter: "adapter: () => sqlite(new Database(process.env.DATABASE_URL ?? 'dev.db')),",
    env: 'DATABASE_URL=dev.db',
  },
  {
    id: 'libsql',
    label: 'libSQL and Turso',
    packages: ['@libsql/client'],
    imports: ["import { createClient } from '@libsql/client';", "import { libsql } from 'kastor/libsql';"],
    adapter: "adapter: () => libsql(createClient({ url: process.env.DATABASE_URL ?? 'file:dev.db', authToken: process.env.DATABASE_TOKEN })),",
    env: 'DATABASE_URL=file:dev.db',
  },
  {
    id: 'd1',
    label: 'Cloudflare D1 (through wrangler)',
    packages: ['wrangler'],
    imports: ["import { getPlatformProxy } from 'wrangler';", "import { d1 } from 'kastor/d1';"],
    adapter: 'adapter: async () => {\n    const { env } = await getPlatformProxy<{ DB: D1Database }>();\n    return d1(env.DB);\n  },',
    env: '# D1 uses the binding named DB in wrangler.toml',
  },
  {
    id: 'mssql',
    label: 'SQL Server',
    packages: ['mssql'],
    imports: ["import sql from 'mssql';", "import { mssql } from 'kastor/mssql';"],
    adapter: 'adapter: async () => mssql(await new sql.ConnectionPool(process.env.DATABASE_URL!).connect()),',
    env: 'DATABASE_URL=Server=localhost,1433;Database=app;User Id=sa;Password=yourStrong(!)Password;Encrypt=false',
  },
  {
    id: 'oracle',
    label: 'Oracle',
    packages: ['oracledb'],
    imports: ["import oracledb from 'oracledb';", "import { oracle } from 'kastor/oracle';"],
    adapter:
      'adapter: async () =>\n    oracle(await oracledb.createPool({ user: process.env.ORACLE_USER, password: process.env.ORACLE_PASSWORD, connectString: process.env.ORACLE_CONNECT })),',
    env: 'ORACLE_USER=app\nORACLE_PASSWORD=app\nORACLE_CONNECT=localhost:1521/FREEPDB1',
  },
  {
    id: 'mongodb',
    label: 'MongoDB',
    packages: ['mongodb'],
    imports: ["import { MongoClient } from 'mongodb';", "import { mongodb } from 'kastor/mongodb';"],
    adapter: 'adapter: async () => mongodb((await new MongoClient(process.env.DATABASE_URL!).connect()).db()),',
    env: 'DATABASE_URL=mongodb://localhost:27017/app',
  },
];

export function configTemplate(db: DatabaseTemplate): string {
  return `${db.imports.join('\n')}
import { defineConfig } from 'kastor';

export default defineConfig({
  schema: './src/db/schema.ts',
  ${db.adapter}
  migrations: './kastor/migrations',
  seed: './src/db/seed.ts',
});
`;
}

export const SCHEMA_TEMPLATE = `import { table, t, index, many, one } from 'kastor';

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

export async function init(ctx: CliContext): Promise<number> {
  const { ui } = ctx;
  ui.title('init');
  let id = opt.str(ctx, 'db');
  if (!id) {
    if (!ctx.prompt) throw new ArgsError('Which database? Pass --db.', `One of: ${DATABASES.map((d) => d.id).join(', ')}.`);
    id = await ctx.prompt.select(
      'Which database do you use?',
      DATABASES.map((d) => ({ label: d.label, value: d.id })),
    );
  }
  const db = DATABASES.find((d) => d.id === id);
  if (!db) throw new ArgsError(`Unknown database "${id}".`, `Use one of: ${DATABASES.map((d) => d.id).join(', ')}.`);

  const configPath = join(ctx.cwd, 'kastor.config.ts');
  const force = opt.bool(ctx, 'force');
  if (existsSync(configPath) && !force) {
    throw new KastorError('INVALID_ARGUMENT', 'kastor.config.ts already exists.', { hint: 'Pass --force to overwrite it.' });
  }
  const written: string[] = [];
  const write = (path: string, text: string, overwrite: boolean): void => {
    if (existsSync(path) && !overwrite) {
      ui.line(`  ${ui.c.gray('skip')}   ${rel(ctx, path)} ${ui.c.gray('(exists)')}`);
      return;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf8');
    written.push(path);
    ui.line(`  ${ui.c.green('create')} ${rel(ctx, path)}`);
  };
  write(configPath, configTemplate(db), true);
  write(join(ctx.cwd, 'src/db/schema.ts'), SCHEMA_TEMPLATE, false);
  write(join(ctx.cwd, 'src/db/seed.ts'), SEED_TEMPLATE, false);
  const envPath = join(ctx.cwd, '.env');
  const envLines = db.env.split('\n');
  const key = envLines[0]!.split('=')[0]!;
  if (!existsSync(envPath)) write(envPath, `${db.env}\n`, false);
  else if (!readFileSync(envPath, 'utf8').includes(`${key}=`) && !key.startsWith('#')) {
    appendFileSync(envPath, `\n${db.env}\n`);
    ui.line(`  ${ui.c.yellow('update')} ${rel(ctx, envPath)} ${ui.c.gray(`(added ${key})`)}`);
  }
  ensureGitignore(ctx, ['.env']);
  ui.line();
  ui.box([
    ui.c.bold('Next steps'),
    `1. npm install kastor ${db.packages.join(' ')}`,
    `2. Set the connection in .env`,
    `3. npx kastor migrate dev --name init`,
    `4. npx kastor studio`,
  ]);
  return 0;
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
