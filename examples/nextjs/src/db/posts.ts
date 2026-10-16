// The queries of the app. They take the client as an argument so tests can pass their own.
import type { Db } from './index';

export const MAX_TITLE = 200;

export function latestPosts(db: Db, take = 20) {
  return db.posts.findMany({ include: { author: true }, orderBy: { id: 'desc' }, take });
}

export function listAuthors(db: Db) {
  return db.authors.findMany({ orderBy: { name: 'asc' } });
}

export interface NewPost {
  title: string;
  body?: string;
  authorId: number;
}

/** Checks the input and creates the post. Throws an Error with a message for the form. */
export async function addPost(db: Db, input: NewPost) {
  const title = input.title.trim();
  if (!title) throw new Error('Give the post a title.');
  if (title.length > MAX_TITLE) throw new Error(`Keep the title under ${MAX_TITLE} characters.`);
  const author = await db.authors.findUnique({ where: { id: input.authorId } });
  if (!author) throw new Error('Pick an author.');
  return db.posts.create({ data: { title, body: input.body?.trim() || null, authorId: author.id } });
}

export async function deletePost(db: Db, id: number) {
  await db.posts.deleteMany({ where: { id } });
}
