import pg from 'pg';
import { postgres } from '../src/postgres';
import { ensurePgDatabase, runMigrateSuite } from './migrate-suite';

const url = process.env.KASTOR_PG_URL;

runMigrateSuite(
  'postgres',
  async () => {
    const pool = new pg.Pool({ connectionString: await ensurePgDatabase(url!, 'kastor_migrate'), max: 5 });
    return { adapter: postgres(pool), close: () => pool.end() };
  },
  { enabled: !!url, skipReason: 'KASTOR_PG_URL is not set' },
);
