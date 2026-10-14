import { runConformance } from './helpers/conformance';
import { connectMariadb } from './mysql-connect';

const url = process.env.KASTOR_MARIADB_URL;

runConformance('mariadb (mariadb pool)', () => connectMariadb(url!, 'mariadb'), { enabled: !!url });
runConformance('mariadb (mysql2 pool)', () => connectMariadb(url!, 'mysql2'), { enabled: !!url });
