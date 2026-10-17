// Shared page chrome for the kastor site: head, top bar, docs sidebar,
// search dialog and footer. Used by scripts/build-site.mjs.
import { logo } from './art/brand.mjs';
import { DATABASES, sprite as brandSprite } from './art/icons.mjs';
import { illustration } from './art/illustrations.mjs';

export const SITE = 'https://kwy404.github.io/kastor/';
export const VERSION = '0.2.0';
export const MONSOON_CSS = 'https://cdn.jsdelivr.net/npm/monsooncss@0.2.0/dist/monsoon.min.css';
export const VOODOO_JS = 'https://cdn.jsdelivr.net/npm/voodoojs@1.0.0/dist/voodoo.full.min.js';
export const GITHUB = 'https://github.com/kwy404/kastor';
export const NPM = 'https://www.npmjs.com/package/kastor-orm';
export const AUTHOR_GH = 'https://github.com/kwy404';
export const AUTHOR_IN = 'https://www.linkedin.com/in/alexandre-silva-173687256/';
export const UPDATED = '2026-10-13';

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const MORE = [
  ['Monsoon', 'https://kwy404.github.io/monsoon/', 'Utility-first CSS with no build step'],
  ['Voodoo.js', 'https://kwy404.github.io/Voodoo.js/', 'Reactive attributes for plain HTML'],
  ['breakhound', 'https://kwy404.github.io/breakhound/', 'Find bugs in any JavaScript library'],
  ['vueleap', 'https://kwy404.github.io/vueleap/', 'Vue 2 to Vue 3 migration'],
  ['graphemely', 'https://kwy404.github.io/graphemely/', 'Grapheme aware string utilities'],
  ['numberparrot', 'https://kwy404.github.io/numberparrot/', 'Parse localized numbers'],
  ['edgegoat', 'https://kwy404.github.io/edgegoat/', 'Edge case inputs for testing'],
  ['cookieowl', 'https://kwy404.github.io/cookieowl/', 'Cookie consent that blocks trackers first'],
  ['installkite', 'https://kwy404.github.io/installkite/', 'Make any website an installable PWA'],
  ['a11ymedic', 'https://kwy404.github.io/a11ymedic/', 'Accessibility checks with the exact fix'],
  ['fontsketch', 'https://kwy404.github.io/fontsketch/', 'Create your own font in the browser'],
];

/** UI glyphs (24 by 24, 1.5 stroke, the same language as the icon set). */
const UI = {
  github: '<path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.4 1.1 2.9.8.1-.7.4-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1a9.6 9.6 0 0 1 5 0c1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.3 4.7-4.6 5 .4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5A10 10 0 0 0 12 2z" fill="currentColor" stroke="none"/>',
  linkedin: '<path d="M4.5 3.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM3 9h3v12H3zM9 9h2.9v1.7c.4-.8 1.4-1.9 3.4-1.9 3.1 0 3.7 2 3.7 4.7V21h-3v-6.6c0-1.6 0-3.6-2.2-3.6s-2.5 1.7-2.5 3.5V21H9z" fill="currentColor" stroke="none"/>',
  npm: '<rect x="2.75" y="7.25" width="18.5" height="9" rx="1"/><path d="M6 14.25v-5h3.25v5M7.6 9.25v5M10.75 16.25v-7H14v5h-1.6M15.5 14.25v-5h4.25v5M17.6 9.25v5"/>',
  sun: '<circle cx="12" cy="12" r="3.75"/><path d="M12 2.75v2M12 19.25v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.75 12h2M19.25 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M19.75 14.5A8 8 0 0 1 9.5 4.25a8 8 0 1 0 10.25 10.25z"/>',
  system: '<rect x="3" y="4.25" width="18" height="12" rx="2"/><path d="M8.5 19.75h7M12 16.25v3.5"/>',
  menu: '<path d="M4 8h16M4 16h16"/>',
  sidebar: '<rect x="3" y="4.25" width="18" height="15.5" rx="2.5"/><path d="M9.25 4.25v15.5M5.5 8h1.5M5.5 11h1.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  copy: '<rect x="8.75" y="8.75" width="11.5" height="11.5" rx="2"/><path d="M15.25 8.75V5.5a1.75 1.75 0 0 0-1.75-1.75h-7.75A1.75 1.75 0 0 0 4 5.5v7.75A1.75 1.75 0 0 0 5.75 15h3"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  arrow: '<path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5"/>',
  chevron: '<path d="M9.5 6.5 15 12l-5.5 5.5"/>',
  search: '<circle cx="11" cy="11" r="6.75"/><path d="M20 20l-4.25-4.25"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  book: '<path d="M12 6.5c-1.75-1.5-4.5-2-8-1.75v13.5c3.5-.25 6.25.25 8 1.75 1.75-1.5 4.5-2 8-1.75V4.75c-3.5-.25-6.25.25-8 1.75zM12 6.5v13.5"/>',
  play: '<path d="M7.5 5.25v13.5L18.75 12 7.5 5.25z"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4"/>',
  globe: '<circle cx="12" cy="12" r="8.75"/><path d="M3.25 12h17.5M12 3.25c2.75 3.25 2.75 14.25 0 17.5M12 3.25c-2.75 3.25-2.75 14.25 0 17.5"/>',
  info: '<circle cx="12" cy="12" r="8.75"/><path d="M12 11v5.25M12 7.75v.25"/>',
  warn: '<path d="M12 3.75 21 19.5H3L12 3.75zM12 10v4.25M12 16.75v.25"/>',
  spark: '<path d="M12 3.5c.6 4.4 2.1 5.9 6.5 6.5-4.4.6-5.9 2.1-6.5 6.5-.6-4.4-2.1-5.9-6.5-6.5 4.4-.6 5.9-2.1 6.5-6.5z"/>',
};

export function ui(name, cls = 'ic') {
  return `<svg class="${cls}" aria-hidden="true"><use href="#u-${name}"/></svg>`;
}
export function icon(name, cls = 'bic') {
  return `<svg class="${cls}" aria-hidden="true"><use href="#ic-${name}"/></svg>`;
}
export function dbIcon(id, cls = 'dbic') {
  return `<svg class="${cls}" aria-hidden="true"><use href="#db-${id}"/></svg>`;
}
export function rtIcon(id, cls = 'rtic') {
  return `<svg class="${cls}" aria-hidden="true"><use href="#rt-${id}"/></svg>`;
}

export function sprite() {
  const glyphs = Object.entries(UI)
    .map(([n, d]) => `<symbol id="u-${n}" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</g></symbol>`)
    .join('');
  return `<svg class="sprite" aria-hidden="true" focusable="false">${glyphs}${brandSprite()}</svg>`;
}

const THEME_SNIPPET = `<script>(function(){try{var t=localStorage.getItem('voodoo:theme');if(t&&t.charAt(0)==='"')t=JSON.parse(t);var r=document.documentElement;if(t==='light'||t==='dark'){r.setAttribute('data-theme',t);r.style.colorScheme=t}else{r.removeAttribute('data-theme')}}catch(e){}})();</script>`;

const FONTS = 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&amp;family=Geist+Mono:wght@400;500;600&amp;display=swap';

/**
 * The document head.
 * p: { path, title, description, lang, ogType, ogImage, jsonld, noindex, alternates: [[hreflang, path]], depth }
 */
export function head(p) {
  const url = SITE + (p.path || '');
  const prefix = p.root ?? (p.depth ? '../'.repeat(p.depth) : '');
  const ogImage = SITE + (p.ogImage || 'og.png');
  const alts = (p.alternates || []).map(([lang, path]) => `<link rel="alternate" hreflang="${lang}" href="${SITE}${path}">`).join('\n');
  const ld = p.jsonld ? `\n<script type="application/ld+json">\n${JSON.stringify(p.jsonld, null, 2).replace(/</g, '\\u003c')}\n</script>` : '';
  return `<!doctype html>
<html lang="${p.lang || 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
${THEME_SNIPPET}
<script src="${prefix}seasons.js"></script>
<title>${esc(p.title)}</title>
<meta name="description" content="${esc(p.description)}">
${p.noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${url}">`}
${alts}
<meta name="author" content="Alexandre Kohler">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0a0a0a" media="(prefers-color-scheme: dark)">
<meta property="og:type" content="${p.ogType || 'website'}">
<meta property="og:site_name" content="kastor">
<meta property="og:locale" content="${p.lang === 'pt-BR' ? 'pt_BR' : 'en_US'}">
<meta property="og:title" content="${esc(p.title)}">
<meta property="og:description" content="${esc(p.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${ogImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(p.ogAlt || 'kastor: the TypeScript ORM for almost every database')}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(p.title)}">
<meta name="twitter:description" content="${esc(p.description)}">
<meta name="twitter:image" content="${ogImage}">
<link rel="icon" href="${prefix}favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="${MONSOON_CSS}">
<link rel="stylesheet" href="${prefix}site.css">
<script src="${VOODOO_JS}" data-manual defer></script>
<script type="module" src="${prefix}site.js"></script>${ld}
</head>`;
}

const NAV = [
  ['playground', 'Playground', '#playground'],
  ['databases', 'Databases', '#databases'],
  ['features', 'Features', '#features'],
  ['frameworks', 'Frameworks', 'frameworks.html'],
  ['migrate', 'Migrate', 'migrate-to-kastor.html'],
  ['api', 'API', 'api.html'],
  ['guides', 'Guides', 'guides.html'],
];

/** The brand lockup: the K of logs and the name. */
function brand(home, ver = true) {
  return `<a href="${home}" class="brand" aria-label="kastor home">${logo({ size: 26, id: `kl-${ver ? 'top' : 'foot'}` })}<span class="brand-name">kastor</span>${ver ? `<span class="brand-ver">${VERSION}</span>` : ''}</a>`;
}

/** The database picker in the top bar, on pages whose examples follow it. */
export function dbSwitch(cls = 'db-switch') {
  const options = DATABASES.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
  return `<label class="${cls}"><svg class="dbic" aria-hidden="true"><use data-db-icon href="#db-postgres"/></svg><span class="sr-only">Database for the examples</span><select data-db-switch aria-label="Database for the examples">${options}</select>${ui('chevron', 'ic db-chev')}</label>`;
}

/** The sticky top bar. */
export function topbar(current = '', depth = 0, lang = 'en', root = null, withDb = false) {
  const prefix = root ?? (depth ? '../'.repeat(depth) : '');
  const home = root ?? (depth ? `${prefix}` : './');
  const links = NAV.map(([key, label, href]) => {
    const h = href.startsWith('#') ? `${home}${href}` : `${prefix}${href}`;
    return `<a href="${h}" class="top-link"${key === current ? ' aria-current="page"' : ''}>${label}</a>`;
  }).join('');
  const langLink = lang === 'pt-BR' ? `<a href="${prefix}guides.html" class="top-link top-lang" hreflang="en">English</a>` : `<a href="${prefix}pt-br/" class="top-link top-lang" hreflang="pt-BR">Portugu&ecirc;s</a>`;
  return `<a href="#main" class="skip-link">${lang === 'pt-BR' ? 'Pular para o conte&uacute;do' : 'Skip to content'}</a>
<header class="topbar" v-data="{ open: false }" @keydown.escape="open = false">
  <div class="wrap topbar-in">
    ${brand(home)}
    <nav id="topnav" class="topnav" :class="{ 'is-open': open }" aria-label="Main" @click="open = false">${links}${langLink}</nav>
    <div class="top-right">
      ${withDb ? dbSwitch() : ''}
      <button type="button" class="search-btn" data-search-open v-hotkey="mod+k" aria-haspopup="dialog" aria-label="Search the site">${ui('search')}<span class="search-label">Search docs</span><kbd class="kbd kbd-sm">Ctrl K</kbd></button>
      <a href="${GITHUB}" class="icon-btn" aria-label="kastor on GitHub">${ui('github')}</a>
      <button type="button" class="icon-btn theme-btn" v-theme-toggle.cycle aria-label="Switch theme" title="Theme: system, light or dark">${ui('system', 'ic ti-system')}${ui('sun', 'ic ti-light')}${ui('moon', 'ic ti-dark')}</button>
      <a href="${home}#start" class="btn btn-sm top-cta">${lang === 'pt-BR' ? 'Come&ccedil;ar' : 'Get started'}</a>
      <button type="button" class="icon-btn nav-btn" aria-controls="topnav" :aria-expanded="open ? 'true' : 'false'" aria-expanded="false" @click="open = !open" aria-label="Menu">${ui('menu')}</button>
    </div>
  </div>
</header>`;
}

/** The Ctrl K search dialog, filled by site.js from search.json. */
export function searchDialog(depth = 0, root = null) {
  const prefix = root ?? (depth ? '../'.repeat(depth) : '');
  return `<dialog id="search" class="modal modal-top search-dlg" aria-label="Search the site" data-root="${prefix}">
  <div class="command-palette" v-data="{ q: '', sel: 0 }" @keydown.down.prevent="sel = Math.min(sel + 1, hits(q, S.ready).length - 1)" @keydown.up.prevent="sel = Math.max(sel - 1, 0)" @keydown.enter.prevent="go(q, sel)">
    <label class="command-palette-search">${ui('search')}<input id="search-input" class="command-palette-input" v-model="q" @input="sel = 0" placeholder="Search guides, API and databases" autocomplete="off" spellcheck="false" aria-label="Search" aria-controls="search-results"></label>
    <div id="search-results" class="command-palette-list" role="listbox" aria-label="Results">
      <p class="command-palette-heading" v-if="!q">Suggestions</p>
      <a v-for="(r, i) in hits(q, S.ready)" :key="r.url" :href="r.href" class="command-palette-item" role="option" :aria-selected="i === sel ? 'true' : 'false'" @mouseenter="sel = i"><span class="hit-kind" v-text="r.kind"></span><span class="hit-text"><span class="hit-title" v-text="r.title"></span><span class="hit-sub" v-text="r.sub"></span></span>${ui('chevron', 'ic hit-go')}</a>
      <div class="command-palette-empty search-empty" v-if="q && !hits(q, S.ready).length"><img src="${prefix}assets/mascot-head.svg" class="brand-light" width="64" height="64" alt="" loading="lazy" data-season-art="mascot-head"><img src="${prefix}assets/mascot-head-dark.svg" class="brand-dark" width="64" height="64" alt="" loading="lazy" data-season-art="mascot-head-dark"><p>Kas looked under every log. Nothing matches that yet.</p><p class="search-empty-sub">Try a method name, a database or a framework.</p></div>
    </div>
    <div class="command-palette-footer"><span><kbd class="kbd kbd-xs">Enter</kbd> open</span><span><kbd class="kbd kbd-xs">Up</kbd> <kbd class="kbd kbd-xs">Down</kbd> move</span><span><kbd class="kbd kbd-xs">Esc</kbd> close</span></div>
  </div>
  <form method="dialog" class="modal-backdrop"><button aria-label="Close search">Close</button></form>
</dialog>`;
}

const guideHref = (meta) => (meta.lang === 'pt-BR' ? `pt-br/${meta.slug}.html` : `${meta.slug}.html`);

/** The footer, the same on every page. */
export function footer(guides, depth = 0, root = null) {
  const prefix = root ?? (depth ? '../'.repeat(depth) : '');
  const home = root ?? (depth ? prefix : './');
  const en = guides.filter((x) => x.meta.lang === 'en');
  const list = (items) => items.map((x) => `<li><a href="${prefix}${guideHref(x.meta)}">${esc(x.meta.crumb)}</a></li>`).join('');
  const notes = list(en.filter((x) => !x.meta.section).slice(0, 7));
  const migrate = list(en.filter((x) => x.meta.section === 'migrate').slice(0, 6));
  const fws = list(en.filter((x) => x.meta.section === 'frameworks').slice(0, 7));
  const more = MORE.map(([n, u, d]) => `<li><a href="${u}">${n}</a><small>${d}</small></li>`).join('');
  return `<footer class="site-foot">
  <div class="wrap">
    <div class="foot-top">
      <div class="foot-about">
        ${brand(home, false)}
        <p>The TypeScript ORM for almost every database. One schema, inferred types and the same queries on ten databases.</p>
        <div class="foot-install"><code><span aria-hidden="true">$</span> npm i kastor-orm</code><button type="button" class="k-copy k-copy-sm" v-copy="npm i kastor-orm" aria-label="Copy: npm i kastor-orm">${ui('copy')}</button></div>
        <p class="foot-links"><a href="${GITHUB}" class="icon-btn" aria-label="kastor on GitHub">${ui('github')}</a><a href="${NPM}" class="icon-btn" aria-label="kastor on npm">${ui('npm')}</a><a href="${GITHUB}/blob/main/CHANGELOG.md" class="foot-chip">${ui('book')}Changelog</a></p>
      </div>
      <div class="foot-grid">
        <nav aria-labelledby="f-site"><h2 id="f-site" class="foot-title">Product</h2><ul>
          <li><a href="${home}#playground">Playground</a></li><li><a href="${home}#databases">Database support</a></li><li><a href="${home}#features">Features</a></li><li><a href="${home}#studio">Studio</a></li><li><a href="${home}#start">Get started</a></li><li><a href="${prefix}api.html">API reference</a></li><li><a href="${prefix}guides.html">All guides</a></li><li><a href="${prefix}pt-br/">Guias em portugu&ecirc;s</a></li>
        </ul></nav>
        <nav aria-labelledby="f-migrate"><h2 id="f-migrate" class="foot-title">Migrate</h2><ul><li><a href="${prefix}migrate-to-kastor.html">Migrate to kastor</a></li>${migrate}</ul></nav>
        <nav aria-labelledby="f-fw"><h2 id="f-fw" class="foot-title">Frameworks</h2><ul><li><a href="${prefix}frameworks.html">All frameworks</a></li>${fws}</ul></nav>
        <nav aria-labelledby="f-guides"><h2 id="f-guides" class="foot-title">Guides</h2><ul>${notes}</ul></nav>
        <nav aria-labelledby="f-more" class="foot-more-nav"><h2 id="f-more" class="foot-title">More from kwy404</h2><ul class="foot-more">${more}</ul></nav>
      </div>
    </div>
    <div class="foot-bottom">
      <p>Made by <a href="${AUTHOR_GH}" rel="me noopener">Alexandre Kohler</a><a href="${AUTHOR_GH}" class="foot-ic" rel="me noopener" aria-label="Alexandre Kohler on GitHub">${ui('github')}</a><a href="${AUTHOR_IN}" class="foot-ic" rel="me noopener" aria-label="Alexandre Kohler on LinkedIn">${ui('linkedin')}</a></p>
      <p>Built with <a href="https://kwy404.github.io/monsoon/">Monsoon</a>. Interactive parts built with <a href="https://kwy404.github.io/Voodoo.js/">Voodoo.js</a>. MIT licensed.</p>
    </div>
  </div>
  <div class="kas-peek" v-data="{ up: false }" :class="{ 'is-up': up }">
    <p class="kas-say" role="status" v-show="up" style="display:none">Kas here. One query per include tree, every time. Now back to the dam.</p>
    <button type="button" class="kas-btn" @click="up = !up" :aria-expanded="up ? 'true' : 'false'" aria-expanded="false" aria-label="Say hi to Kas, the kastor beaver"><img src="${prefix}assets/mascot-head.svg" class="brand-light" width="64" height="64" alt="" loading="lazy" data-season-art="mascot-head"><img src="${prefix}assets/mascot-head-dark.svg" class="brand-dark" width="64" height="64" alt="" loading="lazy" data-season-art="mascot-head-dark"></button>
  </div>
</footer>`;
}

// ---------- Docs layout ----------

const DOCS_OVERVIEW = [
  ['Introduction', './', ''],
  ['Playground', './#playground', ''],
  ['Get started', './#start', ''],
  ['API reference', 'api.html', 'api.html'],
  ['Frameworks overview', 'frameworks.html', 'frameworks.html'],
  ['Migrate to kastor', 'migrate-to-kastor.html', 'migrate-to-kastor.html'],
  ['All guides', 'guides.html', 'guides.html'],
];

/** The left sidebar of docs pages: overview, then every guide by section. */
function docsNav(guides, p) {
  const prefix = p.depth ? '../'.repeat(p.depth) : '';
  const here = p.path || '';
  const link = (label, href, path) => `<li><a href="${href}"${path && path === here ? ' aria-current="page"' : ''}>${label}</a></li>`;
  const overview = DOCS_OVERVIEW.map(([label, href, path]) => link(label, href.startsWith('./') ? (prefix || './') + href.slice(2) : prefix + href, path)).join('');
  const en = guides.filter((g) => g.meta.lang === 'en');
  const pt = guides.filter((g) => g.meta.lang === 'pt-BR');
  const groups = [
    ['Guides', en.filter((g) => !g.meta.section)],
    ['Migrate', en.filter((g) => g.meta.section === 'migrate')],
    ['Frameworks', en.filter((g) => g.meta.section === 'frameworks')],
    ['Em portugu&ecirc;s', pt],
  ];
  const group = ([title, items]) => {
    if (!items.length) return '';
    const open = items.some((g) => guideHref(g.meta) === here);
    const lis = items.map((g) => link(esc(g.meta.crumb), prefix + guideHref(g.meta), guideHref(g.meta))).join('');
    return `<details class="dn-group"${open ? ' open' : ''}><summary>${title}<span class="dn-count">${items.length}</span>${ui('chevron', 'ic dn-chev')}</summary><ul>${lis}</ul></details>`;
  };
  return `<p class="dn-title">Overview</p><ul class="dn-list">${overview}</ul>${groups.map(group).join('')}`;
}

function docsShell(body, guides, p) {
  return `<div class="docs" v-data="{ side: false }" @keydown.escape="side = false">
  <aside id="docs-side" class="docs-side" :class="{ 'is-open': side }" aria-label="Documentation">
    <nav class="docs-nav" aria-label="Docs">${docsNav(guides, p)}</nav>
  </aside>
  <div class="docs-main">
    <button type="button" class="docs-menu" @click="side = !side" aria-controls="docs-side" :aria-expanded="side ? 'true' : 'false'" aria-expanded="false">${ui('sidebar')}<span>Docs menu</span></button>
${body}
  </div>
</div>`;
}

/**
 * Adjusts page bodies to the current visual language: the spot illustration
 * on guide covers and hubs, and wording that belonged to the old drawing set.
 */
function restyle(body, p, guides) {
  const g = guides.find((x) => guideHref(x.meta) === p.path);
  const kind = g ? (g.meta.section === 'migrate' ? 'migrate' : g.meta.section === 'frameworks' ? 'frameworks' : 'guide') : p.nav === 'api' ? 'reference' : p.nav === 'migrate' ? 'migrate' : p.nav === 'frameworks' ? 'frameworks' : 'hub';
  return body
    .replace(/<div class="g-cover-art" aria-hidden="true">[\s\S]*?<\/div>/, `<div class="g-cover-art" aria-hidden="true">${illustration(kind, { id: 'il-cover' })}</div>`)
    .replace(/<img src="[^"]*mascot\.svg" class="brand-light hub-kas"[^>]*><img src="[^"]*mascot-dark\.svg" class="brand-dark hub-kas"[^>]*>/, `<div class="hub-art" aria-hidden="true">${illustration(kind, { id: 'il-hub' })}</div>`)
    .replace(/>On this sheet</g, '>On this page<')
    .replace(/>Nesta folha</g, '>Nesta p&aacute;gina<')
    .replace(/Site engineer note/g, 'Note')
    .replace(/Nota do engenheiro/g, 'Nota')
    .replace(/<span class="sheet-no">SHEET \d+<\/span>/g, '<span class="sheet-no">Docs</span>')
    .replace(/<span>Sheet not found<\/span>/, '<span>Page not found</span>')
    .replace(/This drawing is not in the set/, 'This page is not in the docs');
}

/** Wraps a page body with the shared chrome. */
export function page(p, body, guides) {
  const depth = p.depth || 0;
  const docs = p.kind === 'guide' || p.kind === 'doc';
  let main = restyle(body, p, guides);
  if (docs) main = docsShell(main, guides, p);
  return `${head(p)}
<body class="antialiased page-${p.kind}${docs ? ' has-docs' : ''}">
${sprite()}
${topbar(p.nav, depth, p.lang, p.root, p.dbSwitch)}
<main id="main">
${main}
</main>
${footer(guides, depth, p.root)}
${searchDialog(depth, p.root)}
</body>
</html>
`;
}
