import { mysql } from '../src/mysql';
import { runConformance } from './helpers/conformance';
import { connectMysql } from './mysql-connect';

const url = process.env.KASTOR_MYSQL_URL;

runConformance('mysql (mysql2 pool)', () => connectMysql(url!), { enabled: !!url });

runConformance(
  'mysql (mysql2 callback connection)',
  async () => {
    // A single connection from the callback API: kastor switches to .promise() and queues statements.
    const { createConnection } = await import('mysql2');
    const conn = createConnection(url!);
    return { adapter: mysql(conn), close: () => new Promise<void>((resolve) => conn.end(() => resolve())) };
  },
  { enabled: !!url },
);
