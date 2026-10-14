// Executors and error mapping of the MySQL, MariaDB, SQL Server and Oracle adapters, against fake drivers.
import { describe, expect, it } from 'vitest';
import { isKastorError } from '../src/core/errors';
import { detectDriver, mysqlExecutor, normalizeResult, queryOptions } from '../src/dialects/mysql/executor';
import { mapMysqlError } from '../src/dialects/mysql/errors';
import { bindParams, MssqlTypedParam, mssqlExecutor, type MssqlRequestLike } from '../src/dialects/mssql/executor';
import { mapMssqlError } from '../src/dialects/mssql/errors';
import { OracleOutBind, oracleExecutor, outRows, readLobs } from '../src/dialects/oracle/executor';
import { mapOracleError } from '../src/dialects/oracle/errors';
import { mariadb } from '../src/mariadb';
import { mssql } from '../src/mssql';
import { mysql } from '../src/mysql';
import { oracle } from '../src/oracle';

type Call = { sql: string; values: unknown };

function fakeMysql2() {
  const calls: Call[] = [];
  let released = 0;
  const query = async (opts: { sql: string; values: unknown }) => {
    calls.push({ sql: opts.sql, values: opts.values });
    if (/^INSERT/.test(opts.sql)) return [{ affectedRows: 1, insertId: 7 }, undefined];
    if (opts.sql === 'FAIL') throw Object.assign(new Error('dup'), { errno: 1062, sqlMessage: "Duplicate entry 'a' for key 'users.users_email_key'" });
    return [[{ id: 1 }], []];
  };
  const pool = {
    query,
    getConnection: async () => ({ query, release: () => void released++ }),
    end: async () => undefined,
  };
  return { pool, calls, released: () => released };
}

describe('mysql executor', () => {
  it('tells mysql2 from the mariadb package', () => {
    expect(detectDriver({ query() {} })).toBe('mysql2');
    expect(detectDriver({ query() {}, batch() {} })).toBe('mariadb');
  });

  it('sends per query options that keep values exact', () => {
    const [opts] = queryOptions('mysql2', 'SELECT ?', [1]) as [Record<string, unknown>];
    expect(opts).toMatchObject({ sql: 'SELECT ?', values: [1], supportBigNumbers: true, bigNumberStrings: true, dateStrings: true });
    const [mopts, values] = queryOptions('mariadb', 'SELECT ?', [1]) as [Record<string, unknown>, unknown];
    expect(mopts).toMatchObject({ sql: 'SELECT ?', dateStrings: true, autoJsonMap: false, bigIntAsNumber: false, decimalAsNumber: false });
    expect(values).toEqual([1]);
    const cast = opts.typeCast as (f: unknown, next: () => unknown) => unknown;
    expect(cast({ type: 'JSON', string: (enc: string) => `json:${enc}` }, () => 'next')).toBe('json:utf8');
    expect(cast({ type: 'BLOB', extendedFormat: 'json', string: () => '{}' }, () => 'next')).toBe('{}');
    expect(cast({ type: 'DATETIME', string: () => '2024-01-02 03:04:05.000' }, () => 'next')).toBe('2024-01-02 03:04:05.000');
    expect(cast({ type: 'LONG', string: () => '1' }, () => 'next')).toBe('next');
    const mcast = mopts.typeCast as (c: unknown, next: () => unknown) => unknown;
    expect(mcast({ type: 'BLOB', dataTypeFormat: 'json', string: () => '[1]' }, () => 'next')).toBe('[1]');
    expect(mcast({ type: 'VAR_STRING', string: () => 'x' }, () => 'next')).toBe('next');
  });

  it('normalizes results from both drivers', () => {
    expect(normalizeResult('mysql2', [[{ a: 1 }], []])).toEqual({ rows: [{ a: 1 }] });
    expect(normalizeResult('mysql2', [{ affectedRows: 2, insertId: 0 }, undefined])).toEqual({ rows: [], rowsAffected: 2 });
    expect(normalizeResult('mariadb', { affectedRows: 1n, insertId: 5n })).toEqual({ rows: [], rowsAffected: 1, insertId: 5n });
    expect(normalizeResult('mariadb', [{ a: 1 }])).toEqual({ rows: [{ a: 1 }] });
    expect(normalizeResult('mysql2', [[[{ a: 1 }], [{ b: 2 }]], []])).toEqual({ rows: [{ b: 2 }] });
  });

  it('runs transactions on one pooled connection and releases it', async () => {
    const fake = fakeMysql2();
    const exec = mysqlExecutor(fake.pool);
    const out = await exec.transaction(async (tx) => {
      expect(tx.inTransaction).toBe(true);
      const res = await tx.query('INSERT INTO t VALUES (?)', [1]);
      expect(res.insertId).toBe(7);
      return 'done';
    }, { isolationLevel: 'serializable' });
    expect(out).toBe('done');
    expect(fake.calls.map((c) => c.sql)).toEqual(['SET TRANSACTION ISOLATION LEVEL SERIALIZABLE', 'START TRANSACTION', 'INSERT INTO t VALUES (?)', 'COMMIT']);
    expect(fake.released()).toBe(1);
    await expect(exec.transaction(async (tx) => tx.query('FAIL', []))).rejects.toThrow('dup');
    expect(fake.calls.at(-1)!.sql).toBe('ROLLBACK');
    expect(fake.released()).toBe(2);
  });

  it('switches a mysql2 callback pool to its promise API', async () => {
    const fake = fakeMysql2();
    class Pool {
      promise() {
        return fake.pool;
      }
      query() {
        throw new Error('callback API used');
      }
    }
    const adapter = mysql(new Pool() as never);
    expect((await adapter.executor.query('SELECT 1', [])).rows).toEqual([{ id: 1 }]);
    expect(adapter.dialect.name).toBe('mysql');
    expect(mariadb(fake.pool).dialect.name).toBe('mariadb');
  });

  it('serializes queries on a single connection', async () => {
    const order: string[] = [];
    const conn = {
      async query(opts: { sql: string }) {
        order.push(`start ${opts.sql}`);
        await new Promise((r) => setTimeout(r, 5));
        order.push(`end ${opts.sql}`);
        return [[], []];
      },
      beginTransaction: async () => undefined,
    };
    const exec = mysqlExecutor(conn);
    await Promise.all([exec.query('A', []), exec.query('B', [])]);
    expect(order).toEqual(['start A', 'end A', 'start B', 'end B']);
  });

  it('maps driver errors', () => {
    expect(isKastorError(mapMysqlError({ errno: 1062, sqlMessage: "Duplicate entry 'a' for key 'users.users_email_key'" }), 'UNIQUE_VIOLATION')).toBe(true);
    expect(mapMysqlError({ errno: 1062, sqlMessage: "Duplicate entry 'a' for key 'users.users_email_key'" })!.message).toContain('users_email_key');
    expect(isKastorError(mapMysqlError({ errno: 1452, sqlMessage: 'a foreign key constraint fails (CONSTRAINT `posts_fk` FOREIGN KEY ...)' }), 'FOREIGN_KEY_VIOLATION')).toBe(true);
    expect(isKastorError(mapMysqlError({ errno: 1048, sqlMessage: "Column 'email' cannot be null" }), 'NOT_NULL_VIOLATION')).toBe(true);
    expect(isKastorError(mapMysqlError({ errno: 1364, sqlMessage: "Field 'email' doesn't have a default value" }), 'NOT_NULL_VIOLATION')).toBe(true);
    expect(isKastorError(mapMysqlError({ errno: 3819, sqlMessage: "Check constraint 'ck' is violated." }), 'CHECK_VIOLATION')).toBe(true);
    expect(isKastorError(mapMysqlError({ errno: 4025, sqlMessage: 'CONSTRAINT `ck` failed for `db`.`t`' }), 'CHECK_VIOLATION')).toBe(true);
    expect(isKastorError(mapMysqlError({ errno: 1213 }), 'DEADLOCK')).toBe(true);
    expect(isKastorError(mapMysqlError({ errno: 1205 }), 'TIMEOUT')).toBe(true);
    expect(isKastorError(mapMysqlError({ code: 'ECONNREFUSED' }), 'CONNECTION_FAILED')).toBe(true);
    expect(mapMysqlError({ errno: 1064 })).toBeNull();
    expect(mapMysqlError('nope')).toBeNull();
  });
});

describe('mssql executor', () => {
  function fakeMssql() {
    const log: string[] = [];
    let connects = 0;
    const request = (): MssqlRequestLike & { inputs: Record<string, unknown> } => {
      const inputs: Record<string, unknown> = {};
      return {
        inputs,
        input(name, value) {
          inputs[name] = value;
        },
        async query(sql) {
          log.push(`${sql} ${JSON.stringify(inputs)}`);
          return { recordset: [{ id: 1 }], rowsAffected: [1, 2] };
        },
      };
    };
    const pool = {
      connect: async () => void connects++,
      request,
      transaction: () => ({
        begin: async (level?: number) => void log.push(`BEGIN ${level}`),
        commit: async () => void log.push('COMMIT'),
        rollback: async () => void log.push('ROLLBACK'),
        request,
      }),
      close: async () => undefined,
    };
    return { pool, log, connects: () => connects };
  }

  it('binds @p parameters and casts typed NULLs', () => {
    const inputs: Record<string, unknown> = {};
    const req = { input: (n: string, v: unknown) => void (inputs[n] = v), query: async () => ({}) };
    const sql = bindParams(req, 'UPDATE t SET b = @p1, c = @p10 WHERE id = @p2', [new MssqlTypedParam(null, 'VARBINARY(MAX)'), 5, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(sql).toBe('UPDATE t SET b = CAST(@p1 AS VARBINARY(MAX)), c = @p10 WHERE id = @p2');
    expect(inputs).toMatchObject({ p1: null, p2: 5, p10: 10 });
  });

  it('connects once, sums rowsAffected and runs transactions with isolation levels', async () => {
    const fake = fakeMssql();
    const adapter = mssql(fake.pool);
    const res = await adapter.executor.query('SELECT 1', []);
    await adapter.executor.query('SELECT 2', []);
    expect(res).toEqual({ rows: [{ id: 1 }], rowsAffected: 3 });
    expect(fake.connects()).toBe(1);
    await adapter.executor.transaction(async (tx) => {
      await tx.query('INSERT x', [1]);
    }, { isolationLevel: 'repeatable read' });
    expect(fake.log.slice(-3)).toEqual(['BEGIN 3', 'INSERT x {"p1":1}', 'COMMIT']);
    await expect(
      mssqlExecutor(fake.pool).transaction(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(fake.log.at(-1)).toBe('ROLLBACK');
  });

  it('maps driver errors', () => {
    expect(isKastorError(mapMssqlError({ number: 2627, message: "Violation of UNIQUE KEY constraint 'uq'." }), 'UNIQUE_VIOLATION')).toBe(true);
    expect(isKastorError(mapMssqlError({ originalError: { info: { number: 2601, message: "Cannot insert duplicate key row in object 'dbo.t' with unique index 'ix'." } } }), 'UNIQUE_VIOLATION')).toBe(true);
    expect(isKastorError(mapMssqlError({ number: 547, message: 'The INSERT statement conflicted with the FOREIGN KEY constraint "fk".' }), 'FOREIGN_KEY_VIOLATION')).toBe(true);
    expect(isKastorError(mapMssqlError({ number: 547, message: 'The INSERT statement conflicted with the CHECK constraint "ck".' }), 'CHECK_VIOLATION')).toBe(true);
    expect(isKastorError(mapMssqlError({ number: 515, message: "Cannot insert the value NULL into column 'email', table 'db.dbo.t'" }), 'NOT_NULL_VIOLATION')).toBe(true);
    expect(isKastorError(mapMssqlError({ number: 1205 }), 'DEADLOCK')).toBe(true);
    expect(isKastorError(mapMssqlError({ code: 'ETIMEOUT' }), 'TIMEOUT')).toBe(true);
    expect(isKastorError(mapMssqlError({ code: 'ESOCKET' }), 'CONNECTION_FAILED')).toBe(true);
    expect(mapMssqlError({ number: 102 })).toBeNull();
  });
});

describe('oracle executor', () => {
  it('reads LOBs into plain values and turns out binds into rows', async () => {
    const lob = { getData: async () => 'clob text' };
    expect(await readLobs([{ a: lob, b: 1, c: Buffer.from([1]) }])).toEqual([{ a: 'clob text', b: 1, c: Buffer.from([1]) }]);
    const outs = [new OracleOutBind({ name: 'id', type: 'int', nullable: false }, 'id'), new OracleOutBind({ name: 'title', type: 'string', nullable: false }, 'title')];
    expect(await outRows(outs, [[1, 2], ['a', 'b']])).toEqual([
      { id: 1, title: 'a' },
      { id: 2, title: 'b' },
    ]);
    expect(await outRows(outs, [[], []])).toEqual([]);
  });

  it('commits outside transactions, binds out parameters and closes connections', async () => {
    const log: string[] = [];
    let open = 0;
    const conn = {
      async execute(sql: string, binds: unknown[], options: Record<string, unknown>) {
        log.push(`${sql} autoCommit=${String(options.autoCommit)} outFormat=${String(options.outFormat)}`);
        const outIndex = binds.findIndex((b) => typeof b === 'object' && b !== null && (b as { dir?: number }).dir === 3003);
        if (outIndex >= 0) return { rowsAffected: 1, outBinds: [[42]] };
        return { rows: [{ x: 1 }], rowsAffected: undefined };
      },
      commit: async () => void log.push('COMMIT'),
      rollback: async () => void log.push('ROLLBACK'),
      close: async () => void open--,
    };
    const pool = { getConnection: async () => (open++, conn), close: async () => undefined };
    const adapter = oracle(pool);
    expect((await adapter.executor.query('SELECT 1 FROM DUAL', [])).rows).toEqual([{ x: 1 }]);
    expect(log[0]).toBe('SELECT 1 FROM DUAL autoCommit=true outFormat=4002');
    const inserted = await adapter.executor.query('INSERT INTO t VALUES (DEFAULT) RETURNING "id" INTO :1', [new OracleOutBind({ name: 'id', type: 'int', nullable: false }, 'id')]);
    expect(inserted).toEqual({ rows: [{ id: 42 }], rowsAffected: 1 });
    await adapter.executor.transaction(async (tx) => {
      await tx.query('UPDATE t SET a = 1', []);
    }, { isolationLevel: 'serializable' });
    expect(log.slice(-3)).toEqual(['SET TRANSACTION ISOLATION LEVEL SERIALIZABLE autoCommit=false outFormat=4002', 'UPDATE t SET a = 1 autoCommit=false outFormat=4002', 'COMMIT']);
    await expect(oracleExecutor(pool).transaction(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(log.at(-1)).toBe('ROLLBACK');
    expect(open).toBe(0);
  });

  it('maps driver errors', () => {
    expect(mapOracleError({ errorNum: 1, message: 'ORA-00001: unique constraint (KASTOR.users_email_key) violated' })!.message).toContain('users_email_key');
    expect(isKastorError(mapOracleError({ message: 'ORA-02291: integrity constraint (KASTOR.fk) violated - parent key not found' }), 'FOREIGN_KEY_VIOLATION')).toBe(true);
    expect(isKastorError(mapOracleError({ errorNum: 1400, message: 'ORA-01400: cannot insert NULL into ("KASTOR"."users"."email")' }), 'NOT_NULL_VIOLATION')).toBe(true);
    expect(mapOracleError({ errorNum: 1400, message: 'ORA-01400: cannot insert NULL into ("KASTOR"."users"."email")' })!.message).toContain('"email"');
    expect(isKastorError(mapOracleError({ errorNum: 2290, message: 'ORA-02290: check constraint (KASTOR.CK_t_a) violated' }), 'CHECK_VIOLATION')).toBe(true);
    expect(isKastorError(mapOracleError({ errorNum: 60 }), 'DEADLOCK')).toBe(true);
    expect(isKastorError(mapOracleError({ errorNum: 8177 }), 'SERIALIZATION_FAILURE')).toBe(true);
    expect(isKastorError(mapOracleError({ errorNum: 12541 }), 'CONNECTION_FAILED')).toBe(true);
    expect(isKastorError(mapOracleError({ message: 'NJS-500: connection to the Oracle Database was broken' }), 'CONNECTION_FAILED')).toBe(true);
    expect(mapOracleError({ errorNum: 942 })).toBeNull();
  });
});
