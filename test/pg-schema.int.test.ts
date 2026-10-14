import { postgres } from '../src/postgres';
import { pgSchemaSuite } from './pg-schema-suite';

pgSchemaSuite('postgres', process.env.KASTOR_PG_URL, (pool) => postgres(pool));
