import { index, many, one, t, table } from 'kastor-orm';

export const authors = table('authors', {
  id: t.id(),
  name: t.string(100),
  email: t.string(255).unique(),
});

export const posts = table(
  'posts',
  {
    id: t.id(),
    title: t.string(200),
    body: t.text().nullable(),
    authorId: t.int().references(() => authors.id, { onDelete: 'cascade' }),
    createdAt: t.datetime().defaultNow(),
  },
  { indexes: (p) => [index(p.authorId)] },
);

export const schema = { authors, posts };

export const relations = ({ authors, posts }: typeof schema) => ({
  authors: { posts: many(posts) },
  posts: { author: one(authors, { fields: ['authorId'], references: ['id'] }) },
});
