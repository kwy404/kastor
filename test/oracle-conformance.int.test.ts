import { runConformance } from './helpers/conformance';
import { connectOracle } from './mysql-connect';

const url = process.env.KASTOR_ORACLE_URL;

runConformance('oracle (oracledb thin pool)', () => connectOracle(url!), { enabled: !!url });
