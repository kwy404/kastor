import { connectMssql } from './mysql-connect';
import { sqlmoreCases } from './mysql-sqlmore-cases';

const url = process.env.KASTOR_MSSQL_URL;
sqlmoreCases({ name: 'mssql', enabled: !!url, connect: () => connectMssql(url!) });
