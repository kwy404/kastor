// SQL output of the MySQL, MariaDB, SQL Server and Oracle dialects, without a database.
import { describe, expect, it } from 'vitest';
import type { Dialect, Executor } from '../src/core/ir';
import { kastor, many, one, t, table } from '../src/index';
import { mariadbDialect } from '../src/mariadb';
import { MssqlTypedParam, mssqlDialect } from '../src/mssql';
import { mysqlDialect } from '../src/mysql';
import { OracleOutBind, oracleDialect } from '../src/oracle';

const users = table('users', {
  id: t.id(),
  email: t.string(255).unique(),
  name: t.string().nullable(),
  bio: t.text().nullable(),
  active: t.boolean().default(true),
  price: t.decimal(12, 2).nullable(),
  avatar: t.bytes().nullable(),
  seen: t.datetime().nullable(),
  meta: t.json().nullable(),
});
const posts = table('posts', {
  id: t.id(),
  title: t.string(200),
  rank: t.int(),
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

const client = (dialect: Dialect) => kastor({ adapter: { dialect, executor: noop }, schema, relations });

describe('mysql SQL', () => {
  const db = client(mysqlDialect);

  it('uses backticks, ? placeholders and LIMIT with the largest unsigned value for an offset alone', () => {
    const [stmt] = db.users.findMany({ where: { email: 'a@x.io' }, skip: 5 }).toSQL();
    expect(stmt!.sql).toMatch(/^SELECT `t0`\.`id` AS `id`/);
    expect(stmt!.sql).toContain('WHERE `t0`.`email` = ?');
    expect(stmt!.sql).toContain('LIMIT 18446744073709551615 OFFSET 5');
    expect(stmt!.params).toEqual(['a@x.io']);
  });

  it('loads includes with JSON_ARRAYAGG and embeds decimals and bytes safely', () => {
    const [stmt] = db.posts.findMany({ include: { author: true } }).toSQL();
    expect(stmt!.sql).toContain('JSON_OBJECT(');
    expect(stmt!.sql).toContain('CAST(`t1`.`price` AS CHAR)');
    expect(stmt!.sql).toContain('HEX(`t1`.`avatar`)');
    const [many_] = db.users.findMany({ include: { posts: { orderBy: { rank: 'desc' }, take: 2 } } }).toSQL();
    expect(many_!.sql).toContain('JSON_ARRAYAGG(CAST(`s`.`j` AS JSON))');
    expect(many_!.sql).toContain('ROW_NUMBER() OVER (ORDER BY `t1`.`rank` DESC)');
  });

  it('matches case sensitive text with a binary collation and insensitive text with LOWER', () => {
    const [exact] = db.users.findMany({ where: { name: { contains: '50%' } } }).toSQL();
    expect(exact!.sql).toContain("`t0`.`name` LIKE ? COLLATE utf8mb4_bin ESCAPE '!'");
    expect(exact!.params).toEqual(['%50!%%']);
    const [loose] = db.users.findMany({ where: { name: { startsWith: 'A_', mode: 'insensitive' } } }).toSQL();
    expect(loose!.sql).toContain("LOWER(`t0`.`name`) LIKE LOWER(?) ESCAPE '!'");
    expect(loose!.params).toEqual(['A!_%']);
  });

  it('upserts with ON DUPLICATE KEY UPDATE and encodes booleans, dates and json', () => {
    const [stmt] = db.users
      .upsert({ where: { email: 'a@x.io' }, create: { email: 'a@x.io', active: false, seen: new Date('2024-01-02T03:04:05.678Z'), meta: { a: 1 } }, update: { name: 'A' } })
      .toSQL();
    expect(stmt!.sql).toMatch(/^INSERT INTO `users` \(.*\) VALUES \(.*\) ON DUPLICATE KEY UPDATE `name` = \?$/);
    expect(stmt!.params).toContain(0);
    expect(stmt!.params).toContain('2024-01-02 03:04:05.678');
    expect(stmt!.params).toContain('{"a":1}');
  });

  it('inserts without RETURNING (the row is read back by key)', () => {
    const [stmt] = db.users.create({ data: { email: 'a@x.io' } }).toSQL();
    expect(stmt!.sql).not.toContain('RETURNING');
    const [defaults] = db.posts.createMany({ data: [{ title: 'a', rank: 1, authorId: 1 }, { title: 'b', rank: 2, authorId: 1 }], skipDuplicates: true }).toSQL();
    expect(defaults!.sql).toMatch(/^INSERT IGNORE INTO `posts`/);
    expect(defaults!.sql).toContain('VALUES (?, ?, ?), (?, ?, ?)');
  });

  it('emulates NULLS LAST with CASE', () => {
    const [stmt] = db.users.findMany({ orderBy: { name: { sort: 'asc', nulls: 'last' } } as never }).toSQL();
    expect(stmt!.sql).toContain('CASE WHEN `t0`.`name` IS NULL THEN 1 ELSE 0 END');
  });
});

describe('mariadb SQL', () => {
  const db = client(mariadbDialect);

  it('orders and pages includes inside JSON_ARRAYAGG instead of a correlated derived table', () => {
    const [stmt] = db.users.findMany({ include: { posts: { orderBy: { rank: 'desc' }, skip: 1, take: 2 } } }).toSQL();
    expect(stmt!.sql).toContain('JSON_ARRAYAGG(JSON_OBJECT(');
    expect(stmt!.sql).toContain('ORDER BY `t1`.`rank` DESC LIMIT 1, 2)');
    expect(stmt!.sql).not.toContain('ROW_NUMBER');
  });

  it('nests includes through JSON_EXTRACT', () => {
    const [stmt] = db.posts.findMany({ include: { author: { include: { posts: true } } } }).toSQL();
    expect(stmt!.sql).toContain("JSON_EXTRACT((SELECT COALESCE(JSON_ARRAYAGG(");
  });
});

describe('mssql SQL', () => {
  const db = client(mssqlDialect);

  it('uses brackets, @p placeholders, TOP and OFFSET FETCH', () => {
    const [top] = db.users.findMany({ where: { email: 'a@x.io' }, take: 3 }).toSQL();
    expect(top!.sql).toMatch(/^SELECT TOP \(3\) \[t0\]\.\[id\] AS \[id\]/);
    expect(top!.sql).toContain('WHERE [t0].[email] = @p1');
    const [page] = db.users.findMany({ skip: 10, take: 5 }).toSQL();
    expect(page!.sql).toContain('ORDER BY (SELECT NULL) OFFSET 10 ROWS FETCH NEXT 5 ROWS ONLY');
  });

  it('reads decimals as text and returns rows with OUTPUT', () => {
    const [read] = db.users.findMany({ select: { price: true } }).toSQL();
    expect(read!.sql).toContain('CAST([t0].[price] AS NVARCHAR(80)) AS [price]');
    const [create] = db.users.create({ data: { email: 'a@x.io' } }).toSQL();
    expect(create!.sql).toMatch(/^INSERT INTO \[users\] \(.*\) OUTPUT INSERTED\./);
    const [del] = db.users.delete({ where: { id: 1 } }).toSQL();
    expect(del!.sql).toContain('OUTPUT DELETED.');
  });

  it('loads includes with FOR JSON PATH', () => {
    const [stmt] = db.users.findMany({ include: { posts: true } }).toSQL();
    expect(stmt!.sql).toContain('FOR JSON PATH, INCLUDE_NULL_VALUES');
  });

  it('upserts with MERGE and HOLDLOCK', () => {
    const [stmt] = db.users.upsert({ where: { email: 'a@x.io' }, create: { email: 'a@x.io' }, update: { name: 'A' } }).toSQL();
    expect(stmt!.sql).toMatch(/^MERGE INTO \[users\] WITH \(HOLDLOCK\) \[tgt\] USING \(SELECT /);
    expect(stmt!.sql).toContain('WHEN MATCHED THEN UPDATE SET');
    expect(stmt!.sql).toContain('OUTPUT INSERTED.');
    expect(stmt!.sql.endsWith(';')).toBe(true);
  });

  it('escapes [ in LIKE and sends NULL bytes as a typed parameter', () => {
    const [like] = db.users.findMany({ where: { name: { contains: '[a]' } } }).toSQL();
    expect(like!.sql).toContain("[t0].[name] COLLATE Latin1_General_100_BIN2 LIKE @p1 ESCAPE '!'");
    expect(like!.params).toEqual(['%![a]%']);
    const [update] = db.users.update({ where: { id: 1 }, data: { avatar: null, seen: new Date('2024-01-02T03:04:05.678Z') } }).toSQL();
    expect(update!.params.some((p) => p instanceof MssqlTypedParam && p.sqlType === 'VARBINARY(MAX)')).toBe(true);
    expect(update!.params).toContain('2024-01-02 03:04:05.678');
  });
});

describe('oracle SQL', () => {
  const db = client(oracleDialect);

  it('uses double quotes, :n placeholders and OFFSET FETCH', () => {
    const [stmt] = db.users.findMany({ where: { active: true }, skip: 2, take: 3 }).toSQL();
    expect(stmt!.sql).toContain('WHERE "t0"."active" = :1');
    expect(stmt!.sql).toContain('OFFSET 2 ROWS FETCH NEXT 3 ROWS ONLY');
    expect(stmt!.params).toEqual([1]);
  });

  it('returns rows with RETURNING INTO out binds', () => {
    const [stmt] = db.users.create({ data: { email: 'a@x.io' } }).toSQL();
    expect(stmt!.sql).toMatch(/^INSERT INTO "users" \(.*\) VALUES \(.*\) RETURNING .* INTO :\d+/);
    expect(stmt!.params.some((p) => p instanceof OracleOutBind)).toBe(true);
  });

  it('compares CLOB columns through DBMS_LOB.SUBSTR and aggregates JSON as CLOB', () => {
    const [stmt] = db.users.findMany({ where: { bio: 'x' }, orderBy: { bio: 'asc' } }).toSQL();
    expect(stmt!.sql).toContain('DBMS_LOB.SUBSTR("t0"."bio", 1000, 1) = :1');
    expect(stmt!.sql).toContain('ORDER BY DBMS_LOB.SUBSTR("t0"."bio", 1000, 1) ASC');
    const [inc] = db.users.findMany({ include: { posts: true } }).toSQL();
    expect(inc!.sql).toContain('RETURNING CLOB');
    expect(inc!.sql).toContain('JSON_ARRAYAGG(');
  });

  it('upserts with MERGE from DUAL and encodes dates as Date objects', () => {
    const seen = new Date('2024-01-02T03:04:05.678Z');
    const [stmt] = db.users.upsert({ where: { email: 'a@x.io' }, create: { email: 'a@x.io', seen }, update: { name: 'A' } }).toSQL();
    expect(stmt!.sql).toMatch(/^MERGE INTO "users" "tgt" USING \(SELECT .* FROM DUAL\) "src"/);
    expect(stmt!.params).toContainEqual(seen);
  });
});
