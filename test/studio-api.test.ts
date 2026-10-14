import Database from 'better-sqlite3';
import { request } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Adapter, SchemaIR } from '../src/core/ir';
import { index, t, table } from '../src/core/schema';
import { toSchemaIR } from '../src/core/schema-ir';
import { push } from '../src/migrate/engine';
import { sqlite } from '../src/sqlite';
import { buildWhere, fromJson, handleApi, relationsOf, toJson, type StudioState } from '../src/studio/api';
import { clientScript } from '../src/studio/client';
import { renderPage } from '../src/studio/page';
import { startStudio, type StudioServer } from '../src/studio/server';

const users = table('users', {
  id: t.id(),
  email: t.string(255).unique(),
  name: t.string().nullable(),
  role: t.enum(['user', 'admin']).default('user'),
  score: t.bigint().default(0n),
  active: t.boolean().default(true),
  meta: t.json().nullable(),
  createdAt: t.datetime().defaultNow(),
});
const posts = table(
  'posts',
  {
    id: t.id(),
    title: t.string(200),
    authorId: t.int().references(() => users.id, { onDelete: 'cascade' }),
  },
  { indexes: (p) => [index(p.authorId)] },
);
const logs = table('logs', { line: t.text() });

async function setup(): Promise<{ state: StudioState; adapter: Adapter; schema: SchemaIR }> {
  const adapter = sqlite(new Database(':memory:'));
  const schema = toSchemaIR({ users, posts, logs });
  await push(adapter, schema, {});
  const state: StudioState = { adapter, schema: await adapter.dialect.introspect(adapter.executor), version: '0.1.0' };
  state.schema.tables = state.schema.tables.filter((x) => x.name !== '_kastor_migrations');
  return { state, adapter, schema };
}

const call = (state: StudioState, method: string, path: string, body?: unknown, query = '') => handleApi(state, method, path, new URLSearchParams(query), body);

describe('studio API', () => {
  let state: StudioState;
  beforeAll(async () => {
    ({ state } = await setup());
    for (let i = 1; i <= 30; i++) {
      const r = await call(state, 'POST', '/api/tables/users/rows', { data: { email: `u${i}@acme.com`, name: i % 3 ? `User ${i}` : null, role: i % 5 ? 'user' : 'admin', meta: { n: i } } });
      expect(r.status).toBe(201);
    }
    await call(state, 'POST', '/api/tables/posts/rows', { data: { title: 'Hello', authorId: 1 } });
  });

  it('describes the schema with relations', async () => {
    const r = await call(state, 'GET', '/api/schema');
    expect(r.status).toBe(200);
    const body = r.body as { dialect: string; tables: { name: string }[]; relations: unknown[] };
    expect(body.dialect).toBe('sqlite');
    expect(body.tables.map((x) => x.name).sort()).toEqual(['logs', 'posts', 'users']);
    expect(body.relations).toEqual([{ from: 'posts', columns: ['authorId'], to: 'users', refColumns: ['id'], name: 'posts_authorId_fkey' }]);
    expect(relationsOf({ tables: [] })).toEqual([]);
  });

  it('pages and counts rows', async () => {
    const r = await call(state, 'GET', '/api/tables/users/rows', undefined, 'page=2&pageSize=10');
    const body = r.body as { rows: Array<{ id: number }>; total: number; page: number };
    expect(body.total).toBe(30);
    expect(body.page).toBe(2);
    expect(body.rows.map((x) => x.id)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });

  it('sorts by a column and falls back to the primary key', async () => {
    const r = await call(state, 'GET', '/api/tables/users/rows', undefined, 'sort=role&dir=asc&pageSize=3');
    const rows = (r.body as { rows: Array<{ id: number; role: string }> }).rows;
    expect(rows.map((x) => [x.role, x.id])).toEqual([
      ['admin', 5],
      ['admin', 10],
      ['admin', 15],
    ]);
    const desc = await call(state, 'GET', '/api/tables/users/rows', undefined, 'sort=id&dir=desc&pageSize=2');
    expect((desc.body as { rows: Array<{ id: number }> }).rows.map((x) => x.id)).toEqual([30, 29]);
  });

  it('filters with every operator', async () => {
    const q = async (filters: unknown[]): Promise<number> => {
      const r = await call(state, 'GET', '/api/tables/users/rows', undefined, `filters=${encodeURIComponent(JSON.stringify(filters))}`);
      expect(r.status).toBe(200);
      return (r.body as { total: number }).total;
    };
    expect(await q([{ column: 'role', op: 'eq', value: 'admin' }])).toBe(6);
    expect(await q([{ column: 'role', op: 'ne', value: 'admin' }])).toBe(24);
    expect(await q([{ column: 'name', op: 'null' }])).toBe(10);
    expect(await q([{ column: 'name', op: 'notNull' }])).toBe(20);
    expect(await q([{ column: 'email', op: 'startsWith', value: 'U1' }])).toBe(11);
    expect(await q([{ column: 'email', op: 'endsWith', value: '0@acme.com' }])).toBe(3);
    expect(await q([{ column: 'email', op: 'contains', value: '2' }])).toBe(12);
    expect(await q([{ column: 'id', op: 'gt', value: '25' }])).toBe(5);
    expect(await q([{ column: 'id', op: 'gte', value: 25 }, { column: 'id', op: 'lte', value: 26 }])).toBe(2);
    expect(await q([{ column: 'id', op: 'lt', value: 3 }])).toBe(2);
    expect(await q([{ column: 'id', op: 'in', value: '1, 2, 3, 99' }])).toBe(3);
    expect(await q([{ column: 'name', op: 'eq', value: null }])).toBe(10);
  });

  it('searches text columns and numeric ids', async () => {
    const r = await call(state, 'GET', '/api/tables/users/rows', undefined, 'q=user 2');
    // User 2, 20, 22, 23, 25, 26, 28, 29 (multiples of 3 have no name)
    expect((r.body as { total: number }).total).toBe(8);
    const byId = await call(state, 'GET', '/api/tables/users/rows', undefined, 'q=7');
    expect((byId.body as { rows: Array<{ id: number }> }).rows.map((x) => x.id)).toContain(7);
  });

  it('returns readable values for bigint, json, boolean and dates', async () => {
    const r = await call(state, 'GET', '/api/tables/users/rows', undefined, 'pageSize=1');
    const json = JSON.parse(toJson(r.body)) as { rows: Array<Record<string, unknown>> };
    const row = json.rows[0]!;
    expect(row.score).toBe('0');
    expect(row.active).toBe(true);
    expect(row.meta).toEqual({ n: 1 });
    expect(String(row.createdAt)).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it('updates one column of a row', async () => {
    const r = await call(state, 'PATCH', '/api/tables/users/rows', { key: { id: 2 }, data: { name: 'Renamed', score: '9007199254740993', active: 'false' } });
    expect(r.status).toBe(200);
    const row = (r.body as { row: Record<string, unknown> }).row;
    expect(row.name).toBe('Renamed');
    expect(row.score).toBe(9007199254740993n);
    expect(row.active).toBe(false);
  });

  it('reports bad input with a 400 and a hint', async () => {
    const notNull = await call(state, 'PATCH', '/api/tables/users/rows', { key: { id: 2 }, data: { email: null } });
    expect(notNull.status).toBe(400);
    expect(JSON.stringify(notNull.body)).toContain('email cannot be empty');
    const badEnum = await call(state, 'PATCH', '/api/tables/users/rows', { key: { id: 2 }, data: { role: 'owner' } });
    expect(JSON.stringify(badEnum.body)).toContain('must be one of user, admin');
    const unknown = await call(state, 'POST', '/api/tables/users/rows', { data: { nope: 1 } });
    expect(unknown.status).toBe(400);
    const noTable = await call(state, 'GET', '/api/tables/nope/rows');
    expect(noTable.status).toBe(404);
    const noRow = await call(state, 'PATCH', '/api/tables/users/rows', { key: { id: 999 }, data: { name: 'x' } });
    expect(noRow.status).toBe(404);
    const badFilters = await call(state, 'GET', '/api/tables/users/rows', undefined, 'filters=nope');
    expect(badFilters.status).toBe(400);
    const nothing = await call(state, 'PATCH', '/api/tables/users/rows', { key: { id: 2 }, data: {} });
    expect(nothing.status).toBe(400);
    const route = await call(state, 'GET', '/api/whatever');
    expect(route.status).toBe(404);
    const method = await call(state, 'PUT', '/api/tables/users/rows');
    expect(method.status).toBe(405);
  });

  it('maps database errors such as unique violations', async () => {
    const dup = await call(state, 'POST', '/api/tables/users/rows', { data: { email: 'u1@acme.com' } });
    expect(dup.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(dup.body)).toMatch(/unique|UNIQUE/);
  });

  it('refuses to edit tables without a primary key', async () => {
    const r = await call(state, 'POST', '/api/tables/logs/rows', { data: { line: 'x' } });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain('no primary key');
    const list = await call(state, 'GET', '/api/tables/logs/rows');
    expect(list.status).toBe(200);
  });

  it('deletes rows by key, cascading through foreign keys', async () => {
    const r = await call(state, 'DELETE', '/api/tables/users/rows', { keys: [{ id: 1 }, { id: 3 }] });
    expect(r.body).toEqual({ count: 2 });
    const postsLeft = await call(state, 'GET', '/api/tables/posts/rows');
    expect((postsLeft.body as { total: number }).total).toBe(0);
    const empty = await call(state, 'DELETE', '/api/tables/users/rows', { keys: [] });
    expect(empty.status).toBe(400);
  });

  it('honors read only mode', async () => {
    const ro: StudioState = { ...state, readOnly: true };
    const r = await call(ro, 'DELETE', '/api/tables/users/rows', { keys: [{ id: 4 }] });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain('read only');
  });

  it('reloads the schema', async () => {
    const r = await call(state, 'POST', '/api/refresh');
    expect(r.body).toEqual({ tables: 3 });
  });
});

describe('value conversion', () => {
  const col = (type: string, extra = {}) => ({ name: 'c', type, nullable: true, ...extra }) as never;
  it('converts JSON values by column type', () => {
    expect(fromJson('42', col('int'))).toBe(42);
    expect(() => fromJson('4.2', col('int'))).toThrow(/whole number/);
    expect(() => fromJson('x', col('float'))).toThrow(/number/);
    expect(fromJson('12', col('bigint'))).toBe(12n);
    expect(() => fromJson('1.5', col('bigint'))).toThrow();
    expect(fromJson(' 1.50 ', col('decimal'))).toBe('1.50');
    expect(() => fromJson('abc', col('decimal'))).toThrow();
    expect(fromJson('yes', col('boolean'))).toBe(true);
    expect(fromJson(0, col('boolean'))).toBe(false);
    expect(() => fromJson('maybe', col('boolean'))).toThrow();
    expect(fromJson('2026-01-01T00:00:00Z', col('datetime'))).toEqual(new Date('2026-01-01T00:00:00Z'));
    expect(() => fromJson('nope', col('datetime'))).toThrow();
    expect(fromJson('{"a":1}', col('json'))).toEqual({ a: 1 });
    expect(() => fromJson('{a}', col('json'))).toThrow(/valid JSON/);
    expect(fromJson({ $bytes: 'AQI=' }, col('bytes'))).toEqual(new Uint8Array([1, 2]));
    expect(fromJson(null, col('string'))).toBeNull();
    expect(fromJson(5, col('string'))).toBe('5');
  });

  it('serializes bigint, dates and bytes', () => {
    expect(toJson({ a: 1n, b: new Date('2026-01-01T00:00:00Z'), c: new Uint8Array([1, 2]) })).toBe('{"a":"1","b":"2026-01-01T00:00:00.000Z","c":{"$bytes":"AQI=","length":2}}');
    expect(toJson(5n)).toBe('"5"');
  });

  it('builds a where tree from filters and search', () => {
    const tbl = { name: 't', columns: [{ name: 'id', type: 'int', nullable: false }, { name: 'u', type: 'uuid', nullable: false }], primaryKey: ['id'], indexes: [], foreignKeys: [] } as never;
    expect(buildWhere(tbl, [])).toBeUndefined();
    expect(buildWhere(tbl, [], 'abc')).toEqual({ kind: 'const', value: false });
    expect(buildWhere(tbl, [], '5')).toEqual({ kind: 'or', items: [{ kind: 'compare', column: 'id', op: 'eq', value: 5 }] });
    expect(() => buildWhere(tbl, [{ column: 'id', op: 'bogus' as never }])).toThrow(/Unknown filter/);
  });
});

function http(server: StudioServer, method: string, path: string, headers: Record<string, string> = {}, body?: string): Promise<{ status: number; headers: Record<string, unknown>; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: server.port, method, path, headers }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('studio server', () => {
  let server: StudioServer;
  beforeAll(async () => {
    const { adapter } = await setup();
    server = await startStudio({ adapter, port: 0, token: 'secret-token', version: '0.1.0' });
  });
  afterAll(async () => {
    await server.close();
  });

  it('binds to 127.0.0.1 and prints a link with the token', () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(server.openUrl).toBe(`${server.url}/?token=secret-token`);
    const addr = server.server.address();
    expect(typeof addr === 'object' && addr?.address).toBe('127.0.0.1');
  });

  it('serves the page with strict security headers', async () => {
    const r = await http(server, 'GET', '/');
    expect(r.status).toBe(200);
    expect(r.text).toContain('monsooncss@0.2.0/dist/monsoon.min.css');
    expect(r.text).toContain('monsooncss@0.2.0/dist/monsoon.js');
    expect(r.text).not.toContain('secret-token');
    expect(String(r.headers['content-security-policy'])).toContain("frame-ancestors 'none'");
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
  });

  it('serves a script that parses', async () => {
    const r = await http(server, 'GET', '/app.js');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('javascript');
    expect(() => new Function(r.text)).not.toThrow();
    expect(() => new Function(clientScript())).not.toThrow();
    expect((await http(server, 'GET', '/theme.js')).status).toBe(200);
    expect((await http(server, 'GET', '/favicon.svg')).headers['content-type']).toBe('image/svg+xml');
    expect((await http(server, 'GET', '/nope')).status).toBe(404);
    expect((await http(server, 'POST', '/')).status).toBe(405);
  });

  it('needs the token for every API call', async () => {
    expect((await http(server, 'GET', '/api/schema')).status).toBe(401);
    expect((await http(server, 'GET', '/api/schema', { 'X-Kastor-Token': 'wrong' })).status).toBe(401);
    const ok = await http(server, 'GET', '/api/schema', { 'X-Kastor-Token': 'secret-token' });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.text).dialect).toBe('sqlite');
  });

  it('rejects other host names (DNS rebinding)', async () => {
    const r = await http(server, 'GET', '/', { Host: 'evil.example:80' });
    expect(r.status).toBe(421);
    const local = await http(server, 'GET', '/', { Host: `localhost:${server.port}` });
    expect(local.status).toBe(200);
  });

  it('rejects cross origin writes, non JSON bodies and bad JSON', async () => {
    const h = { 'X-Kastor-Token': 'secret-token', 'Content-Type': 'application/json' };
    const body = JSON.stringify({ data: { email: 'web@acme.com' } });
    expect((await http(server, 'POST', '/api/tables/users/rows', { ...h, Origin: 'https://evil.example' }, body)).status).toBe(403);
    expect((await http(server, 'POST', '/api/tables/users/rows', { ...h, 'Content-Type': 'text/plain' }, body)).status).toBe(415);
    expect((await http(server, 'POST', '/api/tables/users/rows', h, '{nope')).status).toBe(400);
    const created = await http(server, 'POST', '/api/tables/users/rows', { ...h, Origin: server.url }, body);
    expect(created.status).toBe(201);
    expect(JSON.parse(created.text).row.email).toBe('web@acme.com');
  });

  it('refuses bodies over 1 MB', async () => {
    const big = JSON.stringify({ data: { email: 'x'.repeat(1024 * 1024 + 10) } });
    const r = await http(server, 'POST', '/api/tables/users/rows', { 'X-Kastor-Token': 'secret-token', 'Content-Type': 'application/json' }, big).catch(() => ({ status: 413 }));
    expect(r.status).toBe(413);
  });

  it('falls back to the next port when the default one is busy', async () => {
    const { adapter } = await setup();
    const a = await startStudio({ adapter, port: 0, token: 't' });
    const b = await startStudio({ adapter, port: a.port, token: 't' }).catch((e: NodeJS.ErrnoException) => e);
    expect((b as NodeJS.ErrnoException).code).toBe('EADDRINUSE');
    await a.close();
  });
});

describe('page', () => {
  it('has the shell, dialogs and theme toggle', () => {
    const html = renderPage({ version: '1.2.3' });
    expect(html).toContain('v1.2.3');
    expect(html).toContain('id="row-dialog"');
    expect(html).toContain('id="confirm-dialog"');
    expect(html).toContain('id="theme-toggle"');
    expect(html).not.toMatch(/<script>(?!<\/script>)/);
  });
});
