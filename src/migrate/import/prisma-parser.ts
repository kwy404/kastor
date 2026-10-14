/**
 * A parser for Prisma schema files (`schema.prisma`). It reads the whole
 * language the importer needs: datasource and generator blocks, models,
 * views, enums, composite types, fields with their type modifiers, field
 * attributes (`@id`, `@db.VarChar(255)`) and block attributes (`@@index`),
 * and keeps `///` documentation comments. It checks syntax only; meaning is
 * left to the importer.
 */
import { KastorError } from '../../core/errors';

export type PrismaValue =
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: string }
  | { kind: 'boolean'; value: boolean }
  /** A bare name: an enum value, a referential action, a field name. May be dotted. */
  | { kind: 'name'; value: string }
  /** A function call like `now()`, `env("URL")`, `dbgenerated("...")`, or a field with arguments `title(sort: Desc)`. */
  | { kind: 'call'; name: string; args: PrismaArg[] }
  | { kind: 'array'; items: PrismaValue[] };

export interface PrismaArg {
  /** Named argument (`fields: [...]`), or undefined for a positional one. */
  name?: string;
  value: PrismaValue;
}

export interface PrismaAttribute {
  /** Without the `@` or `@@`, for example `id`, `db.VarChar`, `relation`. */
  name: string;
  args: PrismaArg[];
  line: number;
}

export interface PrismaField {
  name: string;
  /** Type name, for example `String`, `User`, or `Unsupported`. */
  type: string;
  optional: boolean;
  list: boolean;
  /** The text of `Unsupported("...")`. */
  unsupported?: string;
  attributes: PrismaAttribute[];
  doc?: string;
  line: number;
}

export interface PrismaModel {
  kind: 'model' | 'view' | 'type';
  name: string;
  fields: PrismaField[];
  attributes: PrismaAttribute[];
  doc?: string;
  line: number;
}

export interface PrismaEnumValue {
  name: string;
  attributes: PrismaAttribute[];
  doc?: string;
}

export interface PrismaEnum {
  name: string;
  values: PrismaEnumValue[];
  attributes: PrismaAttribute[];
  doc?: string;
  line: number;
}

export interface PrismaConfigBlock {
  kind: 'datasource' | 'generator';
  name: string;
  properties: Record<string, PrismaValue>;
  line: number;
}

export interface PrismaSchema {
  datasources: PrismaConfigBlock[];
  generators: PrismaConfigBlock[];
  models: PrismaModel[];
  enums: PrismaEnum[];
}

/* ------------------------------------------------------------------------ */
/* Tokens                                                                    */
/* ------------------------------------------------------------------------ */

type TokenKind = 'ident' | 'string' | 'number' | 'punct' | 'doc' | 'newline' | 'eof';

interface Token {
  kind: TokenKind;
  value: string;
  line: number;
  col: number;
}

export class PrismaParseError extends KastorError {
  constructor(message: string, line: number, col: number, file?: string) {
    super('SCHEMA_INVALID', `${file ? `${file}:` : 'Line '}${line}:${col}: ${message}`, {
      hint: 'Fix the Prisma schema (npx prisma validate shows the same problem), then run the import again.',
      meta: { line, col },
    });
  }
}

function tokenize(source: string, file?: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const push = (kind: TokenKind, value: string, start: number): void => {
    tokens.push({ kind, value, line, col: start - lineStart + 1 });
  };
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === '\n') {
      push('newline', '\n', i);
      i++;
      line++;
      lineStart = i;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '﻿') {
      i++;
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i);
      const text = source.slice(i, end === -1 ? source.length : end);
      if (text.startsWith('///')) push('doc', text.slice(3).replace(/^ /, '').replace(/\r$/, ''), i);
      i = end === -1 ? source.length : end;
      continue;
    }
    if (ch === '"') {
      const start = i;
      let value = '';
      i++;
      for (;;) {
        if (i >= source.length || source[i] === '\n') throw new PrismaParseError('This string is not closed.', line, start - lineStart + 1, file);
        const c = source[i]!;
        if (c === '"') {
          i++;
          break;
        }
        if (c === '\\') {
          const n = source[i + 1];
          const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', '0': '\0' };
          if (n === 'u' && /^[0-9a-fA-F]{4}$/.test(source.slice(i + 2, i + 6))) {
            value += String.fromCharCode(parseInt(source.slice(i + 2, i + 6), 16));
            i += 6;
            continue;
          }
          value += n !== undefined && n in map ? map[n]! : (n ?? '');
          i += 2;
          continue;
        }
        value += c;
        i++;
      }
      push('string', value, start);
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '-' && /[0-9]/.test(source[i + 1] ?? ''))) {
      const m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(source.slice(i))!;
      push('number', m[0], i);
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i))!;
      push('ident', m[0], i);
      i += m[0].length;
      continue;
    }
    if (ch === '@' && source[i + 1] === '@') {
      push('punct', '@@', i);
      i += 2;
      continue;
    }
    if ('{}()[],:=?@.'.includes(ch)) {
      push('punct', ch, i);
      i++;
      continue;
    }
    throw new PrismaParseError(`Unexpected character "${ch}".`, line, i - lineStart + 1, file);
  }
  tokens.push({ kind: 'eof', value: '', line, col: i - lineStart + 1 });
  return tokens;
}

/* ------------------------------------------------------------------------ */
/* Parser                                                                    */
/* ------------------------------------------------------------------------ */

class Parser {
  private pos = 0;
  private docs: string[] = [];

  constructor(
    private readonly tokens: Token[],
    private readonly file?: string,
  ) {}

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]!;
  }

  private next(): Token {
    const t = this.peek();
    if (this.pos < this.tokens.length - 1) this.pos++;
    return t;
  }

  private fail(message: string, token = this.peek()): never {
    throw new PrismaParseError(message, token.line, token.col, this.file);
  }

  private is(value: string): boolean {
    const t = this.peek();
    return t.kind === 'punct' && t.value === value;
  }

  private expect(value: string, what?: string): Token {
    if (!this.is(value)) {
      const t = this.peek();
      this.fail(`Expected "${value}"${what ? ` ${what}` : ''}, found ${describe(t)}.`);
    }
    return this.next();
  }

  private ident(what: string): Token {
    const t = this.peek();
    if (t.kind !== 'ident') this.fail(`Expected ${what}, found ${describe(t)}.`);
    return this.next();
  }

  /** Skips newlines; collects doc comments on the way. */
  private skipBlank(): void {
    for (;;) {
      const t = this.peek();
      if (t.kind === 'newline') {
        this.next();
        continue;
      }
      if (t.kind === 'doc') {
        this.docs.push(t.value);
        this.next();
        continue;
      }
      return;
    }
  }

  /** Skips newlines inside parentheses and brackets, where they mean nothing. */
  private skipNewlines(): void {
    while (this.peek().kind === 'newline' || this.peek().kind === 'doc') this.next();
  }

  private takeDoc(): string | undefined {
    if (!this.docs.length) return undefined;
    const doc = this.docs.join('\n');
    this.docs = [];
    return doc;
  }

  parse(): PrismaSchema {
    const schema: PrismaSchema = { datasources: [], generators: [], models: [], enums: [] };
    for (;;) {
      this.skipBlank();
      const t = this.peek();
      if (t.kind === 'eof') break;
      if (t.kind !== 'ident') this.fail(`Expected a block (model, enum, datasource, generator, view or type), found ${describe(t)}.`);
      const doc = this.takeDoc();
      switch (t.value) {
        case 'datasource':
        case 'generator': {
          const block = this.configBlock(t.value);
          (t.value === 'datasource' ? schema.datasources : schema.generators).push(block);
          break;
        }
        case 'model':
        case 'view':
        case 'type':
          schema.models.push(this.model(t.value, doc));
          break;
        case 'enum':
          schema.enums.push(this.enumBlock(doc));
          break;
        default:
          this.fail(`Unknown block "${t.value}". Expected model, enum, datasource, generator, view or type.`);
      }
    }
    return schema;
  }

  private configBlock(kind: 'datasource' | 'generator'): PrismaConfigBlock {
    const start = this.next();
    const name = this.ident(`a ${kind} name`).value;
    this.expect('{', `after the ${kind} name`);
    const properties: Record<string, PrismaValue> = {};
    for (;;) {
      this.skipBlank();
      this.docs = [];
      if (this.is('}')) {
        this.next();
        break;
      }
      const key = this.ident('a property name').value;
      this.expect('=', `after ${key}`);
      properties[key] = this.value();
      this.endOfLine();
    }
    return { kind, name, properties, line: start.line };
  }

  private model(kind: 'model' | 'view' | 'type', doc: string | undefined): PrismaModel {
    const start = this.next();
    const name = this.ident(`a ${kind} name`).value;
    this.expect('{', `after the ${kind} name`);
    const fields: PrismaField[] = [];
    const attributes: PrismaAttribute[] = [];
    for (;;) {
      this.skipBlank();
      if (this.is('}')) {
        this.next();
        this.docs = [];
        break;
      }
      if (this.is('@@')) {
        this.docs = [];
        attributes.push(this.attribute('@@'));
        this.endOfLine();
        continue;
      }
      fields.push(this.field());
    }
    return { kind, name, fields, attributes, ...(doc ? { doc } : {}), line: start.line };
  }

  private field(): PrismaField {
    const doc = this.takeDoc();
    const nameTok = this.ident('a field name');
    if (this.peek().kind === 'newline' || this.is('}')) this.fail(`Field "${nameTok.value}" has no type.`, nameTok);
    const typeTok = this.ident(`the type of field "${nameTok.value}"`);
    const type = typeTok.value;
    let unsupported: string | undefined;
    if (type === 'Unsupported') {
      this.expect('(', 'after Unsupported');
      const s = this.next();
      if (s.kind !== 'string') this.fail('Unsupported() takes the database type as a string.', s);
      unsupported = s.value;
      this.expect(')', 'to close Unsupported(');
    }
    // Dotted type names do not exist in Prisma, but give a clear error.
    if (this.is('.')) this.fail(`Unexpected "." in the type of field "${nameTok.value}".`);
    let list = false;
    let optional = false;
    if (this.is('[')) {
      this.next();
      this.expect(']', 'to close the list type');
      list = true;
    }
    if (this.is('?')) {
      this.next();
      optional = true;
    }
    const attributes: PrismaAttribute[] = [];
    while (this.is('@')) attributes.push(this.attribute('@'));
    this.endOfLine();
    return {
      name: nameTok.value,
      type,
      optional,
      list,
      ...(unsupported !== undefined ? { unsupported } : {}),
      attributes,
      ...(doc ? { doc } : {}),
      line: nameTok.line,
    };
  }

  private enumBlock(doc: string | undefined): PrismaEnum {
    const start = this.next();
    const name = this.ident('an enum name').value;
    this.expect('{', 'after the enum name');
    const values: PrismaEnumValue[] = [];
    const attributes: PrismaAttribute[] = [];
    for (;;) {
      this.skipBlank();
      if (this.is('}')) {
        this.next();
        this.docs = [];
        break;
      }
      if (this.is('@@')) {
        this.docs = [];
        attributes.push(this.attribute('@@'));
        this.endOfLine();
        continue;
      }
      const valueDoc = this.takeDoc();
      const v = this.ident('an enum value').value;
      const attrs: PrismaAttribute[] = [];
      while (this.is('@')) attrs.push(this.attribute('@'));
      this.endOfLine();
      values.push({ name: v, attributes: attrs, ...(valueDoc ? { doc: valueDoc } : {}) });
    }
    return { name, values, attributes, ...(doc ? { doc } : {}), line: start.line };
  }

  private attribute(prefix: '@' | '@@'): PrismaAttribute {
    const at = this.expect(prefix);
    let name = this.ident(`an attribute name after ${prefix}`).value;
    while (this.is('.')) {
      this.next();
      name += `.${this.ident('an attribute name after "."').value}`;
    }
    const args = this.is('(') ? this.argList() : [];
    return { name, args, line: at.line };
  }

  private argList(): PrismaArg[] {
    this.expect('(');
    const args: PrismaArg[] = [];
    this.skipNewlines();
    while (!this.is(')')) {
      let name: string | undefined;
      if (this.peek().kind === 'ident' && this.peek(1).kind === 'punct' && this.peek(1).value === ':') {
        name = this.next().value;
        this.next();
        this.skipNewlines();
      }
      args.push({ ...(name !== undefined ? { name } : {}), value: this.value() });
      this.skipNewlines();
      if (this.is(',')) {
        this.next();
        this.skipNewlines();
        continue;
      }
      if (!this.is(')')) this.fail(`Expected "," or ")" in the argument list, found ${describe(this.peek())}.`);
    }
    this.next();
    return args;
  }

  private value(): PrismaValue {
    const t = this.peek();
    if (t.kind === 'string') {
      this.next();
      return { kind: 'string', value: t.value };
    }
    if (t.kind === 'number') {
      this.next();
      return { kind: 'number', value: t.value };
    }
    if (this.is('[')) {
      this.next();
      const items: PrismaValue[] = [];
      this.skipNewlines();
      while (!this.is(']')) {
        items.push(this.value());
        this.skipNewlines();
        if (this.is(',')) {
          this.next();
          this.skipNewlines();
          continue;
        }
        if (!this.is(']')) this.fail(`Expected "," or "]" in the list, found ${describe(this.peek())}.`);
      }
      this.next();
      return { kind: 'array', items };
    }
    if (t.kind === 'ident') {
      this.next();
      let name = t.value;
      while (this.is('.')) {
        this.next();
        name += `.${this.ident('a name after "."').value}`;
      }
      if (this.is('(')) return { kind: 'call', name, args: this.argList() };
      if (name === 'true' || name === 'false') return { kind: 'boolean', value: name === 'true' };
      return { kind: 'name', value: name };
    }
    this.fail(`Expected a value, found ${describe(t)}.`);
  }

  private endOfLine(): void {
    const t = this.peek();
    if (t.kind === 'newline' || t.kind === 'eof' || t.kind === 'doc') return;
    if (t.kind === 'punct' && t.value === '}') return;
    this.fail(`Unexpected ${describe(t)}. Each field, attribute or property goes on its own line.`);
  }
}

function describe(t: Token): string {
  switch (t.kind) {
    case 'eof':
      return 'the end of the file';
    case 'newline':
      return 'the end of the line';
    case 'string':
      return `the string "${t.value}"`;
    case 'doc':
      return 'a comment';
    default:
      return `"${t.value}"`;
  }
}

/** Parses a Prisma schema. Throws `PrismaParseError` (a `KastorError`) with the line and column. */
export function parsePrismaSchema(source: string, file?: string): PrismaSchema {
  return new Parser(tokenize(source, file), file).parse();
}

/* ------------------------------------------------------------------------ */
/* Helpers for reading attributes                                             */
/* ------------------------------------------------------------------------ */

export function findAttribute(list: PrismaAttribute[], name: string): PrismaAttribute | undefined {
  return list.find((a) => a.name === name);
}

/** A named argument, or the positional argument at `position` when there is no named one. */
export function argument(attr: PrismaAttribute | undefined, name: string, position?: number): PrismaValue | undefined {
  if (!attr) return undefined;
  const named = attr.args.find((a) => a.name === name);
  if (named) return named.value;
  if (position === undefined) return undefined;
  const positional = attr.args.filter((a) => a.name === undefined);
  return positional[position]?.value;
}

export function stringValue(value: PrismaValue | undefined): string | undefined {
  return value?.kind === 'string' ? value.value : undefined;
}

/** `[a, b(sort: Desc)]` as field names with their extra arguments. */
export function fieldList(value: PrismaValue | undefined): Array<{ name: string; args: PrismaArg[] }> {
  if (!value) return [];
  const items = value.kind === 'array' ? value.items : [value];
  const out: Array<{ name: string; args: PrismaArg[] }> = [];
  for (const item of items) {
    if (item.kind === 'name') out.push({ name: item.value, args: [] });
    else if (item.kind === 'call') out.push({ name: item.name, args: item.args });
  }
  return out;
}

/** Text of a value, for messages. */
export function valueText(value: PrismaValue): string {
  switch (value.kind) {
    case 'string':
      return JSON.stringify(value.value);
    case 'number':
      return value.value;
    case 'boolean':
      return String(value.value);
    case 'name':
      return value.value;
    case 'call':
      return `${value.name}(${value.args.map((a) => `${a.name ? `${a.name}: ` : ''}${valueText(a.value)}`).join(', ')})`;
    case 'array':
      return `[${value.items.map(valueText).join(', ')}]`;
  }
}
