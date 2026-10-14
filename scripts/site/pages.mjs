// Guide pages, the guide hubs (English and Portuguese), the framework guides,
// the API reference and the 404 page.
import { DATABASES } from './art/icons.mjs';
import { FRAMEWORKS } from './content/frameworks.mjs';
import { AUTHOR_GH, AUTHOR_IN, SITE, UPDATED, esc, icon, ui } from './layout.mjs';

const UPDATED_LABEL = { en: 'October 13, 2026', 'pt-BR': '13 de outubro de 2026' };
const T = {
  en: { home: 'kastor', guides: 'Guides', by: 'By', updated: 'Updated', toc: 'On this sheet', faq: 'Questions people ask', related: 'Related guides', cta: 'Try it in the playground', ctaText: 'Edit a schema and a query and see the inferred type and the SQL for every database, in your browser.', open: 'Open the playground', guide: 'GUIDE', hubHref: 'guides.html', other: 'Leia em portugu&ecirc;s' },
  'pt-BR': { home: 'kastor', guides: 'Guias', by: 'Por', updated: 'Atualizado em', toc: 'Nesta folha', faq: 'Perguntas frequentes', related: 'Guias relacionados', cta: 'Teste no playground', ctaText: 'Edite um schema e uma consulta e veja o tipo inferido e o SQL de cada banco, direto no navegador.', open: 'Abrir o playground', guide: 'GUIA', hubHref: './', other: 'Read in English' },
};

export function crumbs(items) {
  const lis = items
    .map(([label, href], i) => (i === items.length - 1 ? `<li><span aria-current="page">${label}</span></li>` : `<li><a href="${href}">${label}</a></li>`))
    .join('');
  return `<nav class="crumbs" aria-label="Breadcrumb"><ol class="breadcrumbs">${lis}</ol></nav>`;
}

/** The middle breadcrumb of a guide: its section hub. */
export function sectionOf(meta) {
  if (meta.lang === 'en' && meta.section === 'migrate') return { name: 'Migrate to kastor', href: 'migrate-to-kastor.html' };
  if (meta.lang === 'en' && meta.section === 'frameworks') return { name: 'Frameworks', href: 'frameworks.html' };
  return meta.lang === 'pt-BR' ? { name: 'Guias', href: 'pt-br/' } : { name: 'Guides', href: 'guides.html' };
}

export function guideUrl(meta) {
  return meta.lang === 'pt-BR' ? `pt-br/${meta.slug}.html` : `${meta.slug}.html`;
}

/** Renders one guide. */
export function guideBody(guide, all, index) {
  const { meta } = guide;
  const t = T[meta.lang];
  const pt = meta.lang === 'pt-BR';
  const up = pt ? '../' : '';
  const sections = [...guide.body.matchAll(/<section id="([^"]+)"><h2>([\s\S]*?)<\/h2>/g)].map((m) => [m[1], m[2]]);
  let body = guide.body.replace(/<section id="([^"]+)"><h2>([\s\S]*?)<\/h2>/g, (_, id, h) => `<section id="${id}" class="chapter"><h2><a href="#${id}" class="anchor" aria-hidden="true" tabindex="-1">#</a>${h}</h2>`);
  body = body.replace(/<div class="callout"><p>([\s\S]*?)<\/p><\/div>/g, `<div class="note-box"><p class="note-title">${ui('info')}${pt ? 'Nota do engenheiro' : 'Site engineer note'}</p><p>$1</p></div>`);
  // Links to sections of the home page written as bare anchors (body, lead and FAQ).
  const homeLinks = (html) => html.replace(/href="#(playground|databases|features|studio|start|compare)"/g, `href="${pt ? '../' : './'}#$1"`);
  body = homeLinks(body);
  meta.lead = homeLinks(meta.lead);
  for (const f of meta.faq) f.a = homeLinks(f.a);
  body = body.replace(/<table class="spec">/g, '<div class="k-table" tabindex="0" role="region" aria-label="Table"><table class="spec">').replace(/<\/table>/g, '</table></div>');
  const toc = [...sections, ['faq', t.faq], ['related', t.related]].map(([id, h], i) => `<li><a href="#${id}"><span>${String(i + 1).padStart(2, '0')}</span>${h.replace(/<[^>]+>/g, '')}</a></li>`).join('');
  const faq = meta.faq
    .map((f, i) => `<details class="collapse q"${i === 0 ? ' open' : ''}><summary class="collapse-title"><span class="q-no">Q${i + 1}</span>${f.q}</summary><div class="collapse-content"><p>${f.a}</p></div></details>`)
    .join('');
  const related = meta.related
    .map((slug) => {
      const r = all.find((x) => x.meta.slug === slug && x.meta.lang === meta.lang);
      if (!r) throw new Error(`${meta.slug}: related guide ${slug} not found`);
      return `<a href="${slug}.html" class="g-card"><span class="g-no">${t.guide}</span><strong>${esc(r.meta.h1)}</strong><span>${esc(r.meta.description)}</span><span class="g-meta">${esc(r.meta.readTime)}${ui('arrow')}</span></a>`;
    })
    .join('');
  const alt = meta.alt ? all.find((x) => x.meta.slug === meta.alt && x.meta.lang !== meta.lang) : null;
  const altLink = alt ? `<a class="lang-switch" href="${pt ? '../' : 'pt-br/'}${alt.meta.slug}.html" hreflang="${alt.meta.lang}">${ui('globe')}${t.other}</a>` : '';
  const no = String(index + 1).padStart(2, '0');
  return `<div class="read-progress" aria-hidden="true"></div>
<div class="wrap">
  ${crumbs([[t.home, pt ? '../' : './'], [sectionOf(meta).name, pt ? t.hubHref : sectionOf(meta).href], [esc(meta.crumb), '']])}
  <header class="g-cover drawing">
    <span class="corner c1"></span><span class="corner c2"></span><span class="corner c3"></span><span class="corner c4"></span>
    <div class="g-cover-text">
      <p class="sheet-label"><span class="sheet-no">${t.guide} ${no}</span><span>${esc(meta.crumb)}</span></p>
      <h1>${esc(meta.h1)}</h1>
      <p class="lead">${meta.lead}</p>
      <p class="g-byline"><span>${t.by} <a href="${AUTHOR_GH}" rel="author">Alexandre Kohler</a></span><span>${t.updated} <time datetime="${UPDATED}">${UPDATED_LABEL[meta.lang]}</time></span><span>${esc(meta.readTime)}</span>${altLink}</p>
    </div>
    <div class="g-cover-art" aria-hidden="true"><img src="${up}assets/mascot-head.svg" class="brand-light" width="150" height="150" alt=""><img src="${up}assets/mascot-head-dark.svg" class="brand-dark" width="150" height="150" alt=""></div>
  </header>
  <div class="read">
    <aside class="read-toc" aria-labelledby="toc-title"><div class="toc-box"><p class="k-toc-title" id="toc-title">${t.toc}</p><ol>${toc}</ol></div></aside>
    <article class="read-main k-prose">
${body}
      <section id="faq" class="chapter"><h2><a href="#faq" class="anchor" aria-hidden="true" tabindex="-1">#</a>${t.faq}</h2><div class="accordion collapse-plus">${faq}</div></section>
      <aside class="guide-cta drawing" aria-label="${t.cta}">
        <img src="${up}assets/mascot.svg" class="brand-light" width="110" height="110" alt="" loading="lazy"><img src="${up}assets/mascot-dark.svg" class="brand-dark" width="110" height="110" alt="" loading="lazy">
        <div><h2>${t.cta}</h2><p>${t.ctaText}</p><a href="${up || './'}#playground" class="btn btn-primary">${ui('play')}${t.open}</a></div>
      </aside>
      <section id="related" class="chapter"><h2><a href="#related" class="anchor" aria-hidden="true" tabindex="-1">#</a>${t.related}</h2><div class="g-grid g-grid-3">${related}</div></section>
    </article>
  </div>
</div>`;
}

/** JSON-LD for a guide: TechArticle, FAQPage and BreadcrumbList. */
export function guideJsonLd(meta) {
  const pt = meta.lang === 'pt-BR';
  const url = SITE + guideUrl(meta);
  const author = { '@type': 'Person', name: 'Alexandre Kohler', url: AUTHOR_GH, sameAs: [AUTHOR_GH, AUTHOR_IN] };
  const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'TechArticle',
        '@id': `${url}#article`,
        headline: meta.h1,
        description: meta.description,
        inLanguage: meta.lang,
        url,
        mainEntityOfPage: url,
        image: `${SITE}og/${pt ? 'pt-br-' : ''}${meta.slug}.png`,
        datePublished: UPDATED,
        dateModified: UPDATED,
        author,
        publisher: author,
        keywords: meta.keywords.join(', '),
        proficiencyLevel: 'Beginner',
        about: { '@type': 'SoftwareApplication', name: 'kastor', applicationCategory: 'DeveloperApplication', url: SITE },
      },
      {
        '@type': 'FAQPage',
        mainEntity: meta.faq.map((f) => ({ '@type': 'Question', name: strip(f.q), acceptedAnswer: { '@type': 'Answer', text: strip(f.a) } })),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'kastor', item: SITE },
          { '@type': 'ListItem', position: 2, name: sectionOf(meta).name, item: SITE + sectionOf(meta).href },
          { '@type': 'ListItem', position: 3, name: meta.crumb, item: url },
        ],
      },
      ...(meta.howto ? [howToLd(meta, url, strip)] : []),
    ],
  };
}

/** HowTo structured data from meta.howto: the numbered steps of the guide. */
function howToLd(meta, url, strip) {
  const h = meta.howto;
  return {
    '@type': 'HowTo',
    '@id': `${url}#howto`,
    name: h.name,
    description: strip(meta.description),
    inLanguage: meta.lang,
    image: `${SITE}og/${meta.lang === 'pt-BR' ? 'pt-br-' : ''}${meta.slug}.png`,
    ...(h.totalTime ? { totalTime: h.totalTime } : {}),
    ...(h.tools ? { tool: h.tools.map((name) => ({ '@type': 'HowToTool', name })) } : {}),
    step: h.steps.map((st, i) => ({ '@type': 'HowToStep', position: i + 1, name: strip(st.name), text: strip(st.text), url: `${url}#${st.anchor}` })),
  };
}

/** The guides hub: English (guides.html) or Portuguese (pt-br/index.html). */
export function hubBody(guides, lang) {
  const t = T[lang];
  const pt = lang === 'pt-BR';
  const list = guides.filter((g) => g.meta.lang === lang);
  const card = (g, i) => `<a href="${g.meta.slug}.html" class="g-card" v-show="hubMatch(${i}, q)"><span class="g-no">${t.guide} ${String(i + 1).padStart(2, '0')}</span><strong>${esc(g.meta.h1)}</strong><span>${esc(g.meta.description)}</span><span class="g-meta">${esc(g.meta.readTime)}${ui('arrow')}</span></a>`;
  const indexed = list.map((g, i) => [g, i]);
  // English cards are grouped by section; the index stays global for the search.
  const groups = pt
    ? [['', '', indexed]]
    : [
        ['Field notes', 'field-notes', indexed.filter(([g]) => !g.meta.section)],
        ['Migrate to kastor', 'migrate', indexed.filter(([g]) => g.meta.section === 'migrate')],
        ['Framework guides', 'frameworks', indexed.filter(([g]) => g.meta.section === 'frameworks')],
      ];
  const cards = groups
    .filter(([, , items]) => items.length)
    .map(([title, id, items]) => `${title ? `<h2 class="hub-group" id="${id}">${title}</h2>` : ''}<div class="g-grid">\n${items.map(([g, i]) => card(g, i)).join('\n')}\n  </div>`)
    .join('\n');
  const otherLang = pt
    ? `<p class="hub-alt">${ui('globe')}<a href="../guides.html" hreflang="en">All guides in English</a></p>`
    : `<p class="hub-alt">${ui('globe')}<a href="pt-br/" hreflang="pt-BR">Guias em portugu&ecirc;s</a></p>`;
  return `<section class="hub-hero">
  <div class="wrap hub-in">
    <div>
      ${crumbs([['kastor', pt ? '../' : './'], [t.guides, '']])}
      <p class="sheet-label"><span class="sheet-no">${pt ? 'ÍNDICE' : 'INDEX'}</span><span>${pt ? 'Folhas de campo' : 'Field notes'}</span></p>
      <h1>${pt ? 'Guias do kastor em português' : 'kastor guides'}</h1>
      <p class="lead">${pt ? 'Artigos longos sobre ORM em TypeScript, migrações, N+1 e Next.js com PostgreSQL, escritos para quem fala português.' : 'Long reads on TypeScript ORMs, migrations, N+1 queries, type safe SQL and running one data layer on every database.'}</p>
      ${otherLang}
    </div>
    <img src="${pt ? '../' : ''}assets/mascot.svg" class="brand-light hub-kas" width="220" height="220" alt=""><img src="${pt ? '../' : ''}assets/mascot-dark.svg" class="brand-dark hub-kas" width="220" height="220" alt="">
  </div>
</section>
<div class="wrap hub" v-data="{ q: '' }">
  <script type="application/json" id="hub-data">${JSON.stringify(list.map((g) => `${g.meta.h1} ${g.meta.description} ${g.meta.keywords.join(' ')}`.toLowerCase()))}</script>
  <label class="hub-search">${ui('search')}<input type="search" v-model="q" placeholder="${pt ? 'Buscar nos guias' : 'Search the guides'}" aria-label="${pt ? 'Buscar nos guias' : 'Search the guides'}"></label>
  ${cards}
</div>`;
}

export function hubJsonLd(guides, lang) {
  const pt = lang === 'pt-BR';
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        name: pt ? 'Guias do kastor' : 'kastor guides',
        url: pt ? `${SITE}pt-br/` : `${SITE}guides.html`,
        inLanguage: lang,
        hasPart: guides.filter((g) => g.meta.lang === lang).map((g) => ({ '@type': 'TechArticle', headline: g.meta.h1, url: SITE + guideUrl(g.meta) })),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'kastor', item: SITE },
          { '@type': 'ListItem', position: 2, name: pt ? 'Guias' : 'Guides', item: pt ? `${SITE}pt-br/` : `${SITE}guides.html` },
        ],
      },
    ],
  };
}

/** Where each migration guide starts: the source, the first command and what happens to history. */
const MIGRATE_ROWS = {
  'migrate-from-prisma': ['Prisma', 'npx kastor import prisma', 'Kept: migrate baseline --from-prisma'],
  'migrate-from-drizzle': ['Drizzle ORM', 'npx kastor db pull', 'Baseline, then kastor owns new migrations'],
  'migrate-from-typeorm': ['TypeORM', 'npx kastor db pull', 'Baseline, then kastor owns new migrations'],
  'migrate-from-sequelize': ['Sequelize', 'npx kastor db pull', 'Baseline, then kastor owns new migrations'],
  'migrate-from-knex': ['Knex', 'npx kastor db pull', 'Baseline, then kastor owns new migrations'],
  'migrate-from-mongoose': ['Mongoose', 'npx kastor db pull', 'Validators and indexes from the schema'],
  'migrate-from-laravel-eloquent': ['Laravel Eloquent (PHP)', 'npx kastor db pull', 'Baseline, PHP and TypeScript share the database'],
  'migrate-from-django-orm': ['Django ORM (Python)', 'npx kastor db pull', 'Baseline, Django keeps or hands over migrations'],
  'migrate-from-rails-active-record': ['Rails Active Record (Ruby)', 'npx kastor db pull', 'Baseline, Rails keeps or hands over migrations'],
};

/** The "Migrate to kastor" hub. */
export function migrateHubBody(guides, frame) {
  const list = guides.filter((g) => g.meta.lang === 'en' && g.meta.section === 'migrate');
  const card = (g) => `<a href="${g.meta.slug}.html" class="g-card"><span class="g-no">FROM ${esc(MIGRATE_ROWS[g.meta.slug]?.[0].replace(/ \(.*\)$/, '').toUpperCase() ?? '')}</span><strong>${esc(g.meta.h1)}</strong><span>${esc(g.meta.description)}</span><span class="g-meta">${esc(g.meta.readTime)}${ui('arrow')}</span></a>`;
  const js = list.filter((g) => !/laravel|django|rails/.test(g.meta.slug));
  const other = list.filter((g) => /laravel|django|rails/.test(g.meta.slug));
  const rows = list
    .map((g) => {
      const [from, cmd, history] = MIGRATE_ROWS[g.meta.slug] || [g.meta.crumb, '', ''];
      return `<tr><th scope="row"><a href="${g.meta.slug}.html">${esc(from)}</a></th><td><code>${esc(cmd)}</code></td><td>${esc(history)}</td></tr>`;
    })
    .join('');
  const pt = guides.filter((g) => g.meta.lang === 'pt-BR' && g.meta.section === 'migrate');
  const ptLinks = pt.map((g) => `<a href="pt-br/${g.meta.slug}.html" hreflang="pt-BR">${esc(g.meta.h1)}</a>`).join(' and ');
  return `<section class="hub-hero">
  <div class="wrap hub-in">
    <div>
      ${crumbs([['kastor', './'], ['Migrate to kastor', '']])}
      <p class="sheet-label"><span class="sheet-no">CHANGE ORDER</span><span>Migrate to kastor</span></p>
      <h1>Migrate to kastor from Prisma and other ORMs</h1>
      <p class="lead">Your database and your data stay where they are. You swap the layer on top: a TypeScript schema instead of a model file, a typed client instead of the old one, and kastor migrations that start from what is already deployed.</p>
      ${ptLinks ? `<p class="hub-alt">${ui('globe')}<span>Em portugu&ecirc;s: ${ptLinks}</span></p>` : ''}
    </div>
    <img src="assets/mascot.svg" class="brand-light hub-kas" width="220" height="220" alt=""><img src="assets/mascot-dark.svg" class="brand-dark hub-kas" width="220" height="220" alt="">
  </div>
</section>
<div class="wrap hub">
  <h2 class="hub-group">Three commands do the heavy lifting</h2>
  <ol class="k-steps">
    <li><span class="step-no">1</span><div><h3>Get a TypeScript schema</h3><p>From Prisma, convert the model file directly with the first command. From any other ORM or language, use the second: it reads the live database, with tables, columns, indexes, foreign keys and the relations between them.</p>${frame('npx kastor import prisma --schema prisma/schema.prisma --out src/db/schema.ts\nnpx kastor db pull --out src/db/schema.ts', { kind: 'terminal', lang: 'bash', title: 'Terminal', compact: true })}</div></li>
    <li><span class="step-no">2</span><div><h3>Adopt the database as it is</h3><p>A baseline records the current schema as the first kastor migration and marks it applied, so nothing is created twice and no data moves. Prisma projects use the second form, which also keeps every migration Prisma already applied as history.</p>${frame('npx kastor migrate baseline --name init\nnpx kastor migrate baseline --from-prisma prisma/migrations', { kind: 'terminal', lang: 'bash', title: 'Terminal', compact: true })}</div></li>
    <li><span class="step-no">3</span><div><h3>Move queries, then let kastor own migrations</h3><p>Rewrite one module at a time while both clients share the database. When the old ORM has no importers left, new schema changes go through kastor, and CI runs <code>migrate deploy</code>.</p>${frame('npx kastor migrate status\nnpx kastor migrate dev --name add_slug_to_posts\nnpx kastor migrate deploy', { kind: 'terminal', lang: 'bash', title: 'Terminal', compact: true })}</div></li>
  </ol>
  <div class="k-prose">
  <h2 class="hub-group">From another TypeScript or JavaScript ORM</h2>
  <div class="g-grid">${js.map(card).join('')}</div>
  <h2 class="hub-group">From PHP, Python or Ruby</h2>
  <p>kastor runs in JavaScript runtimes: Node.js, Bun, Deno, Cloudflare Workers and other edge platforms. It does not run inside PHP, Python or Ruby. These guides cover the two honest paths: moving a service to TypeScript, or running a TypeScript API next to the existing app on the same database.</p>
  <div class="g-grid">${other.map(card).join('')}</div>
  <h2 class="hub-group">Where each guide starts</h2>
  <div class="k-table" tabindex="0" role="region" aria-label="Migration starting points"><table class="spec"><thead><tr><th scope="col">Coming from</th><th scope="col">First command</th><th scope="col">Migration history</th></tr></thead><tbody>${rows}</tbody></table></div>
  <h2 class="hub-group">Then wire it into your framework</h2>
  <p>Every framework guide shows the project structure, one client reused across hot reloads and serverless invocations, the environment variables and how migrations run in CI. Start from the <a href="frameworks.html">framework overview</a> or the <a href="guides.html#frameworks">list of framework guides</a>.</p>
  </div>
</div>`;
}

export function migrateHubJsonLd(guides) {
  const list = guides.filter((g) => g.meta.lang === 'en' && g.meta.section === 'migrate');
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        name: 'Migrate to kastor',
        url: `${SITE}migrate-to-kastor.html`,
        inLanguage: 'en',
        hasPart: list.map((g) => ({ '@type': 'TechArticle', headline: g.meta.h1, url: SITE + guideUrl(g.meta) })),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'kastor', item: SITE },
          { '@type': 'ListItem', position: 2, name: 'Migrate to kastor', item: `${SITE}migrate-to-kastor.html` },
        ],
      },
    ],
  };
}

/** The framework guides page. */
export function frameworksBody(frame) {
  const nav = FRAMEWORKS.map((f) => `<li><a href="#${f.id}">${esc(f.name)}</a></li>`).join('');
  const secs = FRAMEWORKS.map((f, i) => {
    const files = f.files.map(([title, lang, code]) => frame(code, { lang, title, kind: lang === 'bash' ? 'terminal' : 'editor' })).join('');
    const more = (f.guides || [])
      .map(([href, label]) => `<p><a href="${href}" class="more-link">${esc(label)}${ui('arrow')}</a></p>`)
      .join('');
    return `<section id="${f.id}" class="chapter fw-sec"><p class="sheet-label"><span class="sheet-no">FW ${String(i + 1).padStart(2, '0')}</span><span>${esc(f.tag)}</span></p><h2><a href="#${f.id}" class="anchor" aria-hidden="true" tabindex="-1">#</a>${esc(f.name)}</h2><p>${esc(f.intro)}</p>${files}${more}</section>`;
  }).join('\n');
  return `<div class="wrap">
  ${crumbs([['kastor', './'], ['Frameworks', '']])}
  <header class="page-head">
    <p class="sheet-label"><span class="sheet-no">SHEET 07</span><span>Framework guides</span></p>
    <h1>kastor in your framework</h1>
    <p class="lead">${FRAMEWORKS.length} short, complete setups, each with a full guide for project structure, connection reuse, environment variables and migrations on deploy. Each one creates a single client from the driver you choose and shows one read and one write the way that framework likes them. The schema is the one from the playground in <code>src/db/schema.ts</code>; the Postgres client module is in <a href="./#start">Get started</a>.</p>
  </header>
  <div class="read">
    <aside class="read-toc" aria-label="Frameworks"><div class="toc-box"><p class="k-toc-title">Frameworks</p><ol>${nav}</ol></div></aside>
    <article class="read-main k-prose">${secs}</article>
  </div>
</div>`;
}

/** The API reference, from content/api.mjs. */
export function apiBody(api, frame) {
  const nav = api.map((s) => `<li><a href="#${s.id}">${esc(s.title)}</a></li>`).join('');
  const secs = api
    .map((s) => {
      const items = s.items
        .map((it) => {
          const code = it.code ? frame(it.code, { lang: it.lang || 'ts', title: it.file || 'example.ts', kind: it.lang === 'bash' ? 'terminal' : 'editor', compact: true }) : '';
          const table = it.table ? `<div class="k-table" tabindex="0" role="region" aria-label="${esc(it.name)}"><table class="spec"><thead><tr>${it.table[0].map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${it.table.slice(1).map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '';
          return `<div class="api-item" id="${it.id}"><h3><a href="#${it.id}" class="anchor" aria-hidden="true" tabindex="-1">#</a><code>${esc(it.name)}</code></h3>${it.sig ? `<p class="api-sig"><code>${esc(it.sig)}</code></p>` : ''}<p>${it.text}</p>${table}${code}</div>`;
        })
        .join('');
      return `<section id="${s.id}" class="chapter"><h2><a href="#${s.id}" class="anchor" aria-hidden="true" tabindex="-1">#</a>${esc(s.title)}</h2>${s.intro ? `<p>${s.intro}</p>` : ''}${items}</section>`;
    })
    .join('\n');
  return `<div class="wrap">
  ${crumbs([['kastor', './'], ['API reference', '']])}
  <header class="page-head">
    <p class="sheet-label"><span class="sheet-no">SPEC</span><span>API reference</span></p>
    <h1>kastor API reference</h1>
    <p class="lead">Every public export of <code>kastor</code> and its adapters, the client methods, filters, errors, the config file and the CLI. Types are inferred from your schema, so the examples are all the code you write.</p>
  </header>
  <div class="read">
    <aside class="read-toc" aria-label="Sections"><div class="toc-box"><p class="k-toc-title">Sections</p><ol>${nav}</ol></div></aside>
    <article class="read-main k-prose api">${secs}</article>
  </div>
</div>`;
}

export function notFoundBody() {
  return `<section class="nf">
  <div class="wrap nf-in">
    <div>
      <p class="sheet-label"><span class="sheet-no">ERROR 404</span><span>Sheet not found</span></p>
      <h1>This drawing is not in the set</h1>
      <p class="lead">The page you asked for was never built, or the river carried it off. Kas checked the archive twice.</p>
      <p class="nf-code"><code>KastorError: NOT_FOUND</code><br><span>hint: start from the home page or search the site</span></p>
      <p class="hero-cta"><a href="/kastor/" class="btn btn-primary">Back to the home page</a><a href="/kastor/guides.html" class="btn btn-outline">Browse the guides</a><button type="button" class="btn btn-ghost" data-search-open>${ui('search')}Search</button></p>
    </div>
    <div class="nf-art"><img src="/kastor/assets/mascot.svg" class="brand-light" width="300" height="300" alt="Kas the beaver holding a blueprint"><img src="/kastor/assets/mascot-dark.svg" class="brand-dark" width="300" height="300" alt="Kas the beaver holding a blueprint"><span class="stamp stamp-a">Not found</span></div>
  </div>
</section>`;
}

export { T, DATABASES, icon };
