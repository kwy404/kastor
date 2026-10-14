// Hand written SchemaIR and relations for the MongoDB dialect tests.
import type { ColumnIR, ReadIR, RelationIR, SchemaIR, SelectColumnIR, TableIR } from '../src/core/ir';

const col = (name: string, type: ColumnIR['type'], extra: Partial<ColumnIR> = {}): ColumnIR => ({ name, type, nullable: false, ...extra });

const users: TableIR = {
  name: 'users',
  columns: [
    col('id', 'int', { default: { kind: 'autoincrement' } }),
    col('email', 'string', { length: 255 }),
    col('name', 'string', { nullable: true }),
    col('role', 'enum', { enumValues: ['user', 'admin'], default: { kind: 'value', value: 'user' } }),
    col('score', 'decimal', { precision: 10, scale: 2, nullable: true }),
    col('big', 'bigint', { nullable: true }),
    col('createdAt', 'datetime', { default: { kind: 'now' } }),
  ],
  primaryKey: ['id'],
  indexes: [{ name: 'users_email_key', columns: ['email'], unique: true }],
  foreignKeys: [],
};

const posts: TableIR = {
  name: 'posts',
  columns: [
    col('id', 'int', { default: { kind: 'autoincrement' } }),
    col('title', 'string', { length: 200 }),
    col('published', 'boolean', { default: { kind: 'value', value: false } }),
    col('views', 'int', { default: { kind: 'value', value: 0 } }),
    col('authorId', 'int'),
  ],
  primaryKey: ['id'],
  indexes: [{ name: 'posts_authorId_idx', columns: ['authorId'], unique: false }],
  foreignKeys: [{ name: 'posts_authorId_fkey', columns: ['authorId'], refTable: 'users', refColumns: ['id'], onDelete: 'cascade', onUpdate: 'no action' }],
};

const tags: TableIR = {
  name: 'tags',
  columns: [col('id', 'int', { default: { kind: 'autoincrement' } }), col('label', 'string')],
  primaryKey: ['id'],
  indexes: [],
  foreignKeys: [],
};

const postTags: TableIR = {
  name: 'post_tags',
  columns: [col('postId', 'int'), col('tagId', 'int')],
  primaryKey: ['postId', 'tagId'],
  indexes: [],
  foreignKeys: [
    { name: 'post_tags_postId_fkey', columns: ['postId'], refTable: 'posts', refColumns: ['id'], onDelete: 'cascade', onUpdate: 'no action' },
    { name: 'post_tags_tagId_fkey', columns: ['tagId'], refTable: 'tags', refColumns: ['id'], onDelete: 'cascade', onUpdate: 'no action' },
  ],
};

const profiles: TableIR = {
  name: 'profiles',
  columns: [col('id', 'uuid', { default: { kind: 'random' } }), col('bio', 'text', { nullable: true }), col('userId', 'int'), col('avatar', 'bytes', { nullable: true })],
  primaryKey: ['id'],
  indexes: [{ name: 'profiles_userId_key', columns: ['userId'], unique: true }],
  foreignKeys: [{ name: 'profiles_userId_fkey', columns: ['userId'], refTable: 'users', refColumns: ['id'], onDelete: 'restrict', onUpdate: 'no action' }],
};

export const schema: SchemaIR = { tables: [users, posts, tags, postTags, profiles] };

export const rel = {
  userPosts: { name: 'posts', cardinality: 'many', from: 'users', to: 'posts', fromColumns: ['id'], toColumns: ['authorId'] } satisfies RelationIR,
  postAuthor: { name: 'author', cardinality: 'one', from: 'posts', to: 'users', fromColumns: ['authorId'], toColumns: ['id'] } satisfies RelationIR,
  postTags: {
    name: 'tags',
    cardinality: 'many',
    from: 'posts',
    to: 'tags',
    fromColumns: ['id'],
    toColumns: ['id'],
    through: { table: 'post_tags', sourceColumns: ['postId'], targetColumns: ['tagId'] },
  } satisfies RelationIR,
  userProfile: { name: 'profile', cardinality: 'one', from: 'users', to: 'profiles', fromColumns: ['id'], toColumns: ['userId'] } satisfies RelationIR,
};

export const sel = (...cols: string[]): SelectColumnIR[] => cols.map((c) => ({ column: c, as: c }));

export const read = (table: string, columns: string[], extra: Partial<ReadIR> = {}): ReadIR => ({
  table,
  select: sel(...columns),
  include: [],
  counts: [],
  orderBy: [],
  ...extra,
});
