import Database from 'better-sqlite3';
import { request } from 'node:http';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderPage } from '../src/studio/page';
import { findSeasonsDir, NO_SEASONS_SCRIPT, SEASON_ART, SEASON_IDS, seasonFiles } from '../src/studio/seasons';
import { startStudio, type StudioServer } from '../src/studio/server';
import { sqlite } from '../src/sqlite';

const assets = resolve('assets/seasons');

function get(server: StudioServer, path: string): Promise<{ status: number; type: string; text: string }> {
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port: server.port, path }, (res) => {
      let text = '';
      res.on('data', (c: Buffer) => (text += c.toString()));
      res.on('end', () => done({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? ''), text }));
    });
    req.on('error', fail);
    req.end();
  });
}

/** Runs seasons.js the way a browser would, with a fake page. */
function runSeasons(script: string, search: string): { active: string | null; season: string | null; attr: string | null } {
  let attr: string | null = null;
  const win: Record<string, unknown> = {
    document: { documentElement: { setAttribute: (_: string, v: string) => (attr = v), removeAttribute: () => (attr = null) } },
    location: { search },
    navigator: { language: 'en-US' },
    localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  };
  new Function('window', script)(win);
  const api = win.KastorSeasons as { active: string | null; season: string | null };
  return { active: api.active, season: api.season, attr };
}

describe('studio seasons', () => {
  it('finds the shipped seasons folder', () => {
    expect(findSeasonsDir()).toBe(assets);
  });

  it('serves only known art files', () => {
    const files = seasonFiles(assets);
    expect(files.script).toContain('KastorSeasons');
    for (const id of SEASON_IDS) for (const art of SEASON_ART) expect(files.art(`/seasons/${id}/${art}.svg`), `${id}/${art}`).toMatch(/^<svg[\s>]/);
    for (const bad of ['/seasons/halloween/icons/light/bat.svg', '/seasons/../package.json', '/seasons/summer/mascot.svg', '/seasons/halloween/accent.svg', '/seasons/halloween/mascot.png', '/seasons/halloween/..%2fmascot.svg']) {
      expect(files.art(bad), bad).toBeNull();
    }
    const none = seasonFiles(null);
    expect(none.script).toBe(NO_SEASONS_SCRIPT);
    expect(none.art('/seasons/halloween/mascot.svg')).toBeNull();
  });

  it('runs the shared script with a forced season and the off switch', () => {
    const { script } = seasonFiles(assets);
    expect(runSeasons(script, '?token=abc&season=halloween')).toEqual({ active: 'halloween', season: 'halloween', attr: 'halloween' });
    expect(runSeasons(script, '?season=off').active).toBeNull();
  });

  it('loads the script before the app and leaves room for the switch', () => {
    const html = renderPage({ version: '1.0.0' });
    expect(html.indexOf('<script src="/seasons.js">')).toBeGreaterThan(-1);
    expect(html.indexOf('<script src="/seasons.js">')).toBeLessThan(html.indexOf('/app.js'));
    expect(html).toContain('id="season-slot"');
    expect(html).toContain('[data-season="halloween"]');
    expect(html).toMatch(/prefers-reduced-motion: reduce\) \{[^}]*\.season-mascot \{ animation: none/);
  });
});

describe('studio server seasons', () => {
  let on: StudioServer;
  let off: StudioServer;
  beforeAll(async () => {
    on = await startStudio({ adapter: sqlite(new Database(':memory:')), port: 0, token: 't' });
    off = await startStudio({ adapter: sqlite(new Database(':memory:')), port: 0, token: 't', seasons: false });
  });
  afterAll(async () => {
    await on.close();
    await off.close();
  });

  it('serves the script and the art without the session token', async () => {
    const script = await get(on, '/seasons.js');
    expect(script.status).toBe(200);
    expect(script.type).toContain('javascript');
    expect(script.text).toContain('KastorSeasons');
    const art = await get(on, '/seasons/christmas/head-dark.svg');
    expect(art.status).toBe(200);
    expect(art.type).toBe('image/svg+xml');
    expect((await get(on, '/seasons/christmas/nope.svg')).status).toBe(404);
    expect((await get(on, `/seasons/${encodeURIComponent('../../package.json')}`)).status).toBe(404);
  });

  it('can be turned off', async () => {
    expect((await get(off, '/seasons.js')).text).toBe(NO_SEASONS_SCRIPT);
    expect((await get(off, '/seasons/christmas/head.svg')).status).toBe(404);
  });

  it('keeps every season id in step with the shared script', () => {
    const { script } = seasonFiles(join(assets));
    for (const id of SEASON_IDS) expect(script).toContain(`'${id}'`);
  });
});
