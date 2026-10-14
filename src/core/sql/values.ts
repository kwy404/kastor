/**
 * Value conversion between JS and drivers. Decoding is tolerant: it accepts
 * every representation the supported drivers produce (numbers as strings,
 * booleans as 0/1, dates as strings with or without a zone, bytes as Buffer
 * or hex), so most dialects only pick encode options.
 */
import { errors } from '../errors';
import type { ColumnIR, NeutralType } from '../ir';

export interface CodecOptions {
  /** How booleans are sent: `native` (true/false) or `int` (1/0). */
  boolean?: 'native' | 'int';
  /**
   * How datetimes are sent: `date` (Date objects, the driver converts),
   * `iso` (`2026-01-02T03:04:05.000Z`) or `naive` (`2026-01-02 03:04:05.000`, UTC).
   */
  datetime?: 'date' | 'iso' | 'naive';
  /** How json is sent: `string` (JSON text) or `native` (the driver serializes). */
  json?: 'string' | 'native';
  /** Whether the driver returns json columns as text (`string`) or parsed (`native`). */
  jsonResult?: 'string' | 'native';
  /** How 64 bit integers are sent. */
  bigint?: 'bigint' | 'string';
  /** Converts bytes before sending (for example to a Node Buffer). */
  bytes?: (value: Uint8Array) => unknown;
}

export interface Codec {
  encode(value: unknown, column?: ColumnIR): unknown;
  decode(value: unknown, column: ColumnIR, source: 'row' | 'json'): unknown;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

export function formatNaiveUtc(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.${pad(date.getUTCMilliseconds(), 3)}`;
}

export function formatDateOnly(date: Date): string {
  // Drivers build date-only values at local midnight (pg, mysql2) or UTC
  // midnight (mssql). Pick the reading that lands on a midnight.
  const utcMidnight = date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0;
  if (utcMidnight) return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatTime(date: Date): string {
  const ms = date.getUTCMilliseconds();
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}${ms ? `.${pad(ms, 3)}` : ''}`;
}

const HEX = /^[0-9a-fA-F]*$/;

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('\\x') || hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !HEX.test(clean)) throw new TypeError(`Not a hex string: ${hex.slice(0, 20)}`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** Parses a datetime string from any driver. Strings without a zone are UTC. */
export function parseDateTime(value: string): Date {
  let s = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00Z';
  else {
    s = s.replace(' ', 'T');
    if (!/(Z|[+-]\d{2}(:?\d{2})?)$/i.test(s)) s += 'Z';
    // "+00" style offsets need minutes for Date.parse
    s = s.replace(/([+-]\d{2})$/, '$1:00');
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new TypeError(`Not a datetime: ${value}`);
  return d;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') return Number(value);
  if (typeof value === 'boolean') return value ? 1 : 0;
  return Number(value);
}

function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.trunc(value));
  if (typeof value === 'string') return BigInt(value.includes('.') ? value.slice(0, value.indexOf('.')) : value);
  return BigInt(value as string);
}

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return Number(value) !== 0;
  if (typeof value === 'string') {
    const v = value.toLowerCase();
    if (v === 't' || v === 'true' || v === '1' || v === 'y' || v === 'yes') return true;
    if (v === 'f' || v === 'false' || v === '0' || v === 'n' || v === 'no' || v === '') return false;
  }
  if (value instanceof Uint8Array) return value.length > 0 && value[0] !== 0;
  return Boolean(value);
}

function toDecimal(value: unknown): string {
  let s = typeof value === 'string' ? value.trim() : String(value);
  if (s.startsWith('.')) s = `0${s}`;
  else if (s.startsWith('-.')) s = `-0${s.slice(1)}`;
  return s;
}

function toBytes(value: unknown, source: 'row' | 'json'): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  if (typeof value === 'string') return hexToBytes(value);
  if (typeof value === 'object' && value !== null && (value as { type?: string }).type === 'Buffer') {
    return Uint8Array.from((value as unknown as { data: number[] }).data);
  }
  throw new TypeError(`Cannot read bytes from ${source} value of type ${typeof value}`);
}

function decodeTime(value: unknown): string {
  if (value instanceof Date) return formatTime(value);
  const s = String(value);
  const m = /(\d{2}:\d{2}(:\d{2}(\.\d+)?)?)/.exec(s);
  if (!m) return s;
  let out = m[1]!;
  if (out.length === 5) out += ':00';
  // drop trailing zero fractions: 10:00:00.000000 -> 10:00:00
  return out.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function decodeDate(value: unknown): string {
  if (value instanceof Date) return formatDateOnly(value);
  const s = String(value);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1]! : s;
}

/** Decodes one value. Exported for dialects that override parts of it. */
export function decodeValue(value: unknown, type: NeutralType, source: 'row' | 'json', jsonResult: 'string' | 'native' = 'string'): unknown {
  if (value === null || value === undefined) return null;
  switch (type) {
    case 'int':
    case 'float':
      return toNumber(value);
    case 'bigint':
      return toBigInt(value);
    case 'decimal':
      return toDecimal(value);
    case 'boolean':
      return toBoolean(value);
    case 'datetime':
      if (value instanceof Date) return value;
      if (typeof value === 'number') return new Date(value);
      if (typeof value === 'bigint') return new Date(Number(value));
      return parseDateTime(String(value));
    case 'date':
      return decodeDate(value);
    case 'time':
      return decodeTime(value);
    case 'json':
      if (source === 'row' && jsonResult === 'string' && typeof value === 'string') return JSON.parse(value);
      if (source === 'row' && value instanceof Uint8Array) return JSON.parse(new TextDecoder().decode(value));
      return value;
    case 'bytes':
      return toBytes(value, source);
    case 'uuid': {
      if (value instanceof Uint8Array && value.length === 16) {
        const h = bytesToHex(value);
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
      }
      return String(value).toLowerCase();
    }
    case 'string':
    case 'text':
    case 'enum':
      return typeof value === 'string' ? value : value instanceof Uint8Array ? new TextDecoder().decode(value) : String(value);
    default:
      return value;
  }
}

/** Encodes one value for a column of the given type. */
export function encodeValue(value: unknown, column: ColumnIR | undefined, options: CodecOptions = {}): unknown {
  if (value === undefined || value === null) return null;
  const type = column?.type;
  if (type === 'json') {
    return (options.json ?? 'string') === 'string' ? JSON.stringify(value) : value;
  }
  if (typeof value === 'boolean') {
    return options.boolean === 'int' ? (value ? 1 : 0) : value;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw errors.invalidArgument('Invalid Date passed as a value.', 'Check the Date before sending it; new Date(text) gives Invalid Date for unparsable text.');
    if (type === 'date') return formatDateOnly(value);
    if (type === 'time') return formatTime(value);
    switch (options.datetime ?? 'date') {
      case 'iso':
        return value.toISOString();
      case 'naive':
        return formatNaiveUtc(value);
      default:
        return value;
    }
  }
  if (typeof value === 'bigint') {
    return options.bigint === 'string' ? value.toString() : value;
  }
  if (type === 'decimal' && typeof value === 'number') return String(value);
  if (type === 'bigint' && typeof value === 'number') return options.bigint === 'string' ? String(Math.trunc(value)) : BigInt(Math.trunc(value));
  if (value instanceof Uint8Array) return options.bytes ? options.bytes(value) : value;
  return value;
}

/** Builds encode and decode functions from a few choices. */
export function codec(options: CodecOptions = {}): Codec {
  return {
    encode: (value, column) => encodeValue(value, column, options),
    decode: (value, column, source) => decodeValue(value, column.type, source, options.jsonResult ?? 'string'),
  };
}

export const defaultCodec = codec();
export const defaultEncode = defaultCodec.encode;
export const defaultDecode = defaultCodec.decode;
