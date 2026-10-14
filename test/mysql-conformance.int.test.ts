import { runConformance } from './helpers/conformance';
import { connectMysql } from './mysql-connect';

const url = process.env.KASTOR_MYSQL_URL;

runConformance('mysql (mysql2 pool)', () => connectMysql(url!), { enabled: !!url });
