/**
 * The studio HTML shell. Styling comes from Monsoon on the CDN; the behavior
 * lives in `/app.js` (see client.ts) so the page needs no inline script.
 */
export const MONSOON_CSS = 'https://cdn.jsdelivr.net/npm/monsooncss@0.2.0/dist/monsoon.min.css';
export const MONSOON_JS = 'https://cdn.jsdelivr.net/npm/monsooncss@0.2.0/dist/monsoon.js';

export const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#5b3fd6"/><ellipse cx="16" cy="10" rx="8" ry="3" fill="none" stroke="#fff" stroke-width="2"/><path d="M8 10v12c0 1.7 3.6 3 8 3s8-1.3 8-3V10M8 16c0 1.7 3.6 3 8 3s8-1.3 8-3" fill="none" stroke="#fff" stroke-width="2"/></svg>`;

/** Runs before first paint so a stored theme does not flash. */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('kastor-studio:theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

const STYLES = `
:root { --seed: #5b3fd6; }
html, body { height: 100%; }
body { margin: 0; }
.studio { display: grid; grid-template-rows: auto 1fr; height: 100vh; }
.studio-body { display: grid; grid-template-columns: 260px minmax(0, 1fr); min-height: 0; }
.studio-side { border-right: 1px solid var(--border); overflow: auto; min-height: 0; }
.studio-main { overflow: auto; min-width: 0; min-height: 0; }
.studio-side .sidebar { width: 100%; height: auto; border: 0; background: transparent; }
.cell { max-width: 22rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: default; }
.cell[data-editable="true"] { cursor: text; }
.cell-null { color: var(--muted-foreground); font-style: italic; font-size: 0.75rem; }
.cell-edit { min-width: 10rem; }
.th-sort { all: unset; cursor: pointer; display: inline-flex; gap: .25rem; align-items: center; font-weight: 600; }
.th-sort:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; border-radius: 4px; }
.th-type { display: block; font-weight: 400; font-size: .7rem; color: var(--muted-foreground); }
.fk-link { margin-left: .35rem; font-size: .75rem; }
.row-actions { white-space: nowrap; }
.er-wrap { position: relative; height: calc(100vh - 9.5rem); border: 1px solid var(--border); border-radius: .75rem; overflow: hidden; background: var(--surface); }
.er-wrap svg { width: 100%; height: 100%; cursor: grab; user-select: none; touch-action: none; }
.er-wrap svg.dragging { cursor: grabbing; }
.er-table rect.er-box { fill: var(--background); stroke: var(--border); }
.er-table rect.er-head { fill: var(--primary); }
.er-table text { font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; fill: var(--foreground); }
.er-table text.er-title { fill: var(--primary-foreground); font-weight: 700; cursor: pointer; }
.er-table text.er-type { fill: var(--muted-foreground); }
.er-table text.er-key { fill: var(--primary); font-weight: 700; }
.er-edge { fill: none; stroke: var(--muted-foreground); stroke-width: 1.4; }
.er-edge-end { fill: var(--muted-foreground); }
.er-tools { position: absolute; top: .75rem; right: .75rem; display: flex; gap: .5rem; }
.filter-chip { display: inline-flex; align-items: center; gap: .35rem; }
@media (max-width: 760px) { .studio-body { grid-template-columns: minmax(0, 1fr); } .studio-side { display: none; } .studio-side.open { display: block; position: fixed; inset: 3.5rem 0 0 0; z-index: 30; background: var(--background); } }
`;

export function renderPage(options: { version: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>kastor studio</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${MONSOON_CSS}">
<script src="/theme.js"></script>
<style>${STYLES}</style>
<script src="${MONSOON_JS}" defer></script>
<script src="/app.js" defer></script>
</head>
<body class="bg-background text-foreground antialiased">
<div class="studio">
  <header class="navbar border-b border-border">
    <div class="navbar-start gap-3">
      <button type="button" class="btn btn-ghost btn-sm md:hidden" id="menu-toggle" aria-label="Tables">Tables</button>
      <a href="#/" class="navbar-brand"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>kastor studio</a>
      <span class="badge badge-primary hidden sm:inline-flex" id="dialect-badge">connecting</span>
      <span class="text-xs text-muted-foreground hidden sm:inline">v${options.version}</span>
    </div>
    <nav class="navbar-end gap-2" aria-label="Studio">
      <a href="#/diagram" class="btn btn-ghost btn-sm hidden sm:inline-flex" id="diagram-link">Diagram</a>
      <button type="button" class="btn btn-ghost btn-sm hidden sm:inline-flex" id="refresh-schema" title="Read the schema again">Reload schema</button>
      <button type="button" class="btn btn-outline btn-sm" id="theme-toggle" aria-label="Switch theme">Theme: system</button>
    </nav>
  </header>
  <div class="studio-body">
    <aside class="studio-side" id="side">
      <div class="p-3">
        <input type="search" class="input input-sm w-full" id="table-search" placeholder="Find a table" aria-label="Find a table">
      </div>
      <nav class="sidebar" aria-label="Tables">
        <div class="sidebar-section" id="table-list"><p class="sidebar-title">Tables</p></div>
        <div class="sidebar-section"><p class="sidebar-title">Schema</p><a href="#/diagram" class="sidebar-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><path d="M10 6.5h4a2 2 0 0 1 2 2V14"/></svg><span class="sidebar-label">Diagram</span></a></div>
      </nav>
    </aside>
    <main class="studio-main p-4 md:p-6" id="view" tabindex="-1">
      <div class="space-y-3" aria-hidden="true"><div class="skeleton h-8 w-1/3"></div><div class="skeleton h-64"></div></div>
    </main>
  </div>
</div>

<dialog id="row-dialog" class="modal modal-lg" aria-labelledby="row-dialog-title">
  <form class="modal-box" id="row-form" method="dialog" novalidate>
    <div class="modal-header"><h2 class="modal-title" id="row-dialog-title">New row</h2></div>
    <div class="modal-body grid gap-4" id="row-fields"></div>
    <p class="text-sm text-danger" id="row-error" role="alert"></p>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" data-close>Cancel</button>
      <button type="submit" class="btn btn-primary" id="row-submit">Save</button>
    </div>
  </form>
</dialog>

<dialog id="confirm-dialog" class="modal" aria-labelledby="confirm-title">
  <form class="modal-box" method="dialog">
    <div class="modal-header"><h2 class="modal-title" id="confirm-title">Delete?</h2></div>
    <p class="modal-body text-muted-foreground" id="confirm-text"></p>
    <div class="modal-actions">
      <button class="btn btn-ghost" value="cancel">Cancel</button>
      <button class="btn btn-danger" value="ok" id="confirm-ok">Delete</button>
    </div>
  </form>
</dialog>
</body>
</html>`;
}
