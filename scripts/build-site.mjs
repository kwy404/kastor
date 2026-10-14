// Builds the kastor docs site in docs/ and the SVG art in assets/.
//   scripts/site/guides/*.html        English guides: a meta comment, then sections
//   scripts/site/guides/pt-br/*.html  Portuguese guides
//   scripts/site/*.mjs                layout, home, pages, art and content
//   scripts/site/static/              site.css, site.js and the playground worker
//   scripts/site/playground/          the playground entry, bundled from src/
// Code samples are highlighted at build time with Shiki (light-plus and
// dark-plus), so pages ship no highlighter.
// Usage: node scripts/build-site.mjs [--images] [--no-bundle]
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeAssets } from './site/assets.mjs';
import { API } from './site/content/api.mjs';
import { FAQ, fileBadge, homeBody, homeJsonLd } from './site/home.mjs';
import { SITE, UPDATED, esc, page } from './site/layout.mjs';
import { apiBody, frameworksBody, guideBody, guideJsonLd, guideUrl, hubBody, hubJsonLd, migrateHubBody, migrateHubJsonLd, notFoundBody } from './site/pages.mjs';
import { FRAMEWORKS } from './site/content/frameworks.mjs';
import { bundlePlayground } from './site/bundle.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const docs = join(root, 'docs');
const siteDir = join(root, 'scripts', 'site');
const args = new Set(process.argv.slice(2));

// ---------- Shiki ----------

async function loadShiki() {
  const require = createRequire(import.meta.url);
  try {
    return await import(pathToFileURL(require.resolve('shiki')).href);
  } catch {
    // fall back to a sibling checkout that has it installed
  }
  const sibling = join(root, '..', 'graphemely', 'node_modules', 'shiki', 'dist', 'index.mjs');
  if (existsSync(sibling)) return import(pathToFileURL(sibling).href);
  throw new Error('shiki is not installed: npm i -D shiki, or keep a graphemely checkout next to this repo');
}
const shiki = await loadShiki();
const highlighter = await shiki.createHighlighter({ themes: ['light-plus', 'dark-plus'], langs: ['ts', 'tsx', 'js', 'sql', 'json', 'bash', 'yaml', 'toml', 'text', 'prisma', 'php', 'python', 'ruby', 'svelte', 'vue', 'astro', 'dockerfile'] });

let codeId = 0;
/** A VS Code style frame around Shiki output. kind: editor, terminal or output. */
export function frame(code, opts = {}) {
  const lang = opts.lang || 'text';
  const kind = opts.kind || 'editor';
  const title = opts.title || (kind === 'terminal' ? 'Terminal' : 'snippet');
  const html = highlighter.codeToHtml(code, { lang, themes: { light: 'light-plus', dark: 'dark-plus' }, defaultColor: false });
  let inner = /<code>([\s\S]*)<\/code>/.exec(html)[1];
  // Plain text has no tokens; give its lines the theme colors like every other sample.
  if (lang === 'text') inner = inner.replace(/<span class="line"><span>/g, '<span class="line"><span style="--shiki-light:#000000;--shiki-dark:#D4D4D4">');
  const id = `code-${++codeId}`;
  const cls = ['frame', `frame-${kind}`, opts.compact ? 'frame-compact' : ''].filter(Boolean).join(' ');
  return `<figure class="${cls}" data-lang="${lang}"><div class="frame-bar"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="frame-tab">${fileBadge(kind === 'terminal' ? 'bash' : lang)}<span>${esc(title)}</span></span><button type="button" class="frame-copy" v-copy-from="#${id}" aria-label="Copy ${esc(title)}"><svg class="ic" aria-hidden="true"><use href="#u-copy"/></svg><span>Copy</span></button></div><pre class="shiki" tabindex="0"><code id="${id}">${inner}</code></pre></figure>`;
}

const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

function renderBlocks(body) {
  return body.replace(/<pre data-kind="(\w+)"([^>]*)>\n([\s\S]*?)\n<\/pre>/g, (_, kind, attrs, code) => {
    const attr = (name) => (new RegExp(`data-${name}="([^"]*)"`).exec(attrs) || [])[1];
    return frame(unescape(code), { kind, lang: attr('lang') || 'text', title: attr('title') });
  });
}

// ---------- Guides ----------

const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
function readGuides(dir, lang) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.html'))
    .sort()
    .map((f) => {
      const src = readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n');
      const m = /^<!--meta\n([\s\S]*?)\n-->\n([\s\S]*)$/.exec(src);
      if (!m) throw new Error(`${f}: missing meta comment`);
      const meta = JSON.parse(m[1]);
      if (meta.lang !== lang) throw new Error(`${f}: lang should be ${lang}`);
      if (`${meta.slug}.html` !== f) throw new Error(`${f}: slug mismatch`);
      for (const k of ['title', 'description', 'h1', 'crumb', 'lead', 'readTime', 'keywords', 'faq', 'related']) if (!meta[k]) throw new Error(`${f}: meta.${k} missing`);
      if (DASHES.test(src)) throw new Error(`${f}: en or em dash`);
      // Braces outside code would be read as expressions by the page runtime.
      const prose = (m[2] + JSON.stringify([meta.lead, meta.faq])).replace(/<pre[\s\S]*?<\/pre>/g, '').replace(/<code>[\s\S]*?<\/code>/g, '').replace(/^\["|"\]$/g, '');
      const stripped = prose.replace(/\{"q":|,"a":|"\},\{|\[\{|\}\]/g, '');
      if (/[{}]/.test(stripped)) throw new Error(`${f}: a brace outside <code> (the site runtime would evaluate it)`);
      return { meta, body: m[2], file: f };
    });
}

const guidesEn = readGuides(join(siteDir, 'guides'), 'en');
const guidesPt = readGuides(join(siteDir, 'guides', 'pt-br'), 'pt-BR');
// English guides with a Portuguese counterpart link back to it.
for (const p of guidesPt) {
  const en = guidesEn.find((g) => g.meta.slug === p.meta.alt);
  if (!en) throw new Error(`pt-br/${p.file}: alt ${p.meta.alt} not found`);
  en.meta.alt = p.meta.slug;
}
const ORDER = [
  'typescript-orm', 'prisma-alternative-without-codegen', 'drizzle-alternative', 'type-safe-sql-typescript', 'avoid-n-plus-1-queries', 'database-migrations-explained', 'nextjs-postgres-orm', 'database-seeding-typescript', 'multi-database-apps', 'sql-server-orm-nodejs', 'oracle-orm-nodejs', 'mongodb-orm-typescript', 'cloudflare-d1-orm', 'turso-libsql-orm',
  'migrate-from-prisma', 'migrate-from-drizzle', 'migrate-from-typeorm', 'migrate-from-sequelize', 'migrate-from-knex', 'migrate-from-mongoose', 'migrate-from-laravel-eloquent', 'migrate-from-django-orm', 'migrate-from-rails-active-record',
  'nextjs-app-router-orm', 'nuxt-orm', 'sveltekit-orm', 'remix-react-router-orm', 'astro-orm', 'nestjs-orm', 'express-orm', 'fastify-orm', 'hono-orm', 'adonisjs-orm', 'bun-orm', 'deno-orm', 'cloudflare-workers-orm', 'electron-sqlite-orm', 'aws-lambda-orm',
];
const rank = (list, slug) => (list.includes(slug) ? list.indexOf(slug) : list.length);
for (const g of guidesEn) if (!ORDER.includes(g.meta.slug)) throw new Error(`${g.file}: add the slug to ORDER in build-site.mjs`);
guidesEn.sort((a, b) => rank(ORDER, a.meta.slug) - rank(ORDER, b.meta.slug));
const PT_ORDER = ['orm-typescript', 'migracoes-banco-de-dados', 'evitar-consultas-n-mais-1', 'nextjs-postgres-orm', 'migrar-do-prisma', 'migrar-do-laravel-eloquent'];
guidesPt.sort((a, b) => rank(PT_ORDER, a.meta.slug) - rank(PT_ORDER, b.meta.slug));
const guides = [...guidesEn, ...guidesPt];

// ---------- Assets and static files ----------

const written = writeAssets(root);
mkdirSync(join(docs, 'assets'), { recursive: true });
for (const f of readdirSync(join(siteDir, 'static'))) cpSync(join(siteDir, 'static', f), join(docs, f.startsWith('pg-') ? `assets/${f}` : f));
cpSync(join(siteDir, 'playground', 'presets.mjs'), join(docs, 'assets', 'pg-presets.js'));

// Dialect features for the matrix come from the real dialects when the bundle step can load them.
let features = {};
if (!args.has('--no-bundle')) {
  const result = await bundlePlayground(root);
  features = result.features || {};
  if (result.error) console.warn(`playground bundle skipped: ${result.error}`);
}

// ---------- Pages ----------

const out = {};
const alternatesFor = (meta) => {
  if (!meta.alt) return [];
  const other = guides.find((g) => g.meta.lang !== meta.lang && g.meta.slug === meta.alt);
  const pairs = [[meta.lang, guideUrl(meta)], [other.meta.lang, guideUrl(other.meta)]];
  const en = pairs.find(([l]) => l === 'en');
  return [...pairs, ['x-default', en[1]]];
};

codeId = 0;
out['index.html'] = page(
  {
    kind: 'home',
    path: '',
    title: 'kastor: the TypeScript ORM for almost every database',
    description: 'TypeScript ORM with types inferred from a plain TypeScript schema, no codegen. PostgreSQL, MySQL, SQLite, SQL Server, Oracle, MongoDB and more.',
    jsonld: homeJsonLd(guides),
  },
  homeBody({ frame, guides, features }),
  guides,
);

codeId = 0;
out['frameworks.html'] = page(
  {
    kind: 'doc',
    path: 'frameworks.html',
    nav: 'frameworks',
    title: 'kastor with Next.js, Nuxt, SvelteKit, NestJS, Hono and more | kastor',
    description: 'Set up the kastor TypeScript ORM in Next.js, Nuxt, SvelteKit, Remix, Astro, NestJS, Express, Fastify, Hono, AdonisJS, Bun, Deno, Workers, Electron and Lambda.',
    jsonld: {
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      headline: 'kastor in your framework',
      url: `${SITE}frameworks.html`,
      dateModified: UPDATED,
      author: { '@type': 'Person', name: 'Alexandre Kohler', url: 'https://github.com/kwy404' },
      about: FRAMEWORKS.map((f) => f.name),
    },
  },
  frameworksBody(frame),
  guides,
);

codeId = 0;
out['api.html'] = page(
  {
    kind: 'doc',
    path: 'api.html',
    nav: 'api',
    title: 'API reference: client, schema, queries and CLI | kastor',
    description: 'The kastor API: kastor(), table(), column types and modifiers, relations, findMany and every query method, filters, transactions, raw SQL, errors and the CLI.',
    jsonld: { '@context': 'https://schema.org', '@type': 'TechArticle', headline: 'kastor API reference', url: `${SITE}api.html`, dateModified: UPDATED, author: { '@type': 'Person', name: 'Alexandre Kohler', url: 'https://github.com/kwy404' } },
  },
  apiBody(API, frame),
  guides,
);

codeId = 0;
out['migrate-to-kastor.html'] = page(
  {
    kind: 'hub',
    path: 'migrate-to-kastor.html',
    nav: 'migrate',
    title: 'Migrate to kastor from Prisma, Drizzle, TypeORM and more | kastor',
    description: 'Move to the kastor TypeScript ORM from Prisma, Drizzle, TypeORM, Sequelize, Knex, Mongoose, Laravel, Django or Rails without losing data or migration history.',
    jsonld: migrateHubJsonLd(guides),
  },
  migrateHubBody(guides, frame),
  guides,
);

out['guides.html'] = page(
  { kind: 'hub', path: 'guides.html', nav: 'guides', title: 'Guides: TypeScript ORM, migrations, N+1 and more | kastor', description: 'Long form guides on TypeScript ORMs, database migrations, avoiding N+1 queries, type safe SQL, Next.js with Postgres, D1, Turso, SQL Server, Oracle and MongoDB.', jsonld: hubJsonLd(guides, 'en'), alternates: [['en', 'guides.html'], ['pt-BR', 'pt-br/'], ['x-default', 'guides.html']] },
  hubBody(guides, 'en'),
  guides,
);
out['pt-br/index.html'] = page(
  { kind: 'hub', path: 'pt-br/', depth: 1, lang: 'pt-BR', nav: 'guides', title: 'Guias do kastor em português: ORM, migrações e N+1', description: 'Guias em português sobre ORM para TypeScript, migrações de banco de dados, como evitar consultas N+1 e Next.js com PostgreSQL usando o kastor.', jsonld: hubJsonLd(guides, 'pt-BR'), alternates: [['en', 'guides.html'], ['pt-BR', 'pt-br/'], ['x-default', 'guides.html']] },
  hubBody(guides, 'pt-BR'),
  guides,
);

for (const lang of ['en', 'pt-BR']) {
  const list = guides.filter((g) => g.meta.lang === lang);
  list.forEach((g, i) => {
    codeId = 0;
    const pt = lang === 'pt-BR';
    out[guideUrl(g.meta)] = page(
      {
        kind: 'guide',
        path: guideUrl(g.meta),
        depth: pt ? 1 : 0,
        lang,
        nav: g.meta.section === 'migrate' && !pt ? 'migrate' : g.meta.section === 'frameworks' ? 'frameworks' : 'guides',
        ogType: 'article',
        ogImage: `og/${pt ? 'pt-br-' : ''}${g.meta.slug}.png`,
        ogAlt: g.meta.h1,
        title: g.meta.title,
        description: g.meta.description,
        jsonld: guideJsonLd(g.meta),
        alternates: alternatesFor(g.meta),
      },
      guideBody({ ...g, body: renderBlocks(g.body) }, guides, i),
      guides,
    );
  });
}

out['404.html'] = page({ kind: 'nf', path: '404.html', root: '/kastor/', noindex: true, title: 'Page not found | kastor', description: 'This page is not in the kastor drawing set. Go back to the home page, the guides or the API reference of the TypeScript ORM.' }, notFoundBody(), guides);

// ---------- Search index, sitemap, robots ----------

const search = [
  { kind: 'Page', title: 'Live playground', sub: 'Schema, query, inferred type and SQL for every database', url: '#playground', home: true },
  { kind: 'Page', title: 'Database support matrix', sub: 'Adapters, drivers, includes, upsert and paging per database', url: '#databases', home: true },
  { kind: 'Page', title: 'Feature tour', sub: 'Schema, types, queries, includes, migrations, errors', url: '#features', home: true },
  { kind: 'Page', title: 'Studio', sub: 'Browse and edit data, ER diagram', url: '#studio', home: true },
  { kind: 'Page', title: 'Get started in 60 seconds', sub: 'Install, client and first query per database', url: '#start', home: true },
  { kind: 'Page', title: 'Framework guides', sub: FRAMEWORKS.map((f) => f.name).join(', '), url: 'frameworks.html' },
  { kind: 'Page', title: 'API reference', sub: 'Client, schema, queries, filters, errors, CLI', url: 'api.html' },
  { kind: 'Page', title: 'Migrate to kastor', sub: 'From Prisma, Drizzle, TypeORM, Sequelize, Knex, Mongoose, Laravel, Django and Rails', url: 'migrate-to-kastor.html' },
  { kind: 'Page', title: 'FAQ', sub: FAQ.map((f) => f.q).join(' '), url: '#faq', home: true },
  ...FRAMEWORKS.map((f) => ({ kind: 'Framework', title: f.name, sub: f.tag, url: `frameworks.html#${f.id}` })),
  ...API.flatMap((s) => s.items.map((it) => ({ kind: 'API', title: it.name, sub: s.title, url: `api.html#${it.id}` }))),
  ...guides.map((g) => ({ kind: g.meta.lang === 'en' ? 'Guide' : 'Guia', title: g.meta.h1, sub: g.meta.description, url: guideUrl(g.meta) })),
];
out['search.json'] = JSON.stringify(search.map((s) => ({ ...s, url: s.home ? `./${s.url}` : s.url })));

const urls = [
  ['', 'weekly', '1.0'],
  ['frameworks.html', 'monthly', '0.9'],
  ['api.html', 'monthly', '0.9'],
  ['migrate-to-kastor.html', 'monthly', '0.9'],
  ['guides.html', 'monthly', '0.8', [['en', 'guides.html'], ['pt-BR', 'pt-br/'], ['x-default', 'guides.html']]],
  ['pt-br/', 'monthly', '0.7', [['en', 'guides.html'], ['pt-BR', 'pt-br/'], ['x-default', 'guides.html']]],
  ...guides.map((g) => [guideUrl(g.meta), 'monthly', g.meta.lang === 'en' ? '0.8' : '0.7', alternatesFor(g.meta)]),
];
out['sitemap.xml'] = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls
  .map(([u, freq, prio, alts]) => {
    const links = (alts || []).map(([l, p]) => `\n    <xhtml:link rel="alternate" hreflang="${l}" href="${SITE}${p}"/>`).join('');
    return `  <url>\n    <loc>${SITE}${u}</loc>\n    <lastmod>${UPDATED}</lastmod>\n    <changefreq>${freq}</changefreq>\n    <priority>${prio}</priority>${links}\n  </url>`;
  })
  .join('\n')}
</urlset>
`;
out['robots.txt'] = `User-agent: *\nAllow: /\nDisallow: /404.html\n\nSitemap: ${SITE}sitemap.xml\n`;
out['.nojekyll'] = '';

for (const [rel, text] of Object.entries(out)) {
  const file = join(docs, rel);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, text);
}
console.log(`site: ${Object.keys(out).length} files, ${guides.length} guides (${guidesEn.length} en, ${guidesPt.length} pt-BR), ${written.length} art files`);

if (args.has('--images')) {
  const { renderImages } = await import('./site/render-images.mjs');
  const results = await renderImages(root, guides);
  if (results.some(([, ok]) => !ok)) process.exitCode = 1;
}

// Leftovers from older builds: OG images of guides that no longer exist.
if (existsSync(join(docs, 'og'))) {
  const keep = new Set(guides.map((g) => `${g.meta.lang === 'pt-BR' ? 'pt-br-' : ''}${g.meta.slug}.png`));
  for (const f of readdirSync(join(docs, 'og'))) if (!keep.has(f)) rmSync(join(docs, 'og', f));
}
