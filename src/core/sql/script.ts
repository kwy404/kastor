/**
 * Splits a SQL script into statements. Understands quotes, quoted
 * identifiers, line and block comments, Postgres dollar quoting, SQL Server
 * `GO` batch lines and the Oracle `/` line that ends a PL/SQL block.
 */

export interface SplitOptions {
  /** Split on `;` at the end of statements (default true). */
  semicolons?: boolean;
  /** Treat a line holding only `GO` as a separator (default true). */
  goBatches?: boolean;
  /** Treat a line holding only `/` as a separator (default true). */
  slashLines?: boolean;
}

export function splitSqlScript(script: string, options: SplitOptions = {}): string[] {
  const semicolons = options.semicolons ?? true;
  const goBatches = options.goBatches ?? true;
  const slashLines = options.slashLines ?? true;
  const out: string[] = [];
  let current = '';
  let i = 0;
  const n = script.length;
  let lineStart = true;

  const flush = (): void => {
    const stmt = current.trim();
    if (stmt && !/^(--[^\n]*\n?|\/\*[\s\S]*?\*\/|\s)*$/.test(stmt)) out.push(stmt);
    current = '';
  };

  while (i < n) {
    const ch = script[i]!;
    const next = script[i + 1];

    if (lineStart) {
      const end = script.indexOf('\n', i);
      const line = script.slice(i, end === -1 ? n : end);
      if ((goBatches && /^\s*GO\s*$/i.test(line)) || (slashLines && /^\s*\/\s*$/.test(line))) {
        flush();
        i = end === -1 ? n : end + 1;
        continue;
      }
    }
    lineStart = false;

    if (ch === '-' && next === '-') {
      const end = script.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      current += script.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = script.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      current += script.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < n) {
        if (script[j] === ch) {
          if (script[j + 1] === ch) j += 2;
          else break;
        } else if (script[j] === '\\' && ch !== '"') j += 2;
        else j++;
      }
      current += script.slice(i, Math.min(j + 1, n));
      i = j + 1;
      continue;
    }
    if (ch === '[') {
      const end = script.indexOf(']', i);
      const stop = end === -1 ? n : end + 1;
      current += script.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(script.slice(i, i + 64));
      if (m) {
        const tag = m[0];
        const end = script.indexOf(tag, i + tag.length);
        const stop = end === -1 ? n : end + tag.length;
        current += script.slice(i, stop);
        i = stop;
        continue;
      }
    }
    if (ch === ';' && semicolons) {
      flush();
      i++;
      continue;
    }
    if (ch === '\n') lineStart = true;
    current += ch;
    i++;
  }
  flush();
  return out;
}
