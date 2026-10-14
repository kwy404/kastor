import { connectOracle } from './mysql-connect';
import { runMigrateSuite } from './migrate-suite';

const url = process.env.KASTOR_ORACLE_URL;

/**
 * Oracle keeps tables per user, and the app user is shared with the other
 * Oracle suites. This suite drops everything it sees, so it runs as a user of
 * its own, created through SYSTEM (the compose file gives SYSTEM the same
 * password as the app user).
 */
async function ownUser(baseUrl: string): Promise<string> {
  const u = new URL(baseUrl);
  const password = decodeURIComponent(u.password).replace(/"/g, '');
  const system = new URL(baseUrl);
  system.username = 'system';
  const admin = await connectOracle(system.toString());
  try {
    await admin.adapter.executor.query(
      `DECLARE n NUMBER;
BEGIN
  SELECT COUNT(*) INTO n FROM all_users WHERE username = 'KASTOR_MIGRATE';
  IF n = 0 THEN
    EXECUTE IMMEDIATE 'CREATE USER kastor_migrate IDENTIFIED BY "${password}" QUOTA UNLIMITED ON users';
    EXECUTE IMMEDIATE 'GRANT CREATE SESSION, CREATE TABLE, CREATE SEQUENCE, CREATE TRIGGER, CREATE VIEW, CREATE PROCEDURE TO kastor_migrate';
  END IF;
END;`,
      [],
    );
  } finally {
    await admin.close();
  }
  u.username = 'kastor_migrate';
  return u.toString();
}

runMigrateSuite('oracle', async () => connectOracle(await ownUser(url!)), { enabled: !!url, skipReason: 'KASTOR_ORACLE_URL is not set' });
