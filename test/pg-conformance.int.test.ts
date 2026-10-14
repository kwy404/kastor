import pg from 'pg';
import postgresJsDriver from 'postgres';
import { postgres, postgresJs } from '../src/postgres';
import { runConformance } from './helpers/conformance';

const url = process.env.KASTOR_PG_URL;

runConformance(
  'postgres (pg Pool)',
  () => {
    const pool = new pg.Pool({ connectionString: url, max: 5 });
    return { adapter: postgres(pool), close: () => pool.end() };
  },
  { enabled: !!url },
);

runConformance(
  'postgres (pg Client)',
  async () => {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    return { adapter: postgres(client), close: () => client.end() };
  },
  { enabled: !!url },
);

runConformance(
  'postgres (postgres.js)',
  () => {
    const sql = postgresJsDriver(url!, { max: 5, onnotice: () => undefined });
    return { adapter: postgresJs(sql), close: () => sql.end({ timeout: 5 }) };
  },
  { enabled: !!url },
);
