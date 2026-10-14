// The home page: hero with the river drawing, the live playground, the
// database matrix, the feature tour, the studio, 60 second starts, framework
// cards, a neutral comparison and the FAQ.
import { mascot } from './art/mascot.mjs';
import { DATABASES, dbSymbol } from './art/icons.mjs';
import { riverScene } from './art/scene.mjs';
import { DB_INFO } from './content/databases.mjs';
import { FEATURES } from './content/features.mjs';
import { FRAMEWORKS } from './content/frameworks.mjs';
import { PRESETS } from './playground/presets.mjs';
import { AUTHOR_GH, AUTHOR_IN, GITHUB, NPM, SITE, UPDATED, VERSION, dbIcon, esc, icon, ui } from './layout.mjs';

function sheet(no, label) {
  return `<p class="sheet-label"><span class="sheet-no">SHEET ${String(no).padStart(2, '0')}</span><span>${label}</span></p>`;
}

function secHead(no, label, title, lead, id) {
  return `<header class="sec-head">
  ${sheet(no, label)}
  <h2 id="${id}-title">${title}</h2>
  <div class="dim" aria-hidden="true"><i></i><span>${label.toLowerCase()}</span><i></i></div>
  ${lead ? `<p class="lead">${lead}</p>` : ''}
</header>`;
}

function copyBox(id, cmd, label, extra = '') {
  return `<div class="install${extra}" role="group" aria-label="${label}"><code id="${id}"><span class="install-p" aria-hidden="true">$</span> ${esc(cmd)}</code><button type="button" class="k-copy" v-copy="${esc(cmd)}" aria-label="Copy: ${esc(cmd)}">${ui('copy')}<span>Copy</span></button></div>`;
}

export const FAQ = [
  {
    q: 'What is the best TypeScript ORM for multiple databases?',
    a: 'Pick one that infers types straight from a TypeScript schema and runs the same query API on every database you need. kastor supports PostgreSQL, CockroachDB, MySQL, MariaDB, SQLite (better-sqlite3, node:sqlite, bun:sqlite), libSQL and Turso, Cloudflare D1, SQL Server, Oracle and MongoDB with one schema and one API.',
  },
  {
    q: 'Does kastor need a generate step or a binary engine?',
    a: 'No. Types are inferred from the schema by the TypeScript compiler as you type, and queries are compiled to SQL in plain JavaScript. There is nothing to regenerate in CI and nothing native to download.',
  },
  {
    q: 'How does kastor avoid N+1 queries?',
    a: 'Nested includes load in one statement per root call using JSON aggregation where the database supports it. Where it does not, kastor runs one extra query per include level with an IN list, never one query per row. See <a href="avoid-n-plus-1-queries.html">the N+1 guide</a>.',
  },
  {
    q: 'Can I use kastor with an existing database?',
    a: 'Yes. Run <code>npx kastor db pull</code> to introspect the live database into a TypeScript schema file, relations included, then query it right away. Migrations can take over from there when you are ready.',
  },
  {
    q: 'Which drivers does kastor install?',
    a: 'None. kastor ships no database drivers: you install the one you want (<code>pg</code>, <code>mysql2</code>, <code>better-sqlite3</code>, <code>mssql</code>, <code>oracledb</code>, <code>mongodb</code> and so on) and pass its instance to the adapter. Drivers are optional peer dependencies.',
  },
  {
    q: 'Does kastor work on serverless and edge runtimes?',
    a: 'Yes, wherever the driver works: Cloudflare Workers with D1, Turso over HTTP, Neon, Supabase and Vercel Postgres through pg compatible pools, Bun with bun:sqlite and Deno with npm specifiers. The core has no Node only imports.',
  },
  {
    q: 'Is kastor free?',
    a: 'Yes. kastor is open source under the MIT license, including the CLI, migrations and the studio.',
  },
];

export function homeJsonLd(guides) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        name: 'kastor',
        alternateName: 'kastor ORM',
        description: 'TypeScript ORM for almost every database: schema in plain TypeScript with instant type inference, no generate step, nested includes in one query, automatic migrations and a local studio.',
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Node.js 18+, Bun, Deno, Cloudflare Workers',
        softwareVersion: VERSION,
        license: 'https://opensource.org/licenses/MIT',
        url: SITE,
        downloadUrl: NPM,
        codeRepository: GITHUB,
        programmingLanguage: 'TypeScript',
        image: `${SITE}og.png`,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        author: { '@type': 'Person', name: 'Alexandre Kohler', url: AUTHOR_GH, sameAs: [AUTHOR_GH, AUTHOR_IN] },
        dateModified: UPDATED,
      },
      { '@type': 'WebSite', name: 'kastor', url: SITE, inLanguage: ['en', 'pt-BR'] },
      {
        '@type': 'FAQPage',
        mainEntity: FAQ.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a.replace(/<[^>]+>/g, '') } })),
      },
      {
        '@type': 'ItemList',
        name: 'kastor guides',
        itemListElement: guides
          .filter((g) => g.meta.lang === 'en')
          .map((g, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}${g.meta.slug}.html`, name: g.meta.h1 })),
      },
    ],
  };
}

function hero() {
  return `<section class="k-hero" aria-labelledby="hero-title">
  <div class="wrap hero-in">
    <div class="hero-text">
      ${sheet(1, 'The data layer')}
      <h1 id="hero-title">The TypeScript ORM for <span class="hl">almost every database</span></h1>
      <p class="lead">Write your schema in plain TypeScript and the types are there as you type. No generate step, no binary engine. Nested includes in one query, automatic migrations and a local studio, on ten databases.</p>
      <div class="hero-cta">
        <a href="#playground" class="btn btn-primary btn-lg">${ui('play')}Open the playground</a>
        <a href="#start" class="btn btn-outline btn-lg">Get started in 60 seconds</a>
      </div>
      ${copyBox('install-cmd', 'npm i kastor', 'Install')}
      <ul class="hero-facts" aria-label="At a glance">
        <li>${icon('types')}<span><strong>0</strong> codegen steps</span></li>
        <li>${icon('one-query')}<span><strong>1</strong> query per include tree</span></li>
        <li>${icon('adapters')}<span><strong>10</strong> databases, 0 bundled drivers</span></li>
      </ul>
    </div>
    <div class="hero-art">
      <div class="hero-sheet">
        <span class="corner c1"></span><span class="corner c2"></span><span class="corner c3"></span><span class="corner c4"></span>
        <img src="assets/mascot.svg" class="brand-light kas-hero" width="420" height="420" alt="Kas, the kastor beaver engineer, in a yellow hard hat with a blueprint roll under one arm and a pencil behind the ear">
        <img src="assets/mascot-dark.svg" class="brand-dark kas-hero" width="420" height="420" alt="Kas, the kastor beaver engineer, in a yellow hard hat with a blueprint roll under one arm and a pencil behind the ear">
        <span class="stamp stamp-a">No codegen</span>
        <span class="stamp stamp-b">Type safe</span>
        <p class="sheet-caption"><span>FIG. 1</span>Kas, site engineer. Builds strong structures from rows.</p>
      </div>
    </div>
  </div>
  <div class="river-wrap">${riverScene(
    DATABASES.map((d) => dbSymbol(d, 'var(--db-ink)')),
    `<g>${mascot().replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '').replace(/<title[^>]*>.*?<\/title>/, '')}</g>`,
  )}</div>
</section>`;
}

export function fileBadge(lang) {
  const map = { ts: ['#3178c6', 'TS'], tsx: ['#3178c6', 'TSX'], js: ['#c9a400', 'JS'], sql: ['#d97706', 'SQL'], json: ['#8a6d00', '{}'], bash: ['#3f8f4f', '$_'], toml: ['#9c4221', 'TML'], yaml: ['#cb171e', 'YML'], text: ['#6b7280', '>_'] };
  const [color, label] = map[lang] || map.text;
  const size = label.length > 2 ? 5.2 : 6.4;
  return `<svg class="file-ic" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect width="16" height="16" rx="3" fill="${color}"/><text x="8" y="11" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${size}" font-weight="700" fill="#fff">${esc(label)}</text></svg>`;
}

function playground() {
  const presets = PRESETS.map((p, i) => `<button type="button" class="chip-btn" data-preset="${i}" aria-pressed="${i === 0}">${esc(p.label)}</button>`).join('');
  const dbTabs = DATABASES.map(
    (d, i) => `<button type="button" role="tab" class="db-tab" data-dialect="${d.id}" aria-selected="${i === 0}" id="pg-db-${d.id}">${dbIcon(d.id)}<span>${esc(d.name.replace(' / Turso', ''))}</span></button>`,
  ).join('');
  return `<section id="playground" class="sec sec-playground" aria-labelledby="playground-title">
  <div class="wrap">
    ${secHead(2, 'Live playground', 'Type a schema. Watch the types and the SQL appear.', 'This is the real kastor compiler running in your browser. Edit the schema or the query: the result type is checked by the TypeScript compiler, and the SQL is compiled for every database side by side. Open the Rows tab to run it against SQLite in this page.', 'playground')}
    <div class="pg" data-playground>
      <div class="pg-presets" role="group" aria-label="Examples">${presets}</div>
      <div class="pg-grid">
        <div class="pg-pane pg-edit">
          <div class="pg-bar" role="tablist" aria-label="Files">
            <button type="button" role="tab" class="pg-file" data-file="schema" aria-selected="true" id="pg-f-schema">${fileBadge('ts')}schema.ts</button>
            <button type="button" role="tab" class="pg-file" data-file="query" aria-selected="false" id="pg-f-query">${fileBadge('ts')}query.ts</button>
            <span class="pg-status" data-status aria-live="polite">Loading the compiler</span>
          </div>
          <div class="pg-editors">
            <div class="ed" data-editor="schema"><pre class="ed-hl" aria-hidden="true"><code></code></pre><textarea class="ed-ta" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="schema.ts" wrap="off"></textarea></div>
            <div class="ed" data-editor="query" hidden><pre class="ed-hl" aria-hidden="true"><code></code></pre><textarea class="ed-ta" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="query.ts" wrap="off"></textarea></div>
          </div>
          <div class="pg-diag" data-diag hidden></div>
        </div>
        <div class="pg-pane pg-out">
          <div class="pg-bar" role="tablist" aria-label="Output">
            <button type="button" role="tab" class="pg-otab" data-out="type" aria-selected="true">Result type</button>
            <button type="button" role="tab" class="pg-otab" data-out="sql" aria-selected="false">SQL</button>
            <button type="button" role="tab" class="pg-otab" data-out="migration" aria-selected="false">Migration</button>
            <button type="button" role="tab" class="pg-otab" data-out="rows" aria-selected="false">Rows</button>
          </div>
          <div class="pg-dbs" role="tablist" aria-label="Database" data-dbs hidden>${dbTabs}<label class="pg-all"><input type="checkbox" data-all> Side by side</label></div>
          <div class="pg-body">
            <div data-panel="type"><pre class="out-code" tabindex="0"><code data-type>// The inferred type appears here</code></pre></div>
            <div data-panel="sql" hidden><div class="sql-list" data-sql></div></div>
            <div data-panel="migration" hidden><div class="sql-list" data-migration></div></div>
            <div data-panel="rows" hidden><div data-rows><p class="pg-note">Runs your query against an in-memory SQLite database (sql.js) seeded with sample rows. Loads about 1 MB the first time.</p><button type="button" class="btn btn-primary btn-sm" data-run>${ui('play')}Run on SQLite</button></div></div>
          </div>
          <p class="pg-foot" data-foot>kastor ${VERSION} compiled for the browser from the same source as the npm package.</p>
        </div>
      </div>
      <noscript><p class="pg-note">The playground needs JavaScript. Every guide below shows the same API with highlighted code.</p></noscript>
    </div>
  </div>
</section>`;
}

function matrix(features) {
  const yes = (label) => `<span class="ok" title="${label}">${ui('check')}<span class="sr-only">yes</span></span>`;
  const rows = DATABASES.map((d) => {
    const info = DB_INFO[d.id];
    const f = features[d.id] || {};
    return `<tr>
  <th scope="row"><span class="db-name">${dbIcon(d.id)}<span>${esc(d.name)}</span></span></th>
  <td><code>${esc(d.entry)}</code></td>
  <td><code>${esc(info.driver)}</code></td>
  <td>${f.jsonAggregation === false && d.id !== 'mongodb' ? '<span class="k-tag">IN list per level</span>' : esc(info.includes)}</td>
  <td>${esc(info.returning)}</td>
  <td>${esc(info.upsert)}</td>
  <td>${esc(info.pagination)}</td>
  <td>${d.id === 'd1' ? 'Batch' : yes('Transactions')}</td>
  <td>${yes('Migrations')}</td>
</tr>`;
  }).join('\n');
  return `<section id="databases" class="sec" aria-labelledby="databases-title">
  <div class="wrap">
    ${secHead(3, 'Database support', 'One schema, ten databases', 'Every adapter takes the driver you already use. The same queries compile to each dialect: JSON aggregation for includes, the native way to return written rows, the native upsert.', 'databases')}
    <div class="matrix-wrap drawing" tabindex="0" role="region" aria-label="Database support matrix">
      <table class="matrix">
        <thead><tr><th scope="col">Database</th><th scope="col">Import</th><th scope="col">Driver</th><th scope="col">Includes</th><th scope="col">Written rows</th><th scope="col">Upsert</th><th scope="col">Paging</th><th scope="col">Transactions</th><th scope="col">Migrations</th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </div>
    <p class="matrix-note">${ui('info')}<span>Each adapter runs the shared conformance suite in CI. Serverless Postgres (Neon, Supabase, Vercel Postgres) runs through pg compatible pools and PlanetScale through mysql2.</span></p>
  </div>
</section>`;
}

function tour(frame) {
  const n = FEATURES.length;
  const tabs = FEATURES.map(
    (f, i) => `<button type="button" role="tab" class="tour-tab" id="tour-t-${f.id}" aria-controls="tour-p-${f.id}" :aria-selected="tab === ${i} ? 'true' : 'false'" aria-selected="${i === 0}" @click="tab = ${i}"><span class="tour-no">${String(i + 1).padStart(2, '0')}</span>${icon(f.icon)}<span>${esc(f.title)}</span></button>`,
  ).join('');
  const panels = FEATURES.map(
    (f, i) => `<div role="tabpanel" class="tour-panel" id="tour-p-${f.id}" aria-labelledby="tour-t-${f.id}" v-show="tab === ${i}"${i ? ' style="display:none"' : ''}>
  <div class="tour-copy"><p class="tour-kicker">DETAIL ${String(i + 1).padStart(2, '0')} / ${n}</p><h3>${esc(f.title)}</h3><p>${esc(f.text)}</p></div>
  ${frame(f.code, { lang: f.lang || 'ts', title: f.file, kind: f.kind || 'editor' })}
</div>`,
  ).join('\n');
  return `<section id="features" class="sec sec-tour" aria-labelledby="features-title">
  <div class="wrap">
    ${secHead(4, 'Feature tour', 'Everything a data layer needs, drawn to scale', `${n} details from the drawing set. Each one is real code that runs on every supported database.`, 'features')}
    <div class="tour" v-data="{ tab: 0 }">
      <div class="tour-tabs" role="tablist" aria-label="Features" aria-orientation="vertical" @keydown.down.prevent="tab = (tab + 1) % ${n}" @keydown.up.prevent="tab = (tab + ${n - 1}) % ${n}">${tabs}</div>
      <div class="tour-panels drawing">${panels}</div>
    </div>
  </div>
</section>`;
}

/** A faithful HTML drawing of the studio UI. */
function studioMock() {
  const rows = [
    [1, 'ada@example.com', 'Ada Lovelace', 'admin', 3],
    [2, 'grace@example.com', 'Grace Hopper', 'user', 5],
    [3, 'linus@example.com', null, 'user', 0],
    [4, 'margaret@example.com', 'Margaret Hamilton', 'user', 2],
    [5, 'edsger@example.com', 'Edsger Dijkstra', 'user', 1],
  ]
    .map((r, i) => `<tr${i === 1 ? ' class="sel"' : ''}><td>${r[0]}</td><td>${r[1]}</td><td>${r[2] === null ? '<em>null</em>' : r[2]}</td><td><span class="pill pill-${r[3]}">${r[3]}</span></td><td>${r[4]}</td></tr>`)
    .join('');
  return `<div class="st">
  <aside class="st-side"><p class="st-h">Tables</p><a class="on">users <b>5</b></a><a>posts <b>11</b></a><a>tags <b>4</b></a><a>post_tags <b>9</b></a><a>comments <b>23</b></a></aside>
  <div class="st-main">
    <div class="st-tools"><span class="st-filter">where role = user</span><span class="st-btn">+ Add row</span></div>
    <table class="st-grid"><thead><tr><th>id</th><th>email</th><th>name</th><th>role</th><th>posts</th></tr></thead><tbody>${rows}</tbody></table>
  </div>
  <div class="st-er" aria-hidden="true">
    <svg viewBox="0 0 220 210"><g class="er">
      <rect x="8" y="10" width="92" height="74" rx="6"/><text x="16" y="28" class="er-t">users</text><text x="16" y="46">id</text><text x="16" y="60">email</text><text x="16" y="74">name</text>
      <rect x="122" y="40" width="92" height="74" rx="6"/><text x="130" y="58" class="er-t">posts</text><text x="130" y="76">id</text><text x="130" y="90">title</text><text x="130" y="104">authorId</text>
      <rect x="66" y="130" width="92" height="60" rx="6"/><text x="74" y="148" class="er-t">tags</text><text x="74" y="166">id</text><text x="74" y="180">name</text>
      <path class="er-l" d="M100 46 C 112 46, 110 100, 122 100"/><path class="er-l" d="M168 114 C 168 140, 160 150, 158 160"/>
    </g></svg>
  </div>
</div>`;
}

function studio(shot) {
  const body = shot
    ? `<img src="${shot.light}" class="brand-light" width="${shot.w}" height="${shot.h}" alt="The kastor studio showing the users table and its rows" loading="lazy"><img src="${shot.dark}" class="brand-dark" width="${shot.w}" height="${shot.h}" alt="The kastor studio showing the users table and its rows" loading="lazy">`
    : studioMock();
  return `<section id="studio" class="sec sec-studio" aria-labelledby="studio-title">
  <div class="wrap studio-in">
    <div class="studio-copy">
      ${sheet(5, 'Studio')}
      <h2 id="studio-title">See your data. Edit it. Understand the shape.</h2>
      <div class="dim" aria-hidden="true"><i></i><span>studio</span><i></i></div>
      <p class="lead">Run <code>npx kastor studio</code> and a local web UI opens on your machine: browse every table, filter and sort, edit rows inline with validation from your schema, and read the ER diagram of the whole database.</p>
      <ul class="checks">
        <li>${ui('check')}Runs locally, talks to your database through your own config</li>
        <li>${ui('check')}Edits go through the same client, so constraints and errors read the same</li>
        <li>${ui('check')}ER diagram drawn from the schema, relations and foreign keys</li>
      </ul>
      ${copyBox('studio-cmd', 'npx kastor studio', 'Studio command')}
    </div>
    <figure class="studio-shot">
      <div class="browser"><div class="browser-bar"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="browser-url">localhost:4983</span></div>
        <div class="browser-body">${body}</div>
      </div>
      <figcaption>The studio, browsing the <code>users</code> table with its relations.</figcaption>
    </figure>
  </div>
</section>`;
}

function starts(frame) {
  const tabs = DATABASES.map(
    (d, i) => `<button type="button" role="tab" class="start-tab" id="st-t-${d.id}" aria-controls="st-p-${d.id}" :aria-selected="db === '${d.id}' ? 'true' : 'false'" aria-selected="${i === 0}" @click="db = '${d.id}'">${dbIcon(d.id)}<span>${esc(d.name)}</span></button>`,
  ).join('');
  const panels = DATABASES.map((d, i) => {
    const info = DB_INFO[d.id];
    const migrate = d.id === 'mongodb' ? 'npx kastor db push' : 'npx kastor migrate dev --name init';
    return `<div role="tabpanel" class="start-panel" id="st-p-${d.id}" aria-labelledby="st-t-${d.id}" v-show="db === '${d.id}'"${i ? ' style="display:none"' : ''}>
  <ol class="k-steps">
    <li><span class="step-no">1</span><div><h3>Install kastor and the driver</h3>${frame(info.install, { kind: 'terminal', lang: 'bash', title: 'Terminal', compact: true })}</div></li>
    <li><span class="step-no">2</span><div><h3>Create the client</h3><p>${esc(info.note)}</p>${frame(info.setup, { lang: 'ts', title: d.id === 'd1' ? 'src/worker.ts' : 'src/db/index.ts', compact: true })}</div></li>
    <li><span class="step-no">3</span><div><h3>Create the tables and query</h3>${frame(migrate, { kind: 'terminal', lang: 'bash', title: 'Terminal', compact: true })}${frame(`const users = await db.users.findMany({ include: { posts: true } })`, { lang: 'ts', title: 'src/app.ts', compact: true })}</div></li>
  </ol>
</div>`;
  }).join('\n');
  return `<section id="start" class="sec" aria-labelledby="start-title">
  <div class="wrap">
    ${secHead(6, 'Get started', 'Get started in 60 seconds', 'Pick your database. Three steps, and the schema from the playground is all you need: put it in <code>src/db/schema.ts</code>.', 'start')}
    <div class="start" v-data="{ db: 'postgres' }">
      <div class="start-tabs" role="tablist" aria-label="Database">${tabs}</div>
      <div class="start-panels drawing">${panels}</div>
    </div>
  </div>
</section>`;
}

function frameworks() {
  const cards = FRAMEWORKS.map((f) => `<a href="frameworks.html#${f.id}" class="fw-card"><span class="fw-name">${esc(f.name)}</span><span class="fw-tag">${esc(f.tag)}</span><span class="fw-go">${ui('arrow')}</span></a>`).join('');
  return `<section id="frameworks" class="sec" aria-labelledby="frameworks-title">
  <div class="wrap">
    ${secHead(7, 'Framework guides', 'Fits the framework you already use', 'One client per process, created from the driver you pick. Short, complete setups for ten frameworks and runtimes.', 'frameworks')}
    <div class="fw-grid">${cards}</div>
  </div>
</section>`;
}

const COMPARE = [
  ['Where the schema lives', 'TypeScript', 'A schema file in its own language', 'TypeScript', 'Classes with decorators'],
  ['Types after a schema change', 'Inferred on the next keystroke', 'After running a generate command', 'Inferred', 'Declared by hand on classes'],
  ['Query style', 'Objects: where, include, select', 'Objects: where, include, select', 'SQL shaped builder, plus a relational API in some tools', 'Repositories and a builder'],
  ['Nested relations', 'One query per root call (JSON aggregation)', 'Varies by tool and version', 'Varies by API', 'Joins or extra queries'],
  ['Migrations from the schema', 'Built in, rename detection asks first', 'Usually built in', 'Usually a separate kit', 'Usually built in'],
  ['Same API on SQL and MongoDB', 'Yes', 'Varies by tool', 'Usually SQL only', 'Varies by tool'],
  ['Runtime dependencies', 'Zero (bring your driver)', 'Varies', 'Small', 'Several'],
];

function compare() {
  const rows = COMPARE.map(([k, a, b, c, d]) => `<tr><th scope="row">${k}</th><td class="us">${a}</td><td>${b}</td><td>${c}</td><td>${d}</td></tr>`).join('');
  return `<section id="compare" class="sec" aria-labelledby="compare-title">
  <div class="wrap">
    ${secHead(8, 'Comparison', 'How kastor compares, by approach', 'There are many good ORMs. They make different trade-offs, so this table compares approaches rather than products. Check each tool\'s docs for its current details.', 'compare')}
    <div class="matrix-wrap drawing" tabindex="0" role="region" aria-label="Comparison by approach">
      <table class="matrix k-compare">
        <thead><tr><th scope="col"><span class="sr-only">Aspect</span></th><th scope="col" class="us">kastor</th><th scope="col">Generated client ORMs</th><th scope="col">SQL first query builders</th><th scope="col">Decorator ORMs</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="matrix-note">${ui('info')}<span>Coming from a specific tool? Read <a href="prisma-alternative-without-codegen.html">moving from a generated client</a> or <a href="drizzle-alternative.html">kastor next to a SQL first builder</a>.</span></p>
  </div>
</section>`;
}

function guidesTeaser(guides) {
  const en = guides.filter((g) => g.meta.lang === 'en');
  const cards = en
    .slice(0, 6)
    .map((g, i) => `<a href="${g.meta.slug}.html" class="g-card"><span class="g-no">GUIDE ${String(i + 1).padStart(2, '0')}</span><strong>${esc(g.meta.h1)}</strong><span>${esc(g.meta.description)}</span><span class="g-meta">${esc(g.meta.readTime)}${ui('arrow')}</span></a>`)
    .join('');
  return `<section id="guides" class="sec" aria-labelledby="guides-title">
  <div class="wrap">
    ${secHead(9, 'Guides', 'Field notes from the site office', 'Long reads on the problems an ORM should solve, in English and Portuguese.', 'guides')}
    <div class="g-grid">${cards}</div>
    <p class="g-all"><a href="guides.html" class="btn btn-outline">All ${en.length} guides${ui('arrow')}</a><a href="pt-br/" class="btn btn-ghost" hreflang="pt-BR">${ui('globe')}Guias em portugu&ecirc;s</a></p>
  </div>
</section>`;
}

function faq() {
  const items = FAQ.map((f, i) => `<details class="collapse q"${i === 0 ? ' open' : ''}><summary class="collapse-title"><span class="q-no">Q${i + 1}</span>${esc(f.q)}</summary><div class="collapse-content"><p>${f.a}</p></div></details>`).join('');
  return `<section id="faq" class="sec" aria-labelledby="faq-title">
  <div class="wrap faq-in">
    <div>${secHead(10, 'FAQ', 'Questions from the site visit', '', 'faq')}<img src="assets/mascot-head.svg" class="brand-light faq-kas" width="180" height="180" alt="" loading="lazy"><img src="assets/mascot-head-dark.svg" class="brand-dark faq-kas" width="180" height="180" alt="" loading="lazy"></div>
    <div class="accordion collapse-plus">${items}</div>
  </div>
</section>`;
}

function closing() {
  return `<section class="closing" aria-labelledby="closing-title">
  <div class="wrap">
    <div class="closing-in drawing">
      <div>
        <h2 id="closing-title">Lay the first log</h2>
        <p>One install, one schema file, and your database is typed end to end.</p>
      </div>
      ${copyBox('closing-cmd', 'npm i kastor', 'Install', ' install-lg')}
      <span class="stamp stamp-c">Approved for build</span>
    </div>
  </div>
</section>`;
}

export function homeBody(ctx) {
  return [hero(), playground(), matrix(ctx.features || {}), tour(ctx.frame), studio(ctx.studioShot), starts(ctx.frame), frameworks(), compare(), guidesTeaser(ctx.guides), faq(), closing()].join('\n');
}
