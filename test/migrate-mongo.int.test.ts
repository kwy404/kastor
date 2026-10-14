import { MongoClient } from 'mongodb';
import { mongodb } from '../src/mongodb';
import { runMigrateSuite } from './migrate-suite';

const url = process.env.KASTOR_MONGO_URL;

runMigrateSuite(
  'mongodb',
  async () => {
    const client = new MongoClient(url!);
    await client.connect();
    return { adapter: mongodb(client.db('kastor_migrate'), { ids: 'int' }), close: () => client.close() };
  },
  { enabled: !!url, skipReason: 'KASTOR_MONGO_URL is not set' },
);
