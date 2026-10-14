import { cockroach } from '../src/cockroach';
import { pgSchemaSuite } from './pg-schema-suite';

pgSchemaSuite('cockroach', process.env.KASTOR_COCKROACH_URL, (pool) => cockroach(pool));
