/* global requestAnimationFrame, cancelAnimationFrame, location, innerHeight, addEventListener, IntersectionObserver, localStorage, matchMedia, devicePixelRatio, CustomEvent, dispatchEvent, removeEventListener */
// Interactive parts of the kastor site, built with Voodoo.js
// (https://kwy404.github.io/Voodoo.js/). Voodoo is loaded with data-manual:
// this module publishes reactive state and helpers on V.config.globals, then
// calls V.start(). Pages declare behavior in HTML (v-data, @click, v-model,
// v-show, v-copy-from, v-theme-toggle, v-hotkey). Plain JavaScript is used
// where Voodoo cannot help: the search index, the reading progress bar, the
// seasonal art and particles, and the live playground, which is loaded only
// on the home page.

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// Motion and seasons do not wait for Voodoo.js.

// ---------- Motion: sections rise into view ----------

const calm = matchMedia('(prefers-reduced-motion: reduce)');
const risers = $$('.sec-head, .story-vis, .win-q, .inc-grid, .studio-shot, .tour, .start, .matrix-wrap, .rt-grid, .fw-grid, .g-grid, .accordion, .closing-in, .k-steps');
if (risers.length && 'IntersectionObserver' in window && !calm.matches) {
  document.documentElement.classList.add('rise-on');
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('is-in');
        seen.unobserve(e.target);
      }
    }
  }, { rootMargin: '0px 0px -8% 0px' });
  for (const el of risers) {
    el.classList.add('rise');
    seen.observe(el);
  }
}

// ---------- Seasons: art, the chip and particles ----------

const siteRoot = document.querySelector('#search')?.dataset.root ?? '';

const seasons = window.KastorSeasons;
const pagePt = document.documentElement.lang === 'pt-BR';
const ART = { mascot: 'mascot', 'mascot-dark': 'mascot-dark', 'mascot-head': 'head', 'mascot-head-dark': 'head-dark', head: 'head', 'head-dark': 'head-dark', accent: 'accent', 'accent-dark': 'accent-dark' };
const ICON = { newyear: 'firework', carnival: 'mask', easter: 'egg', valentine: 'heart', junina: 'bonfire', halloween: 'pumpkin', christmas: 'snowflake' };

/** Swaps the mascot images for the costume of the season, and back. */
function seasonArt(id) {
  for (const img of $$('img[data-season-art]')) {
    if (!img.dataset.base) img.dataset.base = img.getAttribute('src') || '';
    const name = ART[img.dataset.seasonArt];
    if (id && name) {
      img.src = `${siteRoot}assets/seasons/${id}/${name}.svg`;
      img.hidden = false;
    } else if (img.dataset.base) img.src = img.dataset.base;
    else img.hidden = true;
  }
}

/** The small chip that names the season and switches it off or on. */
function seasonChip(id) {
  const name = seasons.label(id, seasons.lang, pagePt);
  const chip = document.createElement('div');
  chip.className = 'season-chip';
  chip.innerHTML = `<img src="${siteRoot}assets/seasons/${id}/icons/light/${ICON[id]}.svg" class="brand-light" width="18" height="18" alt=""><img src="${siteRoot}assets/seasons/${id}/icons/dark/${ICON[id]}.svg" class="brand-dark" width="18" height="18" alt=""><span class="sc-label"></span><button type="button" role="switch" class="sc-switch"><span class="sc-knob"></span></button>`;
  const label = chip.querySelector('.sc-label');
  const sw = chip.querySelector('.sc-switch');
  const paint = () => {
    const on = seasons.active === id;
    label.textContent = pagePt ? `Tema ${name}` : `${name} mode`;
    sw.setAttribute('aria-checked', String(on));
    sw.setAttribute('aria-label', pagePt ? `Tema ${name}` : `${name} mode`);
    chip.classList.toggle('is-off', !on);
  };
  sw.addEventListener('click', () => {
    if (seasons.active === id) seasons.off(id);
    else seasons.on(id);
  });
  addEventListener('kastor:season', paint);
  paint();
  document.body.appendChild(chip);
}

/** Particles of the season on one small canvas over the first screen. */
const FX = {
  halloween: { n: 16, colors: ['#d9772b', '#b5562a', '#8a5a2b'], shape: 'leaf', vy: [0.35, 0.8], bats: 2 },
  christmas: { n: 40, colors: ['#ffffff'], light: ['#b9c9da'], shape: 'snow', vy: [0.3, 0.9] },
  carnival: { n: 34, colors: ['#e76f51', '#2a9d8f', '#e9c46a', '#7b5ab8'], shape: 'confetti', vy: [0.6, 1.3] },
  junina: { n: 26, colors: ['#ffb547', '#f08a3c', '#ffd27a'], shape: 'spark', vy: [-0.9, -0.35] },
  valentine: { n: 18, colors: ['#df5d70', '#f2a3b0'], shape: 'heart', vy: [0.3, 0.7] },
  easter: { n: 20, colors: ['#f4a3b5', '#f6d36b', '#b9a3e3', '#8fc3e8'], shape: 'petal', vy: [0.3, 0.7] },
  newyear: { n: 0, colors: ['#e9c46a', '#f08a3c', '#ffd27a'], shape: 'firework' },
};

function particles(id) {
  const fx = FX[id];
  const host = $('.k-hero') || $('.hub-hero') || $('.page-head') || $('.g-cover');
  if (!fx || !host || calm.matches) return () => {};
  const canvas = document.createElement('canvas');
  canvas.className = 'season-fx';
  canvas.setAttribute('aria-hidden', 'true');
  host.prepend(canvas);
  const ctx = canvas.getContext('2d');
  const dark = () => document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  let w = 0;
  let h = 0;
  const size = () => {
    const r = Math.min(devicePixelRatio || 1, 2);
    w = host.clientWidth;
    h = Math.min(host.clientHeight, innerHeight * 1.2);
    canvas.width = Math.round(w * r);
    canvas.height = Math.round(h * r);
    canvas.style.height = `${h}px`;
    ctx.setTransform(r, 0, 0, r, 0, 0);
  };
  size();
  addEventListener('resize', size, { passive: true });
  const rnd = (a, b) => a + Math.random() * (b - a);
  const count = Math.round(fx.n * Math.min(1, w / 1200 + 0.35));
  const make = (top) => ({ x: rnd(0, w), y: top ? rnd(-h, 0) * 0.2 - 10 : rnd(0, h), vx: rnd(-0.3, 0.3), vy: fx.vy ? rnd(...fx.vy) : 0, r: rnd(3, 6), a: rnd(0, 6.28), va: rnd(-0.04, 0.04), c: Math.floor(rnd(0, fx.colors.length)), life: rnd(0.4, 1) });
  const ps = Array.from({ length: count }, () => make(false));
  if (fx.shape === 'spark') for (const p of ps) p.y = rnd(h * 0.3, h);
  const bats = Array.from({ length: fx.bats || 0 }, (_, i) => ({ x: -60 - i * 300, y: rnd(40, 160), s: rnd(0.6, 1), t: rnd(0, 6) }));
  const bursts = [];
  let last = 0;
  let raf = 0;
  let running = false;
  const color = (p) => (fx.light && !dark() ? fx.light : fx.colors)[p.c % (fx.light && !dark() ? fx.light.length : fx.colors.length)];
  const draw = (p) => {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.a);
    ctx.fillStyle = color(p);
    if (fx.shape === 'snow') {
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.arc(0, 0, p.r * 0.55, 0, 6.28);
      ctx.fill();
    } else if (fx.shape === 'confetti') {
      ctx.globalAlpha = 0.85;
      ctx.fillRect(-p.r, -p.r * 0.45, p.r * 2, p.r * 0.9 * Math.abs(Math.cos(p.a * 3)) + 0.6);
    } else if (fx.shape === 'spark') {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.beginPath();
      ctx.arc(0, 0, p.r * 0.35, 0, 6.28);
      ctx.fill();
    } else if (fx.shape === 'heart') {
      ctx.globalAlpha = 0.6;
      const k = p.r / 6;
      ctx.beginPath();
      ctx.moveTo(0, 5 * k);
      ctx.bezierCurveTo(-8 * k, 0, -7 * k, -7 * k, 0, -3 * k);
      ctx.bezierCurveTo(7 * k, -7 * k, 8 * k, 0, 0, 5 * k);
      ctx.fill();
    } else {
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.r * 1.3, p.r * 0.6, 0, 0, 6.28);
      ctx.fill();
    }
    ctx.restore();
  };
  const frame = (t) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(48, t - (last || t)) / 16.7;
    last = t;
    ctx.clearRect(0, 0, w, h);
    for (const p of ps) {
      p.x += (p.vx + Math.sin(p.a) * 0.3) * dt;
      p.y += p.vy * dt;
      p.a += p.va * dt;
      if (fx.shape === 'spark') p.life -= 0.004 * dt;
      if (p.y > h + 12 || p.y < -20 || p.x < -20 || p.x > w + 20 || p.life <= 0) Object.assign(p, make(true), fx.shape === 'spark' ? { y: h + 5, life: 1 } : {});
      draw(p);
    }
    for (const b of bats) {
      b.x += 1.4 * dt;
      b.t += 0.25 * dt;
      if (b.x > w + 80) Object.assign(b, { x: -80, y: rnd(40, 180) });
      const flap = Math.sin(b.t) * 0.6;
      ctx.save();
      ctx.translate(b.x, b.y + Math.sin(b.t * 0.3) * 8);
      ctx.scale(b.s, b.s);
      ctx.fillStyle = dark() ? '#c9bfae' : '#3a2a1e';
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-10, -12 * flap - 4, -22, -4 * flap);
      ctx.quadraticCurveTo(-12, 2, 0, 6);
      ctx.quadraticCurveTo(12, 2, 22, -4 * flap);
      ctx.quadraticCurveTo(10, -12 * flap - 4, 0, 0);
      ctx.fill();
      ctx.restore();
    }
    if (fx.shape === 'firework') {
      if (bursts.length < 3 && Math.random() < 0.015 * dt) {
        const c = fx.colors[Math.floor(rnd(0, fx.colors.length))];
        const x = rnd(w * 0.1, w * 0.9);
        const y = rnd(h * 0.08, h * 0.4);
        bursts.push({ parts: Array.from({ length: 22 }, (_, i) => ({ x, y, vx: Math.cos((i / 22) * 6.28) * rnd(1.2, 2.2), vy: Math.sin((i / 22) * 6.28) * rnd(1.2, 2.2) })), c, life: 1 });
      }
      for (let i = bursts.length - 1; i >= 0; i--) {
        const b = bursts[i];
        b.life -= 0.012 * dt;
        if (b.life <= 0) {
          bursts.splice(i, 1);
          continue;
        }
        ctx.fillStyle = b.c;
        ctx.globalAlpha = b.life * 0.8;
        for (const q of b.parts) {
          q.x += q.vx * dt;
          q.y += q.vy * dt;
          q.vy += 0.025 * dt;
          q.vx *= 0.985;
          q.vy *= 0.985;
          ctx.fillRect(q.x - 1.2, q.y - 1.2, 2.4, 2.4);
        }
        ctx.globalAlpha = 1;
      }
    }
  };
  const start = () => {
    if (!running && !document.hidden) {
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    }
  };
  const stop = () => {
    running = false;
    cancelAnimationFrame(raf);
  };
  const io = new IntersectionObserver((e) => (e[0].isIntersecting ? start() : stop()));
  io.observe(canvas);
  const vis = () => (document.hidden ? stop() : start());
  document.addEventListener('visibilitychange', vis);
  return () => {
    stop();
    io.disconnect();
    document.removeEventListener('visibilitychange', vis);
    removeEventListener('resize', size);
    canvas.remove();
  };
}

if (seasons && seasons.season) {
  let clear = () => {};
  const show = (id) => {
    clear();
    seasonArt(id);
    clear = id ? particles(id) : () => {};
  };
  addEventListener('kastor:season', (e) => show(e.detail));
  show(seasons.active);
  seasonChip(seasons.season);
}

function whenVoodoo() {
  return new Promise((resolve) => {
    if (window.V) return resolve(window.V);
    const s = document.querySelector('script[src*="voodoo"]');
    if (s) s.addEventListener('load', () => resolve(window.V), { once: true });
    const t = setInterval(() => window.V && (clearInterval(t), resolve(window.V)), 30);
  });
}

const V = await whenVoodoo();
// ---------- The database every example follows ----------

const DBS = ['postgres', 'cockroach', 'mysql', 'mariadb', 'sqlite', 'libsql', 'd1', 'mssql', 'oracle', 'mongodb'];
const saved = (() => {
  try {
    return localStorage.getItem('kastor:db');
  } catch {
    return null;
  }
})();
const S = V.reactive({ ready: 0, db: DBS.includes(saved) ? saved : 'postgres' });

function setDb(id) {
  if (!DBS.includes(id) || S.db === id) return;
  S.db = id;
  try {
    localStorage.setItem('kastor:db', id);
  } catch {
    // private mode: the choice lasts for this page
  }
  for (const sel of document.querySelectorAll('[data-db-switch]')) sel.value = id;
  for (const use of document.querySelectorAll('[data-db-icon]')) use.setAttribute('href', `#db-${id}`);
  dispatchEvent(new CustomEvent('kastor:db', { detail: id }));
}
/** The include example is compiled for six databases; the others share a family. */
const FAMILY = { cockroach: 'postgres', mariadb: 'mysql', libsql: 'sqlite', d1: 'sqlite' };
const incDb = (id) => FAMILY[id] || id;
window.kastorDb = { get: () => S.db, set: setDb };
for (const sel of document.querySelectorAll('[data-db-switch]')) {
  sel.value = S.db;
  sel.addEventListener('change', () => setDb(sel.value));
}
for (const use of document.querySelectorAll('[data-db-icon]')) use.setAttribute('href', `#db-${S.db}`);

// ---------- Search (Ctrl K and /) ----------

const dialog = $('#search');
const root = dialog?.dataset.root ?? '';
let index = [];
let loading = null;
function loadSearch() {
  if (!loading) {
    loading = fetch(`${root}search.json`)
      .then((r) => r.json())
      .then((j) => {
        index = j.map((e) => ({ ...e, href: root + e.url, hay: `${e.title} ${e.sub} ${e.kind}`.toLowerCase() }));
        S.ready++;
      })
      .catch(() => {
        loading = null;
      });
  }
  return loading;
}
function hits(q) {
  const query = String(q || '').trim().toLowerCase();
  if (!query) return index.filter((e) => e.kind === 'Page').slice(0, 8);
  const words = query.split(/\s+/);
  return index
    .map((e) => {
      if (!words.every((w) => e.hay.includes(w))) return null;
      const t = e.title.toLowerCase();
      return { e, score: (t.startsWith(query) ? 4 : t.includes(query) ? 2 : 0) + (e.kind === 'Guide' ? 1 : 0) };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((x) => x.e);
}
function openSearch() {
  if (!dialog) return;
  loadSearch();
  if (!dialog.open) dialog.showModal();
  requestAnimationFrame(() => $('#search-input')?.focus());
}
document.addEventListener('click', (e) => {
  if (e.target.closest?.('[data-search-open]')) openSearch();
  if (dialog?.open && e.target.closest?.('#search a[href]')) dialog.close();
});
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !e.target.closest?.('input, textarea, select, [contenteditable]')) {
    e.preventDefault();
    openSearch();
  }
});

// ---------- Guide hub filter ----------

const hubData = $('#hub-data') ? JSON.parse($('#hub-data').textContent) : [];
function hubMatch(i, q) {
  const words = String(q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((w) => (hubData[i] || '').includes(w));
}

Object.assign(V.config.globals, {
  S,
  hits: (q) => hits(q),
  go(q, sel) {
    const r = hits(q)[sel];
    if (!r) return;
    dialog?.close();
    location.href = r.href;
  },
  hubMatch,
  setDb,
  incDb,
});

V.start();

// ---------- Reading progress and table of contents ----------

const bar = $('.read-progress');
const article = $('.read-main');
const tocLinks = $$('.toc-box a[href^="#"]');
if (article && (bar || tocLinks.length)) {
  const targets = tocLinks.map((a) => document.getElementById(decodeURIComponent(a.hash.slice(1)))).filter(Boolean);
  let ticking = false;
  const update = () => {
    ticking = false;
    const r = article.getBoundingClientRect();
    const total = r.height - innerHeight * 0.6;
    if (bar) bar.style.width = `${Math.max(0, Math.min(1, -r.top / Math.max(total, 1))) * 100}%`;
    let current = targets[0];
    for (const t of targets) if (t.getBoundingClientRect().top < 140) current = t;
    for (const a of tocLinks) a.classList.toggle('on', current && a.hash === `#${current.id}`);
  };
  addEventListener('scroll', () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }, { passive: true });
  update();
}

// ---------- Playground (home page only) ----------

const pg = $('[data-playground]');
if (pg) {
  const start = () => import('./assets/pg-app.js').then((m) => m.mount(pg)).catch((err) => {
    const status = $('[data-status]', pg);
    if (status) status.textContent = 'The playground could not load';
    console.warn(err);
  });
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        start();
      }
    }, { rootMargin: '600px' });
    io.observe(pg);
  } else start();
}
