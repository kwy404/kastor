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
  ${crumbs([[t.home, pt ? '../' : './'], [t.guides, t.hubHref], [esc(meta.crumb), '']])}
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
        <div><h2>${t.cta}</h2><p>${t.ctaText}</p><a href="${up}#playground" class="btn btn-primary">${ui('play')}${t.open}</a></div>
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
          { '@type': 'ListItem', position: 2, name: pt ? 'Guias' : 'Guides', item: pt ? `${SITE}pt-br/` : `${SITE}guides.html` },
          { '@type': 'ListItem', position: 3, name: meta.crumb, item: url },
        ],
      },
    ],
  };
}

/** The guides hub: English (guides.html) or Portuguese (pt-br/index.html). */
export function hubBody(guides, lang) {
  const t = T[lang];
  const pt = lang === 'pt-BR';
  const list = guides.filter((g) => g.meta.lang === lang);
  const cards = list
    .map(
      (g, i) => `<a href="${g.meta.slug}.html" class="g-card" v-show="hubMatch(${i}, q)"><span class="g-no">${t.guide} ${String(i + 1).padStart(2, '0')}</span><strong>${esc(g.meta.h1)}</strong><span>${esc(g.meta.description)}</span><span class="g-meta">${esc(g.meta.readTime)}${ui('arrow')}</span></a>`,
    )
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
  <div class="g-grid">
${cards}
  </div>
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

/** The framework guides page. */
export function frameworksBody(frame) {
  const nav = FRAMEWORKS.map((f) => `<li><a href="#${f.id}">${esc(f.name)}</a></li>`).join('');
  const secs = FRAMEWORKS.map((f, i) => {
    const files = f.files.map(([title, lang, code]) => frame(code, { lang, title, kind: lang === 'bash' ? 'terminal' : 'editor' })).join('');
    const more = f.guide ? `<p><a href="${f.guide}" class="more-link">Read the full guide${ui('arrow')}</a></p>` : '';
    return `<section id="${f.id}" class="chapter fw-sec"><p class="sheet-label"><span class="sheet-no">FW ${String(i + 1).padStart(2, '0')}</span><span>${esc(f.tag)}</span></p><h2><a href="#${f.id}" class="anchor" aria-hidden="true" tabindex="-1">#</a>${esc(f.name)}</h2><p>${esc(f.intro)}</p>${files}${more}</section>`;
  }).join('\n');
  return `<div class="wrap">
  ${crumbs([['kastor', './'], ['Frameworks', '']])}
  <header class="page-head">
    <p class="sheet-label"><span class="sheet-no">SHEET 07</span><span>Framework guides</span></p>
    <h1>kastor in your framework</h1>
    <p class="lead">Ten short, complete setups. Each one creates a single client from the driver you choose and shows one read and one write the way that framework likes them. The schema is the one from the playground in <code>src/db/schema.ts</code>; the Postgres client module is in <a href="./#start">Get started</a>.</p>
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
