/* global requestAnimationFrame, location, innerHeight, addEventListener, IntersectionObserver */
// Interactive parts of the kastor site, built with Voodoo.js
// (https://kwy404.github.io/Voodoo.js/). Voodoo is loaded with data-manual:
// this module publishes reactive state and helpers on V.config.globals, then
// calls V.start(). Pages declare behavior in HTML (v-data, @click, v-model,
// v-show, v-copy-from, v-theme-toggle, v-hotkey). Plain JavaScript is used
// where Voodoo cannot help: the search index, the reading progress bar and
// the live playground, which is loaded only on the home page.

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

function whenVoodoo() {
  return new Promise((resolve) => {
    if (window.V) return resolve(window.V);
    const s = document.querySelector('script[src*="voodoo"]');
    if (s) s.addEventListener('load', () => resolve(window.V), { once: true });
    const t = setInterval(() => window.V && (clearInterval(t), resolve(window.V)), 30);
  });
}

const V = await whenVoodoo();
const S = V.reactive({ ready: 0 });

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
  if (e.target.closest('[data-search-open]')) openSearch();
  if (dialog?.open && e.target.closest('#search a[href]')) dialog.close();
});
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !e.target.closest('input, textarea, select, [contenteditable]')) {
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
