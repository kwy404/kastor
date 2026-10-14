import { connectOracle, dropOracleTable } from './mysql-connect';
import { sqlmoreSchemaSuite } from './mysql-sqlmore-suite';

sqlmoreSchemaSuite({ name: 'oracle', url: process.env.KASTOR_ORACLE_URL, connect: connectOracle, dropTable: dropOracleTable });
