// Renders the PNG images (social preview, Open Graph images) with a headless
// Edge or Chrome. Templates are plain HTML pages built from the same art as
// the site. Run with: node scripts/build-site.mjs --images
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mascot, mascotHead } from './art/mascot.mjs';
import { dam, THEMES, wordmark } from './art/scene.mjs';
import { DATABASES, dbSymbol } from './art/icons.mjs';

const BROWSERS = [
  process.env.KASTOR_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;700&family=Space+Grotesk:wght@500;700&display=block">';

function base(w, h, body, extra = '') {
  const t = THEMES.dark;
  return `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>
*{box-sizing:border-box}html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden}
body{background:${t.bg};color:${t.ink};font-family:'Space Grotesk','Segoe UI',sans-serif;position:relative}
.grid{position:absolute;inset:0;background-image:linear-gradient(${t.grid2} 1.4px,transparent 1.4px),linear-gradient(90deg,${t.grid2} 1.4px,transparent 1.4px),linear-gradient(${t.grid} 1px,transparent 1px),linear-gradient(90deg,${t.grid} 1px,transparent 1px);background-size:100px 100px,100px 100px,20px 20px,20px 20px;background-position:-1px -1px}
.frame{position:absolute;inset:18px;border:2px solid rgba(207,224,255,.45)}
.frame:after{content:'';position:absolute;inset:6px;border:1px solid rgba(207,224,255,.2)}
.c{position:absolute;width:30px;height:30px;border-color:#8fb2ff;border-style:solid}
.c1{left:12px;top:12px;border-width:5px 0 0 5px}.c2{right:12px;top:12px;border-width:5px 5px 0 0}.c3{right:12px;bottom:12px;border-width:0 5px 5px 0}.c4{left:12px;bottom:12px;border-width:0 0 5px 5px}
.mono{font-family:'JetBrains Mono',Consolas,monospace}
.tb{position:absolute;right:18px;bottom:18px;display:grid;grid-template-columns:auto auto;border-left:2px solid rgba(207,224,255,.45);border-top:2px solid rgba(207,224,255,.45);font:500 13px 'JetBrains Mono',monospace;color:#a9bde6}
.tb span{padding:7px 14px;border-right:1px solid rgba(207,224,255,.25);border-bottom:1px solid rgba(207,224,255,.25)}
.tb b{color:#eef3ff;font-weight:700}
.chip{display:inline-flex;align-items:center;gap:8px;padding:6px 14px 6px 8px;border:1.5px solid #8fb2ff;border-radius:99px;background:#10295e;font:600 17px 'Space Grotesk',sans-serif;color:#eef3ff}
.chip svg{width:26px;height:26px}
${extra}
</style></head><body><div class="grid"></div><div class="frame"></div><i class="c c1"></i><i class="c c2"></i><i class="c c3"></i><i class="c c4"></i>${body}</body></html>`;
}

function chips(list) {
  return list
    .map((d) => `<span class="chip"><svg viewBox="0 0 48 48">${dbSymbol(d, '#0a1d45')}</svg>${esc(d.name)}</span>`)
    .join('');
}

/** The large brand card used for the GitHub social preview and docs/og.png. */
export function brandCard(w, h) {
  const t = THEMES.dark;
  const scale = h / 640;
  const shown = DATABASES.filter((d) => ['postgres', 'mysql', 'sqlite', 'mssql', 'oracle', 'mongodb'].includes(d.id));
  return base(
    w,
    h,
    `<div style="position:absolute;left:${56 * scale}px;top:${70 * scale}px;width:${420 * scale}px;height:${420 * scale}px">${mascot({ dark: true }).replace('width="512" height="512"', 'width="100%" height="100%"')}</div>
<div style="position:absolute;left:${500 * scale}px;top:${92 * scale}px;right:60px">
  <div class="mono" style="font-size:${17 * scale}px;color:#8fb2ff;letter-spacing:.12em;margin-bottom:${18 * scale}px">SHEET 01 &nbsp;/&nbsp; THE DATA LAYER</div>
  <svg viewBox="-16 -166 642 186" style="width:${470 * scale}px;display:block">${wordmark('#eef3ff', 26)}</svg>
  <div style="font-size:${40 * scale}px;font-weight:700;line-height:1.15;margin-top:${26 * scale}px;max-width:${700 * scale}px">The TypeScript ORM for almost every database</div>
  <div style="font-size:${21 * scale}px;color:#a9bde6;margin-top:${14 * scale}px;max-width:${660 * scale}px;line-height:1.4">Schema in plain TypeScript, types inferred as you type. No generate step. Nested includes in one query.</div>
  <div style="display:flex;flex-wrap:wrap;gap:${9 * scale}px;margin-top:${26 * scale}px;max-width:${580 * scale}px">${chips(shown)}<span class="chip" style="padding-left:14px">+4 more</span></div>
</div>
${w >= 1280 ? `<svg style="position:absolute;right:${30 * scale}px;bottom:${86 * scale}px;width:${210 * scale}px;height:${170 * scale}px" viewBox="0 0 210 170">${dam({ w: 210, h: 170, n: 5, t, dims: false })}</svg>` : ""}
<div class="tb"><span>PROJECT</span><span><b>kastor 0.1.0</b></span><span>DRAWN BY</span><span><b>kwy404</b></span></div>`,
  );
}

/** One Open Graph image per guide. */
export function guideCard(meta, w = 1200, h = 630) {
  const pt = meta.lang === 'pt-BR';
  const len = meta.h1.length;
  const size = len > 70 ? 54 : len > 50 ? 62 : 70;
  return base(
    w,
    h,
    `<div style="position:absolute;left:72px;top:70px;right:330px">
  <div class="mono" style="font-size:18px;color:#ffc21a;letter-spacing:.14em">${pt ? 'GUIA' : 'GUIDE'} &nbsp;/&nbsp; ${esc(meta.crumb.toUpperCase())}</div>
  <div style="font-size:${size}px;font-weight:700;line-height:1.08;margin-top:26px;letter-spacing:-.01em">${esc(meta.h1)}</div>
  <div style="height:3px;width:120px;background:#ffc21a;margin-top:30px"></div>
  <div style="font-size:24px;color:#a9bde6;margin-top:24px;display:flex;align-items:center;gap:14px"><svg viewBox="-16 -166 642 186" style="width:150px">${wordmark('#eef3ff', 30)}</svg><span class="mono" style="font-size:19px">kwy404.github.io/kastor</span></div>
</div>
<div style="position:absolute;right:56px;top:96px;width:290px;height:290px">${mascotHead({ dark: true }).replace('width="320" height="320"', 'width="100%" height="100%"')}</div>
<div class="tb"><span>SHEET</span><span><b>${esc(meta.slug)}</b></span><span>${pt ? 'LEITURA' : 'READ'}</span><span><b>${esc(meta.readTime)}</b></span></div>`,
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
