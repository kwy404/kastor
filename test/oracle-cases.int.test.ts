import { connectOracle } from './mysql-connect';
import { sqlmoreCases } from './mysql-sqlmore-cases';

const url = process.env.KASTOR_ORACLE_URL;
sqlmoreCases({ name: 'oracle', enabled: !!url, connect: () => connectOracle(url!) });
