import { connectOracle } from './mysql-connect';
import { runMigrateSuite } from './migrate-suite';

const url = process.env.KASTOR_ORACLE_URL;

// Oracle has one schema for the test user, shared with the other Oracle
// suites; the files run one after another and each one creates its tables.
runMigrateSuite('oracle', () => connectOracle(url!), { enabled: !!url, skipReason: 'KASTOR_ORACLE_URL is not set' });
