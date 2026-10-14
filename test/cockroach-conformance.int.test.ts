import pg from 'pg';
import { cockroach } from '../src/cockroach';
import { runConformance } from './helpers/conformance';

const url = process.env.KASTOR_COCKROACH_URL;

runConformance(
  'cockroach (pg Pool)',
  () => {
    const pool = new pg.Pool({ connectionString: url, max: 5 });
    return { adapter: cockroach(pool), close: () => pool.end() };
  },
  { enabled: !!url },
);
