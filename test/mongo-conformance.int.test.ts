// The shared conformance suite against MongoDB (single node replica set from docker-compose.yml).
import { MongoClient } from 'mongodb';
import { runConformance } from './helpers/conformance';
import { mongodb } from '../src/mongodb';

const url = process.env.KASTOR_MONGO_URL;

runConformance(
  'mongodb',
  async () => {
    const client = new MongoClient(url as string);
    await client.connect();
    const db = client.db('kastor_conformance');
    // The fixture uses t.id() and expects numeric ids, so this run uses the
    // counter based integer ids. ObjectId ids are covered by mongo-dialect.int.test.ts.
    const adapter = mongodb(db, { ids: 'int' });
    return {
      adapter,
      async reset(schemaIR) {
        await db.dropDatabase();
        for (const table of schemaIR.tables) {
          for (const command of adapter.dialect.ddl({ kind: 'createTable', table }, schemaIR)) await adapter.executor.query(command, []);
        }
      },
      close: () => client.close(),
    };
  },
  {
    enabled: !!url,
    skip: [
      // MongoDB has no SQL: toSQL() returns the aggregate command as JSON, so the
      // SELECT text and positional params this test looks for do not exist.
      // mongo-pipeline.test.ts checks the compiled commands instead.
      'toSQL shows the statements without running them',
    ],
  },
);
