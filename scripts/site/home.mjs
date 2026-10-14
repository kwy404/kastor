// The home page: the lit K hero, the database strip, the product story
// (types, includes, migrations, the Prisma import, studio, runtimes), the
// live playground, the support matrix, the feature tour, 60 second starts,
// the build and deploy cards, a neutral comparison, guides and the FAQ.
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { litMark } from './art/brand.mjs';
import { DATABASES, RUNTIMES } from './art/icons.mjs';
import { DB_INFO } from './content/databases.mjs';
import { FEATURES } from './content/features.mjs';
import { FRAMEWORKS } from './content/frameworks.mjs';
import { PRESETS } from './playground/presets.mjs';
import { AUTHOR_GH, AUTHOR_IN, GITHUB, NPM, SITE, UPDATED, VERSION, dbIcon, esc, icon, rtIcon, ui } from './layout.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function eyebrow(iconName, label) {
  return `<p class="eyebrow">${icon(iconName, 'bic eb-ic')}<span>${label}</span></p>`;
}

function secHead(iconName, label, title, lead, id, center = false) {
  return `<header class="sec-head${center ? ' sec-head-c' : ''}">
  ${eyebrow(iconName, label)}
  <h2 id="${id}-title">${title}</h2>
  ${lead ? `<p class="lead">${lead}</p>` : ''}
</header>`;
}

function copyBox(id, cmd, label, extra = '') {
  return `<div class="install${extra}" role="group" aria-label="${label}"><code id="${id}"><span class="install-p" aria-hidden="true">$</span> ${esc(cmd)}</code><button type="button" class="k-copy" v-copy="${esc(cmd)}" aria-label="Copy: ${esc(cmd)}">${ui('copy')}<span class="sr-only">Copy</span></button></div>`;
}

/** Shiki output of `frame`, without the frame: just the highlighted pre. */
function hl(frame, code, lang = 'ts') {
  const html = frame(code, { lang, title: 'x' });
  return /<pre class="shiki"[\s\S]*<\/pre>/.exec(html)[0];
}

/** A window: traffic lights, a file tab and a body. */
function win(title, body, { lang = 'ts', cls = '', tabs = '' } = {}) {
  return `<div class="win ${cls}"><div class="win-bar"><span class="win-dots" aria-hidden="true"><i></i><i></i><i></i></span>${tabs || `<span class="win-title">${fileBadge(lang)}<span>${esc(title)}</span></span>`}</div><div class="win-body">${body}</div></div>`;
}

function checks(items) {
  return `<ul class="feat-list">${items.map(([ic, strong, text]) => `<li>${icon(ic, 'bic fl-ic')}<span><strong>${strong}</strong> ${text}</span></li>`).join('')}</ul>`;
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
    a: 'Nested includes load in one statement per root call: JSON aggregation on every SQL database and a single aggregation pipeline with $lookup stages on MongoDB. Never one query per row. See <a href="avoid-n-plus-1-queries.html">the N+1 guide</a>.',
  },
  {
    q: 'How do I migrate from Prisma to kastor?',
    a: 'Run <code>npx kastor import prisma</code> to turn schema.prisma into a TypeScript schema, then <code>npx kastor migrate baseline --from-prisma prisma/migrations</code> so the migrations Prisma already applied stay recorded. Your data never moves. The <a href="migrate-from-prisma.html">Prisma migration guide</a> maps every client call, and the <a href="migrate-to-kastor.html">migration hub</a> covers Drizzle, TypeORM, Sequelize, Knex, Mongoose, Laravel, Django and Rails.',
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

// ---------- Hero ----------

function hero() {
  const entries = [
    ['#start', 'Start a project', 'Install, create the client and run a first query on any of ten databases.'],
    ['migrate-from-prisma.html', 'Move from Prisma', 'One command converts schema.prisma. Your data and migration history stay put.'],
    ['api.html', 'Read the reference', 'Every method, filter, error code and CLI command, with examples.'],
  ]
    .map(([href, t, d]) => `<li><a href="${href}" class="entry"><span class="entry-t">${t}${ui('arrow', 'ic entry-go')}</span><span class="entry-d">${d}</span></a></li>`)
    .join('');
  return `<section class="k-hero" aria-labelledby="hero-title">
  <div class="hero-grid" aria-hidden="true"></div>
  <div class="wrap hero-in">
    <div class="hero-text">
      <a href="${GITHUB}/blob/main/CHANGELOG.md" class="hero-pill"><span class="hp-new">New</span><span>kastor ${VERSION}: ten databases, one schema</span>${ui('chevron')}</a>
      <h1 id="hero-title">The TypeScript ORM for <span class="hl">every database</span>.</h1>
      <p class="lead">Write your schema in plain TypeScript and the types are there as you type. No generate step, no binary engine. Nested includes in one query, readable migrations and a local studio on PostgreSQL, MySQL, SQLite, SQL Server, Oracle, MongoDB and four more.</p>
      <div class="hero-cta">
        <a href="#start" class="btn btn-lg btn-solid">Get started${ui('arrow')}</a>
        <a href="#playground" class="btn btn-lg btn-line">${ui('play')}Open the playground</a>
        ${copyBox('install-cmd', 'npm i kastor', 'Install', ' install-pill')}
      </div>
    </div>
    <ul class="hero-entries" aria-label="Where to go next">${entries}</ul>
  </div>
  <div class="stage" aria-hidden="true">
    <div class="stage-rays"></div>
    <div class="stage-floor"></div>
    <div class="stage-mark">${litMark({ vars: true, id: 'hero-k' })}</div>
    <div class="stage-line"></div>
  </div>
</section>`;
}

function logoStrip() {
  const items = DATABASES.map((d) => `<li>${dbIcon(d.id, 'dbic strip-ic')}<span>${esc(d.name)}</span></li>`).join('');
  return `<section class="strip" aria-labelledby="strip-title">
  <div class="wrap">
    <h2 id="strip-title" class="strip-title">One schema and one API on the databases you already run</h2>
    <ul class="strip-list">${items}</ul>
  </div>
</section>`;
}

// ---------- Story ----------

const TYPES_SCHEMA = `import { table, t } from 'kastor'

export const users = table('users', {
  id: t.id(),
  email: t.string(255).unique(),
  name: t.string().nullable(),
  role: t.enum(['user', 'admin']).default('user'),
  createdAt: t.datetime().defaultNow(),
})

export const posts = table('posts', {
  id: t.id(),
  title: t.string(200),
  published: t.boolean().default(false),
  authorId: t.int().references(() => users.id),
})`;

const TYPES_APP = `import { db } from './db'

const user = await db.users.findUnique({
  where: { email: 'ada@acme.com' },
  include: { posts: true },
})

user?.posts[0].title`;

const TYPES_TIP = `const user: {
  id: number
  email: string
  name: string | null
  role: 'user' | 'admin'
  createdAt: Date
  posts: {
    id: number
    title: string
    published: boolean
    authorId: number
  }[]
} | null`;

function storyTypes(frame) {
  const app = hl(frame, TYPES_APP).replace(/<span style="([^"]*)">user<\/span>/, '<span class="hover-tok" style="$1">user</span>');
  return `<section class="story" id="types" aria-labelledby="types-title">
  <div class="wrap story-in">
    <div class="story-copy">
      ${secHead('types', 'Schema and types', 'Write a schema, get types instantly', 'Tables and relations are ordinary TypeScript values. The compiler infers every result from them, so the types are already there on the next keystroke.', 'types')}
      ${checks([
        ['schema', 'Plain TypeScript.', 'No schema language, no extension, and your editor understands every line.'],
        ['no-codegen', 'No generate step.', 'Nothing to rerun after a change, nothing to forget in CI.'],
        ['relations', 'Shaped by the query.', 'Includes add relations to the result, <code>select</code> narrows it.'],
        ['errors', 'Rename safely.', 'Rename a column and every call site lights up in the editor.'],
      ])}
    </div>
    <div class="story-vis vis-types">
      ${win('src/db/schema.ts', hl(frame, TYPES_SCHEMA), { cls: 'win-back' })}
      <div class="win win-front"><div class="win-bar"><span class="win-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="win-title">${fileBadge('ts')}<span>src/app.ts</span></span><span class="win-badge">${ui('check')}Types up to date</span></div><div class="win-body">${app}
        <div class="type-tip" role="note" aria-label="Inferred type of user"><p class="tip-head">${ui('spark')}Inferred, not generated</p>${hl(frame, TYPES_TIP)}</div>
      </div></div>
    </div>
  </div>
</section>`;
}

const INCLUDE_QUERY = `const authors = await db.users.findMany({
  where: { email: { endsWith: '@acme.com' } },
  select: {
    name: true,
    posts: {
      where: { published: true },
      orderBy: { views: 'desc' },
      take: 3,
      select: { title: true, views: true },
    },
  },
})`;

/** Compiles the include query with the real compiler bundled for the playground. */
async function compileIncludes() {
  try {
    const asset = (f) => pathToFileURL(join(ROOT, 'docs', 'assets', f)).href;
    const K = await import(asset('pg-kastor.js'));
    const app = await import(asset('pg-app.js'));
    const { SCHEMA } = await import(asset('pg-presets.js'));
    const parsed = app.evalSchema(SCHEMA);
    const executor = { query: async () => ({ rows: [] }), transaction: async (fn) => fn(executor) };
    const out = {};
    for (const id of ['postgres', 'mysql', 'sqlite', 'mssql', 'oracle', 'mongodb']) {
      const db = K.kastor({ adapter: { dialect: K.DIALECTS[id], executor }, schema: parsed.tables, relations: parsed.relations });
      const [st] = await app.evalQuery(INCLUDE_QUERY.replace(/^const authors = await /, ''))(db, K.sql).toSQL();
      out[id] = id === 'mongodb' ? JSON.stringify(JSON.parse(st.sql), null, 2) : app.formatSql(st.sql);
    }
    return out;
  } catch (e) {
    console.warn(`home: could not compile the include example (${e.message})`);
    return null;
  }
}
const INCLUDE_SQL = await compileIncludes();

function storyIncludes(frame) {
  const ids = INCLUDE_SQL ? Object.keys(INCLUDE_SQL) : [];
  const name = (id) => DATABASES.find((d) => d.id === id).name;
  const tabs = ids.map((id, i) => `<button type="button" role="tab" class="seg-tab" id="inc-t-${id}" aria-controls="inc-p-${id}" :aria-selected="db === '${id}' ? 'true' : 'false'" aria-selected="${i === 0}" @click="db = '${id}'">${dbIcon(id)}<span>${esc(name(id))}</span></button>`).join('');
  const panels = ids.map((id, i) => `<div role="tabpanel" class="inc-panel" id="inc-p-${id}" aria-labelledby="inc-t-${id}" v-show="db === '${id}'"${i ? ' style="display:none"' : ''}>${hl(frame, INCLUDE_SQL[id], id === 'mongodb' ? 'json' : 'sql')}</div>`).join('');
  const out = INCLUDE_SQL
    ? `<div class="win win-sql" v-data="{ db: 'postgres' }"><div class="win-bar win-bar-tabs" role="tablist" aria-label="Database">${tabs}</div><div class="win-body">${panels}</div><p class="win-foot">${ui('check')}One statement per call. Compiled at build time by the same code that ships on npm.</p></div>`
    : '';
  return `<section class="story story-rev" id="includes" aria-labelledby="includes-title">
  <div class="wrap">
    ${secHead('one-query', 'Relations', 'Nested includes in one query', 'Ask for authors and their latest posts and kastor sends one statement, built for the database you run. Never one query per row.', 'includes', true)}
    <div class="inc-grid">
      ${win('src/feed.ts', hl(frame, INCLUDE_QUERY), { cls: 'win-q' })}
      <div class="inc-arrow" aria-hidden="true">${ui('arrow')}</div>
      ${out}
    </div>
    <div class="inc-points">
      <p>${icon('database', 'bic')}<span><strong>JSON aggregation</strong> on PostgreSQL, MySQL, MariaDB, SQLite, SQL Server and Oracle.</span></p>
      <p>${icon('one-query', 'bic')}<span><strong>One pipeline</strong> with <code>$lookup</code> stages on MongoDB.</span></p>
      <p>${icon('query', 'bic')}<span><strong>Every level</strong> takes its own where, orderBy, take and select.</span></p>
    </div>
  </div>
</section>`;
}

/** Terminal output of kastor migrate dev, recorded from a real run on Postgres. */
const MIGRATE_OUT = `<span class="t-p">$</span> npx kastor migrate dev --name add_slug_and_views

<span class="t-b t-c">kastor</span> <span class="t-d">/</span> <span class="t-b">migrate dev</span>

  <span class="t-d">Config    </span>  kastor.config.ts
  <span class="t-d">Database  </span>  postgres
  <span class="t-d">Schema    </span>  src/db/schema.ts
  <span class="t-d">Migrations</span>  kastor/migrations

<span class="t-ok">ok</span>    Loaded 2 tables from the schema
<span class="t-b">Changes</span>  <span class="t-ok">3 to add</span><span class="t-d">,</span> <span class="t-w">0 to change</span><span class="t-d">,</span> <span class="t-r">0 to drop</span>

  <span class="t-ok">+</span> Add column posts.slug
  <span class="t-ok">+</span> Add column posts.views
  <span class="t-ok">+</span> Create unique index posts_slug_key on posts (slug)

  <span class="t-w">warn</span>  Column posts.slug is required and has no default, so adding
        it fails if posts already has rows.
        <span class="t-d">Give it a default, make it nullable, or fill it in a second migration.</span>

<span class="t-ok">ok</span>    Wrote <span class="t-b">kastor/migrations/20261014093012_add_slug_and_views/migration.sql</span>
<span class="t-ok">ok</span>    Applied <span class="t-b">20261014093012_add_slug_and_views</span> <span class="t-d">41 ms</span>`;

const MIGRATE_SQL = `-- Migration 20261014093012_add_slug_and_views
-- Written by kastor 0.1.0 for postgres.
--
-- Changes:
--   + Add column posts.slug
--   + Add column posts.views
--   + Create unique index posts_slug_key on posts (slug)

-- Add column posts.slug
ALTER TABLE "posts" ADD COLUMN "slug" varchar(220) NOT NULL;

-- Add column posts.views
ALTER TABLE "posts" ADD COLUMN "views" integer DEFAULT 0 NOT NULL;

-- Create unique index posts_slug_key on posts (slug)
CREATE UNIQUE INDEX "posts_slug_key" ON "posts" ("slug");`;

const MIGRATE_DIFF = `export const posts = table('posts', {
  id: t.id(),
  title: t.string(200),
  slug: t.string(220).unique(),
  views: t.int().default(0),
  published: t.boolean().default(false),
})`;

function storyMigrations(frame) {
  const diff = hl(frame, MIGRATE_DIFF).replace(/<span class="line">((?:(?!<span class="line">)[\s\S])*?(?:slug|views)<)/g, '<span class="line line-add">$1');
  return `<section class="story" id="migrations" aria-labelledby="migrations-title">
  <div class="wrap story-in">
    <div class="story-copy">
      ${secHead('migrations', 'Migrations', 'Migrations you can read', 'Change the schema, run one command. kastor diffs it against the live database, explains the plan in plain English and writes a SQL file you review and commit.', 'migrations')}
      ${checks([
        ['shield', 'Careful by default.', 'Warns before anything that can fail or lose data, and asks before it treats a rename as a drop.'],
        ['raw-sql', 'Plain SQL files.', 'One folder per migration, a header that says what changed, nothing hidden.'],
        ['branch', 'Built for CI.', '<code>migrate deploy</code> applies pending files, <code>migrate status</code> catches drift.'],
        ['logs', 'Existing database?', '<code>db pull</code> writes the schema from it, <code>migrate baseline</code> adopts it.'],
      ])}
    </div>
    <div class="story-vis vis-mig">
      ${win('src/db/schema.ts', diff, { cls: 'win-diff' })}
      <div class="win win-term"><div class="win-bar"><span class="win-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="win-title">${fileBadge('bash')}<span>Terminal</span></span></div><div class="win-body"><pre class="term" tabindex="0"><code>${MIGRATE_OUT}</code></pre></div></div>
      ${win('migration.sql', hl(frame, MIGRATE_SQL, 'sql'), { lang: 'sql', cls: 'win-file' })}
    </div>
  </div>
</section>`;
}

/** Terminal output of kastor import prisma, recorded from a real run. */
const IMPORT_OUT = `<span class="t-p">$</span> npx kastor import prisma

<span class="t-b t-c">kastor</span> <span class="t-d">/</span> <span class="t-b">import prisma</span>

  <span class="t-d">Prisma schema</span>  prisma/schema.prisma
  <span class="t-d">Provider     </span>  postgresql (kastor/postgres)

<span class="t-ok">ok</span>    Wrote <span class="t-b">src/db/schema.ts</span>: 3 models, 1 join table, 1 enum, 4 relation fields.
<span class="t-ok">ok</span>    Every model, field and relation mapped exactly.

  <span class="t-c">+------------------------------------------------------------+</span>
  <span class="t-c">|</span> <span class="t-b">Next steps</span>                                                 <span class="t-c">|</span>
  <span class="t-c">|</span> 1. Read src/db/schema.ts and point kastor.config.ts at it. <span class="t-c">|</span>
  <span class="t-c">|</span> 2. kastor migrate baseline --from-prisma prisma/migrations <span class="t-c">|</span>
  <span class="t-c">|</span>    records the database as it is now, without changing it. <span class="t-c">|</span>
  <span class="t-c">|</span> 3. kastor migrate dev should then say: Already in sync.    <span class="t-c">|</span>
  <span class="t-c">+------------------------------------------------------------+</span>`;

function storyImport(guides) {
  const list = guides.filter((g) => g.meta.lang === 'en' && g.meta.section === 'migrate');
  const chips = list.map((g) => `<a href="${g.meta.slug}.html" class="chip-link"><span>${esc(g.meta.crumb.replace(/^From /, ''))}</span>${ui('arrow', 'ic')}</a>`).join('');
  return `<section class="story story-rev" id="migrate" aria-labelledby="migrate-title">
  <div class="wrap story-in story-in-rev">
    <div class="story-copy">
      ${secHead('deploy', 'Migrate', 'Move from Prisma in one command', 'Point kastor at schema.prisma and get a TypeScript schema with the same table, column and constraint names. A baseline keeps the history Prisma already applied, so nothing in the database moves.', 'migrate')}
      ${checks([
        ['schema', 'Same names, same tables.', 'Models, enums, implicit join tables and relation fields carry over.'],
        ['shield', 'History kept.', '<code>migrate baseline --from-prisma</code> records every applied migration.'],
        ['database', 'Any other ORM.', '<code>db pull</code> reads the live database into a schema file.'],
      ])}
      <div class="chips" aria-label="Migration guides">${chips}</div>
      <p class="story-more"><a href="migrate-to-kastor.html" class="link-arrow">All migration guides${ui('arrow')}</a></p>
    </div>
    <div class="story-vis vis-import">
      <div class="win win-term win-wide"><div class="win-bar"><span class="win-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="win-title">${fileBadge('bash')}<span>Terminal</span></span></div><div class="win-body"><pre class="term" tabindex="0"><code>${IMPORT_OUT}</code></pre></div></div>
    </div>
  </div>
</section>`;
}

function studio() {
  const shot = (view, alt) => `<img src="assets/studio-${view}-light.png" class="brand-light" width="1200" height="680" alt="${alt}" loading="lazy"><img src="assets/studio-${view}-dark.png" class="brand-dark" width="1200" height="680" alt="${alt}" loading="lazy">`;
  return `<section id="studio" class="story story-studio" aria-labelledby="studio-title">
  <div class="wrap">
    ${secHead('studio', 'Studio', 'See your data. Edit it. Understand the shape.', 'Run <code>npx kastor studio</code> and a local web UI opens on your machine: browse every table, filter and search, edit rows, follow foreign keys and read the diagram of the whole database.', 'studio', true)}
    <figure class="studio-shot" v-data="{ view: 'data' }">
      <div class="seg" role="tablist" aria-label="Studio views">
        <button type="button" role="tab" class="seg-tab" :aria-selected="view === 'data' ? 'true' : 'false'" aria-selected="true" @click="view = 'data'">${icon('schema', 'bic')}Data</button>
        <button type="button" role="tab" class="seg-tab" :aria-selected="view === 'diagram' ? 'true' : 'false'" aria-selected="false" @click="view = 'diagram'">${icon('relations', 'bic')}Diagram</button>
      </div>
      <div class="browser"><div class="browser-bar"><span class="win-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="browser-url">${ui('info', 'ic')}127.0.0.1:5555</span></div>
        <div class="browser-body"><div v-show="view === 'data'">${shot('data', 'The kastor studio browsing the posts table: filters, rows, foreign keys and actions')}</div><div v-show="view === 'diagram'" style="display:none">${shot('diagram', 'The kastor studio diagram of users, posts, tags and post_tags with their foreign keys')}</div></div>
      </div>
      <figcaption>Real screenshots of <code>npx kastor studio</code> on the playground schema with SQLite.</figcaption>
    </figure>
    <ul class="studio-points">
      <li>${icon('shield', 'bic')}<span>Runs on 127.0.0.1 behind a private session token, with your own config.</span></li>
      <li>${icon('search', 'bic')}<span>Filters, text search, paging and a read only mode for data you must not touch.</span></li>
      <li>${icon('relations', 'bic')}<span>A diagram drawn from the live schema, downloadable as SVG.</span></li>
    </ul>
  </div>
</section>`;
}

const RT_LINKS = { node: 'express-orm.html', bun: 'bun-orm.html', deno: 'deno-orm.html', workers: 'cloudflare-workers-orm.html', vercel: 'nextjs-app-router-orm.html', netlify: 'frameworks.html' };

function runtimes() {
  const rts = RUNTIMES.map((r) => `<a href="${RT_LINKS[r.id]}" class="rt-card">${rtIcon(r.id)}<span class="rt-name">${esc(r.name)}</span><span class="rt-note">${esc(r.note)}</span></a>`).join('');
  const fws = FRAMEWORKS.map((f) => `<a href="frameworks.html#${f.id}" class="fw-card"><span class="fw-name">${esc(f.name)}</span><span class="fw-tag">${esc(f.tag)}</span>${ui('arrow', 'ic fw-go')}</a>`).join('');
  return `<section id="runtimes" class="story story-rt" aria-labelledby="runtimes-title">
  <div class="wrap">
    ${secHead('edge', 'Runtimes', 'Runs everywhere your code runs', 'The core has no Node only imports and ships no drivers, so kastor goes wherever your driver goes: servers, serverless functions and the edge.', 'runtimes', true)}
    <div class="rt-grid">${rts}</div>
    <div id="frameworks" class="fw-block">
      <h3 class="fw-title">Complete setups for ${FRAMEWORKS.length} frameworks</h3>
      <div class="fw-grid">${fws}</div>
      <p class="g-all"><a href="frameworks.html" class="btn btn-line">All framework setups${ui('arrow')}</a><a href="guides.html#frameworks" class="btn btn-ghost-k">Framework guides${ui('arrow')}</a></p>
    </div>
  </div>
</section>`;
}

// ---------- Playground ----------

export function fileBadge(lang) {
  const map = { ts: ['#3178c6', 'TS'], tsx: ['#3178c6', 'TSX'], js: ['#b59a00', 'JS'], sql: ['#c2621f', 'SQL'], json: ['#7d6608', '{}'], bash: ['#3a7d44', '$_'], toml: ['#9c4221', 'TML'], yaml: ['#b4232a', 'YML'], text: ['#6b7280', '>_'], prisma: ['#2d3748', 'PR'], php: ['#6e6ea8', 'PHP'], python: ['#3572a5', 'PY'], ruby: ['#b3302a', 'RB'], svelte: ['#d9480f', 'SV'], vue: ['#2f8f63', 'VUE'], astro: ['#9b46cf', 'AS'], dockerfile: ['#1f7fc4', 'DK'] };
  const [color, label] = map[lang] || map.text;
  const size = label.length > 2 ? 5.2 : 6.4;
  return `<svg class="file-ic" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect width="16" height="16" rx="4" fill="${color}"/><text x="8" y="11" text-anchor="middle" font-family="Geist, Segoe UI, Arial, sans-serif" font-size="${size}" font-weight="700" fill="#fff">${esc(label)}</text></svg>`;
}

function playground() {
  const presets = PRESETS.map((p, i) => `<button type="button" class="chip-btn" data-preset="${i}" aria-pressed="${i === 0}">${esc(p.label)}</button>`).join('');
  const dbTabs = DATABASES.map(
    (d, i) => `<button type="button" role="tab" class="db-tab" data-dialect="${d.id}" aria-selected="${i === 0}" id="pg-db-${d.id}">${dbIcon(d.id)}<span>${esc(d.name.replace(' / Turso', ''))}</span></button>`,
  ).join('');
  return `<section id="playground" class="sec sec-playground" aria-labelledby="playground-title">
  <div class="pg-glow" aria-hidden="true"></div>
  <div class="wrap">
    ${secHead('cli', 'Live playground', 'Type a schema. Watch the types and the SQL appear.', 'This is the real kastor compiler running in your browser. Edit the schema or the query: the result type is checked by the TypeScript compiler, and the SQL is compiled for every database side by side. Open Rows to run it on SQLite in this page.', 'playground', true)}
    <div class="pg" data-playground>
      <div class="pg-presets" role="group" aria-label="Examples">${presets}</div>
      <div class="pg-grid">
        <div class="pg-pane pg-edit">
          <div class="pg-bar" role="tablist" aria-label="Files">
            <span class="win-dots" aria-hidden="true"><i></i><i></i><i></i></span>
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
            <div data-panel="rows" hidden><div data-rows><p class="pg-note">Runs your query against an in-memory SQLite database (sql.js) seeded with sample rows. Loads about 1 MB the first time.</p><button type="button" class="btn btn-sm btn-solid" data-run>${ui('play')}Run on SQLite</button></div></div>
          </div>
          <p class="pg-foot" data-foot>kastor ${VERSION} compiled for the browser from the same source as the npm package.</p>
        </div>
      </div>
      <noscript><p class="pg-note">The playground needs JavaScript. Every guide below shows the same API with highlighted code.</p></noscript>
    </div>
  </div>
</section>`;
}

// ---------- Reference sections ----------

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
    ${secHead('database', 'Database support', 'One schema, ten databases', 'Every adapter takes the driver you already use. The same queries compile to each dialect: JSON aggregation for includes, the native way to return written rows, the native upsert.', 'databases')}
    <div class="matrix-wrap" tabindex="0" role="region" aria-label="Database support matrix">
      <table class="matrix">
        <thead><tr><th scope="col">Database</th><th scope="col">Import</th><th scope="col">Driver</th><th scope="col">Includes</th><th scope="col">Written rows</th><th scope="col">Upsert</th><th scope="col">Paging</th><th scope="col">Transactions</th><th scope="col">Migrations</th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </div>
    <p class="matrix-note">${ui('info')}<span>The adapters share one conformance suite, run against real databases in CI. Serverless Postgres (Neon, Supabase, Vercel Postgres) runs through pg compatible pools and PlanetScale through mysql2.</span></p>
  </div>
</section>`;
}

function tour(frame) {
  const n = FEATURES.length;
  const tabs = FEATURES.map(
    (f, i) => `<button type="button" role="tab" class="tour-tab" id="tour-t-${f.id}" aria-controls="tour-p-${f.id}" :aria-selected="tab === ${i} ? 'true' : 'false'" aria-selected="${i === 0}" @click="tab = ${i}">${icon(f.icon)}<span>${esc(f.title)}</span></button>`,
  ).join('');
  const panels = FEATURES.map(
    (f, i) => `<div role="tabpanel" class="tour-panel" id="tour-p-${f.id}" aria-labelledby="tour-t-${f.id}" v-show="tab === ${i}"${i ? ' style="display:none"' : ''}>
  <div class="tour-copy"><h3>${esc(f.title)}</h3><p>${esc(f.text)}</p></div>
  ${frame(f.code, { lang: f.lang || 'ts', title: f.file, kind: f.kind || 'editor' })}
</div>`,
  ).join('\n');
  return `<section id="tour" class="sec sec-tour" aria-labelledby="tour-title">
  <div class="wrap">
    ${secHead('package', 'Everything else', 'Everything a data layer needs', `${n} more details. Each one is real code that runs on every supported database.`, 'tour')}
    <div class="tour" v-data="{ tab: 0 }">
      <div class="tour-tabs" role="tablist" aria-label="Features" aria-orientation="vertical" @keydown.down.prevent="tab = (tab + 1) % ${n}" @keydown.up.prevent="tab = (tab + ${n - 1}) % ${n}">${tabs}</div>
      <div class="tour-panels">${panels}</div>
    </div>
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
    <li><span class="step-no">2</span><div><h3>Create the client</h3><p>${esc(info.note).replace(/`([^`]+)`/g, '<code>$1</code>')}</p>${frame(info.setup, { lang: 'ts', title: d.id === 'd1' ? 'src/worker.ts' : 'src/db/index.ts', compact: true })}</div></li>
    <li><span class="step-no">3</span><div><h3>Create the tables and query</h3>${frame(migrate, { kind: 'terminal', lang: 'bash', title: 'Terminal', compact: true })}${frame(`const users = await db.users.findMany({ include: { posts: true } })`, { lang: 'ts', title: 'src/app.ts', compact: true })}</div></li>
  </ol>
</div>`;
  }).join('\n');
  return `<section id="start" class="sec" aria-labelledby="start-title">
  <div class="wrap">
    ${secHead('cli', 'Get started', 'Get started in 60 seconds', 'Pick your database. Three steps, and the schema from the playground is all you need: put it in <code>src/db/schema.ts</code>.', 'start')}
    <div class="start" v-data="{ db: 'postgres' }">
      <div class="start-tabs" role="tablist" aria-label="Database">${tabs}</div>
      <div class="start-panels">${panels}</div>
    </div>
  </div>
</section>`;
}

/** Build, migrate, deploy and inspect: the path to production. */
function lifecycle() {
  const cards = [
    ['amber', 'schema', 'Build', 'Schema, types and queries', 'Write tables in TypeScript and query them with inferred results. The playground above is the real thing.', 'db.users.findMany()', '#playground'],
    ['copper', 'migrations', 'Migrate', 'Reviewed SQL, every time', 'migrate dev writes the file, you commit it, migrate deploy applies it in CI before the new code ships.', 'npx kastor migrate deploy', 'database-migrations-explained.html'],
    ['rose', 'deploy', 'Deploy', 'Servers, functions, edge', 'One client per process, reused across hot reloads and invocations, with the pool or HTTP driver your host wants.', 'export const db = kastor(...)', 'frameworks.html'],
    ['teal', 'studio', 'Inspect', 'Studio and doctor', 'Browse and edit rows locally, read the diagram, and let kastor doctor check config, driver and connection.', 'npx kastor doctor', '#studio'],
  ]
    .map(([tone, ic, kicker, title, text, cmd, href]) => `<a href="${href}" class="lc-card lc-${tone}"><span class="lc-glow" aria-hidden="true"></span><span class="lc-ic">${icon(ic, 'bic')}</span><span class="lc-kicker">${kicker}</span><span class="lc-title">${title}</span><span class="lc-text">${text}</span><code class="lc-cmd">${esc(cmd)}</code></a>`)
    .join('');
  return `<section id="ship" class="sec sec-lc" aria-labelledby="ship-title">
  <div class="wrap">
    ${secHead('deploy', 'From laptop to production', 'Build it, ship it, keep it healthy', 'The same schema file drives the client, the migrations and the studio, from the first table to the hundredth deploy.', 'ship', true)}
    <div class="lc-grid">${cards}</div>
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
    ${secHead('relations', 'Comparison', 'How kastor compares, by approach', 'There are many good ORMs. They make different trade-offs, so this table compares approaches rather than products. Check each tool\'s docs for its current details.', 'compare')}
    <div class="matrix-wrap" tabindex="0" role="region" aria-label="Comparison by approach">
      <table class="matrix k-compare">
        <thead><tr><th scope="col"><span class="sr-only">Aspect</span></th><th scope="col" class="us">kastor</th><th scope="col">Generated client ORMs</th><th scope="col">SQL first query builders</th><th scope="col">Decorator ORMs</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="matrix-note">${ui('info')}<span>Coming from a specific tool? The <a href="migrate-to-kastor.html">migration guides</a> map every concept and command, from Prisma and Drizzle to Laravel and Rails.</span></p>
  </div>
</section>`;
}

function guidesTeaser(guides) {
  const en = guides.filter((g) => g.meta.lang === 'en');
  const cards = en
    .filter((g) => !g.meta.section)
    .slice(0, 6)
    .map((g) => `<a href="${g.meta.slug}.html" class="g-card"><span class="g-no">${esc(g.meta.crumb)}</span><strong>${esc(g.meta.h1)}</strong><span>${esc(g.meta.description)}</span><span class="g-meta">${esc(g.meta.readTime)}${ui('arrow')}</span></a>`)
    .join('');
  return `<section id="guides" class="sec" aria-labelledby="guides-title">
  <div class="wrap">
    ${secHead('blueprint', 'Guides', 'Long reads on the problems an ORM should solve', `${en.length} guides in English and more in Portuguese, from N+1 queries to running one data layer on every database.`, 'guides')}
    <div class="g-grid">${cards}</div>
    <p class="g-all"><a href="guides.html" class="btn btn-line">All ${en.length} guides${ui('arrow')}</a><a href="pt-br/" class="btn btn-ghost-k" hreflang="pt-BR">${ui('globe')}Guias em portugu&ecirc;s</a></p>
  </div>
</section>`;
}

function faq() {
  const items = FAQ.map((f, i) => `<details class="collapse q"${i === 0 ? ' open' : ''}><summary class="collapse-title">${esc(f.q)}</summary><div class="collapse-content"><p>${f.a}</p></div></details>`).join('');
  return `<section id="faq" class="sec" aria-labelledby="faq-title">
  <div class="wrap faq-in">
    <div>${secHead('errors', 'FAQ', 'Questions people ask', `Still curious? Open an issue on <a href="${GITHUB}/issues">GitHub</a> and Kas will take a look.`, 'faq')}</div>
    <div class="accordion collapse-plus">${items}</div>
  </div>
</section>`;
}

function closing() {
  return `<section class="closing" aria-labelledby="closing-title">
  <div class="wrap">
    <div class="closing-in">
      <div class="closing-glow" aria-hidden="true"></div>
      <div class="closing-mark" aria-hidden="true">${litMark({ vars: true, id: 'close-k', cls: 'lit-mark lit-mark-sm' })}</div>
      <h2 id="closing-title">Lay the first log.</h2>
      <p>One install, one schema file, and your database is typed end to end.</p>
      <div class="closing-cta">
        <a href="#start" class="btn btn-lg btn-solid">Get started${ui('arrow')}</a>
        ${copyBox('closing-cmd', 'npm i kastor', 'Install', ' install-pill')}
      </div>
    </div>
  </div>
</section>`;
}

export function homeBody(ctx) {
  const { frame, guides, features = {} } = ctx;
  return [
    hero(),
    logoStrip(),
    `<div id="features" class="stories">`,
    storyTypes(frame),
    storyIncludes(frame),
    storyMigrations(frame),
    storyImport(guides),
    studio(),
    runtimes(),
    `</div>`,
    playground(),
    matrix(features),
    tour(frame),
    starts(frame),
    lifecycle(),
    compare(),
    guidesTeaser(guides),
    faq(),
    closing(),
  ].join('\n');
}
