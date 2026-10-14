/**
 * SQL text produced by the shared SQL base, for the generic ANSI hooks and
 * for the hook presets each dialect family uses.
 */
import { describe, expect, it } from 'vitest';
import { kastor, type Adapter, type Executor } from '../src/index';
import {
  ansiHooks,
  compileOnlyDialect,
  defineHooks,
  jsonMariadb,
  jsonMssql,
  jsonMysql,
  jsonOracle,
  jsonPostgres,
  jsonSqlite,
  limitOffset,
  offsetFetch,
  offsetFetchTop,
  placeholderAtP,
  placeholderColon,
  placeholderDollar,
  quoteBacktick,
  quoteBracket,
  type SqlHooks,
} from '../src/core/sql';
import { fixture } from './helpers/fixture';

const noExec: Executor = {
  query: () => Promise.reject(new Error('compile only')),
  transaction: () => Promise.reject(new Error('compile only')),
};

function client(hooks: SqlHooks) {
  const adapter: Adapter = { dialect: compileOnlyDialect('postgres', hooks), executor: noExec };
  return kastor({ adapter, schema: fixture.schema, relations: fixture.relations });
}

const ansi = client(ansiHooks);
const pg = client(defineHooks({ placeholder: placeholderDollar, returning: 'returning', upsert: 'onConflict', json: jsonPostgres, caseInsensitive: 'ilike' }));
const mysql = client(defineHooks({ quoteIdent: quoteBacktick, paginate: limitOffset('18446744073709551615'), upsert: 'onDuplicateKey', json: jsonMysql, nullsOrder: false, mutationSelfReference: false }));
const mssql = client(defineHooks({ quoteIdent: quoteBracket, placeholder: placeholderAtP, paginate: offsetFetchTop, returning: 'output', upsert: 'merge', json: jsonMssql, nullsOrder: false, mergeHint: 'WITH (HOLDLOCK)', mergeTerminator: ';', likeSpecials: '%_[' }));
const oracle = client(defineHooks({ placeholder: placeholderColon, paginate: offsetFetch, upsert: 'merge', json: jsonOracle, fromDual: ' FROM DUAL' }));
const sqlite = client(defineHooks({ paginate: limitOffset('-1'), returning: 'returning', upsert: 'onConflict', json: jsonSqlite }));
const mariadb = client(defineHooks({ quoteIdent: quoteBacktick, upsert: 'onDuplicateKey', json: jsonMariadb }));

describe('generic ANSI dialect', () => {
  it('compiles filters with bound parameters', () => {
    const [stmt] = ansi.users.findMany({
      where: { email: { endsWith: '@acme.com' }, age: { gte: 18, lt: 65 }, role: { in: ['user', 'admin'] }, name: null },
      orderBy: { createdAt: 'desc' },
      take: 10,
      skip: 20,
      select: { id: true, email: true },
    }).toSQL();
    expect(stmt!.sql).toBe(
      'SELECT "t0"."id" AS "id", "t0"."email" AS "email" FROM "users" "t0" WHERE ("t0"."email" LIKE ? ESCAPE \'!\') AND ("t0"."age" >= ?) AND ("t0"."age" < ?) AND ("t0"."role" IN (?, ?)) AND ("t0"."name" IS NULL) ORDER BY "t0"."created_at" DESC LIMIT 10 OFFSET 20',
    );
    expect(stmt!.params).toEqual(['%@acme.com', 18, 65, 'user', 'admin']);
  });

  it('escapes LIKE wildcards in user text', () => {
    const [stmt] = ansi.posts.findMany({ where: { title: { contains: '50%_off!' } }, select: { id: true } }).toSQL();
    expect(stmt!.params).toEqual(['%50!%!_off!!%']);
  });

  it('turns empty IN lists and OR [] into constant conditions', () => {
    expect(ansi.users.findMany({ where: { id: { in: [] } }, select: { id: true } }).toSQL()[0]!.sql).toContain('WHERE 1=0');
    expect(ansi.users.findMany({ where: { OR: [] }, select: { id: true } }).toSQL()[0]!.sql).toContain('WHERE 1=0');
    expect(ansi.users.findMany({ where: { id: { notIn: [] } }, select: { id: true } }).toSQL()[0]!.sql).toContain('WHERE 1=1');
  });

  it('keeps NULL rows for not on nullable columns', () => {
    const [stmt] = ansi.users.findMany({ where: { name: { not: 'Ada' } }, select: { id: true } }).toSQL();
    expect(stmt!.sql).toContain('WHERE ("t0"."name" <> ?) OR ("t0"."name" IS NULL)');
  });

  it('compiles relation filters to EXISTS subqueries', () => {
    const [stmt] = ansi.users.findMany({ where: { posts: { some: { published: true } }, profile: null }, select: { id: true } }).toSQL();
    expect(stmt!.sql).toBe(
      'SELECT "t0"."id" AS "id" FROM "users" "t0" WHERE (EXISTS (SELECT 1 FROM "posts" "t1" WHERE "t1"."author_id" = "t0"."id" AND ("t1"."published" = ?))) AND (NOT EXISTS (SELECT 1 FROM "profiles" "t2" WHERE "t2"."user_id" = "t0"."id"))',
    );
    const [every] = ansi.users.findMany({ where: { posts: { every: { published: true } } }, select: { id: true } }).toSQL();
    expect(every!.sql).toContain('NOT EXISTS (SELECT 1 FROM "posts" "t1" WHERE "t1"."author_id" = "t0"."id" AND (CASE WHEN "t1"."published" = ? THEN 1 ELSE 0 END = 0))');
  });

  it('joins through the join table for many-to-many filters', () => {
    const [stmt] = ansi.posts.findMany({ where: { tags: { some: { name: 'math' } } }, select: { id: true } }).toSQL();
    expect(stmt!.sql).toContain('EXISTS (SELECT 1 FROM "tags" "t1" INNER JOIN "post_tags" "t2" ON "t2"."tag_id" = "t1"."id" WHERE "t2"."post_id" = "t0"."id" AND ("t1"."name" = ?))');
  });

  it('adds soft delete conditions to the root and to relations', () => {
    const [stmt] = ansi.posts.findMany({ where: { comments: { some: {} } }, select: { id: true } }).toSQL();
    expect(stmt!.sql).toContain('"t1"."deleted_at" IS NULL');
    const [root] = ansi.comments.findMany({ select: { id: true } }).toSQL();
    expect(root!.sql).toBe('SELECT "t0"."id" AS "id" FROM "comments" "t0" WHERE "t0"."deleted_at" IS NULL');
    const [all] = ansi.comments.findMany({ select: { id: true }, withDeleted: true }).toSQL();
    expect(all!.sql).toBe('SELECT "t0"."id" AS "id" FROM "comments" "t0"');
  });

  it('orders by relation counts and fields of a single relation', () => {
    const [stmt] = ansi.posts.findMany({ orderBy: [{ author: { name: 'asc' } }, { comments: { _count: 'desc' } }], select: { id: true } }).toSQL();
    expect(stmt!.sql).toBe(
      'SELECT "t0"."id" AS "id" FROM "posts" "t0" ORDER BY (SELECT "t1"."name" FROM "users" "t1" WHERE "t1"."id" = "t0"."author_id" LIMIT 1) ASC, (SELECT COUNT(*) FROM "comments" "t2" WHERE "t2"."post_id" = "t0"."id" AND "t2"."deleted_at" IS NULL) DESC',
    );
  });

  it('selects relation counts as correlated subqueries', () => {
    const [stmt] = ansi.users.findMany({ select: { id: true, _count: { select: { posts: { where: { published: true } } } } } }).toSQL();
    expect(stmt!.sql).toBe(
      'SELECT "t0"."id" AS "id", (SELECT COUNT(*) FROM "posts" "t1" WHERE "t1"."author_id" = "t0"."id" AND ("t1"."published" = ?)) AS "__count__posts" FROM "users" "t0"',
    );
  });

  it('adds hidden key columns for IN-list includes when there is no JSON flavor', () => {
    const [stmt] = ansi.users.findMany({ select: { email: true, posts: { select: { title: true } } } }).toSQL();
    expect(stmt!.sql).toBe('SELECT "t0"."email" AS "email", "t0"."id" AS "__key__id" FROM "users" "t0"');
  });

  it('compiles distinct with a window function', () => {
    const [stmt] = ansi.posts.findMany({ distinct: ['authorId'], orderBy: { views: 'desc' }, select: { id: true } }).toSQL();
    expect(stmt!.sql).toBe(
      'SELECT "t0"."id" AS "id" FROM "posts" "t0" WHERE EXISTS (SELECT 1 FROM (SELECT "t1"."id" AS "id", ROW_NUMBER() OVER (PARTITION BY "t1"."author_id" ORDER BY "t1"."views" DESC) AS "__rn" FROM "posts" "t1") "t2" WHERE "t2"."__rn" = 1 AND "t2"."id" = "t0"."id") ORDER BY "t0"."views" DESC',
    );
  });

  it('compiles count, aggregate and groupBy', () => {
    expect(ansi.users.count({ where: { active: true } }).toSQL()[0]!.sql).toBe('SELECT COUNT(*) AS "count" FROM "users" "t0" WHERE "t0"."active" = ?');
    expect(ansi.users.count({ take: 5 }).toSQL()[0]!.sql).toBe('SELECT COUNT(*) AS "count" FROM (SELECT 1 AS "x" FROM "users" "t0" LIMIT 5) "s"');
    expect(ansi.posts.aggregate({ _sum: { views: true }, _avg: { views: true }, _count: true }).toSQL()[0]!.sql).toBe(
      'SELECT COUNT(*) AS "a0", SUM("t0"."views") AS "a1", AVG("t0"."views") AS "a2" FROM "posts" "t0"',
    );
    expect(ansi.posts.aggregate({ _max: { views: true }, orderBy: { views: 'desc' }, take: 3 }).toSQL()[0]!.sql).toBe(
      'SELECT MAX("s"."views") AS "a0" FROM (SELECT "t0"."views" AS "views" FROM "posts" "t0" ORDER BY "t0"."views" DESC LIMIT 3) "s"',
    );
    expect(
      ansi.posts.groupBy({ by: ['authorId'], _count: { _all: true }, having: { views: { _avg: { gt: 10 } } }, orderBy: { _count: { _all: 'desc' } }, take: 5 }).toSQL()[0]!.sql,
    ).toBe('SELECT "t0"."author_id" AS "authorId", COUNT(*) AS "a0" FROM "posts" "t0" GROUP BY "t0"."author_id" HAVING AVG("t0"."views") > ? ORDER BY COUNT(*) DESC LIMIT 5');
  });

  it('compiles writes without RETURNING', () => {
    const [ins] = ansi.tags.create({ data: { name: 'x' } }).toSQL();
    expect(ins).toEqual({ sql: 'INSERT INTO "tags" ("name") VALUES (?)', params: ['x'] });
    const [upd] = ansi.posts.update({ where: { id: '00000000-0000-4000-8000-000000000000' }, data: { views: { increment: 2 }, title: 'T' } }).toSQL();
    expect(upd!.sql).toBe('UPDATE "posts" SET "views" = "posts"."views" + ?, "title" = ? WHERE "posts"."id" = ?');
    expect(ansi.tags.deleteMany({ where: { name: { startsWith: 'a' } } }).toSQL()[0]!.sql).toBe('DELETE FROM "tags" WHERE "tags"."name" LIKE ? ESCAPE \'!\'');
    const [many] = ansi.tags.createMany({ data: [{ name: 'a' }, { name: 'b' }] }).toSQL();
    expect(many).toEqual({ sql: 'INSERT INTO "tags" ("name") VALUES (?), (?)', params: ['a', 'b'] });
    expect(ansi.comments.delete({ where: { id: 1 } }).toSQL()[0]!.sql).toBe('UPDATE "comments" SET "deleted_at" = ? WHERE ("comments"."id" = ?) AND ("comments"."deleted_at" IS NULL)');
  });
});

describe('dialect presets', () => {
  it('Postgres: numbered placeholders, ILIKE, RETURNING and json_agg includes', () => {
    const [stmt] = pg.users.findMany({ where: { email: { contains: 'ACME', mode: 'insensitive' } }, include: { posts: { orderBy: { views: 'desc' }, take: 2 } } }).toSQL();
    expect(stmt!.sql).toContain('"t0"."email" ILIKE $1 ESCAPE');
    expect(stmt!.sql).toContain('json_agg("s"."j" ORDER BY "s"."rn")');
    expect(stmt!.sql).toContain('ROW_NUMBER() OVER (ORDER BY "t1"."views" DESC) AS "rn"');
    expect(stmt!.sql).toContain(`'likes', ("t1"."likes")::text`);
    expect(stmt!.sql).toContain('LIMIT 2');
    const [ins] = pg.tags.create({ data: { name: 'x' } }).toSQL();
    expect(ins!.sql).toBe('INSERT INTO "tags" ("name") VALUES ($1) RETURNING "id" AS "id", "name" AS "name"');
    const [ups] = pg.users.upsert({ where: { email: 'a@b.c' }, create: { email: 'a@b.c' }, update: { age: { increment: 1 } } }).toSQL();
    expect(ups!.sql).toMatch(/^INSERT INTO "users" \(.*\) VALUES \(.*\) ON CONFLICT \("email"\) DO UPDATE SET "age" = "users"\."age" \+ \$\d+ RETURNING /);
    const [skip] = pg.tags.createMany({ data: [{ name: 'a' }], skipDuplicates: true }).toSQL();
    expect(skip!.sql).toBe('INSERT INTO "tags" ("name") VALUES ($1) ON CONFLICT DO NOTHING');
  });

  it('Postgres: single relations use json_build_object with LIMIT 1', () => {
    const [stmt] = pg.posts.findMany({ select: { id: true, author: { select: { email: true } } } }).toSQL();
    expect(stmt!.sql).toBe(
      'SELECT "t0"."id" AS "id", (SELECT json_build_object(\'email\', "t1"."email") FROM "users" "t1" WHERE "t1"."id" = "t0"."author_id" LIMIT 1) AS "author" FROM "posts" "t0"',
    );
  });

  it('MySQL: backticks, ON DUPLICATE KEY, JSON_ARRAYAGG with row numbers and emulated NULLS order', () => {
    const [stmt] = mysql.users.findMany({ include: { posts: { orderBy: { views: 'desc' } } }, orderBy: { age: { sort: 'asc', nulls: 'last' } } }).toSQL();
    expect(stmt!.sql).toContain('JSON_ARRAYAGG(CAST(`s`.`j` AS JSON))');
    expect(stmt!.sql).toContain("'__kastor_rn', ROW_NUMBER() OVER (ORDER BY `t1`.`views` DESC)");
    expect(stmt!.sql).toContain('ORDER BY CASE WHEN `t0`.`age` IS NULL THEN 1 ELSE 0 END, `t0`.`age` ASC');
    const [ups] = mysql.users.upsert({ where: { email: 'a@b.c' }, create: { email: 'a@b.c' }, update: { name: 'N' } }).toSQL();
    expect(ups!.sql).toMatch(/ON DUPLICATE KEY UPDATE `name` = \?$/);
    const [skip] = mysql.tags.createMany({ data: [{ name: 'a' }], skipDuplicates: true }).toSQL();
    expect(skip!.sql).toBe('INSERT IGNORE INTO `tags` (`name`) VALUES (?)');
  });

  it('MariaDB: nested JSON through JSON_EXTRACT and IN-list loading for paged includes', () => {
    const [plain] = mariadb.users.findMany({ select: { id: true, posts: { select: { title: true } } } }).toSQL();
    expect(plain!.sql).toContain('JSON_ARRAYAGG(JSON_OBJECT(');
    const [paged] = mariadb.users.findMany({ select: { id: true, posts: { take: 1, select: { title: true } } } }).toSQL();
    expect(paged!.sql).toBe('SELECT `t0`.`id` AS `id`, `t0`.`id` AS `__key__id` FROM `users` `t0`');
  });

  it('SQL Server: brackets, @p placeholders, TOP, OFFSET FETCH, OUTPUT, MERGE and FOR JSON', () => {
    const [stmt] = mssql.users.findMany({ take: 5, select: { id: true } }).toSQL();
    expect(stmt!.sql).toBe('SELECT TOP (5) [t0].[id] AS [id] FROM [users] [t0]');
    const [paged] = mssql.users.findMany({ take: 5, skip: 10, select: { id: true } }).toSQL();
    expect(paged!.sql).toBe('SELECT [t0].[id] AS [id] FROM [users] [t0] ORDER BY (SELECT NULL) OFFSET 10 ROWS FETCH NEXT 5 ROWS ONLY');
    const [ins] = mssql.tags.create({ data: { name: 'x' } }).toSQL();
    expect(ins!.sql).toBe('INSERT INTO [tags] ([name]) OUTPUT INSERTED.[id] AS [id], INSERTED.[name] AS [name] VALUES (@p1)');
    const [inc] = mssql.users.findMany({ select: { id: true, posts: { select: { title: true } } } }).toSQL();
    expect(inc!.sql).toContain("COALESCE((SELECT [t1].[title] AS [title] FROM [posts] [t1] WHERE [t1].[author_id] = [t0].[id] FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')");
    const [ups] = mssql.users.upsert({ where: { email: 'a@b.c' }, create: { email: 'a@b.c' }, update: { name: 'N' }, select: { id: true } }).toSQL();
    expect(ups!.sql).toMatch(/^MERGE INTO \[users\] WITH \(HOLDLOCK\) \[tgt\] USING \(SELECT .* AS \[email\].*\) \[src\] ON \(\[tgt\]\.\[email\] = \[src\]\.\[email\]\) WHEN MATCHED THEN UPDATE SET \[name\] = @p\d+ WHEN NOT MATCHED THEN INSERT .* OUTPUT INSERTED\.\[id\] AS \[id\];$/);
    const [like] = mssql.tags.findMany({ where: { name: { contains: '[x]' } } }).toSQL();
    expect(like!.params).toEqual(['%![x]%']);
  });

  it('Oracle: colon placeholders, OFFSET FETCH, MERGE from DUAL and JSON_ARRAYAGG', () => {
    const [stmt] = oracle.users.findMany({ take: 3, skip: 1, select: { id: true }, where: { id: 1 } }).toSQL();
    expect(stmt!.sql).toBe('SELECT "t0"."id" AS "id" FROM "users" "t0" WHERE "t0"."id" = :1 OFFSET 1 ROWS FETCH NEXT 3 ROWS ONLY');
    const [inc] = oracle.users.findMany({ select: { id: true, posts: { select: { title: true } } } }).toSQL();
    expect(inc!.sql).toContain('JSON_ARRAYAGG(JSON_OBJECT(\'title\' VALUE "t1"."title" NULL ON NULL RETURNING CLOB) FORMAT JSON RETURNING CLOB)');
    const [ups] = oracle.tags.upsert({ where: { name: 'a' }, create: { name: 'a' }, update: {} }).toSQL();
    expect(ups!.sql).toBe('MERGE INTO "tags" "tgt" USING (SELECT :1 AS "name" FROM DUAL) "src" ON ("tgt"."name" = "src"."name") WHEN NOT MATCHED THEN INSERT ("name") VALUES ("src"."name")');
  });

  it('SQLite: json_object includes with row numbers for ordered lists', () => {
    const [stmt] = sqlite.posts.findMany({ select: { id: true, tags: { orderBy: { name: 'asc' }, select: { name: true } } } }).toSQL();
    expect(stmt!.sql).toBe(
      'SELECT "t0"."id" AS "id", (SELECT json_group_array(json("s"."j")) FROM (SELECT json_object(\'name\', "t1"."name", \'__kastor_rn\', ROW_NUMBER() OVER (ORDER BY "t1"."name" ASC)) AS "j" FROM "tags" "t1" INNER JOIN "post_tags" "t2" ON "t2"."tag_id" = "t1"."id" WHERE "t2"."post_id" = "t0"."id" ORDER BY "t1"."name" ASC) "s") AS "tags" FROM "posts" "t0"',
    );
  });
});
