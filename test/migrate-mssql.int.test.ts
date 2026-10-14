import { connectMssql } from './mysql-connect';
import { runMigrateSuite } from './migrate-suite';

const url = process.env.KASTOR_MSSQL_URL;

runMigrateSuite(
  'sql server',
  async () => {
    const base = await connectMssql(url!);
    try {
      await base.adapter.executor.query("IF DB_ID(N'kastor_migrate') IS NULL CREATE DATABASE kastor_migrate", []);
    } finally {
      await base.close();
    }
    const u = new URL(url!);
    u.pathname = '/kastor_migrate';
    return connectMssql(u.toString());
  },
  { enabled: !!url, skipReason: 'KASTOR_MSSQL_URL is not set' },
);
