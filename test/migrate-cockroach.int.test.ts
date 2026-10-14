import pg from 'pg';
import { cockroach } from '../src/cockroach';
import { ensurePgDatabase, runMigrateSuite } from './migrate-suite';

const url = process.env.KASTOR_COCKROACH_URL;

runMigrateSuite(
  'cockroachdb',
  async () => {
    const pool = new pg.Pool({ connectionString: await ensurePgDatabase(url!, 'kastor_migrate'), max: 5 });
    return { adapter: cockroach(pool), close: () => pool.end() };
  },
  { enabled: !!url, skipReason: 'KASTOR_COCKROACH_URL is not set' },
);
