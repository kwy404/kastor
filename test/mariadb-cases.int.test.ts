import { connectMariadb } from './mysql-connect';
import { sqlmoreCases } from './mysql-sqlmore-cases';

const url = process.env.KASTOR_MARIADB_URL;
sqlmoreCases({ name: 'mariadb (mariadb driver)', enabled: !!url, connect: () => connectMariadb(url!, 'mariadb') });
sqlmoreCases({ name: 'mariadb (mysql2 driver)', enabled: !!url, connect: () => connectMariadb(url!, 'mysql2') });
