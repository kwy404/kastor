/**
 * Raw SQL as tagged templates. Interpolated values become bound parameters,
 * never string concatenation, so `sql\`... ${userInput}\`` is safe.
 * Tables and columns interpolate as quoted identifiers.
 */
import { errors } from './errors';
import type { SqlFragmentIR } from './ir';
import { isColumn, isTable } from './schema';

const FRAGMENT = Symbol.for('kastor.sql');

/** Marks an identifier inside `SqlFragmentIR.params`; the dialect quotes it. */
export interface IdentParam {
  readonly $ident: readonly string[];
}

export function isIdentParam(value: unknown): value is IdentParam {
  return typeof value === 'object' && value !== null && Array.isArray((value as IdentParam).$ident);
}

export class SqlFragment implements SqlFragmentIR {
  readonly [FRAGMENT] = true;
  /** `strings.length === params.length + 1` */
  readonly strings: string[];
  readonly params: unknown[];

  constructor(strings: readonly string[], params: readonly unknown[]) {
    this.strings = [...strings];
    this.params = [...params];
  }

  /** Renders with `?` placeholders and double quoted identifiers, for debugging. */
  toString(): string {
    return renderFragment(this, (n) => `"${n.replace(/"/g, '""')}"`, () => '?').sql;
  }
}

export function isSqlFragment(value: unknown): value is SqlFragment {
  return typeof value === 'object' && value !== null && (value as Record<symbol, unknown>)[FRAGMENT] === true;
}

/** Flattens nested fragments and turns tables and columns into identifiers. */
function build(strings: readonly string[], values: readonly unknown[]): SqlFragment {
  const outStrings: string[] = [strings[0] ?? ''];
  const outParams: unknown[] = [];
  const push = (value: unknown, next: string): void => {
    if (isSqlFragment(value)) {
      outStrings[outStrings.length - 1] += value.strings[0]!;
      for (let i = 0; i < value.params.length; i++) {
        outParams.push(value.params[i]);
        outStrings.push(value.strings[i + 1]!);
      }
      outStrings[outStrings.length - 1] += next;
      return;
    }
    if (isTable(value)) value = { $ident: [value.$table.name] } satisfies IdentParam;
    else if (isColumn(value)) value = { $ident: [value.name] } satisfies IdentParam;
    outParams.push(value);
    outStrings.push(next);
  };
  for (let i = 0; i < values.length; i++) push(values[i], strings[i + 1] ?? '');
  return new SqlFragment(outStrings, outParams);
}

export interface SqlTag {
  (strings: TemplateStringsArray, ...values: unknown[]): SqlFragment;
  /** Trusted SQL text inserted as is. Never pass user input. */
  raw(text: string): SqlFragment;
  /** Joins values or fragments with a separator: `sql.join([1, 2, 3])` gives `?, ?, ?`. */
  join(items: readonly unknown[], separator?: string): SqlFragment;
  /** A quoted identifier, dotted parts allowed: `sql.ident('public', 'users')`. */
  ident(...names: string[]): SqlFragment;
  /** An empty fragment, handy in conditional building. */
  readonly empty: SqlFragment;
}

export const sql: SqlTag = Object.assign(
  (strings: TemplateStringsArray, ...values: unknown[]): SqlFragment => {
    if (!Array.isArray(strings) || !('raw' in strings)) {
      throw errors.invalidArgument('sql must be used as a tagged template.', 'Write sql`SELECT * FROM users WHERE id = ${id}`, without parentheses.');
    }
    return build(strings, values);
  },
  {
    raw: (text: string) => new SqlFragment([String(text)], []),
    join: (items: readonly unknown[], separator = ', ') => {
      if (items.length === 0) return new SqlFragment([''], []);
      const strings = [''];
      for (let i = 1; i < items.length; i++) strings.push(separator);
      strings.push('');
      return build(strings, items);
    },
    ident: (...names: string[]) => {
      if (names.length === 0 || names.some((n) => typeof n !== 'string' || n.length === 0)) {
        throw errors.invalidArgument('sql.ident needs non empty names.', "Example: sql.ident('users') or sql.ident('public', 'users').");
      }
      return new SqlFragment(['', ''], [{ $ident: names } satisfies IdentParam]);
    },
    empty: new SqlFragment([''], []),
  },
);

/**
 * Renders a fragment to SQL text with dialect specific quoting and
 * placeholders. `placeholder` receives the 1 based index of the parameter.
 */
export function renderFragment(
  fragment: SqlFragmentIR,
  quoteIdent: (name: string) => string,
  placeholder: (index: number) => string,
  firstIndex = 1,
  encode: (value: unknown) => unknown = (v) => v,
): { sql: string; params: unknown[] } {
  let text = fragment.strings[0] ?? '';
  const params: unknown[] = [];
  for (let i = 0; i < fragment.params.length; i++) {
    const p = fragment.params[i];
    if (isIdentParam(p)) text += p.$ident.map(quoteIdent).join('.');
    else {
      params.push(encode(p));
      text += placeholder(firstIndex + params.length - 1);
    }
    text += fragment.strings[i + 1] ?? '';
  }
  return { sql: text, params };
}
