import { connectMssql, dropMssqlTable } from './mysql-connect';
import { sqlmoreSchemaSuite } from './mysql-sqlmore-suite';

sqlmoreSchemaSuite({ name: 'mssql', url: process.env.KASTOR_MSSQL_URL, connect: connectMssql, dropTable: dropMssqlTable });
