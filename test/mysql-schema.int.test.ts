import { connectMysql, dropMysqlTable } from './mysql-connect';
import { sqlmoreSchemaSuite } from './mysql-sqlmore-suite';

sqlmoreSchemaSuite({ name: 'mysql', url: process.env.KASTOR_MYSQL_URL, connect: connectMysql, dropTable: dropMysqlTable });
