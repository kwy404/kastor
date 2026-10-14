import { connectMysql } from './mysql-connect';
import { sqlmoreCases } from './mysql-sqlmore-cases';

const url = process.env.KASTOR_MYSQL_URL;
sqlmoreCases({ name: 'mysql', enabled: !!url, connect: () => connectMysql(url!) });
