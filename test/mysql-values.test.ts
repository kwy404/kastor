// Value encoding and decoding of the MySQL, MariaDB, SQL Server and Oracle hooks.
import { describe, expect, it } from 'vitest';
import type { ColumnIR, NeutralType } from '../src/core/ir';
import { q, text } from '../src/core/sql/frag';
import { MssqlTypedParam } from '../src/dialects/mssql/executor';
import { mssqlDecode, mssqlEncode, mssqlSelectColumn } from '../src/dialects/mssql/hooks';
import { mysqlDecode, mysqlEncode } from '../src/dialects/mysql/hooks';
import { oracleCompareColumn, oracleDecode, oracleEncode } from '../src/dialects/oracle/hooks';

const col = (type: NeutralType, extra: Partial<ColumnIR> = {}): ColumnIR => ({ name: 'c', type, nullable: true, ...extra });
const at = new Date('2024-01-02T03:04:05.678Z');

describe('mysql values', () => {
  it('encodes for client side interpolation', () => {
    expect(mysqlEncode(true, col('boolean'))).toBe(1);
    expect(mysqlEncode(at, col('datetime'))).toBe('2024-01-02 03:04:05.678');
    expect(mysqlEncode(at, col('date'))).toBe('2024-01-02');
    expect(mysqlEncode({ a: [1] }, col('json'))).toBe('{"a":[1]}');
    expect(mysqlEncode('plain', col('json'))).toBe('"plain"');
    expect(mysqlEncode(9007199254740993n, col('bigint'))).toBe('9007199254740993');
    expect(Buffer.isBuffer(mysqlEncode(new Uint8Array([1, 2]), col('bytes')))).toBe(true);
    expect(mysqlEncode(null, col('string'))).toBeNull();
  });

  it('decodes rows and embedded JSON', () => {
    expect(mysqlDecode('2024-01-02 03:04:05.678', col('datetime'), 'row')).toEqual(at);
    expect(mysqlDecode('2024-01-02 03:04:05.678000', col('datetime'), 'json')).toEqual(at);
    expect(mysqlDecode('9223372036854775807', col('bigint'), 'row')).toBe(9223372036854775807n);
    expect(mysqlDecode(5n, col('bigint'), 'row')).toBe(5n);
    expect(mysqlDecode('12.3400', col('decimal'), 'row')).toBe('12.3400');
    expect(mysqlDecode(1, col('boolean'), 'row')).toBe(true);
    expect(mysqlDecode('{"a":1}', col('json'), 'row')).toEqual({ a: 1 });
    expect(mysqlDecode('already parsed', col('json'), 'row')).toBe('already parsed');
    expect(mysqlDecode(Buffer.from('[1]'), col('json'), 'row')).toEqual([1]);
    expect(mysqlDecode({ a: 1 }, col('json'), 'json')).toEqual({ a: 1 });
    expect(mysqlDecode('base64:type15:AQID', col('bytes'), 'json')).toEqual(new Uint8Array([1, 2, 3]));
    expect(mysqlDecode('010203', col('bytes'), 'json')).toEqual(new Uint8Array([1, 2, 3]));
    expect(mysqlDecode(Buffer.from([1, 2]), col('bytes'), 'row')).toEqual(new Uint8Array([1, 2]));
    expect(mysqlDecode('08:30:00.000000', col('time'), 'json')).toBe('08:30:00');
    expect(mysqlDecode('ABC', col('uuid'), 'row')).toBe('abc');
    expect(mysqlDecode(null, col('int'), 'row')).toBeNull();
  });
});

describe('mssql values', () => {
  it('encodes datetimes as text and NULL bytes as a typed parameter', () => {
    expect(mssqlEncode(at, col('datetime'))).toBe('2024-01-02 03:04:05.678');
    expect(mssqlEncode(true, col('boolean'))).toBe(true);
    expect(mssqlEncode(null, col('bytes'))).toEqual(new MssqlTypedParam(null, 'VARBINARY(MAX)'));
    expect(mssqlEncode(null, col('string'))).toBeNull();
    expect(mssqlEncode(1n, col('bigint'))).toBe('1');
  });

  it('decodes tedious values', () => {
    expect(mssqlDecode(at, col('datetime'), 'row')).toEqual(at);
    expect(mssqlDecode('2024-01-02T03:04:05.678', col('datetime'), 'json')).toEqual(at);
    expect(mssqlDecode(new Date('2024-01-02T00:00:00Z'), col('date'), 'row')).toBe('2024-01-02');
    expect(mssqlDecode(new Date('1970-01-01T08:30:00Z'), col('time'), 'row')).toBe('08:30:00');
    expect(mssqlDecode('0E984725-C51C-4BF4-9960-E1C80E27ABA0', col('uuid'), 'row')).toBe('0e984725-c51c-4bf4-9960-e1c80e27aba0');
    expect(mssqlDecode('12345678901234567890.1234567891', col('decimal'), 'row')).toBe('12345678901234567890.1234567891');
    expect(mssqlDecode(1.5, col('decimal'), 'row')).toBe('1.5');
    expect(mssqlDecode('9223372036854775807', col('bigint'), 'json')).toBe(9223372036854775807n);
    expect(mssqlDecode('0102', col('bytes'), 'json')).toEqual(new Uint8Array([1, 2]));
    expect(mssqlDecode(true, col('boolean'), 'json')).toBe(true);
  });

  it('reads decimals as text', () => {
    const expr = text('[t0].[price]');
    expect(mssqlSelectColumn(expr, col('decimal')).render(() => '?').sql).toBe('CAST([t0].[price] AS NVARCHAR(80))');
    expect(mssqlSelectColumn(expr, col('int'))).toBe(expr);
  });
});

describe('oracle values', () => {
  it('encodes dates, times, booleans and datetimes for oracledb', () => {
    expect(oracleEncode(true, col('boolean'))).toBe(1);
    expect(oracleEncode(at, col('datetime'))).toBe(at);
    expect(oracleEncode('2024-01-02T03:04:05.678Z', col('datetime'))).toEqual(at);
    expect(oracleEncode('2024-01-02', col('date'))).toEqual(new Date(2024, 0, 2));
    expect(oracleEncode('08:30:00', col('time'))).toBe('0 08:30:00');
    expect(oracleEncode('8:30', col('time'))).toBe('0 08:30:00');
    expect(oracleEncode({ a: 1 }, col('json'))).toBe('{"a":1}');
    expect(oracleEncode(null, col('date'))).toBeNull();
  });

  it('decodes intervals, LOB text and numbers read as text', () => {
    expect(oracleDecode({ days: 0, hours: 8, minutes: 30, seconds: 5 }, col('time'), 'row')).toBe('08:30:05');
    expect(oracleDecode('PT8H30M5S', col('time'), 'json')).toBe('08:30:05');
    expect(oracleDecode('PT8H', col('time'), 'json')).toBe('08:00:00');
    expect(oracleDecode('+00 08:30:05.000000', col('time'), 'row')).toBe('08:30:05');
    expect(oracleDecode(new Date(2024, 0, 2), col('date'), 'row')).toBe('2024-01-02');
    expect(oracleDecode('2024-01-02T00:00:00', col('date'), 'json')).toBe('2024-01-02');
    expect(oracleDecode('2024-01-02T00:04:05.678000-03:00', col('datetime'), 'json')).toEqual(at);
    expect(oracleDecode('9223372036854775807', col('bigint'), 'row')).toBe(9223372036854775807n);
    expect(oracleDecode(1, col('boolean'), 'row')).toBe(true);
    expect(oracleDecode('{"a":1}', col('json'), 'row')).toEqual({ a: 1 });
    expect(oracleDecode('ABC ', col('uuid'), 'row')).toBe('abc');
    expect(oracleDecode(Buffer.from([1]), col('bytes'), 'row')).toEqual(new Uint8Array([1]));
  });

  it('compares CLOB columns through DBMS_LOB.SUBSTR', () => {
    const expr = text('"t0"."bio"');
    expect(oracleCompareColumn(expr, col('text')).render(() => '?').sql).toBe('DBMS_LOB.SUBSTR("t0"."bio", 1000, 1)');
    expect(oracleCompareColumn(expr, col('text', { nativeType: 'varchar2(4000)' }))).toBe(expr);
    expect(oracleCompareColumn(q`${expr}`, col('string')).render(() => '?').sql).toBe('"t0"."bio"');
  });
});
