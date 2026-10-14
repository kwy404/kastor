import { oracle } from '../src/oracle';
import { runConformance } from './helpers/conformance';
import { connectOracle } from './mysql-connect';

const url = process.env.KASTOR_ORACLE_URL;

runConformance('oracle (oracledb thin pool)', () => connectOracle(url!), { enabled: !!url });

runConformance(
  'oracle (oracledb single connection)',
  async () => {
    const mod = await import('oracledb');
    const oracledb = (mod as unknown as { default?: typeof mod }).default ?? mod;
    const u = new URL(url!);
    const conn = await oracledb.getConnection({ user: u.username, password: u.password, connectString: `${u.hostname}:${u.port}${u.pathname}` });
    return { adapter: oracle(conn), close: () => conn.close() };
  },
  { enabled: !!url },
);
