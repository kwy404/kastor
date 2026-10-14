/**
 * Splits a migration file into statements, and writes statements back.
 *
 * Statements end with `;` outside of strings, quoted identifiers, comments and
 * PostgreSQL dollar quoted bodies. Procedural blocks (Oracle PL/SQL, SQL Server
 * batches) contain semicolons of their own, so they are written after a
 * `-- kastor:block` line and closed by a line holding only `/` (or `GO`), the
 * usual convention of the vendor tools. A statement that starts with `BEGIN` or
 * `DECLARE` is a block too.
 */
export const BLOCK_MARKER = '-- kastor:block';

export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  const text = sql.replace(/\r\n?/g, '\n');
  let current = '';
  let block = false;
  let i = 0;
  const push = (): void => {
    const stmt = stripLeadingComments(current).trim();
    if (stmt) out.push(stmt);
    current = '';
    block = false;
  };
  while (i < text.length) {
    const ch = text[i]!;
    if (i === 0 || text[i - 1] === '\n') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      const trimmed = text.slice(i, stop).trim();
      if (trimmed === '/' || /^go$/i.test(trimmed)) {
        push();
        i = stop + 1;
        continue;
      }
      if (trimmed === BLOCK_MARKER) {
        if (current.trim() && !block) push();
        block = true;
        i = stop + 1;
        continue;
      }
      if (!stripLeadingComments(current).trim() && /^(begin|declare)\b/i.test(trimmed)) block = true;
    }
    if (ch === '-' && text[i + 1] === '-') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      current += text.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      current += text.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`' || ch === '[') {
      const close = ch === '[' ? ']' : ch;
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === close) {
          if (text[j + 1] === close) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      current += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(i, i + 64));
      if (m && !/[A-Za-z0-9_]/.test(text[i - 1] ?? '')) {
        const tag = m[0];
        const end = text.indexOf(tag, i + tag.length);
        const stop = end === -1 ? text.length : end + tag.length;
        current += text.slice(i, stop);
        i = stop;
        continue;
      }
    }
    if (ch === ';' && !block) {
      push();
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  push();
  return out;
}

/** True when a statement must be written as a block (it has its own semicolons). */
export function isBlockStatement(stmt: string): boolean {
  if (/^\s*(begin|declare)\b/i.test(stmt)) return true;
  return splitStatements(stmt.trim().replace(/;\s*$/, '')).length > 1;
}

/** Writes one statement in the form `splitStatements` reads back. */
export function formatStatement(stmt: string): string {
  const s = stmt.trim();
  if (isBlockStatement(s)) return `${BLOCK_MARKER}\n${s}\n/`;
  return `${s.replace(/;\s*$/, '')};`;
}

export function stripLeadingComments(stmt: string): string {
  let s = stmt;
  for (;;) {
    const t = s.replace(/^\s+/, '');
    if (t.startsWith('--')) {
      const nl = t.indexOf('\n');
      s = nl === -1 ? '' : t.slice(nl + 1);
      continue;
    }
    if (t.startsWith('/*')) {
      const end = t.indexOf('*/');
      s = end === -1 ? '' : t.slice(end + 2);
      continue;
    }
    return t;
  }
}
