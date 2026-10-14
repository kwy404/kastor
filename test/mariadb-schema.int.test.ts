import { connectMariadb, dropMysqlTable } from './mysql-connect';
import { sqlmoreSchemaSuite } from './mysql-sqlmore-suite';

sqlmoreSchemaSuite({ name: 'mariadb', url: process.env.KASTOR_MARIADB_URL, connect: (url) => connectMariadb(url), dropTable: dropMysqlTable });
