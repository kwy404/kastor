import { describe, expect, it } from 'vitest';
import { errors, isKastorError, KastorError, sql, SqlFragment } from '../src/index';
import { closest } from '../src/core/errors';
import { renderFragment } from '../src/core/raw';
import { bytesToHex, codec, decodeValue, encodeValue, formatDateOnly, hexToBytes, parseDateTime, splitSqlScript } from '../src/core/sql';
import type { ColumnIR, NeutralType } from '../src/core/ir';

const col = (type: NeutralType): ColumnIR => ({ name: 'c', type, nullable: true });

describe('decodeValue', () => {
  it('reads numbers from every driver shape', () => {
    expect(decodeValue('42', 'int', 'row')).toBe(42);
    expect(decodeValue(42n, 'int', 'row')).toBe(42);
    expect(decodeValue('1.5', 'float', 'row')).toBe(1.5);
    expect(decodeValue('9007199254740993', 'bigint', 'row')).toBe(9007199254740993n);
    expect(decodeValue(5, 'bigint', 'json')).toBe(5n);
    expect(decodeValue('12.50', 'decimal', 'row')).toBe('12.50');
    expect(decodeValue('.5', 'decimal', 'row')).toBe('0.5');
    expect(decodeValue('-.5', 'decimal', 'row')).toBe('-0.5');
    expect(decodeValue(3.25, 'decimal', 'row')).toBe('3.25');
  });

  it('reads booleans as true and false', () => {
    for (const v of [true, 1, '1', 't', 'true', 1n]) expect(decodeValue(v, 'boolean', 'row')).toBe(true);
    for (const v of [false, 0, '0', 'f', 'false', 0n]) expect(decodeValue(v, 'boolean', 'row')).toBe(false);
  });

  it('reads datetimes with or without a zone as UTC', () => {
    const iso = '2026-01-02T03:04:05.678Z';
    expect((decodeValue('2026-01-02 03:04:05.678', 'datetime', 'row') as Date).toISOString()).toBe(iso);
    expect((decodeValue('2026-01-02T03:04:05.678+00:00', 'datetime', 'json') as Date).toISOString()).toBe(iso);
    expect((decodeValue('2026-01-02T05:04:05.678+02', 'datetime', 'json') as Date).toISOString()).toBe(iso);
    expect((decodeValue('2026-01-02 03:04:05.678000', 'datetime', 'json') as Date).toISOString()).toBe(iso);
    expect((decodeValue(Date.parse(iso), 'datetime', 'row') as Date).toISOString()).toBe(iso);
    expect((decodeValue('2026-01-02', 'datetime', 'row') as Date).toISOString()).toBe('2026-01-02T00:00:00.000Z');
    expect(() => parseDateTime('not a date')).toThrow();
  });

  it('reads dates and times as text', () => {
    expect(decodeValue('2026-01-02T00:00:00', 'date', 'row')).toBe('2026-01-02');
    expect(decodeValue(new Date(Date.UTC(2026, 0, 2)), 'date', 'row')).toBe('2026-01-02');
    expect(decodeValue(new Date(2026, 0, 2), 'date', 'row')).toBe('2026-01-02');
    expect(decodeValue('07:30', 'time', 'row')).toBe('07:30:00');
    expect(decodeValue('07:30:00.000000', 'time', 'row')).toBe('07:30:00');
    expect(decodeValue('07:30:00.500', 'time', 'row')).toBe('07:30:00.5');
    expect(decodeValue(new Date(Date.UTC(1970, 0, 1, 7, 30, 0)), 'time', 'row')).toBe('07:30:00');
    expect(formatDateOnly(new Date(Date.UTC(1999, 11, 31)))).toBe('1999-12-31');
  });

  it('reads json, bytes, uuids and text', () => {
    expect(decodeValue('{"a":1}', 'json', 'row')).toEqual({ a: 1 });
    expect(decodeValue('"text"', 'json', 'row')).toBe('text');
    expect(decodeValue('{"a":1}', 'json', 'row', 'native')).toBe('{"a":1}');
    expect(decodeValue({ a: 1 }, 'json', 'json')).toEqual({ a: 1 });
    expect(Array.from(decodeValue('00ff10', 'bytes', 'json') as Uint8Array)).toEqual([0, 255, 16]);
    expect(Array.from(decodeValue('\\x0102', 'bytes', 'json') as Uint8Array)).toEqual([1, 2]);
    expect(Array.from(decodeValue([1, 2], 'bytes', 'row') as Uint8Array)).toEqual([1, 2]);
    expect(Array.from(decodeValue({ type: 'Buffer', data: [3] }, 'bytes', 'row') as Uint8Array)).toEqual([3]);
    expect(decodeValue('ABCDEF00-0000-4000-8000-000000000000', 'uuid', 'row')).toBe('abcdef00-0000-4000-8000-000000000000');
    expect(decodeValue(hexToBytes('0f8fad5bd9cb469fa16570867728950e'), 'uuid', 'row')).toBe('0f8fad5b-d9cb-469f-a165-70867728950e');
    expect(decodeValue(12, 'string', 'row')).toBe('12');
    expect(decodeValue(new TextEncoder().encode('hi'), 'text', 'row')).toBe('hi');
    expect(decodeValue(null, 'int', 'row')).toBeNull();
    expect(decodeValue(undefined, 'text', 'row')).toBeNull();
    expect(() => hexToBytes('abc')).toThrow();
    expect(bytesToHex(new Uint8Array([0, 171]))).toBe('00ab');
  });
});

describe('encodeValue', () => {
  it('follows the codec options', () => {
    const c = codec({ boolean: 'int', datetime: 'iso', json: 'string', bigint: 'string', bytes: (b) => Array.from(b) });
    const d = new Date('2026-01-02T03:04:05.006Z');
    expect(c.encode(true, col('boolean'))).toBe(1);
    expect(c.encode(d, col('datetime'))).toBe('2026-01-02T03:04:05.006Z');
    expect(c.encode({ a: 1 }, col('json'))).toBe('{"a":1}');
    expect(c.encode(5n, col('bigint'))).toBe('5');
    expect(c.encode(5, col('bigint'))).toBe('5');
    expect(c.encode(new Uint8Array([1]), col('bytes'))).toEqual([1]);
    expect(c.encode(undefined, col('text'))).toBeNull();
    expect(encodeValue(d, col('datetime'), { datetime: 'naive' })).toBe('2026-01-02 03:04:05.006');
    expect(encodeValue(d, col('date'))).toBe('2026-01-02');
    expect(encodeValue(d, col('time'))).toBe('03:04:05.006');
    expect(encodeValue(d, col('datetime'))).toBe(d);
    expect(encodeValue(1.5, col('decimal'))).toBe('1.5');
    expect(encodeValue(7, col('bigint'))).toBe(7n);
    expect(encodeValue({ a: 1 }, col('json'), { json: 'native' })).toEqual({ a: 1 });
    expect(c.decode('1', col('boolean'), 'row')).toBe(true);
    expect(() => encodeValue(new Date('nope'), col('datetime'))).toThrow(KastorError);
  });
});

describe('splitSqlScript', () => {
  it('splits on semicolons outside strings, comments and dollar quotes', () => {
    const script = [
      "CREATE TABLE a (x TEXT DEFAULT 'a;b');",
      '-- comment; still a comment',
      'INSERT INTO a VALUES ($$x;y$$);',
      '/* block; comment */ SELECT "weird;name" FROM a;',
      'SELECT [semi;colon] FROM b;',
      "SELECT 'it''s; fine';",
      '',
    ].join('\n');
    const out = splitSqlScript(script);
    expect(out).toHaveLength(5);
    expect(out[0]).toBe("CREATE TABLE a (x TEXT DEFAULT 'a;b')");
    expect(out[1]).toContain('$$x;y$$');
    expect(out[4]).toBe("SELECT 'it''s; fine'");
    expect(out[3]).toBe('SELECT [semi;colon] FROM b');
  });

  it('understands GO batches and slash lines', () => {
    expect(splitSqlScript('SELECT 1\nGO\nSELECT 2\ngo\n')).toEqual(['SELECT 1', 'SELECT 2']);
    expect(splitSqlScript('BEGIN x := 1; y := 2; END;\n/\nSELECT 1 FROM dual', { semicolons: false })).toEqual(['BEGIN x := 1; y := 2; END;', 'SELECT 1 FROM dual']);
    expect(splitSqlScript('-- only a comment\n')).toEqual([]);
  });
});

describe('sql fragments', () => {
  it('binds values and quotes identifiers', () => {
    const name = 'Ada';
    const frag = sql`SELECT * FROM ${sql.ident('public', 'users')} WHERE name = ${name} AND ${sql`age > ${18}`} AND id IN (${sql.join([1, 2, 3])})`;
    const out = renderFragment(frag, (n) => `"${n}"`, (i) => `$${i}`);
    expect(out.sql).toBe('SELECT * FROM "public"."users" WHERE name = $1 AND age > $2 AND id IN ($3, $4, $5)');
    expect(out.params).toEqual(['Ada', 18, 1, 2, 3]);
    expect(frag).toBeInstanceOf(SqlFragment);
    expect(String(sql`a = ${1}`)).toBe('a = ?');
    expect(renderFragment(sql.raw('NOW()'), (n) => n, () => '?').sql).toBe('NOW()');
    expect(renderFragment(sql.join([]), (n) => n, () => '?').sql).toBe('');
    expect(sql.empty.strings).toEqual(['']);
    expect(() => sql.ident()).toThrow(KastorError);
    expect(() => (sql as unknown as (s: string) => unknown)('not a template')).toThrow(KastorError);
  });
});

describe('KastorError', () => {
  it('carries code, message, hint, meta and cause', () => {
    const cause = new Error('driver says no');
    const e = errors.uniqueViolation(['email'], cause, { model: 'users' });
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('UNIQUE_VIOLATION');
    expect(e.message).toBe('A record with the same email already exists.');
    expect(e.hint).toContain('upsert');
    expect(e.meta).toMatchObject({ target: 'email', model: 'users' });
    expect(e.cause).toBe(cause);
    expect(e.toString()).toContain('Hint:');
    expect(e.toJSON()).toMatchObject({ code: 'UNIQUE_VIOLATION' });
    expect(isKastorError(e)).toBe(true);
    expect(isKastorError(e, 'NOT_FOUND')).toBe(false);
    expect(isKastorError(new Error('x'))).toBe(false);
    expect(new KastorError('NOT_FOUND', 'm').toString()).toBe('KastorError [NOT_FOUND]: m');
  });

  it('suggests close names', () => {
    expect(closest('emial', ['email', 'name'])).toBe('email');
    expect(closest('zzzzzz', ['email'])).toBeUndefined();
    const e = errors.unknownField('users', 'emial', ['id', 'email']);
    expect(e.hint).toContain('Did you mean "email"?');
    expect(errors.unknownRelation('users', 'x', []).hint).toContain('no relations');
    expect(errors.unknownModel('usr', ['users']).hint).toContain('users');
  });

  it('has a factory for every database condition', () => {
    const cause = new Error('x');
    expect(errors.foreignKeyViolation('fk', cause).code).toBe('FOREIGN_KEY_VIOLATION');
    expect(errors.foreignKeyViolation(undefined, cause).message).toContain('foreign key');
    expect(errors.notNullViolation('c', cause).message).toContain('"c"');
    expect(errors.notNullViolation(undefined, cause).code).toBe('NOT_NULL_VIOLATION');
    expect(errors.checkViolation('ck', cause).code).toBe('CHECK_VIOLATION');
    expect(errors.checkViolation(undefined, cause).code).toBe('CHECK_VIOLATION');
    expect(errors.serialization(cause).code).toBe('SERIALIZATION_FAILURE');
    expect(errors.deadlock(cause).code).toBe('DEADLOCK');
    expect(errors.connection(cause).code).toBe('CONNECTION_FAILED');
    expect(errors.timeout(cause).code).toBe('TIMEOUT');
    expect(errors.queryFailed(cause, 'SELECT 1').meta).toEqual({ sql: 'SELECT 1' });
    expect(errors.queryFailed('plain').message).toContain('plain');
    expect(errors.uniqueViolation(undefined, cause).message).toContain('unique value');
    expect(errors.uniqueViolation('email', cause).message).toContain('email');
    expect(errors.notFound('users', 'update').hint).toContain('updateMany');
    expect(errors.missingUnique('users', 'findUnique', [['id'], ['a', 'b']]).hint).toContain('(a, b)');
    expect(errors.unsupported('x', 'y', 'z').code).toBe('UNSUPPORTED');
    expect(errors.validation('m', 'f', 'p', 'h').message).toBe('Invalid value for m.f: p.');
  });
});
