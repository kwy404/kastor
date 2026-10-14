/**
 * A tiny SQL builder. Text and parameters stay separate until `render`, which
 * numbers the placeholders, so fragments can be composed in any order.
 */

export interface Param {
  readonly value: unknown;
}

export class Sql {
  readonly parts: readonly (string | Param)[];

  constructor(parts: readonly (string | Param)[]) {
    this.parts = parts;
  }

  get isEmpty(): boolean {
    return this.parts.every((p) => p === '');
  }

  /** Renders the text with placeholders numbered from `firstIndex` (1 based). */
  render(placeholder: (index: number) => string, firstIndex = 1): { sql: string; params: unknown[] } {
    let sql = '';
    const params: unknown[] = [];
    for (const part of this.parts) {
      if (typeof part === 'string') sql += part;
      else {
        params.push(part.value);
        sql += placeholder(firstIndex + params.length - 1);
      }
    }
    return { sql, params };
  }

  get paramCount(): number {
    return this.parts.filter((p) => typeof p !== 'string').length;
  }
}

/** Anything the `q` template accepts: trusted text, a fragment or a parameter. */
export type SqlPart = string | number | Sql | Param;

/** Wraps a value as a bound parameter. */
export function p(value: unknown): Param {
  return { value };
}

function flatten(item: SqlPart, out: (string | Param)[]): void {
  if (item instanceof Sql) out.push(...item.parts);
  else if (typeof item === 'string') out.push(item);
  else if (typeof item === 'number') out.push(String(item));
  else out.push(item);
}

/**
 * Template for compiler generated SQL. Interpolated strings are inserted as
 * trusted text (identifiers must already be quoted); use `p(value)` for data.
 */
export function q(strings: TemplateStringsArray, ...values: SqlPart[]): Sql {
  const out: (string | Param)[] = [];
  for (let i = 0; i < strings.length; i++) {
    out.push(strings[i]!);
    if (i < values.length) flatten(values[i]!, out);
  }
  return new Sql(out);
}

/** Trusted text as a fragment. */
export function text(value: string): Sql {
  return new Sql([value]);
}

export function join(items: readonly SqlPart[], separator: string): Sql {
  const out: (string | Param)[] = [];
  items.forEach((item, i) => {
    if (i > 0) out.push(separator);
    flatten(item, out);
  });
  return new Sql(out);
}

export const empty = new Sql([]);
