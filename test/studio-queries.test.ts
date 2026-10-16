import Database from 'better-sqlite3';
import { request } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Adapter, ExecResult, Executor } from '../src/core/ir';
import { t, table } from '../src/core/schema';
import { toSchemaIR } from '../src/core/schema-ir';
import { push } from '../src/migrate/engine';
import { sqlite } from '../src/sqlite';
import { handleApi, type StudioState } from '../src/studio/api';
import { renderPage } from '../src/studio/page';
import { MAX_PARAM_LENGTH, MAX_PARAMS, QueryLog, logParam, type QueryEntry } from '../src/studio/queries';
import { startStudio, type StudioServer } from '../src/studio/server';

const users = table('users', { id: t.id(), email: t.string(255).unique(), name: t.string().nullable() });

async function setup(log = new QueryLog()): Promise<StudioState> {
  const adapter = sqlite(new Database(':memory:'));
  await push(adapter, toSchemaIR({ users }), {});
  const schema = await adapter.dialect.introspect(adapter.executor);
  schema.tables = schema.tables.filter((x) => x.name !== '_kastor_migrations');
  return { adapter, schema, version: '0.1.0', queries: log };
}

const call = (state: StudioState, method: string, path: string, body?: unknown, query = '') => handleApi(state, method, path, new URLSearchParams(query), body);

function fakeExecutor(fail = false): Executor & { seen: string[] } {
  const seen: string[] = [];
  const exec: Executor & { seen: string[] } = {
    seen,
    async query(sql: string): Promise<ExecResult> {
      seen.push(sql);
      if (fail) throw new Error('boom');
      return { rows: [], rowCount: 0 } as unknown as ExecResult;
    },
    async transaction(fn) {
      return fn(exec);
    },
  };
  return exec;
}

describe('query log', () => {
  it('records statements with their action, newest first', async () => {
    const log = new QueryLog();
    const exec = log.executor(fakeExecutor());
    await log.run('Browse users', async () => {
      await exec.query('SELECT 1', []);
      await exec.query('SELECT 2', [7]);
    });
    await exec.query('SELECT 3', []);
    const list = log.list();
    expect(list.map((q) => q.sql)).toEqual(['SELECT 3', 'SELECT 2', 'SELECT 1']);
    expect(list.map((q) => q.action)).toEqual(['Other', 'Browse users', 'Browse users']);
    expect(list[1]!.params).toEqual([7]);
    expect(list[0]!.id).toBeGreaterThan(list[1]!.id);
    expect(log.list(list[1]!.id).map((q) => q.sql)).toEqual(['SELECT 3']);
    expect(new Date(list[0]!.at).getTime()).not.toBeNaN();
  });

  it('returns the statements of one action', async () => {
    const log = new QueryLog();
    const exec = log.executor(fakeExecutor());
    const { result, queries } = await log.run('Count', async () => {
      await exec.query('SELECT COUNT(*) FROM "users"', []);
      return 42;
    });
    expect(result).toBe(42);
    expect(queries.map((q) => q.sql)).toEqual(['SELECT COUNT(*) FROM "users"']);
  });

  it('keeps actions that run at the same time apart', async () => {
    const log = new QueryLog();
    const exec = log.executor(fakeExecutor());
    const tick = () => new Promise((r) => setTimeout(r, 5));
    const [a, b] = await Promise.all([
      log.run('A', async () => {
        await tick();
        await exec.query('SELECT a', []);
      }),
      log.run('B', async () => {
        await exec.query('SELECT b', []);
        await tick();
      }),
    ]);
    expect(a.queries.map((q) => q.sql)).toEqual(['SELECT a']);
    expect(b.queries.map((q) => q.sql)).toEqual(['SELECT b']);
  });

  it('records failures and still throws them', async () => {
    const log = new QueryLog();
    const exec = log.executor(fakeExecutor(true));
    await expect(exec.query('SELECT nope', [])).rejects.toThrow('boom');
    expect(log.list()[0]).toMatchObject({ sql: 'SELECT nope', error: 'boom' });
  });

  it('records statements inside transactions', async () => {
    const log = new QueryLog();
    const exec = log.executor(fakeExecutor());
    await exec.transaction(async (tx) => {
      await tx.query('INSERT INTO t VALUES (1)', []);
    });
    expect(log.list().map((q) => q.sql)).toEqual(['INSERT INTO t VALUES (1)']);
  });

  it('wraps an executor once and leaves executors without query alone', () => {
    const log = new QueryLog();
    const base = fakeExecutor();
    expect(log.executor(base)).toBe(log.executor(base));
    const other = { find: () => 1 };
    expect(log.executor(other)).toBe(other);
  });

  it('keeps only the newest entries', async () => {
    const log = new QueryLog(3);
    const exec = log.executor(fakeExecutor());
    for (let i = 1; i <= 5; i++) await exec.query(`SELECT ${i}`, []);
    expect(log.size).toBe(3);
    expect(log.list().map((q) => q.sql)).toEqual(['SELECT 5', 'SELECT 4', 'SELECT 3']);
    log.clear();
    expect(log.list()).toEqual([]);
  });

  it('stores readable, bounded parameters', () => {
    expect(logParam(10n)).toBe('10');
    expect(logParam(new Date('2026-01-02T03:04:05Z'))).toBe('2026-01-02T03:04:05.000Z');
    expect(logParam(new Uint8Array(4))).toBe('<4 bytes>');
    expect(logParam(undefined)).toBeNull();
    expect(logParam({ a: 1n })).toBe('{"a":"1"}');
    const long = logParam('x'.repeat(MAX_PARAM_LENGTH + 50)) as string;
    expect(long.startsWith('x'.repeat(MAX_PARAM_LENGTH))).toBe(true);
    expect(long).toContain(`(${MAX_PARAM_LENGTH + 50} chars)`);
    const log = new QueryLog();
    const entry = log.record('SELECT ?', Array.from({ length: MAX_PARAMS + 5 }, (_, i) => i), 1);
    expect(entry.params).toHaveLength(MAX_PARAMS + 1);
    expect(entry.params.at(-1)).toBe('... 5 more');
  });
});

describe('studio API query log on SQLite', () => {
  let state: StudioState;
  beforeAll(async () => {
    state = await setup();
  });

  it('starts empty and says the database speaks SQL', async () => {
    const r = await call(state, 'GET', '/api/queries');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ sql: true, enabled: true, limit: 200, queries: [] });
  });

  it('logs the SQL of each action and returns the SQL of a page with its rows', async () => {
    const created = await call(state, 'POST', '/api/tables/users/rows', { data: { email: 'ada@example.com', name: 'Ada' } });
    expect(created.status).toBe(201);
    const page = await call(state, 'GET', '/api/tables/users/rows', undefined, 'page=1&pageSize=10');
    const body = page.body as { rows: unknown[]; total: number; queries: QueryEntry[] };
    expect(body.total).toBe(1);
    expect(body.queries).toHaveLength(2);
    expect(body.queries.every((q) => q.action === 'Browse users')).toBe(true);
    expect(body.queries.some((q) => /^SELECT .*FROM "users"/s.test(q.sql) && /LIMIT/i.test(q.sql))).toBe(true);
    expect(body.queries.some((q) => /COUNT\(\*\)/i.test(q.sql))).toBe(true);

    const log = (await call(state, 'GET', '/api/queries')).body as { queries: QueryEntry[] };
    expect(log.queries.slice(0, 2).every((q) => q.action === 'Browse users')).toBe(true);
    const insert = log.queries.find((q) => q.action === 'Add a row to users')!;
    expect(insert.sql).toMatch(/^INSERT INTO "users"/);
    expect(insert.params).toContain('ada@example.com');
    expect(insert.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('logs failed statements with the database error', async () => {
    const dup = await call(state, 'POST', '/api/tables/users/rows', { data: { email: 'ada@example.com' } });
    expect(dup.status).toBeGreaterThanOrEqual(400);
    const newest = ((await call(state, 'GET', '/api/queries')).body as { queries: QueryEntry[] }).queries[0]!;
    expect(newest.action).toBe('Add a row to users');
    expect(newest.error).toMatch(/UNIQUE/i);
  });

  it('labels edits, deletes and schema reloads', async () => {
    await call(state, 'PATCH', '/api/tables/users/rows', { key: { id: 1 }, data: { name: 'Ada L.' } });
    await call(state, 'DELETE', '/api/tables/users/rows', { keys: [{ id: 1 }] });
    await call(state, 'POST', '/api/refresh');
    const actions = new Set(((await call(state, 'GET', '/api/queries')).body as { queries: QueryEntry[] }).queries.map((q) => q.action));
    expect(actions).toContain('Edit a row in users');
    expect(actions).toContain('Delete rows from users');
    expect(actions).toContain('Reload schema');
  });

  it('lists only newer entries with after and clears the log', async () => {
    const all = ((await call(state, 'GET', '/api/queries')).body as { queries: QueryEntry[] }).queries;
    const newest = all[0]!.id;
    expect(((await call(state, 'GET', '/api/queries', undefined, `after=${newest}`)).body as { queries: QueryEntry[] }).queries).toEqual([]);
    await call(state, 'GET', '/api/tables/users/rows');
    const after = ((await call(state, 'GET', '/api/queries', undefined, `after=${newest}`)).body as { queries: QueryEntry[] }).queries;
    expect(after.length).toBe(2);
    expect((await call(state, 'DELETE', '/api/queries')).body).toEqual({ cleared: true });
    expect(((await call(state, 'GET', '/api/queries')).body as { queries: QueryEntry[] }).queries).toEqual([]);
    expect((await call(state, 'PUT', '/api/queries')).status).toBe(405);
  });

  it('works without a log and says when there is no SQL', async () => {
    const plain: StudioState = { ...state, queries: undefined };
    const rows = await call(plain, 'GET', '/api/tables/users/rows');
    expect((rows.body as { queries: unknown[] }).queries).toEqual([]);
    expect((await call(plain, 'GET', '/api/queries')).body).toMatchObject({ enabled: false, queries: [] });
    const mongoLike: StudioState = { ...state, adapter: { ...state.adapter, dialect: { ...state.adapter.dialect, name: 'mongodb' } } as Adapter };
    expect((await call(mongoLike, 'GET', '/api/queries')).body).toMatchObject({ sql: false });
  });
});

function http(server: StudioServer, method: string, path: string, headers: Record<string, string> = {}): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: server.port, method, path, headers }, (res) => {
      let text = '';
      res.on('data', (c: Buffer) => (text += c.toString()));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('studio server query log', () => {
  let server: StudioServer;
  beforeAll(async () => {
    const adapter = sqlite(new Database(':memory:'));
    await push(adapter, toSchemaIR({ users }), {});
    server = await startStudio({ adapter, port: 0, token: 'tok', version: '0.1.0' });
  });
  afterAll(() => server.close());

  it('keeps the log behind the session token', async () => {
    expect((await http(server, 'GET', '/api/queries')).status).toBe(401);
    await http(server, 'GET', '/api/tables/users/rows', { 'X-Kastor-Token': 'tok' });
    const r = await http(server, 'GET', '/api/queries', { 'X-Kastor-Token': 'tok' });
    expect(r.status).toBe(200);
    const body = JSON.parse(r.text) as { queries: QueryEntry[] };
    expect(body.queries.length).toBe(2);
    expect(body.queries[0]!.action).toBe('Browse users');
  });

  it('can run with the log turned off', async () => {
    const adapter = sqlite(new Database(':memory:'));
    const off = await startStudio({ adapter, port: 0, token: 'tok', queryLog: 0 });
    expect(off.state.queries).toBeUndefined();
    await off.close();
  });

  it('links the query log from the page', () => {
    const html = renderPage({ version: '1.0.0' });
    expect(html).toContain('href="#/queries"');
    expect(html).toContain('id="queries-link"');
    expect(html).toContain('prefers-reduced-motion');
  });
});
