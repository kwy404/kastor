/**
 * Fixture schema shared by the conformance suite: users, profiles (1:1),
 * posts (1:n), tags (n:m through post_tags) and comments (self relation,
 * soft delete). It touches every column type and modifier.
 */
import { many, one, t, table, toSchemaIR, uniqueIndex, index, type AnyColumn } from '../../src/index';

export const users = table('users', {
  id: t.id(),
  email: t.string(255).unique(),
  name: t.string(100).nullable(),
  role: t.enum(['user', 'admin']).default('user'),
  age: t.int().nullable(),
  score: t.float().default(0),
  balance: t.decimal(12, 2).default('0.00'),
  active: t.boolean().default(true),
  createdAt: t.datetime().defaultNow().map('created_at'),
});

export const profiles = table('profiles', {
  id: t.id(),
  userId: t.int().unique().references(() => users.id, { onDelete: 'cascade' }).map('user_id'),
  bio: t.text(),
  avatar: t.bytes().nullable(),
  settings: t.json<{ theme: string; tags?: string[] }>().nullable(),
  birthday: t.date().nullable(),
  wakeUp: t.time().nullable().map('wake_up'),
});

export const posts = table(
  'posts',
  {
    id: t.uuid().primaryKey().defaultRandom(),
    title: t.string(200),
    body: t.text().nullable(),
    published: t.boolean().default(false),
    views: t.int().default(0),
    likes: t.bigint().default(0n),
    authorId: t.int().references(() => users.id, { onDelete: 'cascade' }).map('author_id'),
    createdAt: t.datetime().defaultNow().map('created_at'),
  },
  { indexes: (p) => [index(p.authorId), uniqueIndex(p.authorId, p.title)] },
);

export const tags = table('tags', {
  id: t.id(),
  name: t.string(50).unique(),
});

export const postTags = table(
  'post_tags',
  {
    postId: t.uuid().references(() => posts.id, { onDelete: 'cascade' }).map('post_id'),
    tagId: t.int().references(() => tags.id, { onDelete: 'cascade' }).map('tag_id'),
  },
  { primaryKey: (c) => [c.postId, c.tagId] },
);

export const comments = table(
  'comments',
  {
    id: t.id(),
    postId: t.uuid().references(() => posts.id, { onDelete: 'cascade' }).map('post_id'),
    authorId: t.int().references(() => users.id, { onDelete: 'cascade' }).map('author_id'),
    parentId: t.int().nullable().references((): AnyColumn => comments.id).map('parent_id'),
    body: t.text(),
    deletedAt: t.datetime().nullable().map('deleted_at'),
  },
  { softDelete: 'deletedAt' },
);

export const schema = { users, profiles, posts, tags, postTags, comments };

export const relations = (s: typeof schema) => ({
  users: {
    profile: one(s.profiles),
    posts: many(s.posts),
    comments: many(s.comments),
  },
  profiles: {
    user: one(s.users, { fields: ['userId'], references: ['id'] }),
  },
  posts: {
    author: one(s.users, { fields: ['authorId'], references: ['id'] }),
    tags: many(s.tags, { through: s.postTags }),
    comments: many(s.comments),
  },
  tags: {
    posts: many(s.posts, { through: s.postTags }),
  },
  postTags: {
    post: one(s.posts, { fields: ['postId'], references: ['id'] }),
    tag: one(s.tags, { fields: ['tagId'], references: ['id'] }),
  },
  comments: {
    post: one(s.posts, { fields: ['postId'], references: ['id'] }),
    author: one(s.users, { fields: ['authorId'], references: ['id'] }),
    parent: one(s.comments, { fields: ['parentId'], references: ['id'] }),
    replies: many(s.comments, { fields: ['id'], references: ['parentId'] }),
  },
});

export const fixture = { schema, relations, schemaIR: toSchemaIR(schema) };
