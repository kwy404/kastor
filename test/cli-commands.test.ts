import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { main, VERSION, type MainOptions } from '../src/cli/index';
import { ScriptedPrompter } from '../src/cli/prompt';
import { MemoryStream } from '../src/cli/ui';
import { DATABASES, configTemplate } from '../src/cli/commands/init';

const root = resolve('.');
const posix = (p: string): string => p.replace(/\\/g, '/');

function project(): string {
  mkdirSync(join(root, '.kastor'), { recursive: true });
  const dir = mkdtempSync(join(root, '.kastor', 'cli-'));
  writeFileSync(
    join(dir, 'kastor.config.ts'),
    `import Database from 'better-sqlite3';
import { sqlite } from '${posix(join(root, 'src/sqlite'))}';
export default {
  schema: './schema.ts',
  adapter: () => sqlite(new Database(__dirname + '/dev.db')),
  migrations: './kastor/migrations',
  seed: './seed.ts',
};
`,
  );
  writeFileSync(join(dir, 'seed.ts'), `import { writeFileSync } from 'node:fs';\nwriteFileSync(__dirname + '/seeded.txt', 'yes');\n`);
  writeSchema(dir, 'name');
  return dir;
}

function writeSchema(dir: string, nameColumn: string, extra = ''): void {
  writeFileSync(
    join(dir, 'schema.ts'),
    `import { table, t, index } from '${posix(join(root, 'src/core/schema'))}';
export const users = table('users', {
  id: t.id(),
  email: t.string(255).unique(),
  ${nameColumn}: t.string().nullable(),${extra}
});
export const posts = table('posts', {
  id: t.id(),
  title: t.string(200),
  authorId: t.int().references(() => users.id, { onDelete: 'cascade' }),
}, { indexes: (p) => [index(p.authorId)] });
`,
  );
}

async function run(dir: string, argv: string[], extra: MainOptions = {}): Promise<{ code: number; out: string; err: string }> {
  const stdout = new MemoryStream();
  const stderr = new MemoryStream();
  const code = await main(argv, { cwd: dir, stdout, stderr, env: { NO_COLOR: '1' }, prompt: null, openUrl: () => undefined, ...extra });
  return { code, out: stdout.text, err: stderr.text };
}

describe('kastor CLI end to end on SQLite', () => {
  let dir: string;
  beforeAll(() => {
    dir = project();
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('prints the version and help', async () => {
    expect((await run(dir, ['--version'])).out.trim()).toBe(VERSION);
    const help = await run(dir, ['--help']);
    expect(help.code).toBe(0);
    expect(help.out).toContain('migrate dev');
    expect((await run(dir, [])).code).toBe(1);
    const sub = await run(dir, ['db', 'pull', '--help']);
    expect(sub.out).toContain('--print');
  });

  it('explains unknown commands', async () => {
    const r = await run(dir, ['migrat', 'dev']);
    expect(r.code).toBe(2);
    expect(r.err).toContain('Unknown command');
  });

  it('migrate dev writes and applies the first migration', async () => {
    const r = await run(dir, ['migrate', 'dev', '--name', 'init']);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(r.out).toContain('+ Create table users');
    expect(r.out).toMatch(/Wrote kastor\/migrations\/\d{14}_init\/migration\.sql/);
    expect(r.out).toContain('The database matches the schema');
    expect(r.out).not.toMatch(/\u001b\[/);
    const again = await run(dir, ['migrate', 'dev']);
    expect(again.out).toContain('Already in sync');
  });

  it('stops on a possible rename without a terminal and tells how to answer', async () => {
    writeSchema(dir, 'fullName');
    const r = await run(dir, ['migrate', 'dev', '--name', 'rename']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('column users.name is gone');
    expect(r.err).toContain('--rename users.name:fullName');
  });

  it('asks about the rename and the name on a terminal', async () => {
    const prompt = new ScriptedPrompter(['fullName', 'rename_name']);
    const r = await run(dir, ['migrate', 'dev'], { prompt });
    expect(r.code).toBe(0);
    expect(prompt.asked).toEqual(['Column users.name is gone from the schema. Was it renamed?', 'Name of the migration']);
    expect(r.out).toContain('> Rename column users.name to fullName');
    expect(readdirSync(join(dir, 'kastor/migrations')).some((d) => d.endsWith('_rename_name'))).toBe(true);
  });

  it('migrate status reports up to date, as text and JSON', async () => {
    const text = await run(dir, ['migrate', 'status']);
    expect(text.code).toBe(0);
    expect(text.out).toContain('applied');
    expect(text.out).toContain('Database is up to date.');
    const json = await run(dir, ['migrate', 'status', '--json']);
    const data = JSON.parse(json.out) as { upToDate: boolean; applied: unknown[]; drift: number };
    expect(data.upToDate).toBe(true);
    expect(data.applied).toHaveLength(2);
    expect(data.drift).toBe(0);
  });

  it('create only, then status shows pending and deploy applies it', async () => {
    writeSchema(dir, 'fullName', "\n  bio: t.text().nullable(),");
    const created = await run(dir, ['migrate', 'dev', '--name', 'bio', '--create-only']);
    expect(created.code).toBe(0);
    expect(created.out).toContain('Review the SQL');
    const st = await run(dir, ['migrate', 'status']);
    expect(st.code).toBe(1);
    expect(st.out).toContain('pending');
    const dep = await run(dir, ['migrate', 'deploy']);
    expect(dep.code).toBe(0);
    expect(dep.out).toContain('Applied 1 migration.');
    expect((await run(dir, ['migrate', 'deploy'])).out).toContain('No pending migrations');
  });

  it('db push reports in sync and pushes changes with data loss accepted', async () => {
    expect((await run(dir, ['db', 'push'])).out).toContain('Already in sync');
    writeSchema(dir, 'fullName');
    const refused = await run(dir, ['db', 'push']);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain('nobody confirmed');
    const pushed = await run(dir, ['db', 'push', '--accept-data-loss']);
    expect(pushed.code).toBe(0);
    expect(pushed.out).toContain('Drop column users.bio');
    expect(pushed.out).toContain('No migration file was written');
    const st = await run(dir, ['doctor', '--json']);
    expect(JSON.parse(st.out).ok).toBe(true);
  });

  it('db pull prints or writes a TypeScript schema', async () => {
    const printed = await run(dir, ['db', 'pull', '--print']);
    expect(printed.code).toBe(0);
    expect(printed.out).toContain("export const users = table('users', {");
    expect(printed.out).toContain('posts: many(posts');
    const out = join(dir, 'pulled.ts');
    const wrote = await run(dir, ['db', 'pull', '--out', 'pulled.ts']);
    expect(wrote.code).toBe(0);
    expect(readFileSync(out, 'utf8')).toContain("import { table, t, index, one, many } from 'kastor';");
    const again = await run(dir, ['db', 'pull', '--out', 'pulled.ts']);
    expect(again.code).toBe(1);
    expect(again.err).toContain('--force');
    expect((await run(dir, ['db', 'pull', '--out', 'pulled.ts', '--force'])).code).toBe(0);
  });

  it('doctor lists every check', async () => {
    const r = await run(dir, ['doctor']);
    expect(r.code).toBe(0);
    for (const name of ['Node.js', 'Config', 'Schema', 'Connection', 'Migrations', 'Drift']) expect(r.out).toContain(name);
  });

  it('db seed runs the seed script', async () => {
    const r = await run(dir, ['db', 'seed']);
    expect(r.code).toBe(0);
    expect(readFileSync(join(dir, 'seeded.txt'), 'utf8')).toBe('yes');
  });

  it('migrate reset needs a confirmation and then rebuilds the database', async () => {
    const refused = await run(dir, ['migrate', 'reset']);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain('--force');
    const no = await run(dir, ['migrate', 'reset'], { prompt: new ScriptedPrompter([false]) });
    expect(no.out).toContain('Nothing was changed');
    rmSync(join(dir, 'seeded.txt'));
    const r = await run(dir, ['migrate', 'reset', '--force']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Applied 3 migration(s).');
    expect(existsSync(join(dir, 'seeded.txt'))).toBe(true);
  });

  it('studio starts on 127.0.0.1 and answers with the token', async () => {
    let studio: { url: string; close(): Promise<void> } | undefined;
    const opened: string[] = [];
    const r = await run(dir, ['studio', '--port', '0'], { onStudio: (s) => (studio = s), openUrl: (u) => opened.push(u) });
    expect(r.code).toBe(0);
    expect(studio).toBeDefined();
    expect(opened).toEqual([studio!.url]);
    const url = new URL(studio!.url);
    const res = await fetch(`${url.origin}/api/schema`, { headers: { 'X-Kastor-Token': url.searchParams.get('token')! } });
    expect(res.status).toBe(200);
    await studio!.close();
    const noOpen = await run(dir, ['studio', '--port', '0', '--no-open'], { onStudio: (s) => (studio = s), openUrl: (u) => opened.push(u) });
    expect(noOpen.code).toBe(0);
    expect(opened).toHaveLength(1);
    await studio!.close();
    await run(dir, ['studio', '--port', '0', '--no-open', '--read-only'], { onStudio: (s) => (studio = s) });
    const ro = new URL(studio!.url);
    const schema = (await (await fetch(`${ro.origin}/api/schema`, { headers: { 'X-Kastor-Token': ro.searchParams.get('token')! } })).json()) as { readOnly: boolean };
    expect(schema.readOnly).toBe(true);
    await studio!.close();
  });

  it('reports a missing config with a hint', async () => {
    const empty = mkdtempSync(join(root, '.kastor', 'empty-'));
    writeFileSync(join(empty, 'package.json'), '{}');
    try {
      const r = await run(empty, ['migrate', 'deploy']);
      expect(r.code).toBe(1);
      expect(r.err).toContain('No kastor.config.ts found');
      expect(r.err).toContain('kastor init');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('kastor init', () => {
  it('scaffolds the config, schema, seed and .env, and refuses to overwrite', async () => {
    const dir = mkdtempSync(join(root, '.kastor', 'init-'));
    try {
      writeFileSync(join(dir, '.gitignore'), 'node_modules');
      const r = await run(dir, ['init', '--db', 'postgres']);
      expect(r.code).toBe(0);
      expect(readFileSync(join(dir, 'kastor.config.ts'), 'utf8')).toContain("import { postgres } from 'kastor/postgres';");
      expect(readFileSync(join(dir, 'src/db/schema.ts'), 'utf8')).toContain("export const users = table('users'");
      expect(readFileSync(join(dir, '.env'), 'utf8')).toContain('DATABASE_URL=postgres://');
      expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toBe('node_modules\n.env\n');
      expect(r.out).toContain('npm install kastor pg');
      const again = await run(dir, ['init', '--db', 'sqlite']);
      expect(again.code).toBe(1);
      expect(again.err).toContain('already exists');
      const forced = await run(dir, ['init', '--db', 'mysql', '--force']);
      expect(forced.code).toBe(0);
      expect(readFileSync(join(dir, '.env'), 'utf8')).not.toContain('mysql://');
      expect(forced.out).toContain('skip   src/db/schema.ts');
      const unknown = await run(dir, ['init', '--db', 'nope']);
      expect(unknown.code).toBe(2);
      const ask = await run(dir, ['init', '--force'], { prompt: new ScriptedPrompter(['sqlite']) });
      expect(ask.code).toBe(0);
      expect(readFileSync(join(dir, 'kastor.config.ts'), 'utf8')).toContain('better-sqlite3');
      expect((await run(dir, ['init', '--force'])).err).toContain('Pass --db');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('has a config template for every database', () => {
    for (const db of DATABASES) {
      const text = configTemplate(db);
      expect(text).toContain(`from 'kastor/${db.id}'`);
      expect(text).toContain('export default defineConfig({');
    }
  });
});
