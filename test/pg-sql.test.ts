import { describe, expect, it } from 'vitest';
import type { Executor } from '../src/core/ir';
import { cockroachDialect } from '../src/cockroach';
import { postgresDialect } from '../src/postgres';
import { sqliteDialect } from '../src/sqlite';
import { kastor, many, one, t, table } from '../src/index';
import { JsonParam } from '../src/dialects/postgres/values';

const users = table('users', {
  id: t.id(),
  email: t.string(255).unique(),
  name: t.string().nullable(),
  active: t.boolean().default(true),
  meta: t.json().nullable(),
});
const posts = table('posts', {
  id: t.id(),
  title: t.string(200),
  authorId: t.int().references(() => users.id),
});
const schema = { users, posts };
const relations = (s: typeof schema) => ({
  users: { posts: many(s.posts) },
  posts: { author: one(s.users, { fields: ['authorId'], references: ['id'] }) },
});

const noop: Executor = {
  query: async () => ({ rows: [] }),
  transaction: (fn) => fn(noop),
};

const client = (dialect: typeof postgresDialect) => kastor({ adapter: { dialect, executor: noop }, schema, relations });

describe('postgres SQL', () => {
  const db = client(postgresDialect);

  it('loads includes with json_agg in one statement, paged includes through ROW_NUMBER', () => {
    const [stmt] = db.users
      .findMany({ where: { email: { endsWith: '@acme.com', mode: 'insensitive' } }, include: { posts: { orderBy: { title: 'asc' }, take: 3 } as any } })
      .toSQL();
    expect(stmt!.sql).toContain('COALESCE(json_agg("s"."j" ORDER BY "s"."rn"), \'[]\'::json)');
    expect(stmt!.sql).toContain('ROW_NUMBER() OVER (ORDER BY "t1"."title" ASC)');
    expect(stmt!.sql).toContain('LIMIT 3');
    expect(stmt!.sql).toMatch(/"t0"\."email" ILIKE \$1 ESCAPE '!'/);
    expect(stmt!.params).toEqual(['%@acme.com']);
  });

  it('uses RETURNING, ON CONFLICT and $n placeholders', () => {
    const [create] = db.users.create({ data: { email: 'a@x.io', meta: { a: 1 } } }).toSQL();
    expect(create!.sql).toMatch(/^INSERT INTO "users" \(.*"email".*\) VALUES \(\$1, \$2(, \$\d+)*\) RETURNING /);
    expect(create!.params).toContainEqual(new JsonParam('{"a":1}'));
    expect(JSON.stringify(create!.params)).toContain('"{\\"a\\":1}"');
    const [upsert] = db.users.upsert({ where: { email: 'a@x.io' }, create: { email: 'a@x.io' }, update: { name: 'A' } }).toSQL();
    expect(upsert!.sql).toContain('ON CONFLICT ("email") DO UPDATE SET');
    expect(upsert!.sql).toContain('RETURNING');
  });

  it('keeps native booleans and LIMIT ALL for an offset alone', () => {
    const [stmt] = db.users.findMany({ where: { active: false }, skip: 5 }).toSQL();
    expect(stmt!.params).toEqual([false]);
    expect(stmt!.sql).toContain('LIMIT ALL OFFSET 5');
  });

  it('compiles the same text for CockroachDB', () => {
    const query = { where: { name: { contains: 'x' } }, include: { posts: true } } as const;
    expect(client(cockroachDialect).users.findMany(query).toSQL()).toEqual(db.users.findMany(query).toSQL());
  });
});

describe('sqlite SQL', () => {
  const db = client(sqliteDialect);

  it('loads includes with json_group_array and ? placeholders', () => {
    const [stmt] = db.posts.findMany({ include: { author: true }, where: { title: { startsWith: 'Hi' } } }).toSQL();
    expect(stmt!.sql).toContain('json_object(');
    expect(stmt!.sql).toContain('substr("t0"."title", 1, length(?)) = ?');
    expect(stmt!.params).toEqual(['Hi', 'Hi']);
  });

  it('sends booleans as integers and uses LIMIT -1 for an offset alone', () => {
    const [stmt] = db.users.findMany({ where: { active: true }, skip: 2 }).toSQL();
    expect(stmt!.params).toEqual([1]);
    expect(stmt!.sql).toContain('LIMIT -1 OFFSET 2');
  });

  it('keeps LIKE for case insensitive matching', () => {
    const [stmt] = db.users.findMany({ where: { email: { contains: '50%', mode: 'insensitive' } } }).toSQL();
    expect(stmt!.sql).toContain(`LOWER("t0"."email") LIKE LOWER(?) ESCAPE '!'`);
    expect(stmt!.params).toEqual(['%50!%%']);
  });
});
