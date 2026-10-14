/**
 * Connection helpers for the MySQL, MariaDB, SQL Server and Oracle
 * integration tests. Each reads a KASTOR_*_URL and builds the driver pool.
 */
import type { Adapter, Executor } from '../src/core/ir';
import { mariadb } from '../src/mariadb';
import { mssql } from '../src/mssql';
import { mysql } from '../src/mysql';
import { oracle } from '../src/oracle';

export interface Connected {
  adapter: Adapter;
  close(): Promise<void>;
}

function parts(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
  };
}

export async function connectMysql(url: string): Promise<Connected> {
  const { createPool } = await import('mysql2/promise');
  const pool = createPool({ ...parts(url), connectionLimit: 5 });
  return { adapter: mysql(pool), close: () => pool.end() };
}

/** MariaDB through the mariadb package (`driver: 'mariadb'`) or mysql2. */
export async function connectMariadb(url: string, driver: 'mariadb' | 'mysql2' = 'mariadb'): Promise<Connected> {
  if (driver === 'mysql2') {
    const { createPool } = await import('mysql2/promise');
    const pool = createPool({ ...parts(url), connectionLimit: 5 });
    return { adapter: mariadb(pool), close: () => pool.end() };
  }
  const mod = await import('mariadb');
  const pool = mod.createPool({ ...parts(url), connectionLimit: 5 });
  return { adapter: mariadb(pool), close: () => pool.end() };
}

export async function connectMssql(url: string): Promise<Connected> {
  const mod = await import('mssql');
  const sql = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const p = parts(url);
  const pool = new sql.ConnectionPool({
    server: p.host,
    port: p.port,
    user: p.user,
    password: p.password,
    database: p.database,
    options: { encrypt: false, trustServerCertificate: true },
    pool: { max: 5 },
    requestTimeout: 120000,
  });
  return { adapter: mssql(pool), close: () => pool.close() };
}

export async function connectOracle(url: string): Promise<Connected> {
  const mod = await import('oracledb');
  const oracledb = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const p = parts(url);
  const pool = await oracledb.createPool({ user: p.user, password: p.password, connectString: `${p.host}:${p.port}/${p.database}`, poolMax: 5 });
  return { adapter: oracle(pool), close: () => pool.close(0) };
}

export async function dropMysqlTable(exec: Executor, table: string): Promise<void> {
  await exec.query('SET FOREIGN_KEY_CHECKS = 0', []);
  await exec.query(`DROP TABLE IF EXISTS \`${table}\``, []);
  await exec.query('SET FOREIGN_KEY_CHECKS = 1', []);
}

export async function dropMssqlTable(exec: Executor, table: string): Promise<void> {
  const name = table.replace(/'/g, "''");
  await exec.query(
    `DECLARE @sql NVARCHAR(MAX) = N'';
     SELECT @sql = @sql + N'ALTER TABLE ' + QUOTENAME(OBJECT_SCHEMA_NAME(parent_object_id)) + N'.' + QUOTENAME(OBJECT_NAME(parent_object_id)) + N' DROP CONSTRAINT ' + QUOTENAME(name) + N';'
     FROM sys.foreign_keys WHERE referenced_object_id = OBJECT_ID(N'${name}') OR parent_object_id = OBJECT_ID(N'${name}');
     EXEC sp_executesql @sql;
     IF OBJECT_ID(N'${name}', N'U') IS NOT NULL DROP TABLE [${table.replace(/]/g, ']]')}];`,
    [],
  );
}

export async function dropOracleTable(exec: Executor, table: string): Promise<void> {
  try {
    await exec.query(`DROP TABLE "${table.replace(/"/g, '""')}" CASCADE CONSTRAINTS PURGE`, []);
  } catch (error) {
    if (!/ORA-00942/.test(String((error as Error).message))) throw error;
  }
}
