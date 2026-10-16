// Runs with npm run db:seed, and before npm run dev. It only adds rows to an empty database.
import type { Db } from './index';

export default async function seed(db: Db) {
  if ((await db.authors.count()) > 0) return;
  const ada = await db.authors.create({ data: { name: 'Ada', email: 'ada@example.com' } });
  const grace = await db.authors.create({ data: { name: 'Grace', email: 'grace@example.com' } });
  await db.posts.create({ data: { title: 'Hello from kastor', body: 'This post was read with one query, author included.', authorId: ada.id } });
  await db.posts.create({ data: { title: 'Edit src/db/schema.ts', body: 'Then run npm run db:migrate to write and apply a migration.', authorId: grace.id } });
}
