// Contrast audit for the built docs site. Serves docs/ under /kastor/, opens
// every page in a headless Chromium (Edge or Chrome) over the DevTools
// protocol, and measures the text and icon contrast of every button, tab,
// chip and card in light and dark, at rest and in the hover, focus,
// focus-visible and active states. No dependencies: it needs Node's global
// WebSocket (Node 22+) and a Chromium based browser.
//   node scripts/site/contrast.mjs        prints failures, exits 1 on any
/* global WebSocket */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MIN_RATIO = 4.5;

const BROWSERS = [
  process.env.KASTOR_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

export function findBrowser() {
  return BROWSERS.find((b) => existsSync(b)) || null;
}

/** Interactive elements whose colors are checked. */
export const SELECTOR = [
  'a.btn', 'button', '[role="button"]', '[role="tab"]', 'summary', '.chip-link', '.lang-switch', '.foot-chip',
  '.entry', '.hero-pill', '.fw-card', '.rt-card', '.lc-card', '.g-card', '.top-link', '.docs-nav a', '.toc-box a', '.crumbs a',
].join(', ');

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.xml': 'application/xml', '.wasm': 'application/wasm', '.txt': 'text/plain' };

function serve(docs) {
  const server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!p.startsWith('/kastor/')) {
      res.writeHead(404);
      return res.end();
    }
    let f = join(docs, p.slice(8));
    try {
      if (statSync(f).isDirectory()) f = join(f, 'index.html');
      const body = readFileSync(f);
      res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function htmlPages(docs, dir = docs, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) htmlPages(docs, p, out);
    else if (f.endsWith('.html')) out.push(relative(docs, p).replace(/\\/g, '/'));
  }
  return out.sort();
}

/** A minimal DevTools protocol client over the global WebSocket. */
class Cdp {
  constructor(url) {
    this.id = 0;
    this.pending = new Map();
    this.waiters = [];
    this.ws = new WebSocket(url);
    this.ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message}`));
        else resolve(msg.result);
      } else if (msg.method) {
        this.waiters = this.waiters.filter((w) => !(w.method === msg.method && w.sessionId === msg.sessionId && (w.resolve(msg.params), true)));
      }
    };
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  once(method, sessionId) {
    return new Promise((resolve) => this.waiters.push({ method, sessionId, resolve }));
  }
  close() {
    this.ws.close();
  }
}

function launch(browser) {
  const profile = mkdtempSync(join(tmpdir(), 'kastor-contrast-'));
  const child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('the browser did not start')), 30000);
    child.stderr.on('data', (d) => {
      buf += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    child.on('exit', () => reject(new Error('the browser exited')));
  });
  const stop = () => {
    try {
      child.kill();
    } catch {
      // already gone
    }
    setTimeout(() => {
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        // the browser may still hold the profile
      }
    }, 500);
  };
  return { endpoint, stop };
}

/** In-page helpers: color parsing through a canvas, compositing and the ratio. */
const PAGE_LIB = `(() => {
  if (window.__cx) return;
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const rgba = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = 'rgba(0,0,0,0)'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (top, base) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + base[i] * (1 - a)).concat(1); };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const gradColors = (img) => (img.match(/(rgba?\\([^)]*\\)|oklab\\([^)]*\\)|oklch\\([^)]*\\)|color\\([^)]*\\)|#[0-9a-f]{3,8})/gi) || []).map(rgba).filter((c) => c[3] > 0);
  /** Background candidates behind an element: solid layers composited, plus gradient stops. */
  const backs = (el) => {
    const layers = []; let grads = null;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (!grads && cs.backgroundImage && cs.backgroundImage.includes('gradient') && !/url\\(/.test(cs.backgroundImage) && cs.backgroundClip !== 'text') {
        const g = gradColors(cs.backgroundImage);
        if (g.length && n.getBoundingClientRect().width > 8) grads = g;
      }
      const c = rgba(cs.backgroundColor);
      if (c[3] > 0) { layers.push(c); if (c[3] >= 0.999) break; }
    }
    let base = [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return grads ? grads.map((g) => over(g, base)) : [base];
  };
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.opacity !== '0'; };
  const sig = (el) => { const parts = []; for (let n = el, i = 0; n && n.nodeType === 1 && i < 5; n = n.parentElement, i++) parts.push(n.tagName + '.' + [...n.classList].filter((c) => !/^(on|is-open|is-up)$/.test(c)).join('.') + (n.getAttribute('aria-selected') === 'true' || n.getAttribute('aria-pressed') === 'true' || n.hasAttribute('aria-current') ? '!' : '')); return parts.join('<'); };
  const label = (el) => (el.textContent || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().slice(0, 40);
  window.__cx = {
    mark(selector, seen) {
      const out = [];
      document.querySelectorAll(selector).forEach((el, i) => {
        if (el.disabled || el.closest('[hidden], dialog:not([open])') || !visible(el)) return;
        const s = sig(el);
        if (seen.includes(s)) return;
        seen.push(s); el.setAttribute('data-cx', String(i)); out.push({ i, sig: s, label: label(el) });
      });
      return out;
    },
    measure(i) {
      const el = document.querySelector('[data-cx="' + i + '"]');
      const sources = new Set();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) if (t.textContent.trim() && t.parentElement && visible(t.parentElement)) sources.add(t.parentElement);
      el.querySelectorAll('svg.ic, svg.bic, svg.dbic, svg.rtic').forEach((s) => { if (visible(s)) sources.add(s); });
      if (!sources.size) sources.add(el);
      let worst = null;
      for (const src of sources) {
        const cs = getComputedStyle(src);
        if (cs.backgroundClip === 'text' || cs.webkitBackgroundClip === 'text') continue;
        if (src.closest('.sr-only')) continue;
        const raw = rgba(src instanceof SVGElement ? cs.color : cs.color);
        if (raw[3] === 0) continue;
        for (const b of backs(src)) {
          const fg = over(raw, b); const r = ratio(fg, b);
          if (!worst || r < worst.ratio) worst = { ratio: Math.round(r * 100) / 100, fg: cs.color, bg: 'rgb(' + b.slice(0, 3).map(Math.round).join(',') + ')', text: (src.textContent || '').trim().slice(0, 30) || src.tagName };
        }
      }
      return worst;
    },
  };
})()`;

/**
 * Runs the audit. Returns { pages, checked, failures: [{ page, theme, state, label, ratio, fg, bg }] }.
 */
export async function auditContrast({ docs, browser = findBrowser(), pages, min = MIN_RATIO, log = () => {} } = {}) {
  if (!browser) throw new Error('no Chromium based browser found (set KASTOR_BROWSER)');
  if (typeof WebSocket === 'undefined') throw new Error('this Node has no global WebSocket (Node 22+)');
  const server = await serve(docs);
  const base = `http://127.0.0.1:${server.address().port}/kastor/`;
  const { endpoint, stop } = launch(browser);
  const cdp = new Cdp(await endpoint);
  await cdp.ready;
  const failures = [];
  let checked = 0;
  const list = pages || htmlPages(docs);
  try {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId: s } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    for (const d of ['Page', 'Runtime', 'DOM', 'CSS']) await cdp.send(`${d}.enable`, {}, s);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, s);
    const evaluate = async (expression) => {
      const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, s);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    const seen = { light: [], dark: [] };
    for (const rel of list) {
      const loaded = cdp.once('Page.loadEventFired', s);
      await cdp.send('Page.navigate', { url: base + (rel === 'index.html' ? '' : rel) }, s);
      await loaded;
      await evaluate('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 400)))');
      await evaluate(`(() => { const st = document.createElement('style'); st.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}'; document.head.append(st); })()`);
      await evaluate(PAGE_LIB);
      for (const theme of ['light', 'dark']) {
        await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] }, s);
        await evaluate('document.querySelectorAll("[data-cx]").forEach((e) => e.removeAttribute("data-cx"))');
        const marked = await evaluate(`window.__cx.mark(${JSON.stringify(SELECTOR)}, ${JSON.stringify(seen[theme])})`);
        seen[theme].push(...marked.map((m) => m.sig));
        if (!marked.length) continue;
        const { root } = await cdp.send('DOM.getDocument', { depth: 0 }, s);
        for (const m of marked) {
          const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `[data-cx="${m.i}"]` }, s);
          if (!nodeId) continue;
          for (const state of ['rest', 'hover', 'focus', 'focus-visible', 'active']) {
            await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: state === 'rest' ? [] : [state] }, s);
            const w = await evaluate(`window.__cx.measure(${m.i})`);
            checked++;
            if (w && w.ratio < min) failures.push({ page: rel, theme, state, label: m.label, sig: m.sig, ...w });
          }
          await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] }, s);
        }
      }
      log(`${rel}: ${failures.length} failures so far`);
    }
  } finally {
    cdp.close();
    stop();
    server.close();
  }
  return { pages: list.length, checked, failures };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const docs = fileURLToPath(new URL('../../docs/', import.meta.url));
  const res = await auditContrast({ docs, log: process.argv.includes('--verbose') ? console.log : () => {} });
  for (const f of res.failures) console.log(`${f.ratio.toFixed(2)}  ${f.theme.padEnd(5)} ${f.state.padEnd(13)} ${f.page}  "${f.label}"  ${f.fg} on ${f.bg}  [${f.sig.split('<').slice(0, 2).join(' < ')}]`);
  console.log(`contrast: ${res.pages} pages, ${res.checked} element states checked, ${res.failures.length} below ${MIN_RATIO}:1`);
  process.exitCode = res.failures.length ? 1 : 0;
}
