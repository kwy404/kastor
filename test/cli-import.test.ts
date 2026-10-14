import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseArgs, renderHelp, resolveCommand } from '../src/cli/args';
import { importedConfig } from '../src/cli/commands/import';
import { main } from '../src/cli/index';
import { MemoryStream } from '../src/cli/ui';
import { prismaToKastor } from '../src/migrate/import/prisma';
import { splitStatements } from '../src/migrate/sql-split';

const root = resolve('.');
const posix = (p: string): string => p.replace(/\\/g, '/');
const fixture = (name: string): string => readFileSync(join(root, 'test', 'migrate-prisma', name), 'utf8');
const plain = { bold: (s: string) => s, gray: (s: string) => s, cyan: (s: string) => s };

async function run(dir: string, argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const stdout = new MemoryStream();
  const stderr = new MemoryStream();
  const code = await main(argv, { cwd: dir, stdout, stderr, env: { NO_COLOR: '1' }, prompt: null });
  return { code, out: stdout.text, err: stderr.text };
}

function project(prefix: string): string {
  mkdirSync(join(root, '.kastor'), { recursive: true });
  return mkdtempSync(join(root, '.kastor', prefix));
}

describe('import and baseline arguments', () => {
  it('reads --config as a switch for import prisma and as a path elsewhere', () => {
    const imp = parseArgs(['import', 'prisma', '--config', '--out', 'src/schema.ts']);
    expect(resolveCommand(imp)?.name).toBe('import prisma');
    expect(imp.options).toEqual({ config: true, out: 'src/schema.ts' });
    expect(parseArgs(['--out', 'x.ts', 'import', 'prisma', '--config']).options.config).toBe(true);
    const dev = parseArgs(['migrate', 'dev', '--config', 'other.config.ts']);
    expect(dev.options.config).toBe('other.config.ts');
    expect(parseArgs(['migrate', 'baseline', '--from-prisma', 'prisma/migrations', '-n', 'init']).options).toEqual({ 'from-prisma': 'prisma/migrations', name: 'init' });
    expect(() => parseArgs(['migrate', 'baseline', '--from-prisma'])).toThrow('needs a value');
    expect(() => resolveCommand(parseArgs(['import', 'prisma', '--accept-data-loss']))).toThrow('does not apply');
    expect(() => resolveCommand(parseArgs(['import', 'prisam']))).toThrow('Unknown command "kastor import prisam"');
  });

  it('documents both commands in the help', () => {
    const top = renderHelp(null, plain, '0.0.0');
    expect(top).toContain('import prisma');
    expect(top).toContain('migrate baseline');
    const help = renderHelp(resolveCommand(parseArgs(['import', 'prisma']))!, plain, '0.0.0');
    expect(help).toContain('kastor import prisma [--schema prisma/schema.prisma] [--out src/db/schema.ts] [--config]');
    expect(help).toMatch(/--config\s+Also write kastor\.config\.ts/);
    expect(help).not.toContain('--config <path>');
    const base = renderHelp(resolveCommand(parseArgs(['migrate', 'baseline']))!, plain, '0.0.0');
    expect(base).toContain('--from-prisma <folder>');
    expect(base).toContain('--config <path>');
  });
});

describe('kastor import prisma', { timeout: 120000 }, () => {
  let dir: string;
  beforeAll(() => {
    dir = project('import-');
    mkdirSync(join(dir, 'prisma'), { recursive: true });
    writeFileSync(join(dir, 'prisma', 'schema.prisma'), fixture('schema.prisma').replace('provider = "postgresql"', 'provider = "sqlite"').replace('env("DATABASE_URL")', 'env("APP_DB")'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('finds prisma/schema.prisma, writes the schema and kastor.config.ts, and prints the report', async () => {
    const r = await run(dir, ['import', 'prisma', '--config']);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(r.out).toContain('Prisma schema  prisma/schema.prisma');
    expect(r.out).toContain('sqlite (kastor/sqlite)');
    expect(r.out).toContain('Wrote src/db/schema.ts: 8 models, 3 join tables, 2 enums, 20 relation fields.');
    expect(r.out).toContain('Wrote kastor.config.ts for sqlite, reading APP_DB.');
    expect(r.out).toContain('Not mapped exactly (1)');
    expect(r.out).toContain('Unix milliseconds');
    expect(r.out).toContain('Good to know');
    expect(r.out).toContain('kastor migrate baseline');
    expect(r.out).not.toMatch(/\u001b\[/);
    const code = readFileSync(join(dir, 'src', 'db', 'schema.ts'), 'utf8');
    expect(code).toContain("export const user = table('User', {");
    const config = readFileSync(join(dir, 'kastor.config.ts'), 'utf8');
    expect(config).toContain("import { sqlite } from 'kastor/sqlite';");
    expect(config).toContain("schema: './src/db/schema.ts',");
    expect(config).toContain(`resolve("prisma", (process.env.APP_DB ?? 'file:./dev.db').replace(/^file:/, ''))`);
  });

  it('refuses to overwrite without --force, and --print writes to stdout only', async () => {
    const again = await run(dir, ['import', 'prisma']);
    expect(again.code).not.toBe(0);
    expect(again.err).toContain('src/db/schema.ts already exists');
    expect((await run(dir, ['import', 'prisma', '--force'])).code).toBe(0);
    const printed = await run(dir, ['import', 'prisma', '--print', '--out', 'other.ts']);
    expect(printed.code).toBe(0);
    expect(printed.out.startsWith('// Schema imported from prisma/schema.prisma')).toBe(true);
    expect(existsSync(join(dir, 'other.ts'))).toBe(false);
  });

  it('reads a multi file schema folder and explains a missing schema', async () => {
    const multi = project('import-multi-');
    try {
      mkdirSync(join(multi, 'prisma', 'schema', 'models'), { recursive: true });
      writeFileSync(join(multi, 'prisma', 'schema', 'main.prisma'), 'datasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n}\n');
      writeFileSync(join(multi, 'prisma', 'schema', 'models', 'user.prisma'), 'model User {\n  id Int @id @default(autoincrement())\n  posts Post[]\n}\n');
      writeFileSync(join(multi, 'prisma', 'schema', 'models', 'post.prisma'), 'model Post {\n  id Int @id\n  userId Int\n  user User @relation(fields: [userId], references: [id])\n}\n');
      const r = await run(multi, ['import', 'prisma', '--out', 'db/schema.ts']);
      expect(r.err).toBe('');
      expect(r.out).toContain('2 models');
      expect(readFileSync(join(multi, 'db', 'schema.ts'), 'utf8')).toContain("posts: many(post, { fields: ['id'], references: ['userId'] }),");
      const none = await run(join(multi, 'db'), ['import', 'prisma', '--schema', 'nope.prisma']);
      expect(none.err).toContain('nope.prisma does not exist');
      const broken = await run(multi, ['import', 'prisma', '--schema', 'db/schema.ts', '--force']);
      expect(broken.err).toMatch(/db\/schema\.ts:\d+:\d+: /);
    } finally {
      rmSync(multi, { recursive: true, force: true });
    }
  });

  it('writes configs for every provider', () => {
    const configFor = (provider: string): string => importedConfig(prismaToKastor(`datasource db {\n  provider = "${provider}"\n  url = env("DB_URL")\n}\nmodel A {\n  id Int @id\n}`), { schemaPath: './src/db/schema.ts', prismaDir: 'prisma' });
    expect(configFor('postgresql')).toContain('postgres(new pg.Pool({ connectionString: process.env.DB_URL }))');
    expect(configFor('cockroachdb')).toContain("import { cockroach } from 'kastor/cockroach';");
    expect(configFor('mysql')).toContain('mysql(createPool(process.env.DB_URL!))');
    expect(configFor('mysql')).toContain('MariaDB works too');
    expect(configFor('sqlserver')).toContain("import { mssql } from 'kastor/mssql';");
    expect(configFor('mongodb')).toContain('mongodb((await new MongoClient(process.env.DB_URL!).connect()).db())');
  });
});

describe('kastor migrate baseline on SQLite', { timeout: 120000 }, () => {
  let dir: string;
  const config = (file: string): string => `import Database from 'better-sqlite3';
import { sqlite } from '${posix(join(root, 'src/sqlite'))}';
export default {
  schema: './src/db/schema.ts',
  adapter: () => sqlite(new Database(${JSON.stringify(posix(file))})),
  migrations: './kastor/migrations',
};
`;
  const createPrismaDb = (file: string): void => {
    const db = new Database(file);
    for (const s of splitStatements(fixture('sqlite.sql'))) db.exec(s);
    db.exec('CREATE TABLE "_prisma_migrations" ("id" TEXT PRIMARY KEY NOT NULL, "checksum" TEXT NOT NULL, "finished_at" DATETIME, "migration_name" TEXT NOT NULL, "logs" TEXT, "rolled_back_at" DATETIME, "started_at" DATETIME NOT NULL DEFAULT current_timestamp, "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0)');
    db.exec(`INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name) VALUES ('1', 'x', 1704067200000, '20240101000000_init'), ('2', 'y', NULL, '20240102000000_broken')`);
    db.close();
  };

  beforeAll(async () => {
    dir = project('baseline-');
    mkdirSync(join(dir, 'prisma', 'migrations', '20240101000000_init'), { recursive: true });
    mkdirSync(join(dir, 'prisma', 'migrations', '20240102000000_broken'), { recursive: true });
    writeFileSync(join(dir, 'prisma', 'migrations', '20240101000000_init', 'migration.sql'), fixture('sqlite.sql'));
    writeFileSync(join(dir, 'prisma', 'migrations', '20240102000000_broken', 'migration.sql'), 'SELECT 1;\n');
    writeFileSync(join(dir, 'prisma', 'schema.prisma'), fixture('schema.prisma').replace('provider = "postgresql"', 'provider = "sqlite"'));
    createPrismaDb(join(dir, 'dev.db'));
    writeFileSync(join(dir, 'kastor.config.ts'), config(join(dir, 'dev.db')));
    expect((await run(dir, ['import', 'prisma'])).code).toBe(0);
    const schemaFile = join(dir, 'src', 'db', 'schema.ts');
    writeFileSync(schemaFile, readFileSync(schemaFile, 'utf8').replace(/from 'kastor'/g, `from '${posix(join(root, 'src/index'))}'`));
  }, 120000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('refuses an empty database', async () => {
    const empty = project('baseline-empty-');
    try {
      writeFileSync(join(empty, 'kastor.config.ts'), config(join(empty, 'empty.db')));
      mkdirSync(join(empty, 'src', 'db'), { recursive: true });
      writeFileSync(join(empty, 'src', 'db', 'schema.ts'), readFileSync(join(dir, 'src', 'db', 'schema.ts'), 'utf8'));
      const r = await run(empty, ['migrate', 'baseline']);
      expect(r.code).not.toBe(0);
      expect(r.err).toContain('no tables, so there is nothing to baseline');
      expect(existsSync(join(empty, 'kastor', 'migrations'))).toBe(false);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('writes the baseline, records the finished Prisma migrations and leaves the database alone', async () => {
    const r = await run(dir, ['migrate', 'baseline', '--from-prisma', 'prisma/migrations']);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(r.out).toContain('Recorded 1 Prisma migration as history');
    expect(r.out).toContain('did not finish (20240102000000_broken)');
    expect(r.out).toMatch(/Wrote kastor\/migrations\/\d{14}_baseline\/migration\.sql \(\d+ steps\)/);
    expect(r.out).toContain('Recorded it as applied without running it');
    expect(r.out).toContain('The schema file matches the database');
    const [folder] = readdirSync(join(dir, 'kastor', 'migrations')).filter((f) => f.endsWith('_baseline'));
    const sql = readFileSync(join(dir, 'kastor', 'migrations', folder!, 'migration.sql'), 'utf8');
    expect(sql).toContain('-- Baseline: the schema of the database when kastor took over.');
    expect(sql).toContain('CREATE TABLE "User"');
    expect(sql).not.toContain('_prisma_migrations');
    expect(readFileSync(join(dir, 'kastor', 'migrations', 'migration_lock.toml'), 'utf8')).toContain('dialect = "sqlite"');

    const status = await run(dir, ['migrate', 'status', '--json']);
    expect(status.code).toBe(0);
    const json = JSON.parse(status.out) as { applied: Array<{ id: string }>; history: string[]; missing: string[]; drift: number; upToDate: boolean };
    expect(json.applied.map((a) => a.id)).toEqual([folder]);
    expect(json.history).toEqual(['prisma/20240101000000_init']);
    expect(json.missing).toEqual([]);
    expect(json.drift).toBe(0);
    expect(json.upToDate).toBe(true);

    const dev = await run(dir, ['migrate', 'dev']);
    expect(dev.out).toContain('Already in sync');
    const pulled = await run(dir, ['db', 'pull', '--print']);
    expect(pulled.out).not.toContain('_prisma_migrations');
  });

  it('marks a committed baseline as applied on a teammate database', async () => {
    const mate = join(dir, 'mate.db');
    createPrismaDb(mate);
    writeFileSync(join(dir, 'kastor.mate.ts'), config(mate));
    const r = await run(dir, ['migrate', 'baseline', '--config', 'kastor.mate.ts']);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Marked \d{14}_baseline as applied without running it/);
    expect(readdirSync(join(dir, 'kastor', 'migrations')).filter((f) => /^\d{14}_/.test(f))).toHaveLength(1);
    const again = await run(dir, ['migrate', 'baseline', '--config', 'kastor.mate.ts']);
    expect(again.err).toContain('needs no baseline');
  });

  it('refuses when the first migration is not a baseline', async () => {
    const other = project('baseline-other-');
    try {
      createPrismaDb(join(other, 'x.db'));
      writeFileSync(join(other, 'kastor.config.ts'), config(join(other, 'x.db')));
      mkdirSync(join(other, 'src', 'db'), { recursive: true });
      writeFileSync(join(other, 'src', 'db', 'schema.ts'), readFileSync(join(dir, 'src', 'db', 'schema.ts'), 'utf8'));
      mkdirSync(join(other, 'kastor', 'migrations', '20240101000000_init'), { recursive: true });
      writeFileSync(join(other, 'kastor', 'migrations', '20240101000000_init', 'migration.sql'), 'CREATE TABLE x (id INTEGER);\n');
      const r = await run(other, ['migrate', 'baseline']);
      expect(r.err).toContain('is not a baseline');
      const missing = await run(other, ['migrate', 'baseline', '--from-prisma', 'nowhere']);
      expect(missing.err).toContain('is not a baseline');
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});
