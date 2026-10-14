// The kastor icon set: 48 by 48 duotone line icons, drawn for the project.
// Each entry is a function of (ink, accent, blue) so the same drawing yields
// the light files, the dark files and the site sprite (currentColor).

export const FEATURE_ICONS = {
  schema: {
    label: 'Schema in TypeScript',
    draw: (_i, _a, _b, s) => `<rect x="7" y="8" width="34" height="32" rx="5" fill="${s}"/><rect x="7" y="8" width="34" height="32" rx="5"/><path d="M7 17 H41 M7 25.5 H41 M7 33 H41 M19 17 V40"/>`,
  },
  types: {
    label: 'Inferred types',
    draw: (_i, a, _b, _s) => `<path d="M16 12 L7 24 L16 36 M32 12 L41 24 L32 36"/><circle cx="24" cy="24" r="7" fill="${a}"/><path d="M20.5 24 L23 26.5 L27.5 21.5"/>`,
  },
  'no-codegen': {
    label: 'No generate step',
    draw: (_i, a, _b, _s) => `<path d="M27 5 L11 27 H23 L20 43 L37 20 H25 Z" fill="${a}" stroke-linejoin="round"/>`,
  },
  query: {
    label: 'Friendly queries',
    draw: (_i, _a, _b, s) => `<path d="M7 11 H31 M7 19 H25 M7 27 H19 M7 35 H17"/><circle cx="31" cy="30" r="8" fill="${s}"/><circle cx="31" cy="30" r="8"/><path d="M37 36 L42 41"/>`,
  },
  relations: {
    label: 'Relations',
    draw: (_i, a, _b, _s) => `<path d="M16 16 L21 31 M32 16 L27 31 M17 13 H31"/><circle cx="12" cy="13" r="5" fill="${a}"/><circle cx="36" cy="13" r="5" fill="${a}"/><circle cx="24" cy="36" r="6" fill="${a}"/>`,
  },
  'one-query': {
    label: 'Nested includes in one query',
    draw: (_i, a, _b, _s) => `<path d="M6 11 C 18 11 18 24 29 24 M6 24 H29 M6 37 C 18 37 18 24 29 24"/><path d="M29 24 H42 M36 18 L42 24 L36 30"/><circle cx="29" cy="24" r="4" fill="${a}"/>`,
  },
  migrations: {
    label: 'Automatic migrations',
    draw: (_i, a, _b, _s) => `<path d="M24 7 L41 15.5 L24 24 L7 15.5 Z" fill="${a}" stroke-linejoin="round"/><path d="M7 24 L24 32.5 L41 24 M7 32 L24 40.5 L41 32" stroke-linejoin="round"/>`,
  },
  studio: {
    label: 'Studio',
    draw: (_i, a, _b, _s) => `<rect x="5" y="9" width="38" height="30" rx="4"/><path d="M5 16 H43"/><rect x="10" y="21" width="11" height="8" rx="2" fill="${a}"/><rect x="27" y="27" width="11" height="8" rx="2" fill="${a}"/><path d="M21 25 H24 V31 H27"/>`,
  },
  transactions: {
    label: 'Transactions',
    draw: (_i, a, _b, _s) => `<path d="M11 21 A 14 14 0 0 1 37 17 M37 9 V17 H29"/><path d="M37 27 A 14 14 0 0 1 11 31 M11 39 V31 H19"/><circle cx="24" cy="24" r="4.5" fill="${a}"/>`,
  },
  'raw-sql': {
    label: 'Typed raw SQL',
    draw: (_i, _a, _b, s) => `<rect x="7" y="6" width="34" height="36" rx="5" fill="${s}"/><rect x="7" y="6" width="34" height="36" rx="5"/><path d="M14 12 L17 17 M31 12 L34 17 M13 25 H35 M13 31 H29 M13 37 H22"/>`,
  },
  errors: {
    label: 'Readable errors',
    draw: (i, a, _b, _s) => `<path d="M7 9 H41 V32 H22 L13 40 V32 H7 Z" fill="${a}" stroke-linejoin="round"/><path d="M24 15 V23"/><circle cx="24" cy="27.5" r="1.2" fill="${i}"/>`,
  },
  'soft-delete': {
    label: 'Soft delete',
    draw: (_i, _a, _b, s) => `<path d="M10 14 H38 M19 14 V9 H29 V14"/><path d="M13 14 L15.5 41 H32.5 L35 14" fill="${s}" stroke-linejoin="round"/><path d="M19.5 28 A 5 5 0 1 1 24 33.5 M19.5 23 V28 H24.5"/>`,
  },
  pagination: {
    label: 'Cursor pagination',
    draw: (i, a, _b, _s) => `<rect x="12" y="5" width="24" height="30" rx="3"/><rect x="7" y="10" width="24" height="30" rx="3" fill="${a}"/><path d="M12 18 H25 M12 24 H22"/><path d="M28 27 L42 33 L35.5 35 L33 41.5 Z" fill="${i}" stroke-linejoin="round"/>`,
  },
  seed: {
    label: 'Seeds and factories',
    draw: (_i, a, _b, _s) => `<path d="M24 41 V24"/><path d="M24 29 C 14 29 9 22 9 14 C 18 14 24 19 24 29 Z M24 25 C 25 16 31 11 40 11 C 40 19 34 25 24 25 Z" fill="${a}" stroke-linejoin="round"/><path d="M11 41 H37"/>`,
  },
  adapters: {
    label: 'Bring your own driver',
    draw: (_i, a, _b, _s) => `<path d="M19 17 V8 M29 17 V8"/><rect x="13" y="17" width="22" height="14" rx="4" fill="${a}"/><path d="M24 31 V36 C 24 41 20 42 16 42 H10"/>`,
  },
  edge: {
    label: 'Serverless and edge',
    draw: (_i, a, _b, _s) => `<path d="M14 36 A 8 8 0 0 1 13 20 A 11 11 0 0 1 34 17 A 9.5 9.5 0 0 1 35 36 Z" fill="${a}" stroke-linejoin="round"/><path d="M26 21 L20.5 29.5 H27 L23.5 38" stroke-linejoin="round"/>`,
  },
  cli: {
    label: 'CLI',
    draw: (_i, _a, _b, s) => `<rect x="5" y="9" width="38" height="30" rx="4" fill="${s}"/><rect x="5" y="9" width="38" height="30" rx="4"/><path d="M12 19 L18 24 L12 29 M22 30 H33"/>`,
  },
  logs: {
    label: 'Rows, like logs',
    draw: (_i, a, _b, _s) => `<circle cx="14" cy="33" r="9" fill="${a}"/><circle cx="34" cy="33" r="9" fill="${a}"/><circle cx="24" cy="16" r="9" fill="${a}"/><circle cx="14" cy="33" r="3.5"/><circle cx="34" cy="33" r="3.5"/><circle cx="24" cy="16" r="3.5"/>`,
  },
  blueprint: {
    label: 'Blueprint',
    draw: (_i, a, b, _s) => `<rect x="6" y="13" width="30" height="22" rx="3" fill="${b}" fill-opacity=".85"/><rect x="6" y="13" width="30" height="22" rx="3"/><ellipse cx="36" cy="24" rx="5" ry="11" fill="${a}"/><path d="M11 20 H29 M11 25 H25 M11 30 H28" stroke-width="2"/>`,
  },
  search: {
    label: 'Search',
    draw: (_i, _a, _b, s) => `<circle cx="21" cy="21" r="12" fill="${s}"/><circle cx="21" cy="21" r="12"/><path d="M30 30 L41 41"/>`,
  },
};

/** Databases: an original cylinder with a two letter monogram, one hue each. */
export const DATABASES = [
  { id: 'postgres', name: 'PostgreSQL', mono: 'PG', hue: '#3768b5', entry: 'kastor/postgres' },
  { id: 'cockroach', name: 'CockroachDB', mono: 'CR', hue: '#6a4fd6', entry: 'kastor/cockroach' },
  { id: 'mysql', name: 'MySQL', mono: 'MY', hue: '#127f96', entry: 'kastor/mysql' },
  { id: 'mariadb', name: 'MariaDB', mono: 'MA', hue: '#a8612f', entry: 'kastor/mariadb' },
  { id: 'sqlite', name: 'SQLite', mono: 'SL', hue: '#2f86cf', entry: 'kastor/sqlite' },
  { id: 'libsql', name: 'libSQL / Turso', mono: 'LS', hue: '#16947f', entry: 'kastor/libsql' },
  { id: 'd1', name: 'Cloudflare D1', mono: 'D1', hue: '#e0731a', entry: 'kastor/d1' },
  { id: 'mssql', name: 'SQL Server', mono: 'MS', hue: '#c23b3b', entry: 'kastor/mssql' },
  { id: 'oracle', name: 'Oracle', mono: 'OR', hue: '#9a2f55', entry: 'kastor/oracle' },
  { id: 'mongodb', name: 'MongoDB', mono: 'MG', hue: '#2f9150', entry: 'kastor/mongodb' },
];

export function dbSymbol(db, ink) {
  return `<path d="M9 12 V36 A15 5 0 0 0 39 36 V12" fill="${db.hue}"/><ellipse cx="24" cy="12" rx="15" ry="5" fill="${db.hue}"/><ellipse cx="24" cy="12" rx="15" ry="5" fill="#ffffff" fill-opacity=".35"/><path d="M9 12 V36 A15 5 0 0 0 39 36 V12" fill="none" stroke="${ink}" stroke-width="2.6"/><ellipse cx="24" cy="12" rx="15" ry="5" fill="none" stroke="${ink}" stroke-width="2.6"/><path d="M9 20 A15 5 0 0 0 39 20" fill="none" stroke="#ffffff" stroke-opacity=".45" stroke-width="2"/><text x="24" y="33.5" text-anchor="middle" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="11.5" font-weight="800" fill="#ffffff" letter-spacing=".3">${db.mono}</text>`;
}

const FONT = "Segoe UI, Helvetica Neue, Helvetica, Arial, sans-serif";

export function featureIconSvg(name, { ink, accent, blue, soft }) {
  const ic = FEATURE_ICONS[name];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48" role="img" aria-label="${ic.label}"><g fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${ic.draw(ink, accent, blue, soft)}</g></svg>`;
}

export function dbIconSvg(db, { ink, text }) {
  const w = 58 + Math.round(db.name.length * 11.2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 48" width="${w}" height="48" role="img" aria-label="${db.name}">${dbSymbol(db, ink)}<text x="50" y="30.5" font-family="${FONT}" font-size="18" font-weight="700" fill="${text}">${db.name}</text></svg>`;
}

/** The site sprite: symbols that follow currentColor and the --ic-accent variable. */
export function sprite() {
  const syms = Object.entries(FEATURE_ICONS)
    .map(([name, ic]) => `<symbol id="ic-${name}" viewBox="0 0 48 48"><g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${ic.draw('currentColor', 'var(--ic-accent)', 'var(--ic-blue)', 'var(--ic-soft)')}</g></symbol>`)
    .join('');
  const dbs = DATABASES.map((d) => `<symbol id="db-${d.id}" viewBox="0 0 48 48">${dbSymbol(d, 'var(--db-ink)')}</symbol>`).join('');
  return syms + dbs;
}
