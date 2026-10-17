/* global Worker, performance, ResizeObserver */
// The live playground. Loaded by site.js when the playground scrolls into
// view. Three engines work together:
//   pg-kastor.js  the real kastor core and dialects, bundled from src/, which
//                 compile the query to SQL for every database and plan the
//                 CREATE statements of the schema (instant, on every keystroke)
//   pg-worker.js  a Web Worker running the TypeScript compiler over the real
//                 kastor source to infer the result type and report errors
//   sql.js        SQLite compiled to WebAssembly, loaded on demand, to run the
//                 query against seeded sample rows
import * as K from './pg-kastor.js';
import { PRESETS, SCHEMA, TUTORIAL } from './pg-presets.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const DB_ORDER = ['postgres', 'cockroach', 'mysql', 'mariadb', 'sqlite', 'libsql', 'd1', 'mssql', 'oracle', 'mongodb'];
const DB_NAMES = { postgres: 'PostgreSQL', cockroach: 'CockroachDB', mysql: 'MySQL', mariadb: 'MariaDB', sqlite: 'SQLite', libsql: 'libSQL / Turso', d1: 'Cloudflare D1', mssql: 'SQL Server', oracle: 'Oracle', mongodb: 'MongoDB' };
const SQLJS = 'https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/';

// ---------- Highlighting ----------

const TS_RE = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:\\.|[^'\\\n])*'?|"(?:\\.|[^"\\\n])*"?|`(?:\\.|[^`\\])*`?)|\b(\d+(?:\.\d+)?n?)\b|\b(import|from|export|const|let|var|function|return|await|async|new|true|false|null|undefined|typeof|as|type|interface|if|else|satisfies)\b|\b(string|number|boolean|bigint|Date|unknown|never|Uint8Array)\b|([A-Za-z_$][\w$]*)(?=\s*[(<])|([A-Za-z_$][\w$]*)(?=\??\s*:)/g;
function highlightTs(src) {
  let out = '';
  let last = 0;
  for (const m of src.matchAll(TS_RE)) {
    out += esc(src.slice(last, m.index));
    const cls = m[1] ? 'c' : m[2] ? 's' : m[3] ? 'n' : m[4] ? 'k' : m[5] ? 't' : m[6] ? 'f' : 'p';
    out += `<span class="tk-${cls}">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return `${out + esc(src.slice(last))}\n`;
}

const SQL_KW = new Set('select from where and or not in is null as on join left inner outer cross lateral order by group having limit offset fetch first next rows only insert into values update set delete returning output inserted deleted merge using when matched then case end else conflict do nothing duplicate key exists distinct asc desc nulls last with union all create table index unique primary foreign references cascade restrict default constraint alter add drop column type enum check if like ilike escape collate top coalesce count sum avg min max lower upper cast json true false begin commit generated always identity autoincrement integer int bigint varchar nvarchar text boolean timestamp timestamptz datetime2 datetime date time numeric decimal real double precision float uuid jsonb json blob bytea varbinary raw clob number varchar2 nclob char tinyint smallint serial bigserial bit'.split(' '));
function highlightSql(src) {
  return esc(src).replace(/('(?:[^']|'')*')|("(?:[^"])*"|`[^`]*`|\[[^\]]*\])|(\$\d+|@p\d+|:\d+|\?)|\b(\d+)\b|\b([A-Za-z_][A-Za-z0-9_]*)\b/g, (m, s, id, ph, num, word) => {
    if (s) return `<span class="tk-s">${s}</span>`;
    if (id) return `<span class="tk-p">${id}</span>`;
    if (ph) return `<span class="tk-n">${ph}</span>`;
    if (num) return `<span class="tk-n">${num}</span>`;
    if (word && SQL_KW.has(word.toLowerCase())) return `<span class="tk-k">${word}</span>`;
    if (word && /^(json_\w+|JSON_\w+|jsonb_\w+|row_to_json|to_jsonb?|array_agg|group_concat|string_agg|ifnull|nvl|isnull|iif)$/.test(word)) return `<span class="tk-f">${word}</span>`;
    return m;
  });
}
function highlightJson(src) {
  return esc(src).replace(/("(?:\\.|[^"\\])*")(\s*:)?|\b(-?\d+(?:\.\d+)?)\b|\b(true|false|null)\b/g, (m, str, colon, num, lit) => {
    if (str) return colon ? `<span class="tk-p">${str}</span>${colon}` : `<span class="tk-s">${str}</span>`;
    if (num) return `<span class="tk-n">${num}</span>`;
    return `<span class="tk-k">${lit}</span>`;
  });
}

/** Breaks long single line SQL at clause keywords and sub selects, indented by depth. */
const BREAK = /^(FROM|WHERE|ORDER BY|GROUP BY|HAVING|LIMIT|OFFSET|FETCH|LEFT JOIN|INNER JOIN|CROSS JOIN|JOIN|RETURNING|OUTPUT|VALUES|SET|ON CONFLICT|ON DUPLICATE KEY UPDATE|WHEN MATCHED|WHEN NOT MATCHED|USING|UNION ALL|FOR JSON)\b/i;
export function formatSql(sql) {
  if (sql.includes('\n') || sql.length < 90) return sql;
  const ind = (d) => `\n${'  '.repeat(d)}`;
  let out = '';
  let depth = 0;
  let quote = null;
  const stack = [];
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      out += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '(') {
      const sub = /^\(\s*(SELECT|WITH)\b/i.test(sql.slice(i, i + 12));
      stack.push(sub);
      out += ch;
      if (sub) {
        depth++;
        out += ind(depth);
        while (sql[i + 1] === ' ') i++;
      }
      continue;
    }
    if (ch === ')') {
      if (stack.pop()) {
        depth--;
        out += ind(depth);
      }
      out += ch;
      continue;
    }
    if (ch === ' ' && (stack.length === 0 || stack[stack.length - 1]) && BREAK.test(sql.slice(i + 1, i + 26))) {
      out += ind(depth);
      continue;
    }
    out += ch;
  }
  return out;
}

// ---------- Editors ----------

function editor(root, onChange) {
  const ta = $('textarea', root);
  const code = $('.ed-hl code', root);
  const fit = () => {
    ta.style.height = 'auto';
    ta.style.width = 'auto';
    ta.style.height = `${Math.max(ta.scrollHeight, root.clientHeight)}px`;
    ta.style.width = `${Math.max(ta.scrollWidth, root.clientWidth)}px`;
  };
  // A third layer draws wavy underlines under type errors, with transparent text.
  const errPre = document.createElement('pre');
  errPre.className = 'ed-hl ed-err';
  errPre.setAttribute('aria-hidden', 'true');
  errPre.innerHTML = '<code></code>';
  root.insertBefore(errPre, ta);
  const errCode = $('code', errPre);
  const paint = () => {
    code.innerHTML = highlightTs(ta.value);
    fit();
  };
  const setErrors = (list) => {
    const text = ta.value;
    let out = '';
    let at = 0;
    for (const e of [...list].sort((a, b) => a.start - b.start)) {
      if (e.start < at) continue;
      out += esc(text.slice(at, e.start)) + `<span class="tk-err" title="${esc(e.text)}">${esc(text.slice(e.start, e.start + e.length))}</span>`;
      at = e.start + e.length;
    }
    errCode.innerHTML = list.length ? `${out}${esc(text.slice(at))}\n` : '';
  };
  ta.addEventListener('input', () => {
    paint();
    errCode.innerHTML = '';
    onChange();
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      document.execCommand('insertText', false, '  ');
    } else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      const start = ta.selectionStart;
      const line = ta.value.slice(ta.value.lastIndexOf('\n', start - 1) + 1, start);
      const indent = /^\s*/.exec(line)[0] + (/[{([]\s*$/.test(line) ? '  ' : '');
      e.preventDefault();
      document.execCommand('insertText', false, `\n${indent}`);
    } else if (e.key === 'Escape') {
      ta.blur();
    }
  });
  return {
    get value() {
      return ta.value;
    },
    set value(v) {
      ta.value = v;
      paint();
    },
    paint,
    fit,
    setErrors,
  };
}

// ---------- Evaluating the user's TypeScript ----------

/** Removes the TypeScript only syntax the playground files use. */
export function stripTypes(src) {
  let s = src.replace(/^\s*import\s[\s\S]*?from\s*['"][^'"]+['"]\s*;?/gm, (m) => m.replace(/[^\n]/g, '')).replace(/^\s*import\s+['"][^'"]+['"]\s*;?/gm, '');
  s = s.replace(/^\s*export\s+(type|interface)\s[\s\S]*?(?:\n\}|;)\s*$/gm, '');
  s = s.replace(/\bexport\s+(default\s+)?/g, '');
  s = s.replace(/\s+as\s+const\b/g, '').replace(/\s+satisfies\s+[\w.<>[\]|&\s]+(?=[,;)\n])/g, '');
  // generic arguments on calls: name<...>(  ->  name(
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '<' && /[\w$]/.test(s[i - 1] || '')) {
      let depth = 0;
      let j = i;
      for (; j < s.length; j++) {
        if (s[j] === '<') depth++;
        else if (s[j] === '>' && s[j - 1] !== '=') {
          depth--;
          if (depth === 0) break;
        } else if (s[j] === ';' || (s[j] === '\n' && depth === 1 && !/[,{|&]\s*$/.test(s.slice(i, j)))) break;
      }
      if (depth === 0 && s[j + 1] === '(') {
        i = j;
        continue;
      }
    }
    out += s[i];
  }
  // parameter annotations in arrow functions: (x: Type) =>
  out = out.replace(/\(\s*([\w$]+)\s*:\s*[\w$.<>[\]| ]+\)\s*=>/g, '($1) =>').replace(/\}\s*:\s*(?:typeof\s+)?[\w$.<>[\]| ]+\)\s*=>/g, '}) =>');
  return out;
}

const FACTORY_NAMES = ['table', 't', 'one', 'many', 'index', 'uniqueIndex', 'sql'];
export function evalSchema(src) {
  const js = stripTypes(src);
  const names = [...js.matchAll(/(?:^|\n)\s*(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  const fn = new Function(...FACTORY_NAMES, `"use strict";\n${js}\n;return { ${names.join(', ')} };`);
  const exportsObj = fn(...FACTORY_NAMES.map((n) => K[n]));
  const tables = {};
  for (const [k, v] of Object.entries(exportsObj)) if (K.isTable(v)) tables[k] = v;
  if (!Object.keys(tables).length) throw new Error('The schema exports no table. Declare one with table(\'name\', { ... }).');
  const relations = typeof exportsObj.relations === 'function' ? exportsObj.relations : undefined;
  return { tables, relations };
}

export function evalQuery(src) {
  const js = stripTypes(src).trim().replace(/^await\s+/, '').replace(/;\s*$/, '');
  if (!/^db\./.test(js)) throw new Error('Start the query with db.<model>, for example db.users.findMany({ ... }).');
  return new Function('db', 'sql', `"use strict";\nreturn (${js});`);
}

// ---------- Compiling ----------

const nullExecutor = {
  async query() {
    return { rows: [] };
  },
  async transaction(fn) {
    return fn(nullExecutor);
  },
};

function client(dialect, parsed) {
  return K.kastor({ adapter: { dialect, executor: nullExecutor }, schema: parsed.tables, relations: parsed.relations });
}

async function compileFor(id, parsed, queryFn) {
  const dialect = K.DIALECTS[id];
  const db = client(dialect, parsed);
  const q = queryFn(db, K.sql);
  if (!q || typeof q.toSQL !== 'function') throw new Error('The query must be a single kastor call, like db.users.findMany({ ... }).');
  return await q.toSQL();
}

function sqlBlock(id, statements, kind) {
  const head = `<div class="sql-head"><svg class="dbic" aria-hidden="true"><use href="#db-${id === 'libsql' ? 'libsql' : id}"/></svg>${esc(DB_NAMES[id])}${kind ? ` <span>${kind}</span>` : ''}</div>`;
  const body = statements
    .map((st) => {
      const text = typeof st === 'string' ? st : st.sql;
      const params = typeof st === 'string' ? null : st.params;
      const isJson = id === 'mongodb';
      let shown = text;
      if (isJson) {
        try {
          shown = JSON.stringify(JSON.parse(text), null, 2);
        } catch {
          // not JSON, show as is
        }
      }
      const html = isJson ? highlightJson(shown) : highlightSql(formatSql(shown));
      const p = params && params.length ? `<div class="sql-params">params: ${esc(JSON.stringify(params, (k, v) => (typeof v === 'bigint' ? `${v}n` : v)))}</div>` : '';
      return `<pre class="out-code"><code>${html}</code></pre>${p}`;
    })
    .join('');
  return `<div class="sql-item">${head}${body || '<p class="pg-note">No statements.</p>'}</div>`;
}

function errorBlock(title, err) {
  const e = err || {};
  const hint = e.hint ? `\n\nhint: ${e.hint}` : '';
  return `<div class="pg-err"><b>${esc(title)}${e.code ? `: ${esc(e.code)}` : ''}</b>${esc(e.message || String(err))}${esc(hint)}</div>`;
}

// ---------- Sample data for the Rows tab ----------

const FIRST = ['Ada', 'Grace', 'Linus', 'Margaret', 'Edsger', 'Barbara', 'Donald', 'Frances', 'Ken', 'Radia'];
const LAST = ['Lovelace', 'Hopper', 'Torvalds', 'Hamilton', 'Dijkstra', 'Liskov', 'Knuth', 'Allen', 'Thompson', 'Perlman'];
const WORDS = ['typescript', 'orm', 'rows', 'logs', 'dams', 'rivers', 'blueprints', 'schemas', 'queries', 'migrations', 'indexes', 'joins'];

function sampleValue(col, key, i, refs) {
  const c = col.config;
  if (c.references) {
    const target = c.references.target();
    const ids = refs[target.tableName] || [];
    return ids.length ? ids[(i * 7 + key.length) % ids.length] : null;
  }
  const k = key.toLowerCase();
  switch (c.type) {
    case 'string':
    case 'text':
      if (k.includes('email')) return `${FIRST[i % 10].toLowerCase()}${i >= 10 ? i : ''}@example.com`;
      if (k === 'name' && /tag|categor|label|topic/i.test(col.tableName || '')) return WORDS[i % WORDS.length];
      if (k === 'name' || k.endsWith('name')) return i % 6 === 5 && c.nullable ? null : `${FIRST[i % 10]} ${LAST[(i * 3) % 10]}`;
      if (k.includes('title')) return `Notes on ${WORDS[i % WORDS.length]} and ${WORDS[(i + 5) % WORDS.length]}`;
      if (k.includes('slug')) return `${WORDS[i % WORDS.length]}-${i + 1}`;
      return i % 5 === 4 && c.nullable ? null : `${WORDS[(i * 5) % WORDS.length]} ${i + 1}`.slice(0, c.length || 200);
    case 'int':
    case 'float':
      return k.includes('view') || k.includes('count') ? (i * 37) % 250 : i + 1;
    case 'bigint':
      return BigInt(i + 1);
    case 'decimal':
      return `${(i * 3.75 + 9.99).toFixed(c.scale ?? 2)}`;
    case 'boolean':
      return i % 3 !== 2;
    case 'datetime':
      return new Date(Date.UTC(2026, 0, 1 + i * 9, 9 + (i % 8)));
    case 'date':
      return `2026-0${1 + (i % 9)}-1${i % 10}`;
    case 'time':
      return `0${i % 10}:30:00`;
    case 'json':
      return { n: i };
    case 'bytes':
      return new Uint8Array([i, i + 1]);
    case 'uuid':
      return crypto.randomUUID();
    case 'enum':
      return c.enumValues[i % c.enumValues.length];
    default:
      return null;
  }
}

export async function seed(db, parsed) {
  const ir = K.toSchemaIR(parsed.tables);
  const order = K.sortByDependencies ? K.sortByDependencies(ir.tables).map((t) => t.name) : ir.tables.map((t) => t.name);
  const refs = {};
  const byDbName = Object.entries(parsed.tables).map(([model, tbl]) => [tbl.$table.name, model, tbl]);
  for (const name of order) {
    const entry = byDbName.find(([n]) => n === name);
    if (!entry) continue;
    const [, model, tbl] = entry;
    const cols = Object.entries(tbl.$table.columns);
    const pk = cols.filter(([, c]) => c.config.primaryKey);
    const auto = pk.length === 1 && pk[0][1].config.default?.kind === 'autoincrement';
    const n = cols.some(([, c]) => c.config.references) ? 12 : 6;
    const seen = new Set();
    const ids = [];
    for (let i = 0; i < n; i++) {
      const data = {};
      for (const [key, col] of cols) {
        if (col.config.default?.kind === 'autoincrement') continue;
        if (col.config.default && !col.config.references && col.config.type !== 'enum' && col.config.type !== 'boolean' && !/view|count/i.test(key)) continue;
        data[key] = sampleValue(col, key, col.config.references ? i + Math.floor(i / 3) : i, refs);
      }
      const sig = JSON.stringify(cols.filter(([, c]) => c.config.unique || c.config.primaryKey).map(([k]) => data[k]));
      if (seen.has(sig) && sig !== '[]' && sig !== '[null]') continue;
      seen.add(sig);
      try {
        const row = await db[model].create({ data });
        if (pk.length === 1) ids.push(row[pk[0][0]]);
      } catch {
        // a sample row that breaks a constraint is skipped
      }
    }
    if (pk.length === 1) refs[name] = auto || ids.length ? ids : [];
  }
}

let sqlJsPromise = null;
function loadSqlJs() {
  if (!sqlJsPromise) {
    sqlJsPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `${SQLJS}sql-wasm.js`;
      s.crossOrigin = 'anonymous';
      s.onload = () => window.initSqlJs({ locateFile: (f) => SQLJS + f }).then(resolve, reject);
      s.onerror = () => reject(new Error('Could not load sql.js from jsDelivr.'));
      document.head.appendChild(s);
    }).catch((e) => {
      sqlJsPromise = null;
      throw e;
    });
  }
  return sqlJsPromise;
}

function renderValue(v) {
  if (v === null || v === undefined) return '<em>null</em>';
  if (v instanceof Date) return esc(v.toISOString());
  if (typeof v === 'bigint') return `${v}n`;
  if (v instanceof Uint8Array) return esc(`Uint8Array(${v.length})`);
  if (typeof v === 'object') return esc(JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? `${x}n` : x)));
  return esc(String(v));
}

export function rowsHtml(result) {
  const json = (v) => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? `${x}n` : x instanceof Uint8Array ? `Uint8Array(${x.length})` : x), 2);
  const list = Array.isArray(result) ? result : result && typeof result === 'object' && !(result instanceof Date) ? [result] : null;
  if (!list) return `<pre class="out-code"><code>${highlightJson(json(result))}</code></pre>`;
  if (!list.length) return '<p class="pg-note">No rows matched.</p>';
  const flat = list.every((r) => r && Object.values(r).every((v) => v === null || typeof v !== 'object' || v instanceof Date));
  if (!flat) return `<pre class="out-code"><code>${highlightJson(json(result))}</code></pre>`;
  const keys = Object.keys(list[0]);
  return `<table class="rows-table"><thead><tr>${keys.map((k) => `<th>${esc(k)}</th>`).join('')}</tr></thead><tbody>${list.map((r) => `<tr>${keys.map((k) => `<td>${renderValue(r[k])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

// ---------- Tutorial ----------

/** The five step tutorial above the editors: step pills, the task, Show me and Next. */
function makeTutorial(root, hooks) {
  const box = $('[data-tutorial]', root);
  const t = { index: 0, done: new Set(), check() {}, go() {} };
  if (!box) return t;
  const pills = $$('[data-step]', box);
  const title = $('[data-step-title]', box);
  const text = $('[data-step-text]', box);
  const count = $('[data-step-count]', box);
  const status = $('[data-step-state]', box);
  const next = $('[data-next]', box);
  const prev = $('[data-prev]', box);
  const show = $('[data-show]', box);
  const finish = $('[data-finish]', box);
  const bar = $('[data-progress]', box);
  const paint = () => {
    const step = TUTORIAL[t.index];
    const ok = t.done.has(t.index);
    pills.forEach((p, i) => {
      if (i === t.index) p.setAttribute('aria-current', 'step');
      else p.removeAttribute('aria-current');
      p.classList.toggle('is-done', t.done.has(i));
    });
    title.textContent = step.title;
    text.innerHTML = step.text;
    count.textContent = `Step ${t.index + 1} of ${TUTORIAL.length}`;
    status.textContent = ok ? (t.index === TUTORIAL.length - 1 ? 'Done. That is the whole loop.' : 'Done. On to the next step.') : 'Your turn: make the edit, or press Show me.';
    box.classList.toggle('is-ok', ok);
    prev.disabled = t.index === 0;
    next.hidden = t.index === TUTORIAL.length - 1;
    next.classList.toggle('btn-solid', ok);
    next.classList.toggle('btn-line', !ok);
    show.hidden = ok;
    finish.hidden = t.done.size !== TUTORIAL.length;
    bar.style.transform = `scaleX(${t.done.size / TUTORIAL.length})`;
  };
  t.go = (i) => {
    t.index = Math.max(0, Math.min(TUTORIAL.length - 1, i));
    paint();
    hooks.load(TUTORIAL[t.index]);
  };
  t.check = () => {
    if (!t.done.has(t.index) && hooks.passed(TUTORIAL[t.index].check)) {
      t.done.add(t.index);
      box.classList.remove('just-done');
      void box.offsetWidth;
      box.classList.add('just-done');
      paint();
    }
  };
  pills.forEach((p) => p.addEventListener('click', () => t.go(Number(p.dataset.step))));
  next.addEventListener('click', () => t.go(t.index + 1));
  prev.addEventListener('click', () => t.go(t.index - 1));
  show.addEventListener('click', () => hooks.apply(TUTORIAL[t.index].solution));
  paint();
  return t;
}

// ---------- Mount ----------

export function mount(root) {
  const status = $('[data-status]', root);
  const diag = $('[data-diag]', root);
  const typeOut = $('[data-type]', root);
  const sqlOut = $('[data-sql]', root);
  const migOut = $('[data-migration]', root);
  const rowsOut = $('[data-rows]', root);
  const dbBar = $('[data-dbs]', root);
  const allBox = $('[data-all]', root);
  const foot = $('[data-foot]', root);
  const shared = window.kastorDb;
  const state = { out: 'type', db: shared?.get() || 'postgres', all: false, parsed: null, queryFn: null, seq: 0, typeSeq: 0, rowsFor: '', rowsOk: '' };
  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(run, 140);
  };
  const edSchema = editor($('[data-editor="schema"]', root), schedule);
  const edQuery = editor($('[data-editor="query"]', root), schedule);

  const setStatus = (text, kind = '') => {
    status.textContent = text;
    status.className = `pg-status ${kind}`;
  };

  // Files
  $$('.pg-file', root).forEach((b) =>
    b.addEventListener('click', () => {
      $$('.pg-file', root).forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      $$('[data-editor]', root).forEach((ed) => (ed.hidden = ed.dataset.editor !== b.dataset.file));
      (b.dataset.file === 'schema' ? edSchema : edQuery).fit();
    }),
  );
  // Output tabs
  $$('.pg-otab', root).forEach((b) =>
    b.addEventListener('click', () => {
      state.out = b.dataset.out;
      $$('.pg-otab', root).forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      $$('[data-panel]', root).forEach((p) => (p.hidden = p.dataset.panel !== state.out));
      dbBar.hidden = !(state.out === 'sql' || state.out === 'migration');
      renderSql();
      if (state.out === 'rows' && state.queryFn && state.rowsFor !== key()) runRows();
    }),
  );
  // The database follows the switcher shared by every example on the page.
  const selectDb = (id) => {
    if (!K.DIALECTS[id]) return;
    state.db = id;
    $$('.db-tab', root).forEach((x) => x.setAttribute('aria-selected', String(x.dataset.dialect === id)));
    if (state.all) {
      state.all = false;
      allBox.checked = false;
    }
    renderSql();
  };
  $$('.db-tab', root).forEach((b) =>
    b.addEventListener('click', () => {
      if (shared) shared.set(b.dataset.dialect);
      else selectDb(b.dataset.dialect);
    }),
  );
  window.addEventListener('kastor:db', (e) => selectDb(e.detail));
  $$('.db-tab', root).forEach((x) => x.setAttribute('aria-selected', String(x.dataset.dialect === state.db)));
  allBox.addEventListener('change', () => {
    state.all = allBox.checked;
    renderSql();
  });
  // Presets
  $$('[data-preset]', root).forEach((b) =>
    b.addEventListener('click', () => {
      const p = PRESETS[Number(b.dataset.preset)];
      $$('[data-preset]', root).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      edSchema.value = p.schema || SCHEMA;
      edQuery.value = p.query;
      $('.pg-file[data-file="query"]', root).click();
      run();
    }),
  );
  $('[data-run]', root)?.addEventListener('click', runRows);

  // Type checker worker
  let worker = null;
  let workerReady = false;
  try {
    worker = new Worker(new URL('./pg-worker.js', import.meta.url));
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.kind === 'ready') {
        workerReady = true;
        foot.textContent = `kastor ${K.VERSION || '0.2.0'} compiled from source, TypeScript ${m.version} checking the types, all in your browser.`;
        sendTypes();
        return;
      }
      if (m.kind === 'loading') {
        if (state.out === 'type') typeOut.textContent = `// ${m.text}`;
        return;
      }
      if (m.kind === 'result' && m.id === state.typeSeq) {
        if (m.error) {
          typeOut.innerHTML = esc(`// The type checker stopped: ${m.error}`);
          return;
        }
        const mongoNote = /\bt\.(id|bigId)\(\)/.test(edSchema.value) ? `\n\n// On MongoDB, id keys and the columns that reference them are strings\n// (ObjectId), unless you pass mongodb(db, { ids: 'int' }).` : '';
        typeOut.innerHTML = highlightTs(`type Result = ${m.type}${mongoNote}`).trimEnd();
        diag.hidden = !m.diags.length;
        diag.innerHTML = m.diags.map((d) => `<p><b>${esc(d.file)}:${d.line}:${d.col}</b>${esc(d.text)}</p>`).join('');
        edSchema.setErrors(m.diags.filter((d) => d.editor === 'schema'));
        edQuery.setErrors(m.diags.filter((d) => d.editor === 'query'));
        if (m.diags.length) setStatus(`${m.diags.length} type error${m.diags.length > 1 ? 's' : ''}`, 'err');
        else setStatus(`checked in ${m.ms} ms`, 'ok');
      }
    };
    worker.onerror = () => {
      typeOut.textContent = '// The type checker could not start in this browser.';
    };
    worker.postMessage({ kind: 'init' });
  } catch {
    typeOut.textContent = '// The type checker needs Web Workers.';
  }

  function sendTypes() {
    if (!worker || !workerReady || !state.parsed) return;
    state.typeSeq++;
    worker.postMessage({ kind: 'check', id: state.typeSeq, schema: edSchema.value, query: edQuery.value, models: Object.keys(state.parsed.tables), relations: Boolean(state.parsed.relations) });
  }

  const key = () => `${edSchema.value}\u0000${edQuery.value}`;

  async function renderSql() {
    if (state.out !== 'sql' && state.out !== 'migration') return;
    const seq = state.seq;
    const ids = state.all ? DB_ORDER : [state.db];
    const target = state.out === 'sql' ? sqlOut : migOut;
    if (!state.parsed) return;
    const parts = [];
    for (const id of ids) {
      try {
        if (state.out === 'sql') {
          if (!state.queryFn) throw state.queryError;
          parts.push(sqlBlock(id, await compileFor(id, state.parsed, state.queryFn)));
        } else {
          parts.push(sqlBlock(id, K.planCreate(id, state.parsed.tables), id === 'mongodb' ? 'collections and indexes' : 'migration.sql'));
        }
      } catch (e) {
        parts.push(`<div class="sql-item"><div class="sql-head">${esc(DB_NAMES[id])}</div>${errorBlock(state.out === 'sql' ? 'Query' : 'Schema', e)}</div>`);
      }
    }
    if (seq === state.seq) target.innerHTML = parts.join('');
  }

  async function runRows() {
    const myKey = key();
    state.rowsFor = myKey;
    rowsOut.innerHTML = '<p class="pg-note">Loading SQLite (sql.js) and seeding sample rows</p>';
    try {
      const SQL = await loadSqlJs();
      const sdb = new SQL.Database();
      const adapter = K.sqlJsAdapter(sdb);
      for (const st of K.planCreate('sqlite', state.parsed.tables)) sdb.run(st);
      const db = K.kastor({ adapter, schema: state.parsed.tables, relations: state.parsed.relations });
      await seed(db, state.parsed);
      const started = performance.now();
      const result = await state.queryFn(db, K.sql);
      const ms = (performance.now() - started).toFixed(1);
      if (key() !== myKey) return;
      rowsOut.innerHTML = `<p class="pg-note">Ran on SQLite in ${ms} ms against freshly seeded sample rows.</p>${rowsHtml(result)}`;
      state.rowsOk = myKey;
      tutorial.check();
      sdb.close();
    } catch (e) {
      rowsOut.innerHTML = errorBlock('SQLite', e) + '<button type="button" class="btn btn-primary btn-sm" data-run>Try again</button>';
      $('[data-run]', rowsOut)?.addEventListener('click', runRows);
    }
  }

  function run() {
    state.seq++;
    state.rowsOk = '';
    try {
      state.parsed = evalSchema(edSchema.value);
    } catch (e) {
      state.parsed = null;
      setStatus('schema error', 'err');
      const html = errorBlock('Schema', e);
      sqlOut.innerHTML = html;
      migOut.innerHTML = html;
      typeOut.innerHTML = esc(`// Fix the schema first: ${e.message}`);
      return;
    }
    try {
      state.queryFn = evalQuery(edQuery.value);
      state.queryError = null;
    } catch (e) {
      state.queryFn = null;
      state.queryError = e;
    }
    if (!workerReady) setStatus('compiled, loading TypeScript');
    renderSql();
    sendTypes();
    tutorial.check();
    if (state.out === 'rows' && state.queryFn) runRows();
    else rowsOut.innerHTML = '<p class="pg-note">Runs your query against an in-memory SQLite database (sql.js) seeded with sample rows. Loads about 1 MB the first time.</p><button type="button" class="btn btn-primary btn-sm" data-run>Run on SQLite</button>';
    $('[data-run]', rowsOut)?.addEventListener('click', runRows);
  }

  // ---------- Tutorial ----------

  const tutorial = makeTutorial(root, {
    load(step) {
      edSchema.value = step.schema;
      edQuery.value = step.query;
      run();
      $(`.pg-file[data-file="${step.file}"]`, root).click();
      $(`.pg-otab[data-out="${step.out}"]`, root).click();
    },
    apply(solution) {
      if (solution.schema) edSchema.value = solution.schema;
      if (solution.query) edQuery.value = solution.query;
      if (solution.schema || solution.query) run();
      else if (state.out !== 'rows') $('.pg-otab[data-out="rows"]', root).click();
      else runRows();
    },
    passed(check) {
      const cols = (name) => state.parsed?.tables[name]?.$table?.columns || {};
      if (check === 'users.name') return Boolean(cols('users').name);
      if (check === 'posts.authorId.references') return Boolean(cols('posts').authorId?.config.references);
      if (check === 'query.include.posts') return Boolean(state.queryFn) && /include\s*:\s*\{[^}]*\bposts\s*:/.test(edQuery.value);
      if (check === 'posts.views') return Boolean(cols('posts').views);
      if (check === 'rows') return state.rowsOk !== '' && state.rowsOk === key();
      return false;
    },
  });

  // Examples and the tutorial share the editors.
  const modes = $$('[data-mode]', root);
  const setMode = (mode) => {
    modes.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
    $('[data-tutorial]', root).hidden = mode !== 'tutorial';
    $('.pg-presets', root).hidden = mode !== 'examples';
    if (mode === 'examples') $('[data-preset="0"]', root).click();
    else tutorial.go(tutorial.index);
  };
  modes.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  if ($('[data-tutorial]', root)) setMode('tutorial');
  else {
    edSchema.value = SCHEMA;
    edQuery.value = PRESETS[0].query;
    run();
  }
  new ResizeObserver(() => {
    edSchema.fit();
    edQuery.fit();
  }).observe($('.pg-editors', root));
}
