import pg from 'pg';
import { cockroach } from '../src/cockroach';
import { fixture, resetWithDdl, runConformance } from './helpers/conformance';

const url = process.env.KASTOR_COCKROACH_URL;

runConformance(
  'cockroach (pg Pool)',
  () => {
    const pool = new pg.Pool({ connectionString: url, max: 5 });
    const adapter = cockroach(pool);
    return {
      adapter,
      async reset(schemaIR) {
        await resetWithDdl(adapter, schemaIR);
        // Schema changes are jobs on CockroachDB: wait until every connection sees the new tables.
        for (const tbl of fixture.schemaIR.tables) {
          for (let attempt = 0; ; attempt++) {
            try {
              await Promise.all(Array.from({ length: 5 }, () => pool.query(`SELECT 1 FROM "${tbl.name}" LIMIT 0`)));
              break;
            } catch (error) {
              if (attempt > 50) throw error;
              await new Promise((resolve) => setTimeout(resolve, 200));
            }
          }
        }
      },
      close: () => pool.end(),
    };
  },
  { enabled: !!url },
);
