import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectPackageManager, FIRST_QUERY, installCommand, missingPackages } from '../src/cli/commands/init';
import { main, type MainOptions } from '../src/cli/index';
import { ScriptedPrompter } from '../src/cli/prompt';
import { MemoryStream } from '../src/cli/ui';

const root = resolve('.');
const posix = (p: string): string => p.replace(/\\/g, '/');

/** A folder for one test, with its own package.json so kastor-orm is not found until "installed". */
function folder(): string {
  mkdirSync(join(root, '.kastor'), { recursive: true });
  const dir = mkdtempSync(join(root, '.kastor', 'wizard-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo', private: true }));
  return dir;
}

/** What `npm install kastor-orm` leaves behind, pointing at this checkout's sources. */
function installKastor(dir: string): void {
  const pkg = join(dir, 'node_modules', 'kastor-orm');
  mkdirSync(pkg, { recursive: true });
  const entries: Record<string, string> = { '.': 'index', './sqlite': 'sqlite', './postgres': 'postgres' };
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'kastor-orm', version: '0.0.0', exports: Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, `./${v}.ts`])) }));
  for (const file of Object.values(entries)) writeFileSync(join(pkg, `${file}.ts`), `export * from '${posix(join(root, 'src', file))}';\n`);
}

async function run(dir: string, argv: string[], extra: MainOptions = {}): Promise<{ code: number; out: string; err: string }> {
  const stdout = new MemoryStream();
  const stderr = new MemoryStream();
  const code = await main(argv, { cwd: dir, stdout, stderr, env: { NO_COLOR: '1' }, prompt: null, openUrl: () => undefined, ...extra });
  return { code, out: stdout.text, err: stderr.text };
}

describe('kastor init wizard', () => {
  let dir: string;
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    dir = folder();
  });
  afterEach(() => {
    delete process.env.DATABASE_URL;
    rmSync(dir, { recursive: true, force: true });
  });

  it('goes from an empty folder to a first query on SQLite', { timeout: 120_000 }, async () => {
    // A path the test controls, so the database file lands in the test folder.
    writeFileSync(join(dir, '.env'), `DATABASE_URL=${posix(join(dir, 'dev.db'))}\n`);
    const calls: string[] = [];
    const prompt = new ScriptedPrompter(['sqlite', true, true]);
    const r = await run(dir, ['init'], {
      prompt,
      exec: async (cmd, args, cwd) => {
        calls.push(`${cmd} ${args.join(' ')} in ${cwd === dir ? 'project' : cwd}`);
        installKastor(dir);
        return 0;
      },
    });
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(prompt.asked).toEqual([
      'Which database do you use?',
      'Install kastor-orm with npm now?',
      'Create the tables, add sample rows and run a first query?',
    ]);
    expect(calls).toEqual(['npm install kastor-orm in project']);
    expect(r.out).toContain('Step 1 of 3');
    expect(r.out).toContain('Step 3 of 3');
    expect(r.out).toMatch(/Applied \d{14}_init/);
    expect(r.out).toContain('Seeded');
    expect(r.out).toContain(FIRST_QUERY);
    expect(r.out).toMatch(/SELECT .*FROM "users"/);
    expect(r.out).toContain("email: 'ada@example.com'");
    expect(r.out).toContain("title: 'Hello kastor'");
    expect(r.out).toContain('You are set up');
    expect(r.out).not.toContain('npx kastor migrate dev --name init');
    expect(existsSync(join(dir, 'dev.db'))).toBe(true);
    expect(readdirSync(join(dir, 'kastor/migrations')).some((m) => m.endsWith('_init'))).toBe(true);
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe(`DATABASE_URL=${posix(join(dir, 'dev.db'))}\n`);
  });

  it('takes every answer from flags with --yes and asks nothing', { timeout: 120_000 }, async () => {
    writeFileSync(join(dir, '.env'), `DATABASE_URL=${posix(join(dir, 'dev.db'))}\n`);
    let installs = 0;
    const r = await run(dir, ['init', '--db', 'sqlite', '--yes'], {
      exec: async () => {
        installs++;
        installKastor(dir);
        return 0;
      },
    });
    expect(r.code).toBe(0);
    expect(installs).toBe(1);
    expect(r.out).toContain(FIRST_QUERY);
  });

  it('skips what it cannot do and prints the commands instead', async () => {
    const r = await run(dir, ['init', '--db', 'sqlite']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('needs kastor-orm from step 2');
    expect(r.out).toContain('1. npm install kastor-orm');
    expect(r.out).toContain('npx kastor migrate dev --name init');
    expect(r.out).toContain('npx kastor db seed');
    expect(r.out).not.toContain('Set the connection in .env');
    const asked = await run(dir, ['init', '--db', 'sqlite', '--run', '--force']);
    expect(asked.code).toBe(1);
  });

  it('reports a failed install and keeps the files', async () => {
    const r = await run(dir, ['init', '--db', 'sqlite', '--install', '--no-run'], { exec: async () => 1 });
    expect(r.code).toBe(1);
    expect(r.out).toContain('npm stopped with exit code 1 and kastor-orm is still missing');
    expect(existsSync(join(dir, 'kastor.config.ts'))).toBe(true);
  });

  it('writes package.json before installing into a folder without one', async () => {
    rmSync(join(dir, 'package.json'));
    let sawPackageJson = false;
    await run(dir, ['init', '--db', 'sqlite', '--install', '--no-run'], {
      exec: async () => {
        sawPackageJson = existsSync(join(dir, 'package.json'));
        return 0;
      },
    });
    expect(sawPackageJson).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))).toMatchObject({ private: true });
  });

  it('explains a database that does not answer and still prints the next steps', { timeout: 60_000 }, async () => {
    installKastor(dir);
    writeFileSync(join(dir, '.env'), 'DATABASE_URL=postgres://kastor:kastor@127.0.0.1:1/none\n');
    const prompt = new ScriptedPrompter([true]);
    const r = await run(dir, ['init', '--db', 'postgres'], { prompt });
    expect(prompt.asked).toEqual(['Is PostgreSQL running at the address in .env? Create the tables and run a first query?']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/ECONNREFUSED|connect/);
    expect(r.out).toContain('Set the connection in .env');
    expect(r.out).toContain('npx kastor migrate dev --name init');
  });

  it('keeps an existing schema and only creates its tables', { timeout: 60_000 }, async () => {
    installKastor(dir);
    writeFileSync(join(dir, '.env'), `DATABASE_URL=${posix(join(dir, 'dev.db'))}\n`);
    mkdirSync(join(dir, 'src/db'), { recursive: true });
    writeFileSync(join(dir, 'src/db/schema.ts'), `import { table, t } from 'kastor-orm';\nexport const notes = table('notes', { id: t.id(), body: t.text() });\n`);
    const r = await run(dir, ['init', '--db', 'sqlite', '--run']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('skip   src/db/schema.ts');
    expect(r.out).toContain('Step 3 of 3  Create the tables');
    expect(r.out).not.toContain(FIRST_QUERY);
    expect(r.out).toMatch(/Applied \d{14}_init/);
  });
});

describe('package helpers', () => {
  it('detects the package manager from lockfiles, then the user agent', () => {
    mkdirSync(join(root, '.kastor'), { recursive: true });
    const base = mkdtempSync(join(root, '.kastor', 'pm-'));
    try {
      const nested = join(base, 'a', 'b');
      mkdirSync(nested, { recursive: true });
      writeFileSync(join(base, 'pnpm-lock.yaml'), '');
      expect(detectPackageManager(nested)).toBe('pnpm');
      rmSync(join(base, 'pnpm-lock.yaml'));
      writeFileSync(join(nested, 'yarn.lock'), '');
      expect(detectPackageManager(nested)).toBe('yarn');
      rmSync(join(nested, 'yarn.lock'));
      writeFileSync(join(nested, 'bun.lock'), '');
      expect(detectPackageManager(nested)).toBe('bun');
      rmSync(join(nested, 'bun.lock'));
      // The checkout's own package-lock.json sits above the folder.
      expect(detectPackageManager(nested, { npm_config_user_agent: 'pnpm/9.0.0 npm/? node/v22' })).toBe('npm');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('builds the install command for each package manager', () => {
    expect(installCommand('npm', ['kastor-orm', 'pg'])).toEqual(['npm', ['install', 'kastor-orm', 'pg']]);
    expect(installCommand('pnpm', ['kastor-orm'])).toEqual(['pnpm', ['add', 'kastor-orm']]);
    expect(installCommand('yarn', ['kastor-orm'])).toEqual(['yarn', ['add', 'kastor-orm']]);
    expect(installCommand('bun', ['@libsql/client'])).toEqual(['bun', ['add', '@libsql/client']]);
  });

  it('finds installed packages in node_modules up the tree, scoped ones included', () => {
    expect(missingPackages(root, ['better-sqlite3', '@libsql/client', 'no-such-package-here'])).toEqual(['no-such-package-here']);
  });
});
