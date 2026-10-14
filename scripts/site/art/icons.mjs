// The kastor icon set: 24 by 24 line icons with a 1.5 stroke, round caps and
// joins, drawn for the project. Each drawing is a function of (ink, accent):
// the same paths yield the light files, the dark files and the site sprite
// (currentColor plus the --ic-accent variable).

const A = (accent, d, extra = '') => `<path d="${d}" stroke="${accent}"${extra}/>`;

export const FEATURE_ICONS = {
  schema: { label: 'Schema in TypeScript', draw: (_i, a) => `<rect x="3.75" y="4.75" width="16.5" height="14.5" rx="2.5"/><path d="M3.75 9.75h16.5M9.25 9.75v9.5M3.75 14.5h16.5"/>${A(a, 'M6.25 7.25h.5M11.75 7.25h5.5')}` },
  types: { label: 'Inferred types', draw: (_i, a) => `<path d="M8 4.5C6.2 4.5 5.5 5.3 5.5 7v2.4c0 1.2-.7 2.1-2 2.6 1.3.5 2 1.4 2 2.6V17c0 1.7.7 2.5 2.5 2.5M16 4.5c1.8 0 2.5.8 2.5 2.5v2.4c0 1.2.7 2.1 2 2.6-1.3.5-2 1.4-2 2.6V17c0 1.7-.7 2.5-2.5 2.5"/>${A(a, 'M9.25 12.25l1.9 1.9 3.6-3.9')}` },
  'no-codegen': { label: 'No generate step', draw: (_i, a) => `<path d="M3.75 19.5h4M3.75 4.5h4" opacity=".5"/>${A(a, 'M13.25 3.5 6.5 13.25h5.25L10.5 20.5l7-10h-5.25l1-7Z')}` },
  query: { label: 'Friendly queries', draw: (_i, a) => `<path d="M3.75 6h11M3.75 10h7.5M3.75 14h4.5"/><circle cx="15.25" cy="14.75" r="4"/>${A(a, 'M18.25 17.75 20.5 20')}` },
  relations: { label: 'Relations', draw: (_i, a) => `<circle cx="6" cy="6" r="2.25"/><circle cx="18" cy="6" r="2.25"/><path d="M8.25 6h7.5M7.1 8 10.9 15.8M16.9 8l-3.8 7.8"/>${A(a, 'M12 15.75a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5Z')}` },
  'one-query': { label: 'Nested includes in one query', draw: (_i, a) => `<path d="M3.5 5.5c4.75 0 4.75 6.5 9 6.5M3.5 12h9M3.5 18.5c4.75 0 4.75-6.5 9-6.5"/>${A(a, 'M12.5 12h8M17.5 9l3 3-3 3')}` },
  migrations: { label: 'Automatic migrations', draw: (_i, a) => `<path d="M3.5 12.25 12 16.5l8.5-4.25M3.5 16.5 12 20.75l8.5-4.25"/>${A(a, 'M12 3.75 20.5 8 12 12.25 3.5 8 12 3.75Z')}` },
  studio: { label: 'Studio', draw: (_i, a) => `<rect x="3" y="4.25" width="18" height="15.5" rx="2.5"/><path d="M3 8.25h18M10.25 13.75h3.5"/>${A(a, 'M6 11.25h4.25v5H6zM13.75 11.25H18v5h-4.25z')}` },
  transactions: { label: 'Transactions', draw: (_i, a) => `<path d="M5 10.25a7.25 7.25 0 0 1 12.6-3.9M17.75 3.25v3.25H14.5M19 13.75a7.25 7.25 0 0 1-12.6 3.9M6.25 20.75V17.5H9.5"/>${A(a, 'M12 10.25a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5Z')}` },
  'raw-sql': { label: 'Typed raw SQL', draw: (_i, a) => `<path d="M6 3.5h8.25l3.75 3.75V20.5H6V3.5Z"/><path d="M14 3.5v4h4"/>${A(a, 'M8.75 11.75h6.5M8.75 14.75h4.25M8.75 17.75h5.5')}` },
  errors: { label: 'Readable errors', draw: (_i, a) => `<path d="M4 5h16v10.5h-9.5L6.5 19v-3.5H4V5Z"/>${A(a, 'M12 7.75v3.75M12 13.6v.15')}` },
  'soft-delete': { label: 'Soft delete', draw: (_i, a) => `<path d="M4.5 6.5h15M9.25 6.5V4.25h5.5V6.5M6.25 6.5l.9 13.25h9.7l.9-13.25"/>${A(a, 'M9.75 13.5a2.5 2.5 0 1 1 1.1 2.05M9.75 11.25v2.25H12')}` },
  pagination: { label: 'Cursor pagination', draw: (_i, a) => `<rect x="7.5" y="3.25" width="11" height="14" rx="2"/><path d="M5.5 6.75v12a2 2 0 0 0 2 2h8"/><path d="M10.5 7.75h5M10.5 10.75h3.5"/>${A(a, 'M15 12.75 20.5 15l-2.4.8-.85 2.45L15 12.75Z')}` },
  seed: { label: 'Seeds and factories', draw: (_i, a) => `<path d="M12 20.5V12M6 20.5h12"/>${A(a, 'M12 14.5c-4.25 0-6.5-2.75-6.5-6.5 4 0 6.5 2.25 6.5 6.5ZM12 12c.3-4 2.8-6.25 6.5-6.25 0 3.75-2.5 6.25-6.5 6.25Z')}` },
  adapters: { label: 'Bring your own driver', draw: (_i, a) => `<path d="M9 3.5v4.25M15 3.5v4.25M12 16.25v2c0 1.5-1 2.25-2.5 2.25H6.5"/>${A(a, 'M6.75 7.75h10.5v4a4.5 4.5 0 0 1-4.5 4.5h-1.5a4.5 4.5 0 0 1-4.5-4.5v-4Z')}` },
  edge: { label: 'Serverless and edge', draw: (_i, a) => `<path d="M7 18.5a4 4 0 0 1-.6-7.95A6 6 0 0 1 17.9 9.4a4.6 4.6 0 0 1-.4 9.1H7Z"/>${A(a, 'M12.75 10.25 10.5 14h3l-2.25 3.75')}` },
  cli: { label: 'CLI', draw: (_i, a) => `<rect x="3" y="4.25" width="18" height="15.5" rx="2.5"/>${A(a, 'M7 9.25l3 2.75-3 2.75M12.5 15h4.5')}` },
  logs: { label: 'Rows, like logs', draw: (_i, a) => `<circle cx="7.5" cy="16" r="3.75"/><circle cx="16.5" cy="16" r="3.75"/><circle cx="7.5" cy="16" r="1.25"/><circle cx="16.5" cy="16" r="1.25"/>${A(a, 'M12 4.25a3.75 3.75 0 1 0 0 7.5 3.75 3.75 0 0 0 0-7.5ZM12 6.75a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Z')}` },
  blueprint: { label: 'Guide', draw: (_i, a) => `<path d="M12 6.5c-1.75-1.5-4.5-2-8-1.75v13.5c3.5-.25 6.25.25 8 1.75 1.75-1.5 4.5-2 8-1.75V4.75c-3.5-.25-6.25.25-8 1.75Z"/>${A(a, 'M12 6.5v13.5')}` },
  search: { label: 'Search', draw: (_i, a) => `<circle cx="10.75" cy="10.75" r="6.25"/>${A(a, 'M15.5 15.5 20.5 20.5')}` },
  database: { label: 'Database', draw: (_i, a) => `<path d="M5 6v12c0 1.5 3.1 2.75 7 2.75s7-1.25 7-2.75V6M5 12c0 1.5 3.1 2.75 7 2.75S19 13.5 19 12"/>${A(a, 'M12 3.25c3.9 0 7 1.25 7 2.75s-3.1 2.75-7 2.75S5 7.5 5 6s3.1-2.75 7-2.75Z')}` },
  deploy: { label: 'Deploy', draw: (_i, a) => `<path d="M4 15.5v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>${A(a, 'M12 15.5V3.75M7.75 8 12 3.75 16.25 8')}` },
  shield: { label: 'Safe changes', draw: (_i, a) => `<path d="M12 3.25 19 6v5.5c0 4.5-3 7.75-7 9.25-4-1.5-7-4.75-7-9.25V6l7-2.75Z"/>${A(a, 'M9 12l2.1 2.1L15.25 10')}` },
  branch: { label: 'Branches and CI', draw: (_i, a) => `<circle cx="6.5" cy="5.5" r="2"/><circle cx="6.5" cy="18.5" r="2"/><path d="M6.5 7.5v9"/>${A(a, 'M17.5 5.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM17.5 9.5c0 4.5-11 3-11 7')}` },
  gauge: { label: 'Fast', draw: (_i, a) => `<path d="M4.5 17.5a8.25 8.25 0 1 1 15 0"/><path d="M7.25 17.5h9.5" opacity=".5"/>${A(a, 'M12 14.75 15.5 9')}` },
  package: { label: 'Zero dependencies', draw: (_i, a) => `<path d="M12 3.25 20 7.5v9L12 20.75 4 16.5v-9L12 3.25Z"/><path d="M4 7.5l8 4.25 8-4.25M12 11.75v9"/>${A(a, 'M8 5.4l8 4.25')}` },
};

/** Supported databases. Marks are original symbols, not product logos. */
export const DATABASES = [
  { id: 'postgres', name: 'PostgreSQL', short: 'PostgreSQL', entry: 'kastor/postgres' },
  { id: 'cockroach', name: 'CockroachDB', short: 'CockroachDB', entry: 'kastor/cockroach' },
  { id: 'mysql', name: 'MySQL', short: 'MySQL', entry: 'kastor/mysql' },
  { id: 'mariadb', name: 'MariaDB', short: 'MariaDB', entry: 'kastor/mariadb' },
  { id: 'sqlite', name: 'SQLite', short: 'SQLite', entry: 'kastor/sqlite' },
  { id: 'libsql', name: 'libSQL / Turso', short: 'libSQL', entry: 'kastor/libsql' },
  { id: 'd1', name: 'Cloudflare D1', short: 'D1', entry: 'kastor/d1' },
  { id: 'mssql', name: 'SQL Server', short: 'SQL Server', entry: 'kastor/mssql' },
  { id: 'oracle', name: 'Oracle', short: 'Oracle', entry: 'kastor/oracle' },
  { id: 'mongodb', name: 'MongoDB', short: 'MongoDB', entry: 'kastor/mongodb' },
];

/** One line mark per database, 24 by 24. */
const DB_MARKS = {
  // A cylinder: the classic relational store.
  postgres: '<ellipse cx="12" cy="5.75" rx="6.75" ry="2.5"/><path d="M5.25 5.75v12.5c0 1.4 3 2.5 6.75 2.5s6.75-1.1 6.75-2.5V5.75M5.25 12c0 1.4 3 2.5 6.75 2.5s6.75-1.1 6.75-2.5"/>',
  // Three nodes on a hexagon: a cluster that survives losing one.
  cockroach: '<path d="M12 3 19.8 7.5v9L12 21l-7.8-4.5v-9L12 3Z"/><circle cx="12" cy="8" r="1.6"/><circle cx="8.4" cy="14.25" r="1.6"/><circle cx="15.6" cy="14.25" r="1.6"/><path d="M11.2 9.4 9.2 12.9M12.8 9.4l2 3.5M10 14.25h4"/>',
  // A wave cresting over a line.
  mysql: '<path d="M3.5 15.5c2.5-6 5.75-9 9.5-9 3.5 0 6.25 2.25 7.5 6"/><path d="M13 6.5c-1.25 2.75-.75 5.75 1.75 7.75"/><path d="M3.5 19h17"/>',
  // A crescent and a star: the sea at night.
  mariadb: '<path d="M14.5 4.25a7.75 7.75 0 1 0 5.25 13.5A6.25 6.25 0 0 1 14.5 4.25Z"/><path d="M18 5.5v3M16.5 7h3"/>',
  // A quill: a database in one file.
  sqlite: '<path d="M19.5 4.5c-7 .5-11.75 5.25-13 13.25 7.25-1.25 12.25-6 13-13.25Z"/><path d="M4.5 19.5 13.5 10.5M9.25 13.75h3.5M11.5 11.25h3"/>',
  // A fork in the line: the open fork of SQLite.
  libsql: '<circle cx="7" cy="5.5" r="2"/><circle cx="7" cy="18.5" r="2"/><circle cx="17" cy="9" r="2"/><path d="M7 7.5v9M17 11c0 3.5-3 4-6.5 4.5-1.7.25-3.5.75-3.5 1"/>',
  // A cloud with a disk inside.
  d1: '<path d="M7 18.5a4 4 0 0 1-.6-7.95A6 6 0 0 1 17.9 9.4a4.6 4.6 0 0 1-.4 9.1H7Z"/><ellipse cx="12" cy="12.4" rx="2.75" ry="1"/><path d="M9.25 12.4v2.6c0 .55 1.25 1 2.75 1s2.75-.45 2.75-1v-2.6"/>',
  // Two stacked server units.
  mssql: '<rect x="4" y="4.25" width="16" height="6.75" rx="1.75"/><rect x="4" y="13" width="16" height="6.75" rx="1.75"/><path d="M7.25 7.6h.1M7.25 16.4h.1M11 7.6h5.75M11 16.4h5.75"/>',
  // An eye of concentric rings.
  oracle: '<path d="M2.75 12c2.25-4 5.5-6.25 9.25-6.25S19 8 21.25 12c-2.25 4-5.5 6.25-9.25 6.25S5 16 2.75 12Z"/><circle cx="12" cy="12" r="3"/>',
  // A document with braces: a document store.
  mongodb: '<path d="M6 3.5h8.25L18 7.25V20.5H6V3.5Z"/><path d="M10.25 10.25c-1 0-1.25.5-1.25 1.25v.5c0 .5-.3.85-.85 1 .55.15.85.5.85 1v.5c0 .75.25 1.25 1.25 1.25M13.75 10.25c1 0 1.25.5 1.25 1.25v.5c0 .5.3.85.85 1-.55.15-.85.5-.85 1v.5c0 .75-.25 1.25-1.25 1.25"/>',
};

/** Runtimes and platforms. Marks are original symbols, not product logos. */
export const RUNTIMES = [
  { id: 'node', name: 'Node.js', note: '18, 20 and 22', mark: '<path d="M12 2.75 20 7.4v9.2L12 21.25 4 16.6V7.4L12 2.75Z"/><path d="M9 9.5v5.25c0 .9-.6 1.5-1.5 1.5M15.5 10.25c-.4-.6-1.1-.9-1.9-.9-1 0-1.85.5-1.85 1.4 0 1.9 4 1 4 3.1 0 .95-.9 1.5-2 1.5-.95 0-1.75-.35-2.15-1"/>' },
  { id: 'bun', name: 'Bun', note: 'bun:sqlite built in', mark: '<path d="M3.5 14c0-4.75 3.75-8 8.5-8s8.5 3.25 8.5 8c0 3-2.5 4.5-8.5 4.5S3.5 17 3.5 14Z"/><path d="M8.25 8c.6 1.4.6 2.75 0 4M12 7.25c.6 1.5.6 3 0 4.5M15.75 8c.6 1.4.6 2.75 0 4"/>' },
  { id: 'deno', name: 'Deno', note: 'npm: specifiers', mark: '<circle cx="12" cy="12" r="8.75"/><path d="M8.75 9.25l-1.5 2.5M12.5 7l-1.5 2.5M16 9.5l-1.5 2.5"/><path d="M7.5 16.5c1.5-1.25 3-1.75 4.5-1.75s3 .5 4.5 1.75"/>' },
  { id: 'workers', name: 'Cloudflare Workers', note: 'D1, Turso, Neon', mark: '<path d="M7 18.5a4 4 0 0 1-.6-7.95A6 6 0 0 1 17.9 9.4a4.6 4.6 0 0 1-.4 9.1H7Z"/><path d="M10.25 11.5 8.5 13.5l1.75 2M13.75 11.5l1.75 2-1.75 2"/>' },
  { id: 'vercel', name: 'Vercel', note: 'Node and edge functions', mark: '<path d="M12 4 20.5 19.25h-17L12 4Z"/><circle cx="12" cy="4" r="1.25"/><circle cx="3.5" cy="19.25" r="1.25"/><circle cx="20.5" cy="19.25" r="1.25"/><path d="M12 9.5v5.25"/>' },
  { id: 'netlify', name: 'Netlify', note: 'Functions and edge', mark: '<path d="M12 2.75 21.25 12 12 21.25 2.75 12 12 2.75Z"/><path d="M8 12h8M12 8v8"/><circle cx="12" cy="12" r="1.5"/>' },
];

const LINE = 'fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';

/** A database mark as SVG markup, stroked with `ink`. */
export function dbSymbol(db, ink = 'currentColor') {
  return `<g ${LINE} stroke="${ink}">${DB_MARKS[db.id]}</g>`;
}

export function runtimeSymbol(rt, ink = 'currentColor') {
  return `<g ${LINE} stroke="${ink}">${rt.mark}</g>`;
}

const FONT = 'Geist, Inter, Segoe UI, Helvetica Neue, Helvetica, Arial, sans-serif';

export function featureIconSvg(name, { ink, accent }) {
  const ic = FEATURE_ICONS[name];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48" role="img" aria-label="${ic.label}"><g ${LINE} stroke="${ink}">${ic.draw(ink, accent)}</g></svg>`;
}

/** A database mark with its name, for READMEs and slides. */
export function dbIconSvg(db, { ink, text }) {
  const w = 40 + Math.round(db.name.length * 9.2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 32" width="${w}" height="32" role="img" aria-label="${db.name}"><g transform="translate(4 4)">${dbSymbol(db, ink)}</g><text x="36" y="21.5" font-family="${FONT}" font-size="15" font-weight="500" fill="${text}">${db.name}</text></svg>`;
}

/** The site sprite: symbols that follow currentColor and the --ic-accent variable. */
export function sprite() {
  const syms = Object.entries(FEATURE_ICONS)
    .map(([name, ic]) => `<symbol id="ic-${name}" viewBox="0 0 24 24"><g ${LINE} stroke="currentColor">${ic.draw('currentColor', 'var(--ic-accent)')}</g></symbol>`)
    .join('');
  const dbs = DATABASES.map((d) => `<symbol id="db-${d.id}" viewBox="0 0 24 24">${dbSymbol(d)}</symbol>`).join('');
  const rts = RUNTIMES.map((r) => `<symbol id="rt-${r.id}" viewBox="0 0 24 24">${runtimeSymbol(r)}</symbol>`).join('');
  return syms + dbs + rts;
}
