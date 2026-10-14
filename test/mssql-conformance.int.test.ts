import { runConformance } from './helpers/conformance';
import { connectMssql } from './mysql-connect';

const url = process.env.KASTOR_MSSQL_URL;

runConformance('mssql (mssql pool)', () => connectMssql(url!), { enabled: !!url });
