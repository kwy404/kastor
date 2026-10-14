/// <reference lib="dom" />
/**
 * The studio front end. `clientMain` runs in the browser: the server sends
 * its source as `/app.js`, so everything it needs lives inside the function.
 * It is plain TypeScript so the compiler checks it like the rest of kastor.
 */

export function clientMain(): void {
  type Col = { name: string; type: string; nullable: boolean; default?: { kind: string; value?: unknown }; enumValues?: string[]; length?: number };
  type Fk = { name: string; columns: string[]; refTable: string; refColumns: string[] };
  type Table = { name: string; columns: Col[]; primaryKey: string[]; indexes: { name: string; columns: string[]; unique: boolean }[]; foreignKeys: Fk[] };
  type Rel = { from: string; columns: string[]; to: string; refColumns: string[]; name: string };
  type Schema = { dialect: string; version: string; readOnly: boolean; tables: Table[]; relations: Rel[] };
  type Filter = { column: string; op: string; value?: unknown };
  type Route = { view: 'home' } | { view: 'diagram' } | { view: 'table'; table: string; tab: 'data' | 'structure'; filters: Filter[]; page: number; sort?: string; dir: 'asc' | 'desc'; q: string };

  const TOKEN_KEY = 'kastor-studio:token';
  const THEME_KEY = 'kastor-studio:theme';
  const PAGE_SIZE_KEY = 'kastor-studio:page-size';

  const params = new URLSearchParams(location.search);
  const urlToken = params.get('token');
  if (urlToken) {
    try {
      sessionStorage.setItem(TOKEN_KEY, urlToken);
    } catch {
      /* private mode: keep it in memory */
    }
    history.replaceState(null, '', location.pathname + location.hash);
  }
  let token = urlToken ?? '';
  try {
    token = token || sessionStorage.getItem(TOKEN_KEY) || '';
  } catch {
    /* ignore */
  }

  const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T => root.querySelector(sel) as T;
  const esc = (s: unknown): string =>
    String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string);

  let schema: Schema | null = null;
  let pageSize = Number(localStorage.getItem(PAGE_SIZE_KEY)) || 50;
  let current: { table: Table; rows: Record<string, unknown>[]; total: number; route: Extract<Route, { view: 'table' }> } | null = null;
  const selected = new Set<string>();

  /* -------------------------------------------------------------- toasts */
  function toast(message: string, tone: 'success' | 'danger' | 'info' | 'warning' = 'info', description?: string): void {
    const M = (window as any).Monsoon;
    if (M && typeof M.toast === 'function') {
      M.toast(message, { tone, description, position: 'bottom-end' });
      return;
    }
    let box = document.getElementById('toasts');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toasts';
      box.className = 'toast toast-bottom toast-end';
      document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = `alert alert-${tone} alert-solid`;
    el.setAttribute('role', 'status');
    el.innerHTML = `<div class="alert-content"><p class="alert-title">${esc(message)}</p>${description ? `<p class="alert-description">${esc(description)}</p>` : ''}</div>`;
    box.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  /* ---------------------------------------------------------------- API */
  async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(path, {
      method,
      headers: { 'X-Kastor-Token': token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = (data as { error?: { message?: string; hint?: string } }).error ?? {};
      const e = new Error(err.message ?? `Request failed (${res.status})`) as Error & { hint?: string; status?: number };
      e.hint = err.hint;
      e.status = res.status;
      throw e;
    }
    return data as T;
  }

  function fail(error: unknown): void {
    const e = error as Error & { hint?: string; status?: number };
    if (e.status === 401) {
      showLocked();
      return;
    }
    toast(e.message || String(error), 'danger', e.hint);
  }

  function showLocked(): void {
    $('#view').innerHTML = `<div class="empty-state empty-state-bordered max-w-xl mx-auto mt-10">
      <h2 class="empty-state-title">This studio link has expired</h2>
      <p class="empty-state-description">Open the link printed by <code>kastor studio</code> in your terminal. Each run creates a new private link.</p>
    </div>`;
  }

  /* ------------------------------------------------------------- routing */
  function parseRoute(): Route {
    const hash = location.hash.replace(/^#\/?/, '');
    const [path = '', query = ''] = hash.split('?');
    const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
    const q = new URLSearchParams(query);
    if (parts[0] === 'diagram') return { view: 'diagram' };
    if (parts[0] === 'table' && parts[1]) {
      let filters: Filter[] = [];
      try {
        filters = JSON.parse(q.get('filters') ?? '[]');
      } catch {
        filters = [];
      }
      return {
        view: 'table',
        table: parts[1],
        tab: parts[2] === 'structure' ? 'structure' : 'data',
        filters: Array.isArray(filters) ? filters : [],
        page: Math.max(1, Number(q.get('page')) || 1),
        sort: q.get('sort') ?? undefined,
        dir: q.get('dir') === 'desc' ? 'desc' : 'asc',
        q: q.get('q') ?? '',
      };
    }
    return { view: 'home' };
  }

  function tableHref(table: string, opts: { tab?: 'data' | 'structure'; filters?: Filter[]; page?: number; sort?: string; dir?: string; q?: string } = {}): string {
    const q = new URLSearchParams();
    if (opts.filters && opts.filters.length) q.set('filters', JSON.stringify(opts.filters));
    if (opts.page && opts.page > 1) q.set('page', String(opts.page));
    if (opts.sort) q.set('sort', opts.sort);
    if (opts.sort && opts.dir === 'desc') q.set('dir', 'desc');
    if (opts.q) q.set('q', opts.q);
    const qs = q.toString();
    return `#/table/${encodeURIComponent(table)}${opts.tab === 'structure' ? '/structure' : ''}${qs ? `?${qs}` : ''}`;
  }

  function go(href: string): void {
    if (location.hash === href) void render();
    else location.hash = href;
  }

  /* ---------------------------------------------------------- formatting */
  function typeLabel(c: Col): string {
    if (c.type === 'enum') return `enum(${(c.enumValues ?? []).join(', ')})`;
    if (c.type === 'string' && c.length) return `string(${c.length})`;
    return c.type;
  }

  function display(value: unknown, col: Col): string {
    if (value === null || value === undefined) return '<span class="cell-null">NULL</span>';
    if (col.type === 'boolean') return value ? '<span class="badge badge-success badge-sm">true</span>' : '<span class="badge badge-sm">false</span>';
    if (col.type === 'enum') return `<span class="badge badge-primary badge-soft badge-sm">${esc(value)}</span>`;
    if (col.type === 'bytes' && typeof value === 'object') return `<span class="text-muted-foreground">${esc((value as { length?: number }).length ?? 0)} bytes</span>`;
    if (col.type === 'json') return `<code class="text-xs">${esc(JSON.stringify(value))}</code>`;
    if (col.type === 'datetime' && typeof value === 'string') return esc(value.replace('T', ' ').replace(/\.000Z$/, 'Z'));
    return esc(value);
  }

  function rowKey(table: Table, row: Record<string, unknown>): Record<string, unknown> {
    const key: Record<string, unknown> = {};
    for (const pk of table.primaryKey) key[pk] = row[pk];
    return key;
  }

  const keyId = (key: Record<string, unknown>): string => JSON.stringify(key);

  function isAuto(c: Col): boolean {
    return c.default?.kind === 'autoincrement';
  }

  /* --------------------------------------------------------------- shell */
  function renderTableList(): void {
    const list = $('#table-list');
    const filter = ($<HTMLInputElement>('#table-search').value || '').toLowerCase();
    const route = parseRoute();
    const active = route.view === 'table' ? route.table : '';
    const items = (schema?.tables ?? [])
      .filter((t) => t.name.toLowerCase().includes(filter))
      .map(
        (t) =>
          `<a href="${tableHref(t.name)}" class="sidebar-item"${t.name === active ? ' aria-current="page"' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/></svg><span class="sidebar-label">${esc(t.name)}</span><span class="sidebar-badge">${t.columns.length}</span></a>`,
      )
      .join('');
    list.innerHTML = `<p class="sidebar-title">Tables (${schema?.tables.length ?? 0})</p>${items || '<p class="px-3 text-sm text-muted-foreground">No tables match.</p>'}`;
  }

  async function loadSchema(): Promise<void> {
    schema = await api<Schema>('GET', '/api/schema');
    $('#dialect-badge').textContent = schema.dialect;
    renderTableList();
  }

  async function render(): Promise<void> {
    if (!schema) return;
    renderTableList();
    $('#side').classList.remove('open');
    const route = parseRoute();
    if (route.view === 'diagram') return renderDiagram();
    if (route.view === 'table') return renderTable(route);
    renderHome();
  }

  function renderHome(): void {
    const s = schema!;
    const cards = s.tables
      .map((t) => {
        const out = s.relations.filter((r) => r.from === t.name).length;
        const inc = s.relations.filter((r) => r.to === t.name).length;
        return `<a href="${tableHref(t.name)}" class="card card-bordered card-interactive"><div class="card-body"><h3 class="card-title">${esc(t.name)}</h3><p class="card-subtitle">${t.columns.length} columns, ${out + inc} relation${out + inc === 1 ? '' : 's'}</p></div></a>`;
      })
      .join('');
    $('#view').innerHTML = `<div class="space-y-6 max-w-6xl">
      <div><h1 class="text-2xl font-bold">Your ${esc(s.dialect)} database</h1><p class="text-muted-foreground">${s.tables.length} table${s.tables.length === 1 ? '' : 's'}. Pick one to browse and edit its rows, or open the <a class="link link-primary" href="#/diagram">diagram</a>.</p></div>
      ${s.tables.length ? `<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">${cards}</div>` : '<div class="empty-state empty-state-bordered"><h3 class="empty-state-title">No tables yet</h3><p class="empty-state-description">Run <code>kastor migrate dev</code> to create them from your schema.</p></div>'}
    </div>`;
  }

  /* --------------------------------------------------------------- table */
  const OPS: Array<[string, string]> = [
    ['eq', 'equals'],
    ['ne', 'not equal'],
    ['contains', 'contains'],
    ['startsWith', 'starts with'],
    ['endsWith', 'ends with'],
    ['gt', 'greater than'],
    ['gte', 'at least'],
    ['lt', 'less than'],
    ['lte', 'at most'],
    ['in', 'one of (a, b)'],
    ['null', 'is NULL'],
    ['notNull', 'is not NULL'],
  ];
  const opLabel = (op: string): string => OPS.find((o) => o[0] === op)?.[1] ?? op;

  async function renderTable(route: Extract<Route, { view: 'table' }>): Promise<void> {
    const table = schema!.tables.find((t) => t.name === route.table);
    const view = $('#view');
    if (!table) {
      view.innerHTML = `<div class="empty-state empty-state-bordered"><h3 class="empty-state-title">No table ${esc(route.table)}</h3><p class="empty-state-description">It may have been renamed. Reload the schema.</p></div>`;
      return;
    }
    const readOnly = schema!.readOnly || !table.primaryKey.length;
    const tabs = `<nav class="tabs tabs-boxed w-fit" aria-label="Table views"><a href="${tableHref(table.name, { filters: route.filters })}" class="tab${route.tab === 'data' ? ' tab-active' : ''}"${route.tab === 'data' ? ' aria-current="page"' : ''}>Data</a><a href="${tableHref(table.name, { tab: 'structure' })}" class="tab${route.tab === 'structure' ? ' tab-active' : ''}"${route.tab === 'structure' ? ' aria-current="page"' : ''}>Structure</a></nav>`;
    const head = `<div class="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div class="flex flex-wrap items-center gap-3"><h1 class="text-2xl font-bold">${esc(table.name)}</h1>${readOnly ? `<span class="badge badge-warning" title="${table.primaryKey.length ? 'The studio runs read only' : 'Tables without a primary key are read only'}">read only</span>` : ''}</div>
      ${tabs}
    </div>`;
    if (route.tab === 'structure') {
      view.innerHTML = head + structureHtml(table);
      return;
    }
    view.innerHTML = `${head}<div class="space-y-3" aria-hidden="true"><div class="skeleton h-10"></div><div class="skeleton h-64"></div></div>`;
    const qs = new URLSearchParams({ page: String(route.page), pageSize: String(pageSize), dir: route.dir });
    if (route.sort) qs.set('sort', route.sort);
    if (route.filters.length) qs.set('filters', JSON.stringify(route.filters));
    if (route.q) qs.set('q', route.q);
    let data: { rows: Record<string, unknown>[]; total: number };
    try {
      data = await api('GET', `/api/tables/${encodeURIComponent(table.name)}/rows?${qs}`);
    } catch (error) {
      view.innerHTML = `${head}<div class="alert alert-danger" role="alert"><div class="alert-content"><p class="alert-title">Could not read ${esc(table.name)}</p><p class="alert-description">${esc((error as Error).message)}</p></div></div>`;
      if ((error as { status?: number }).status === 401) showLocked();
      return;
    }
    if (parseRoute().view !== 'table') return;
    current = { table, rows: data.rows, total: data.total, route };
    selected.clear();
    view.innerHTML = head + toolbarHtml(table, route, readOnly) + gridHtml(table, data.rows, route, readOnly) + pagerHtml(data.total, route);
    bindTable(table, route, readOnly);
  }

  function toolbarHtml(table: Table, route: Extract<Route, { view: 'table' }>, readOnly: boolean): string {
    const colOpts = table.columns.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
    const opOpts = OPS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
    const chips = route.filters
      .map(
        (f, i) =>
          `<span class="badge badge-primary badge-soft filter-chip">${esc(f.column)} ${esc(opLabel(f.op))}${f.op === 'null' || f.op === 'notNull' ? '' : ` <strong>${esc(f.value)}</strong>`}<button type="button" class="btn btn-ghost btn-xs" data-remove-filter="${i}" aria-label="Remove filter">x</button></span>`,
      )
      .join('');
    return `<div class="flex flex-wrap items-end gap-2 mb-3">
      <form class="flex flex-wrap items-end gap-2" id="filter-form">
        <select class="select select-sm w-auto" id="f-col" aria-label="Column">${colOpts}</select>
        <select class="select select-sm w-auto" id="f-op" aria-label="Operator">${opOpts}</select>
        <input class="input input-sm w-40" id="f-val" placeholder="value" aria-label="Value">
        <button class="btn btn-sm btn-outline" type="submit">Add filter</button>
      </form>
      <form id="search-form" class="flex gap-2"><input type="search" class="input input-sm w-56" id="q" placeholder="Search text columns" aria-label="Search" value="${esc(route.q)}"></form>
      <div class="flex-1"></div>
      <button type="button" class="btn btn-sm btn-ghost" id="reload">Refresh</button>
      ${readOnly ? '' : '<button type="button" class="btn btn-sm btn-danger btn-outline" id="delete-selected" disabled>Delete selected</button><button type="button" class="btn btn-sm btn-primary" id="add-row">Add row</button>'}
    </div>
    ${chips ? `<div class="flex flex-wrap items-center gap-2 mb-3">${chips}<a class="link text-sm" href="${tableHref(table.name)}">Clear all</a></div>` : ''}`;
  }

  function gridHtml(table: Table, rows: Record<string, unknown>[], route: Extract<Route, { view: 'table' }>, readOnly: boolean): string {
    const incoming = schema!.relations.filter((r) => r.to === table.name);
    const heads = table.columns
      .map((c) => {
        const sorted = route.sort === c.name;
        const arrow = sorted ? (route.dir === 'asc' ? ' &#9650;' : ' &#9660;') : '';
        const pk = table.primaryKey.includes(c.name) ? ' <span class="badge badge-xs badge-primary">PK</span>' : '';
        const fk = table.foreignKeys.some((f) => f.columns.includes(c.name)) ? ' <span class="badge badge-xs">FK</span>' : '';
        return `<th scope="col"${sorted ? ` aria-sort="${route.dir === 'asc' ? 'ascending' : 'descending'}"` : ''}><button type="button" class="th-sort" data-sort="${esc(c.name)}">${esc(c.name)}${arrow}</button>${pk}${fk}<span class="th-type">${esc(typeLabel(c))}${c.nullable ? '?' : ''}</span></th>`;
      })
      .join('');
    if (!rows.length) {
      return `<div class="empty-state empty-state-bordered"><h3 class="empty-state-title">${route.filters.length || route.q ? 'No rows match' : 'This table is empty'}</h3><p class="empty-state-description">${route.filters.length || route.q ? 'Change or clear the filters.' : readOnly ? 'Nothing to show yet.' : 'Add the first row with the button above.'}</p></div>`;
    }
    const body = rows
      .map((row, i) => {
        const key = keyId(rowKey(table, row));
        const cells = table.columns
          .map((c) => {
            const fk = table.foreignKeys.find((f) => f.columns.length === 1 && f.columns[0] === c.name);
            const v = row[c.name];
            const link =
              fk && v !== null && v !== undefined
                ? `<a class="link link-primary fk-link" title="Open the ${esc(fk.refTable)} row" href="${tableHref(fk.refTable, { filters: [{ column: fk.refColumns[0]!, op: 'eq', value: v }] })}">${esc(fk.refTable)} &#8594;</a>`
                : '';
            const editable = !readOnly && c.type !== 'bytes' && !table.primaryKey.includes(c.name);
            return `<td class="cell" data-row="${i}" data-col="${esc(c.name)}" data-editable="${editable}" title="${editable ? 'Double click to edit' : ''}">${display(v, c)}${link}</td>`;
          })
          .join('');
        const rel = incoming.length
          ? `<details class="dropdown dropdown-end"><summary class="btn btn-ghost btn-xs">Related</summary><ul class="dropdown-content menu menu-sm">${incoming
              .map((r) => {
                const filters = r.columns.map((col, j) => ({ column: col, op: 'eq', value: row[r.refColumns[j]!] }));
                return `<li><a href="${tableHref(r.from, { filters })}">${esc(r.from)} <span class="menu-shortcut">${esc(r.columns.join(', '))}</span></a></li>`;
              })
              .join('')}</ul></details>`
          : '';
        const actions = readOnly
          ? rel
          : `${rel}<button type="button" class="btn btn-ghost btn-xs" data-edit="${i}">Edit</button><button type="button" class="btn btn-ghost btn-xs text-danger" data-delete="${i}">Delete</button>`;
        return `<tr>${readOnly ? '' : `<td><input type="checkbox" class="checkbox checkbox-sm" data-select='${esc(key)}' aria-label="Select row"></td>`}${cells}<td class="row-actions">${actions}</td></tr>`;
      })
      .join('');
    return `<div class="table-wrap" style="max-height: calc(100vh - 16rem)"><table class="table table-zebra table-hover table-compact table-pin-header">
      <thead><tr>${readOnly ? '' : '<th scope="col"><input type="checkbox" class="checkbox checkbox-sm" id="select-all" aria-label="Select all rows"></th>'}${heads}<th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${body}</tbody></table></div>`;
  }

  function pagerHtml(total: number, route: Extract<Route, { view: 'table' }>): string {
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(route.page, pages);
    const from = total ? (page - 1) * pageSize + 1 : 0;
    const to = Math.min(total, page * pageSize);
    const link = (p: number, label: string, cls = '', disabled = false): string =>
      disabled
        ? `<li><span class="pagination-item pagination-disabled ${cls}" aria-disabled="true">${label}</span></li>`
        : `<li><a class="pagination-item ${cls}" href="${tableHref(route.table, { filters: route.filters, page: p, sort: route.sort, dir: route.dir, q: route.q })}"${p === page && !cls ? ' aria-current="page"' : ''}>${label}</a></li>`;
    const nums: string[] = [];
    const show = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
    let last = 0;
    for (const p of [...show].sort((a, b) => a - b)) {
      if (p - last > 1) nums.push('<li><span class="pagination-ellipsis" aria-hidden="true"></span></li>');
      nums.push(link(p, String(p)));
      last = p;
    }
    const sizes = [25, 50, 100, 250].map((n) => `<option value="${n}"${n === pageSize ? ' selected' : ''}>${n} per page</option>`).join('');
    return `<div class="flex flex-wrap items-center justify-between gap-3 mt-3">
      <p class="text-sm text-muted-foreground">${total ? `Rows ${from} to ${to} of ${total}` : 'No rows'}</p>
      <div class="flex items-center gap-3"><select class="select select-sm w-auto" id="page-size" aria-label="Rows per page">${sizes}</select>
      <nav aria-label="Pages"><ul class="pagination pagination-sm">${link(page - 1, 'Previous', 'pagination-prev', page <= 1)}${nums.join('')}${link(page + 1, 'Next', 'pagination-next', page >= pages)}</ul></nav></div>
    </div>`;
  }

  function structureHtml(table: Table): string {
    const cols = table.columns
      .map((c) => {
        const d = c.default ? (c.default.kind === 'value' ? JSON.stringify(c.default.value) : c.default.kind === 'sql' ? String(c.default.value) : c.default.kind) : '';
        return `<tr><td><code>${esc(c.name)}</code>${table.primaryKey.includes(c.name) ? ' <span class="badge badge-xs badge-primary">PK</span>' : ''}</td><td>${esc(typeLabel(c))}</td><td>${c.nullable ? 'yes' : 'no'}</td><td><code class="text-xs">${esc(d)}</code></td></tr>`;
      })
      .join('');
    const idx = table.indexes.map((i) => `<tr><td><code>${esc(i.name)}</code></td><td>${esc(i.columns.join(', '))}</td><td>${i.unique ? 'unique' : ''}</td></tr>`).join('');
    const fks = table.foreignKeys
      .map((f) => `<tr><td><code>${esc(f.name)}</code></td><td>${esc(f.columns.join(', '))}</td><td><a class="link link-primary" href="${tableHref(f.refTable)}">${esc(f.refTable)}</a> (${esc(f.refColumns.join(', '))})</td><td>${esc((f as any).onDelete ?? '')}</td></tr>`)
      .join('');
    const section = (title: string, head: string, rows: string, empty: string): string =>
      `<section class="space-y-2"><h2 class="text-lg font-semibold">${title}</h2>${rows ? `<div class="table-wrap"><table class="table table-compact"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="text-sm text-muted-foreground">${empty}</p>`}</section>`;
    return `<div class="space-y-6">${section('Columns', '<th>Name</th><th>Type</th><th>Nullable</th><th>Default</th>', cols, '')}${section('Indexes', '<th>Name</th><th>Columns</th><th></th>', idx, 'No secondary indexes.')}${section('Foreign keys', '<th>Name</th><th>Columns</th><th>References</th><th>On delete</th>', fks, 'No foreign keys.')}</div>`;
  }

  function bindTable(table: Table, route: Extract<Route, { view: 'table' }>, readOnly: boolean): void {
    const view = $('#view');
    const nav = (patch: Partial<Extract<Route, { view: 'table' }>>): void => {
      const r = { ...route, ...patch };
      go(tableHref(table.name, { filters: r.filters, page: r.page, sort: r.sort, dir: r.dir, q: r.q }));
    };
    $('#filter-form', view)?.addEventListener('submit', (e) => {
      e.preventDefault();
      const column = $<HTMLSelectElement>('#f-col').value;
      const op = $<HTMLSelectElement>('#f-op').value;
      const value = $<HTMLInputElement>('#f-val').value;
      nav({ filters: [...route.filters, op === 'null' || op === 'notNull' ? { column, op } : { column, op, value }], page: 1 });
    });
    $('#search-form', view)?.addEventListener('submit', (e) => {
      e.preventDefault();
      nav({ q: $<HTMLInputElement>('#q').value, page: 1 });
    });
    view.querySelectorAll<HTMLElement>('[data-remove-filter]').forEach((b) =>
      b.addEventListener('click', () => nav({ filters: route.filters.filter((_, i) => i !== Number(b.dataset.removeFilter)), page: 1 })),
    );
    view.querySelectorAll<HTMLElement>('[data-sort]').forEach((b) =>
      b.addEventListener('click', () => {
        const col = b.dataset.sort!;
        nav({ sort: col, dir: route.sort === col && route.dir === 'asc' ? 'desc' : 'asc', page: 1 });
      }),
    );
    $('#reload', view)?.addEventListener('click', () => void render());
    $('#page-size', view)?.addEventListener('change', (e) => {
      pageSize = Number((e.target as HTMLSelectElement).value) || 50;
      localStorage.setItem(PAGE_SIZE_KEY, String(pageSize));
      nav({ page: 1 });
    });
    if (readOnly) return;
    $('#add-row', view)?.addEventListener('click', () => openRowDialog(table, null));
    const delSel = $<HTMLButtonElement>('#delete-selected', view);
    const syncSel = (): void => {
      if (delSel) {
        delSel.disabled = selected.size === 0;
        delSel.textContent = selected.size ? `Delete ${selected.size} selected` : 'Delete selected';
      }
    };
    view.querySelectorAll<HTMLInputElement>('[data-select]').forEach((cb) =>
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(cb.dataset.select!);
        else selected.delete(cb.dataset.select!);
        syncSel();
      }),
    );
    $<HTMLInputElement>('#select-all', view)?.addEventListener('change', (e) => {
      const on = (e.target as HTMLInputElement).checked;
      view.querySelectorAll<HTMLInputElement>('[data-select]').forEach((cb) => {
        cb.checked = on;
        if (on) selected.add(cb.dataset.select!);
        else selected.delete(cb.dataset.select!);
      });
      syncSel();
    });
    delSel?.addEventListener('click', async () => {
      const keys = [...selected].map((k) => JSON.parse(k));
      if (!(await confirmDialog(`Delete ${keys.length} row${keys.length === 1 ? '' : 's'}?`, `This removes ${keys.length === 1 ? 'the row' : 'the rows'} from ${table.name}. It cannot be undone.`))) return;
      try {
        const r = await api<{ count: number }>('DELETE', `/api/tables/${encodeURIComponent(table.name)}/rows`, { keys });
        toast(`Deleted ${r.count} row${r.count === 1 ? '' : 's'}`, 'success');
        void render();
      } catch (error) {
        fail(error);
      }
    });
    view.querySelectorAll<HTMLElement>('[data-delete]').forEach((b) =>
      b.addEventListener('click', async () => {
        const row = current!.rows[Number(b.dataset.delete)]!;
        const key = rowKey(table, row);
        if (!(await confirmDialog('Delete this row?', `${table.name} where ${Object.entries(key).map(([k, v]) => `${k} = ${String(v)}`).join(' and ')}. It cannot be undone.`))) return;
        try {
          await api('DELETE', `/api/tables/${encodeURIComponent(table.name)}/rows`, { keys: [key] });
          toast('Row deleted', 'success');
          void render();
        } catch (error) {
          fail(error);
        }
      }),
    );
    view.querySelectorAll<HTMLElement>('[data-edit]').forEach((b) => b.addEventListener('click', () => openRowDialog(table, current!.rows[Number(b.dataset.edit)]!)));
    view.querySelectorAll<HTMLElement>('td.cell[data-editable="true"]').forEach((td) => td.addEventListener('dblclick', () => inlineEdit(table, td)));
  }

  /* --------------------------------------------------------- inline edit */
  function inputFor(c: Col, value: unknown, id?: string): string {
    const v = value === null || value === undefined ? '' : c.type === 'json' ? JSON.stringify(value, null, 2) : String(value);
    const attrs = `${id ? `id="${id}" ` : ''}name="${esc(c.name)}" aria-label="${esc(c.name)}"`;
    if (c.type === 'boolean') return `<select class="select select-sm" ${attrs}><option value="true"${value === true ? ' selected' : ''}>true</option><option value="false"${value === false ? ' selected' : ''}>false</option>${c.nullable ? `<option value=""${value === null ? ' selected' : ''}>NULL</option>` : ''}</select>`;
    if (c.type === 'enum') return `<select class="select select-sm" ${attrs}>${c.nullable ? '<option value="">NULL</option>' : ''}${(c.enumValues ?? []).map((e) => `<option${e === value ? ' selected' : ''}>${esc(e)}</option>`).join('')}</select>`;
    if (c.type === 'json' || c.type === 'text') return `<textarea class="textarea textarea-sm" rows="3" ${attrs}>${esc(v)}</textarea>`;
    if (c.type === 'int' || c.type === 'float' || c.type === 'bigint' || c.type === 'decimal') return `<input class="input input-sm" inputmode="decimal" ${attrs} value="${esc(v)}">`;
    if (c.type === 'datetime') return `<input class="input input-sm" ${attrs} value="${esc(v)}" placeholder="2026-01-31T12:00:00Z">`;
    if (c.type === 'date') return `<input type="date" class="input input-sm" ${attrs} value="${esc(v)}">`;
    if (c.type === 'time') return `<input type="time" step="1" class="input input-sm" ${attrs} value="${esc(v)}">`;
    return `<input class="input input-sm" ${attrs} value="${esc(v)}"${c.length ? ` maxlength="${c.length}"` : ''}>`;
  }

  function readInput(c: Col, el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): unknown {
    const raw = el.value;
    const texty = c.type === 'string' || c.type === 'text' || c.type === 'uuid';
    if (raw === '' && (c.nullable && !texty)) return null;
    if (c.type === 'boolean') return raw === 'true';
    return raw;
  }

  function inlineEdit(table: Table, td: HTMLElement): void {
    if (td.querySelector('input, select, textarea')) return;
    const row = current!.rows[Number(td.dataset.row)]!;
    const col = table.columns.find((c) => c.name === td.dataset.col)!;
    const before = td.innerHTML;
    td.innerHTML = `<div class="cell-edit">${inputFor(col, row[col.name])}<p class="text-xs text-muted-foreground mt-1">Enter saves, Esc cancels${col.nullable ? ', empty means NULL' : ''}</p></div>`;
    const input = td.querySelector('input, select, textarea') as HTMLInputElement;
    input.focus();
    let done = false;
    const cancel = (): void => {
      if (done) return;
      done = true;
      td.innerHTML = before;
    };
    const save = async (): Promise<void> => {
      if (done) return;
      done = true;
      const value = readInput(col, input);
      try {
        const res = await api<{ row: Record<string, unknown> }>('PATCH', `/api/tables/${encodeURIComponent(table.name)}/rows`, { key: rowKey(table, row), data: { [col.name]: value } });
        Object.assign(row, res.row);
        td.innerHTML = display(res.row[col.name], col);
        toast(`Saved ${col.name}`, 'success');
      } catch (error) {
        td.innerHTML = before;
        fail(error);
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') cancel();
      if (e.key === 'Enter' && !(input.tagName === 'TEXTAREA' && !e.ctrlKey && !e.metaKey)) {
        e.preventDefault();
        void save();
      }
    });
    input.addEventListener('blur', () => setTimeout(cancel, 150));
  }

  /* ------------------------------------------------------------- dialogs */
  function confirmDialog(title: string, text: string): Promise<boolean> {
    const dlg = $<HTMLDialogElement>('#confirm-dialog');
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = text;
    dlg.returnValue = '';
    dlg.showModal();
    return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true }));
  }

  function openRowDialog(table: Table, row: Record<string, unknown> | null): void {
    const dlg = $<HTMLDialogElement>('#row-dialog');
    $('#row-dialog-title').textContent = row ? `Edit ${table.name} row` : `New ${table.name} row`;
    $('#row-error').textContent = '';
    const fields = table.columns
      .filter((c) => (row ? !table.primaryKey.includes(c.name) : true) && c.type !== 'bytes')
      .map((c, i) => {
        const optional = c.nullable || c.default !== undefined;
        const hint = isAuto(c) ? 'Leave empty to auto increment.' : c.default && !row ? 'Leave empty to use the default.' : c.nullable ? 'Leave empty for NULL.' : '';
        return `<div class="field"><label class="label${optional ? '' : ' label-required'}" for="rf-${i}">${esc(c.name)} <span class="text-xs text-muted-foreground">${esc(typeLabel(c))}</span></label>${inputFor(c, row ? row[c.name] : undefined, `rf-${i}`)}${hint ? `<p class="hint">${hint}</p>` : ''}</div>`;
      })
      .join('');
    $('#row-fields').innerHTML = fields;
    const form = $<HTMLFormElement>('#row-form');
    const submit = async (e: Event): Promise<void> => {
      e.preventDefault();
      const data: Record<string, unknown> = {};
      for (const c of table.columns) {
        const el = form.querySelector(`[name="${CSS.escape(c.name)}"]`) as HTMLInputElement | null;
        if (!el) continue;
        if (el.value === '' && !row && (c.default !== undefined || c.nullable)) continue;
        const v = readInput(c, el);
        if (row && JSON.stringify(v) === JSON.stringify(row[c.name] === undefined ? null : row[c.name])) continue;
        data[c.name] = v;
      }
      try {
        if (row) {
          if (Object.keys(data).length) await api('PATCH', `/api/tables/${encodeURIComponent(table.name)}/rows`, { key: rowKey(table, row), data });
          toast('Row saved', 'success');
        } else {
          await api('POST', `/api/tables/${encodeURIComponent(table.name)}/rows`, { data });
          toast('Row created', 'success');
        }
        form.removeEventListener('submit', submit);
        dlg.close();
        void render();
      } catch (error) {
        const err = error as Error & { hint?: string };
        $('#row-error').textContent = err.hint ? `${err.message} ${err.hint}` : err.message;
      }
    };
    form.addEventListener('submit', submit);
    dlg.addEventListener('close', () => form.removeEventListener('submit', submit), { once: true });
    form.querySelector<HTMLElement>('[data-close]')!.onclick = () => dlg.close();
    dlg.showModal();
    (form.querySelector('input, select, textarea') as HTMLElement | null)?.focus();
  }

  /* ------------------------------------------------------------- diagram */
  function renderDiagram(): void {
    const s = schema!;
    const view = $('#view');
    if (!s.tables.length) {
      view.innerHTML = '<div class="empty-state empty-state-bordered"><h3 class="empty-state-title">Nothing to draw yet</h3><p class="empty-state-description">Create tables first.</p></div>';
      return;
    }
    const ROW = 20;
    const HEAD = 28;
    const GAP_X = 90;
    const GAP_Y = 36;
    const byName = new Map(s.tables.map((t) => [t.name, t]));
    const level = new Map<string, number>();
    for (const t of s.tables) level.set(t.name, 0);
    for (let pass = 0; pass < s.tables.length; pass++) {
      let changed = false;
      for (const t of s.tables) {
        for (const fk of t.foreignKeys) {
          if (fk.refTable === t.name || !byName.has(fk.refTable)) continue;
          const want = Math.min((level.get(fk.refTable) ?? 0) + 1, s.tables.length);
          if (want > (level.get(t.name) ?? 0)) {
            level.set(t.name, want);
            changed = true;
          }
        }
      }
      if (!changed) break;
    }
    const width = (t: Table): number => Math.max(180, ...t.columns.map((c) => (c.name.length + typeLabel(c).length) * 7.2 + 56), t.name.length * 8 + 30);
    const columns = new Map<number, Table[]>();
    for (const t of s.tables) {
      const l = level.get(t.name)!;
      columns.set(l, [...(columns.get(l) ?? []), t]);
    }
    const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
    let x = 20;
    for (const l of [...columns.keys()].sort((a, b) => a - b)) {
      const list = columns.get(l)!;
      const colW = Math.max(...list.map(width));
      let y = 20;
      for (const t of list) {
        const h = HEAD + t.columns.length * ROW + 8;
        pos.set(t.name, { x, y, w: colW, h });
        y += h + GAP_Y;
      }
      x += colW + GAP_X;
    }
    const totalW = x;
    const totalH = Math.max(...[...pos.values()].map((p) => p.y + p.h)) + 20;
    const rowY = (t: Table, col: string): number => {
      const i = Math.max(0, t.columns.findIndex((c) => c.name === col));
      return HEAD + i * ROW + ROW / 2 + 4;
    };
    let edges = '';
    for (const t of s.tables) {
      const a = pos.get(t.name)!;
      for (const fk of t.foreignKeys) {
        const target = byName.get(fk.refTable);
        if (!target) continue;
        const b = pos.get(target.name)!;
        const y1 = a.y + rowY(t, fk.columns[0]!);
        const y2 = b.y + rowY(target, fk.refColumns[0]!);
        let d: string;
        let ex: number;
        let dir: number;
        if (target === t) {
          const xr = a.x + a.w;
          d = `M${xr},${y1} C${xr + 50},${y1} ${xr + 50},${y2} ${xr},${y2}`;
          ex = xr;
          dir = -1;
        } else if (b.x + b.w < a.x) {
          const x1 = a.x;
          const x2 = b.x + b.w;
          const mid = (x1 + x2) / 2;
          d = `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`;
          ex = x2;
          dir = 1;
        } else {
          const x1 = a.x + a.w;
          const x2 = b.x;
          const mid = (x1 + x2) / 2;
          d = x2 > x1 ? `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}` : `M${x1},${y1} C${x1 + 60},${y1} ${x2 - 60},${y2} ${x2},${y2}`;
          ex = x2;
          dir = -1;
        }
        edges += `<path class="er-edge" d="${d}"><title>${esc(`${t.name}.${fk.columns.join(', ')} references ${target.name}.${fk.refColumns.join(', ')}`)}</title></path><path class="er-edge-end" d="M${ex},${y2} l${8 * dir},-5 l0,10 z"/>`;
      }
    }
    let boxes = '';
    for (const t of s.tables) {
      const p = pos.get(t.name)!;
      const fkCols = new Set(t.foreignKeys.flatMap((f) => f.columns));
      const rows = t.columns
        .map((c, i) => {
          const y = p.y + HEAD + i * ROW + ROW / 2 + 8;
          const key = t.primaryKey.includes(c.name) ? 'PK' : fkCols.has(c.name) ? 'FK' : '';
          return `<text class="er-key" x="${p.x + 8}" y="${y}">${key}</text><text x="${p.x + 34}" y="${y}">${esc(c.name)}${c.nullable ? '?' : ''}</text><text class="er-type" x="${p.x + p.w - 8}" y="${y}" text-anchor="end">${esc(typeLabel(c))}</text>`;
        })
        .join('');
      boxes += `<g class="er-table" data-table="${esc(t.name)}"><rect class="er-box" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="8"/><rect class="er-head" x="${p.x}" y="${p.y}" width="${p.w}" height="${HEAD}" rx="8"/><rect class="er-head" x="${p.x}" y="${p.y + HEAD - 8}" width="${p.w}" height="8"/><text class="er-title" x="${p.x + 10}" y="${p.y + 19}">${esc(t.name)}</text>${rows}</g>`;
    }
    view.innerHTML = `<div class="flex flex-wrap items-center justify-between gap-3 mb-4"><div><h1 class="text-2xl font-bold">Diagram</h1><p class="text-sm text-muted-foreground">${s.tables.length} table${s.tables.length === 1 ? '' : 's'}, ${s.relations.length} foreign key${s.relations.length === 1 ? '' : 's'}. Drag to pan, scroll to zoom, click a table name to open it.</p></div></div>
      <div class="er-wrap"><svg id="er" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" role="img" aria-label="Entity relationship diagram">${edges}${boxes}</svg>
      <div class="er-tools"><button type="button" class="btn btn-sm btn-outline" id="er-fit">Fit</button><button type="button" class="btn btn-sm btn-outline" id="er-download">Download SVG</button></div></div>`;
    const svg = $('#er') as unknown as SVGSVGElement;
    const fit = (): { x: number; y: number; w: number; h: number } => {
      const r = svg.getBoundingClientRect();
      const w = Math.max(totalW, r.width || totalW);
      const h = Math.max(totalH, r.height || totalH);
      return { x: (totalW - w) / 2, y: (totalH - h) / 2, w, h };
    };
    let vb = fit();
    const apply = (): void => svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    apply();
    svg.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = svg.getBoundingClientRect();
        const k = e.deltaY > 0 ? 1.12 : 1 / 1.12;
        const mx = vb.x + ((e.clientX - r.left) / r.width) * vb.w;
        const my = vb.y + ((e.clientY - r.top) / r.height) * vb.h;
        vb = { x: mx - (mx - vb.x) * k, y: my - (my - vb.y) * k, w: vb.w * k, h: vb.h * k };
        apply();
      },
      { passive: false },
    );
    let drag: { x: number; y: number; vx: number; vy: number } | null = null;
    svg.addEventListener('pointerdown', (e) => {
      if ((e.target as Element).classList.contains('er-title')) return;
      drag = { x: e.clientX, y: e.clientY, vx: vb.x, vy: vb.y };
      svg.setPointerCapture(e.pointerId);
      svg.classList.add('dragging');
    });
    svg.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const r = svg.getBoundingClientRect();
      vb.x = drag.vx - ((e.clientX - drag.x) / r.width) * vb.w;
      vb.y = drag.vy - ((e.clientY - drag.y) / r.height) * vb.h;
      apply();
    });
    const end = (): void => {
      drag = null;
      svg.classList.remove('dragging');
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.querySelectorAll<SVGTextElement>('.er-title').forEach((el) =>
      el.addEventListener('click', () => go(tableHref((el.parentNode as Element).getAttribute('data-table')!))),
    );
    $('#er-fit').addEventListener('click', () => {
      vb = fit();
      apply();
    });
    $('#er-download').addEventListener('click', () => {
      const clone = svg.cloneNode(true) as SVGSVGElement;
      const cs = getComputedStyle(document.body);
      const v = (name: string): string => cs.getPropertyValue(name).trim() || '#888';
      const style = `text{font:12px monospace;fill:${v('--foreground')}}.er-box{fill:${v('--background')};stroke:${v('--border')}}.er-head{fill:${v('--primary')}}.er-title{fill:${v('--primary-foreground')};font-weight:700}.er-type{fill:${v('--muted-foreground')}}.er-key{fill:${v('--primary')};font-weight:700}.er-edge{fill:none;stroke:${v('--muted-foreground')}}.er-edge-end{fill:${v('--muted-foreground')}}`;
      clone.insertAdjacentHTML('afterbegin', `<style>${style}</style>`);
      clone.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);
      const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'kastor-diagram.svg';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  }

  /* --------------------------------------------------------------- theme */
  function themeLabel(): void {
    const t = document.documentElement.getAttribute('data-theme') ?? 'system';
    $('#theme-toggle').textContent = `Theme: ${t}`;
  }
  $('#theme-toggle').addEventListener('click', () => {
    const order = ['system', 'light', 'dark'];
    const now = document.documentElement.getAttribute('data-theme') ?? 'system';
    const next = order[(order.indexOf(now) + 1) % order.length]!;
    if (next === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', next);
    try {
      if (next === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {
      /* ignore */
    }
    themeLabel();
  });
  themeLabel();

  $('#table-search').addEventListener('input', renderTableList);
  $('#menu-toggle')?.addEventListener('click', () => $('#side').classList.toggle('open'));
  $('#refresh-schema').addEventListener('click', async () => {
    try {
      await api('POST', '/api/refresh');
      await loadSchema();
      await render();
      toast('Schema reloaded', 'success');
    } catch (error) {
      fail(error);
    }
  });
  window.addEventListener('hashchange', () => void render());
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault();
      $<HTMLInputElement>('#table-search').focus();
    }
  });

  if (!token) {
    showLocked();
    return;
  }
  loadSchema()
    .then(render)
    .catch(fail);
}

/** The browser script: `clientMain` as source, called right away. */
export function clientScript(): string {
  return `"use strict";\n(${clientMain.toString()})();\n`;
}
