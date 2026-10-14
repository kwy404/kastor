// Renders the PNG images (social preview, Open Graph images) with a headless
// Edge or Chrome. Templates are plain HTML pages built from the same art as
// the site. Run with: node scripts/build-site.mjs --images
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { litMark, logo } from './art/brand.mjs';
import { DATABASES, dbSymbol } from './art/icons.mjs';
import { illustration } from './art/illustrations.mjs';

const BROWSERS = [
  process.env.KASTOR_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=block">';

function base(w, h, body, extra = '') {
  return `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>
*{box-sizing:border-box}html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden}
body{background:#0a0a0a;color:#ededed;font-family:Geist,'Segoe UI',sans-serif;position:relative;-webkit-font-smoothing:antialiased;
  --lm-hi:#6b6b6b;--lm-mid:#262626;--lm-lo:#0c0c0c;--lm-side:#1a1a1a;--lm-grain:#fff;--lm-grainOp:.06;--lm-rim:#ffc27a;--lm-rimOp:.7;--lm-edge:#000;--lm-edgeOp:.5;--lm-halo:.6;
  --il-card:#111;--il-line:#2b2b2b;--il-dim:#4d4d4d;--il-ink:#ededed}
.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.06) 1px,transparent 1px);background-size:56px 56px;background-position:-1px -1px;-webkit-mask-image:radial-gradient(ellipse 70% 80% at 30% 50%,#000 20%,transparent 75%)}
.glow{position:absolute;border-radius:50%;background:radial-gradient(closest-side,rgba(240,138,60,.38),rgba(240,138,60,0));filter:blur(10px)}
.mono{font-family:'Geist Mono',Consolas,monospace}
.brand{display:flex;align-items:center;gap:12px;font:700 30px Geist,sans-serif;letter-spacing:-.04em;color:#ededed}
.brand svg{width:34px;height:34px;color:#ededed}
.chip{display:inline-flex;align-items:center;gap:8px;height:38px;padding:0 15px 0 11px;border:1px solid #262626;border-radius:99px;background:#111;font:500 16px Geist,sans-serif;color:#a1a1a1}
.chip svg{width:20px;height:20px}
.acc{background:linear-gradient(90deg,#ffb547,#d4622b);-webkit-background-clip:text;background-clip:text;color:transparent}
.rule{position:absolute;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.12),transparent)}
${extra}
</style></head><body><div class="grid"></div>${body}</body></html>`;
}

function chips(list) {
  return list.map((d) => `<span class="chip"><svg viewBox="0 0 24 24">${dbSymbol(d, '#a1a1a1')}</svg>${esc(d.name)}</span>`).join('');
}

/** The large brand card used for the GitHub social preview and docs/og.png. */
export function brandCard(w, h) {
  const k = h / 630;
  const shown = DATABASES.filter((d) => ['postgres', 'mysql', 'sqlite', 'mssql', 'oracle', 'mongodb'].includes(d.id));
  return base(
    w,
    h,
    `<div class="glow" style="left:${-40 * k}px;top:${40 * k}px;width:${640 * k}px;height:${560 * k}px"></div>
<div style="position:absolute;left:${10 * k}px;top:${92 * k}px;width:${560 * k}px;height:${448 * k}px">${litMark({ vars: true, id: 'og-k' }).replace('width="600" height="480"', 'width="100%" height="100%"')}</div>
<div style="position:absolute;left:${560 * k}px;top:${92 * k}px;right:${56 * k}px">
  <div class="brand">${logo({ size: 34, id: 'og-logo' })}kastor<span class="mono" style="font-size:15px;font-weight:500;color:#737373;letter-spacing:0;margin-left:6px;border:1px solid #262626;border-radius:99px;padding:3px 10px">0.1.0</span></div>
  <div style="font-size:${62 * k}px;font-weight:700;line-height:1.02;letter-spacing:-.045em;margin-top:${34 * k}px">The TypeScript ORM for <span class="acc">every database</span>.</div>
  <div style="font-size:${23 * k}px;color:#a1a1a1;margin-top:${22 * k}px;line-height:1.45;letter-spacing:-.01em;max-width:${560 * k}px">Schema in plain TypeScript, types as you type. No generate step. Nested includes in one query.</div>
  <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:${30 * k}px;max-width:${600 * k}px">${chips(shown)}<span class="chip" style="padding-left:15px">+4 more</span></div>
</div>
<div class="mono" style="position:absolute;left:${560 * k}px;bottom:${40 * k}px;font-size:15px;color:#737373">kwy404.github.io/kastor</div>`,
  );
}

const SECTION = { migrate: ['MIGRATE', 'migrate'], frameworks: ['FRAMEWORKS', 'frameworks'] };

/** One Open Graph image per guide. */
export function guideCard(meta, w = 1200, h = 630) {
  const pt = meta.lang === 'pt-BR';
  const [label, kind] = SECTION[meta.section] || [pt ? 'GUIA' : 'GUIDE', 'guide'];
  const len = meta.h1.length;
  const size = len > 70 ? 46 : len > 50 ? 54 : 62;
  return base(
    w,
    h,
    `<div class="glow" style="right:-60px;top:110px;width:620px;height:460px"></div>
<div style="position:absolute;left:68px;top:60px" class="brand">${logo({ size: 34, id: 'og-logo' })}kastor</div>
<div style="position:absolute;left:68px;top:168px;width:560px">
  <div class="mono" style="font-size:16px;letter-spacing:.14em;color:#a1a1a1"><span class="acc" style="font-weight:600">${label}</span>&nbsp;&nbsp;/&nbsp;&nbsp;${esc(meta.crumb.toUpperCase())}</div>
  <div style="font-size:${size}px;font-weight:700;line-height:1.04;margin-top:24px;letter-spacing:-.045em">${esc(meta.h1)}</div>
</div>
<div style="position:absolute;right:56px;top:150px;width:470px;height:294px;border-radius:18px;border:1px solid #222;background:#0d0d0d;overflow:hidden;box-shadow:0 30px 80px -30px rgba(0,0,0,.8)">${illustration(kind, { id: 'og-il' }).replace('width="320" height="200"', 'width="100%" height="100%"')}</div>
<div class="rule" style="bottom:96px"></div>
<div class="mono" style="position:absolute;left:68px;bottom:42px;font-size:16px;color:#737373;display:flex;gap:28px"><span>kwy404.github.io/kastor</span><span>${esc(meta.readTime)}</span></div>`,
  );
}

function findBrowser() {
  return BROWSERS.find((b) => existsSync(b));
}

function shoot(browser, profile, html, png, w, h) {
  return new Promise((resolve) => {
    if (existsSync(png)) rmSync(png);
    const child = spawn(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', `--user-data-dir=${profile}`, '--virtual-time-budget=6000', `--window-size=${w},${h}`, `--screenshot=${png}`, pathToFileURL(html).href], { stdio: 'ignore' });
    const started = Date.now();
    const timer = setInterval(() => {
      const done = existsSync(png) && statSync(png).size > 0;
      if (done || Date.now() - started > 45000) {
        clearInterval(timer);
        setTimeout(() => {
          try {
            child.kill();
          } catch {
            // already gone
          }
          resolve(done);
        }, 400);
      }
    }, 250);
  });
}

/** Renders the social preview, docs/og.png and one card per guide. */
export async function renderImages(root, guides) {
  const browser = findBrowser();
  if (!browser) throw new Error('No Edge or Chrome found: set KASTOR_BROWSER to a Chromium based browser');
  const work = mkdtempSync(join(tmpdir(), 'kastor-img-'));
  const profile = join(work, 'profile');
  mkdirSync(join(root, 'docs', 'og'), { recursive: true });
  const jobs = [
    ['social-preview', brandCard(1280, 640), join(root, 'assets', 'social-preview.png'), 1280, 640],
    ['og', brandCard(1200, 630), join(root, 'docs', 'og.png'), 1200, 630],
    ...guides.map((g) => [`og-${g.meta.lang}-${g.meta.slug}`, guideCard(g.meta), join(root, 'docs', 'og', `${g.meta.lang === 'pt-BR' ? 'pt-br-' : ''}${g.meta.slug}.png`), 1200, 630]),
  ];
  const results = [];
  for (const [name, html, png, w, h] of jobs) {
    const file = join(work, `${name}.html`);
    writeFileSync(file, html);
    const ok = await shoot(browser, join(profile, name), file, png, w, h);
    results.push([png, ok]);
    console.log(`${ok ? 'rendered' : 'FAILED  '} ${relative(root, png)}`);
  }
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    // the browser may still hold the profile for a moment
  }
  return results;
}
