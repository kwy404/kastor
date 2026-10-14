import { connectMariadb, connectMysql } from './mysql-connect';
import { runMigrateSuite } from './migrate-suite';

const mysqlUrl = process.env.KASTOR_MYSQL_URL;
const mariadbUrl = process.env.KASTOR_MARIADB_URL;

/** A database of its own, so dropping everything never touches other suites. */
async function ownDatabase(url: string, connect: (u: string) => Promise<{ adapter: { executor: { query(sql: string, params: unknown[]): Promise<unknown> } }; close(): Promise<void> }>): Promise<string> {
  const base = await connect(url);
  try {
    await base.adapter.executor.query('CREATE DATABASE IF NOT EXISTS kastor_migrate', []);
  } finally {
    await base.close();
  }
  const u = new URL(url);
  u.pathname = '/kastor_migrate';
  return u.toString();
}

runMigrateSuite('mysql', async () => connectMysql(await ownDatabase(mysqlUrl!, connectMysql)), {
  enabled: !!mysqlUrl,
  skipReason: 'KASTOR_MYSQL_URL is not set',
});

runMigrateSuite('mariadb', async () => connectMariadb(await ownDatabase(mariadbUrl!, connectMariadb)), {
  enabled: !!mariadbUrl,
  skipReason: 'KASTOR_MARIADB_URL is not set',
});
