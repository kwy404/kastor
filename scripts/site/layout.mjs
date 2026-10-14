// Shared page chrome for the kastor site: head, top bar, search dialog and
// footer. Used by scripts/build-site.mjs.
import { sprite as brandSprite } from './art/icons.mjs';

export const SITE = 'https://kwy404.github.io/kastor/';
export const VERSION = '0.1.0';
export const MONSOON_CSS = 'https://cdn.jsdelivr.net/npm/monsooncss@0.2.0/dist/monsoon.min.css';
export const VOODOO_JS = 'https://cdn.jsdelivr.net/npm/voodoojs@1.0.0/dist/voodoo.full.min.js';
export const GITHUB = 'https://github.com/kwy404/kastor';
export const NPM = 'https://www.npmjs.com/package/kastor';
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

/** UI glyphs (24 by 24, stroke based). Brand icons come from art/icons.mjs. */
const UI = {
  github: '<path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.4 1.1 2.9.8.1-.7.4-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1a9.6 9.6 0 0 1 5 0c1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.3 4.7-4.6 5 .4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5A10 10 0 0 0 12 2z" fill="currentColor" stroke="none"/>',
  linkedin: '<path d="M4.5 3.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM3 9h3v12H3zM9 9h2.9v1.7c.4-.8 1.4-1.9 3.4-1.9 3.1 0 3.7 2 3.7 4.7V21h-3v-6.6c0-1.6 0-3.6-2.2-3.6s-2.5 1.7-2.5 3.5V21H9z" fill="currentColor" stroke="none"/>',
  npm: '<path d="M3 7h18v9h-9v2H8v-2H3zm2 2v5h2v-3.5h1.5V14H10V9zm7 0v7h2v-2h3V9zm2 2h1.5v1.5H14zm5-2h-1v5h-1.5V9H17"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  system: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5"/>',
  play: '<path d="M7 5l12 7-12 7z"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  warn: '<path d="M12 3l10 18H2zM12 10v5M12 18v.5"/>',
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

export function sprite() {
  const ui = Object.entries(UI)
    .map(([n, d]) => `<symbol id="u-${n}" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</g></symbol>`)
    .join('');
  return `<svg class="sprite" aria-hidden="true" focusable="false">${ui}${brandSprite()}</svg>`;
}

const THEME_SNIPPET = `<script>(function(){try{var t=localStorage.getItem('voodoo:theme');if(t&&t.charAt(0)==='"')t=JSON.parse(t);var r=document.documentElement;if(t==='light'||t==='dark'){r.setAttribute('data-theme',t);r.style.colorScheme=t}else{r.removeAttribute('data-theme')}}catch(e){}})();</script>`;

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
<title>${esc(p.title)}</title>
<meta name="description" content="${esc(p.description)}">
${p.noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${url}">`}
${alts}
<meta name="author" content="Alexandre Kohler">
<meta name="theme-color" content="#f6f1e4" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0a1d45" media="(prefers-color-scheme: dark)">
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
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&amp;family=Space+Grotesk:wght@500;600;700&amp;display=swap">
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
  ['api', 'API', 'api.html'],
  ['guides', 'Guides', 'guides.html'],
];

/** The sticky top bar. */
export function topbar(current = '', depth = 0, lang = 'en', root = null) {
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
    <a href="${home}" class="brand" aria-label="kastor home"><img src="${prefix}assets/mascot-head.svg" class="brand-light" width="34" height="34" alt=""><img src="${prefix}assets/mascot-head-dark.svg" class="brand-dark" width="34" height="34" alt=""><span class="brand-name">kastor</span><span class="brand-ver">${VERSION}</span></a>
    <nav id="topnav" class="topnav" :class="{ 'is-open': open }" aria-label="Main" @click="open = false">${links}${langLink}</nav>
    <div class="top-right">
      <button type="button" class="search-btn" data-search-open v-hotkey="mod+k" aria-haspopup="dialog" aria-label="Search the site">${ui('search')}<span class="search-label">Search</span><kbd class="kbd kbd-sm">Ctrl K</kbd></button>
      <a href="${GITHUB}" class="icon-btn" aria-label="kastor on GitHub">${ui('github')}</a>
      <button type="button" class="icon-btn theme-btn" v-theme-toggle.cycle aria-label="Switch theme" title="Theme: system, light or dark">${ui('system', 'ic ti-system')}${ui('sun', 'ic ti-light')}${ui('moon', 'ic ti-dark')}</button>
      <button type="button" class="icon-btn nav-btn" aria-controls="topnav" :aria-expanded="open ? 'true' : 'false'" aria-expanded="false" @click="open = !open" aria-label="Menu">${ui('menu')}</button>
    </div>
  </div>
</header>`;
}

/** The Ctrl K search dialog, filled by site.js from search.json. */
export function searchDialog(depth = 0, root = null) {
  return `<dialog id="search" class="modal modal-top search-dlg" aria-label="Search the site" data-root="${root ?? (depth ? '../'.repeat(depth) : '')}">
  <div class="command-palette" v-data="{ q: '', sel: 0 }" @keydown.down.prevent="sel = Math.min(sel + 1, hits(q, S.ready).length - 1)" @keydown.up.prevent="sel = Math.max(sel - 1, 0)" @keydown.enter.prevent="go(q, sel)">
    <label class="command-palette-search">${ui('search')}<input id="search-input" class="command-palette-input" v-model="q" @input="sel = 0" placeholder="Search guides, API and databases" autocomplete="off" spellcheck="false" aria-label="Search" aria-controls="search-results"></label>
    <div id="search-results" class="command-palette-list" role="listbox" aria-label="Results">
      <p class="command-palette-heading" v-if="!q">Suggestions</p>
      <a v-for="(r, i) in hits(q, S.ready)" :key="r.url" :href="r.href" class="command-palette-item" role="option" :aria-selected="i === sel ? 'true' : 'false'" @mouseenter="sel = i"><span class="hit-kind" v-text="r.kind"></span><span class="hit-text"><span class="hit-title" v-text="r.title"></span><span class="hit-sub" v-text="r.sub"></span></span></a>
      <p class="command-palette-empty" v-if="q && !hits(q, S.ready).length">Nothing on the drawings matches that yet.</p>
    </div>
    <div class="command-palette-footer"><span><kbd class="kbd kbd-xs">Enter</kbd> open</span><span><kbd class="kbd kbd-xs">Esc</kbd> close</span></div>
  </div>
  <form method="dialog" class="modal-backdrop"><button aria-label="Close search">Close</button></form>
</dialog>`;
}

/** The footer, the same on every page. */
export function footer(guides, depth = 0, root = null) {
  const prefix = root ?? (depth ? '../'.repeat(depth) : '');
  const home = root ?? (depth ? prefix : './');
  const g = guides
    .filter((x) => x.meta.lang === 'en')
    .slice(0, 8)
    .map((x) => `<li><a href="${prefix}${x.meta.slug}.html">${esc(x.meta.crumb)}</a></li>`)
    .join('');
  const more = MORE.map(([n, u, d]) => `<li><a href="${u}">${n}</a><small>${d}</small></li>`).join('');
  return `<footer class="site-foot">
  <div class="wrap">
    <div class="foot-grid">
      <div class="foot-about">
        <a href="${home}" class="brand"><img src="${prefix}assets/mascot-head.svg" class="brand-light" width="40" height="40" alt="" loading="lazy"><img src="${prefix}assets/mascot-head-dark.svg" class="brand-dark" width="40" height="40" alt="" loading="lazy"><span class="brand-name">kastor</span></a>
        <p>Beavers build strong structures from logs. kastor builds strong data layers from rows: one TypeScript schema, inferred types and the same queries on ten databases.</p>
        <p class="foot-links"><a href="${GITHUB}">${ui('github')}GitHub</a><a href="${NPM}">${ui('npm')}npm</a><a href="${GITHUB}/blob/main/CHANGELOG.md">${ui('book')}Changelog</a></p>
      </div>
      <nav aria-labelledby="f-site"><h2 id="f-site" class="foot-title">The site</h2><ul>
        <li><a href="${home}#playground">Playground</a></li><li><a href="${home}#databases">Database support</a></li><li><a href="${home}#features">Feature tour</a></li><li><a href="${home}#studio">Studio</a></li><li><a href="${home}#start">Get started</a></li><li><a href="${prefix}frameworks.html">Frameworks</a></li><li><a href="${prefix}api.html">API reference</a></li><li><a href="${prefix}guides.html">All guides</a></li><li><a href="${prefix}pt-br/">Guias em portugu&ecirc;s</a></li>
      </ul></nav>
      <nav aria-labelledby="f-guides"><h2 id="f-guides" class="foot-title">Guides</h2><ul>${g}</ul></nav>
      <nav aria-labelledby="f-more"><h2 id="f-more" class="foot-title">More from kwy404</h2><ul class="foot-more">${more}</ul></nav>
    </div>
    <div class="foot-bottom">
      <p>Made by <a href="${AUTHOR_GH}" rel="me noopener">Alexandre Kohler</a><a href="${AUTHOR_GH}" class="foot-ic" rel="me noopener" aria-label="Alexandre Kohler on GitHub">${ui('github')}</a><a href="${AUTHOR_IN}" class="foot-ic" rel="me noopener" aria-label="Alexandre Kohler on LinkedIn">${ui('linkedin')}</a></p>
      <p>Built with <a href="https://kwy404.github.io/monsoon/">Monsoon</a>. Interactive parts built with <a href="https://kwy404.github.io/Voodoo.js/">Voodoo.js</a>. MIT licensed.</p>
    </div>
  </div>
</footer>`;
}

/** Wraps a page body with the shared chrome. */
export function page(p, body, guides) {
  const depth = p.depth || 0;
  return `${head(p)}
<body class="antialiased page-${p.kind}">
${sprite()}
${topbar(p.nav, depth, p.lang, p.root)}
<main id="main">
${body}
</main>
${footer(guides, depth, p.root)}
${searchDialog(depth, p.root)}
</body>
</html>
`;
}
