import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { isKastorError, kastor } from '../src/index';
import { toSchemaIR } from '../src/core/schema-ir';
import { importModule } from '../src/migrate/config';
import { parsePrismaSchema, prismaToKastor, type PrismaImportResult } from '../src/migrate/import/prisma';
import { sqlite } from '../src/sqlite';

const root = resolve('.');
const posix = (p: string): string => p.replace(/\\/g, '/');
mkdirSync(join(root, '.kastor'), { recursive: true });
const tmp = mkdtempSync(join(root, '.kastor', 'prisma-unit-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const ds = (provider: string, extra = ''): string => `datasource db {\n  provider = "${provider}"\n  url = env("DATABASE_URL")\n${extra}}\n`;
const convert = (source: string, provider?: string): PrismaImportResult => prismaToKastor(source, { date: new Date('2026-01-01'), ...(provider ? { provider } : {}) });
const messages = (r: PrismaImportResult, level?: 'warn' | 'info'): string => r.warnings.filter((w) => !level || w.level === level).map((w) => `${w.where}: ${w.message} ${w.hint ?? ''}`).join('\n');
const line = (r: PrismaImportResult, key: string): string => r.code.split('\n').find((l) => l.trimStart().startsWith(`${key}:`))?.trim() ?? '';

let counter = 0;
/** Writes the generated code, imports it and checks it declares exactly `schemaIR`, and that a client builds on it. */
async function evaluate(r: PrismaImportResult): Promise<Record<string, unknown>> {
  const file = join(tmp, `schema${counter++}.ts`);
  writeFileSync(file, r.code.replace(/from 'kastor'/g, `from '${posix(join(root, 'src/index'))}'`));
  const mod = await importModule(file);
  // Loaded through jiti, like the CLI loads schemas: another module copy than this test's kastor.
  const schema = mod.schema as Record<string, unknown>;
  expect(toSchemaIR(schema)).toEqual(r.schemaIR);
  const db = kastor({ adapter: sqlite(new Database(':memory:')), schema: schema as never, relations: mod.relations as never }) as unknown as Record<string, { findMany(a: unknown): { toSQL(): unknown } }>;
  // Building a query with every relation included resolves all of them.
  for (const [key] of Object.entries(schema)) {
    const rels = typeof mod.relations === 'function' ? ((mod.relations as (s: unknown) => Record<string, Record<string, unknown>>)(schema)[key] ?? {}) : {};
    const include = Object.fromEntries(Object.keys(rels).map((k) => [k, true]));
    expect(() => db[key]!.findMany({ include }).toSQL()).not.toThrow();
  }
  return mod;
}

describe('Prisma schema parser', () => {
  it('reads blocks, fields, modifiers, attributes and doc comments', () => {
    const s = parsePrismaSchema(`
// plain comment
${ds('postgresql')}
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["fullTextSearchPostgres", "views"]
}

/// Users of the app.
/// Second line.
model User {
  id    Int     @id @default(autoincrement()) // trailing comment
  /// Their address.
  email String  @unique @db.VarChar(255)
  tags  String[]
  bio   String? @db.Text
  geo   Unsupported("point")?
  @@index([email(sort: Desc, length: 10), id], map: "custom", type: BTree)
  @@map("users")
}

enum Role {
  USER
  ADMIN @map("admin")
  @@map("roles")
}
`);
    expect(s.datasources[0]!.properties.provider).toEqual({ kind: 'string', value: 'postgresql' });
    expect(s.datasources[0]!.properties.url).toEqual({ kind: 'call', name: 'env', args: [{ value: { kind: 'string', value: 'DATABASE_URL' } }] });
    expect(s.generators[0]!.properties.previewFeatures).toEqual({ kind: 'array', items: [{ kind: 'string', value: 'fullTextSearchPostgres' }, { kind: 'string', value: 'views' }] });
    const user = s.models[0]!;
    expect(user.doc).toBe('Users of the app.\nSecond line.');
    expect(user.fields.map((f) => [f.name, f.type, f.optional, f.list])).toEqual([
      ['id', 'Int', false, false],
      ['email', 'String', false, false],
      ['tags', 'String', false, true],
      ['bio', 'String', true, false],
      ['geo', 'Unsupported', true, false],
    ]);
    expect(user.fields[1]!.doc).toBe('Their address.');
    expect(user.fields[1]!.attributes.map((a) => a.name)).toEqual(['unique', 'db.VarChar']);
    expect(user.fields[1]!.attributes[1]!.args).toEqual([{ value: { kind: 'number', value: '255' } }]);
    expect(user.fields[4]!.unsupported).toBe('point');
    const idx = user.attributes[0]!;
    expect(idx.name).toBe('index');
    expect(idx.args[0]!.value).toEqual({
      kind: 'array',
      items: [
        { kind: 'call', name: 'email', args: [{ name: 'sort', value: { kind: 'name', value: 'Desc' } }, { name: 'length', value: { kind: 'number', value: '10' } }] },
        { kind: 'name', value: 'id' },
      ],
    });
    expect(idx.args.slice(1)).toEqual([
      { name: 'map', value: { kind: 'string', value: 'custom' } },
      { name: 'type', value: { kind: 'name', value: 'BTree' } },
    ]);
    expect(s.enums[0]!.values.map((v) => v.name)).toEqual(['USER', 'ADMIN']);
    expect(s.enums[0]!.attributes[0]!.name).toBe('map');
  });

  it('reads string escapes, negative numbers, booleans and multi line arguments', () => {
    const s = parsePrismaSchema(`model A {
  id    Int     @id
  name  String  @default("say \\"hi\\"\\n")
  temp  Float   @default(-1.5)
  ok    Boolean @default(true)
  other Int
  rel   B       @relation(
    fields: [other],
    references: [id],
    onDelete: Cascade
  )
}
model B {
  id Int @id
  as A[]
}`);
    const a = s.models[0]!;
    expect(a.fields[1]!.attributes[0]!.args[0]!.value).toEqual({ kind: 'string', value: 'say "hi"\n' });
    expect(a.fields[2]!.attributes[0]!.args[0]!.value).toEqual({ kind: 'number', value: '-1.5' });
    expect(a.fields[3]!.attributes[0]!.args[0]!.value).toEqual({ kind: 'boolean', value: true });
    expect(a.fields[5]!.attributes[0]!.args.map((x) => x.name)).toEqual(['fields', 'references', 'onDelete']);
  });

  it('reports syntax errors with the line and column', () => {
    const fail = (src: string): string => {
      try {
        parsePrismaSchema(src, 'schema.prisma');
      } catch (error) {
        expect(isKastorError(error)).toBe(true);
        return (error as Error).message;
      }
      throw new Error('no error');
    };
    expect(fail('model A {\n  id Int @id\n  name String @default("x\n}')).toMatch(/^schema\.prisma:3:24: This string is not closed/);
    expect(fail('model A {\n  id\n}')).toContain('2:3: Field "id" has no type');
    expect(fail('modle A {}')).toContain('Unknown block "modle"');
    expect(fail('model A {\n  id Int @id @default(\n}')).toContain('Expected a value');
    expect(fail('model A {\n  id Int @id name String\n}')).toContain('own line');
    expect(fail('model A {\n  id Int # \n}')).toContain('Unexpected character "#"');
  });
});

describe('prismaToKastor', { timeout: 120000 }, () => {
  it('maps the fixture schema exactly and the code declares the returned SchemaIR', async () => {
    const source = readFileSync(join(root, 'test/migrate-prisma/schema.prisma'), 'utf8');
    for (const provider of ['postgresql', 'mysql', 'sqlite', 'cockroachdb', 'sqlserver']) {
      const r = convert(source, provider);
      expect(messages(r, 'warn')).not.toMatch(/left out|not mapped/);
      await evaluate(r);
    }
    const r = convert(source);
    expect(r.database).toBe('postgres');
    expect(r.urlEnv).toBe('DATABASE_URL');
    expect(r.stats).toEqual({ models: 9, enums: 2, joinTables: 3, relations: 24 });
    expect(r.code).toContain("export const Role = ['USER', 'EDITOR', 'ADMIN'] as const;");
    expect(r.code).toContain("export const OrderStatus = ['PENDING', 'PAID', 'SHIPPED', 'canceled'] as const;");
    expect(line(r, 'role')).toBe("role: t.enum(Role, 'Role').default('USER'),");
    expect(line(r, 'status')).toBe("status: t.enum(OrderStatus, 'order_status').default('PENDING'),");
    expect(line(r, 'createdAt')).toBe("createdAt: t.datetime().nativeType('timestamp(3)').defaultNow().map('created_at'),");
    expect(line(r, 'updatedAt')).toBe("updatedAt: t.datetime().nativeType('timestamp(3)').updatedAt().map('updated_at'),");
    expect(r.code).toContain("bestFriendOf: one(user, { from: 'bestFriend' }),");
    expect(r.code).toContain("foreignKeys: (c) => [foreignKey([c.orderId, c.productId], () => [orderItem.orderId, orderItem.productId], { onDelete: 'cascade', onUpdate: 'cascade' })],");
    expect(r.code).toContain("reviews: many(review, { fields: ['orderId', 'productId'], references: ['orderId', 'productId'] }),");
    expect(r.warnings.map((w) => w.message).join('\n')).not.toMatch(/updatedAt|composite|comment/);
    expect(line(r, 'views')).toBe('views: t.bigint().default(0n),');
    expect(line(r, 'total')).toBe("total: t.decimal(65, 30).default('0'),");
    expect(r.code).toContain("id: t.text().primaryKey().default(() => cuid()),");
    expect(r.code).toContain("id: t.text().primaryKey().default(() => randomUUID()),");
    expect(r.code).toContain("parentId: t.text().nullable().references((): AnyColumn => category.id, { onDelete: 'set null', onUpdate: 'cascade' }),");
    expect(r.code).toContain("userId: t.int().unique().references(() => user.id, { onDelete: 'cascade', onUpdate: 'cascade' }),");
    expect(r.code).toContain("primaryKey: (c) => [c.orderId, c.productId],");
    expect(r.code).toContain("export const categoryToPost = table('_CategoryToPost', {");
    expect(r.code).toContain("indexes: (c) => [index(c.B).name('_CategoryToPost_B_index')],");
    expect(r.code).toContain("categories: many(category, { through: { table: categoryToPost, fields: ['B'], references: ['A'] } }),");
    expect(r.code).toContain("followers: many(user, { through: { table: follows, fields: ['A'], references: ['B'] } }),");
    expect(r.code).toContain("following: many(user, { through: { table: follows, fields: ['B'], references: ['A'] } }),");
    expect(r.code).toContain('profile: one(profile),');
    expect(r.code).toContain("children: many(category, { fields: ['id'], references: ['parentId'] }),");
    expect(r.code).toContain('/** A person who writes posts and places orders. */');
    expect(r.code).toContain('    /** The writer. */');
    const mysql = convert(source, 'mysql');
    expect(line(mysql, 'email')).toBe('email: t.string(191).unique(),');
    expect(mysql.code).toContain("indexes: (c) => [uniqueIndex(c.A, c.B).name('_PostToTag_AB_unique'), index(c.B).name('_PostToTag_B_index')],");
    const lite = convert(source, 'sqlite');
    expect(line(lite, 'role')).toBe("role: t.text().$type<Role>().default('USER'),");
    expect(line(lite, 'price')).toBe("price: t.decimal().nativeType('DECIMAL'),");
    expect(line(lite, 'settings')).toBe("settings: t.json().nativeType('JSONB').nullable(),");
    expect(messages(lite, 'warn')).toContain('Unix milliseconds');
  });

  it('maps PostgreSQL native types, arrays and database defaults', async () => {
    const r = convert(`${ds('postgresql')}
enum Mood {
  HAPPY
  SAD
}
model Thing {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  code      String   @db.Char(2)
  title     String   @db.VarChar(120)
  small     Int      @db.SmallInt
  ratio     Float    @db.Real
  price     Decimal  @db.Decimal(10, 2)
  cash      Decimal  @db.Money
  email     String   @db.Citext
  at        DateTime @db.Timestamptz(6)
  at3       DateTime @default(now()) @db.Timestamptz(3)
  day       DateTime @db.Date
  clock     DateTime @db.Time(3)
  doc       Json     @default("{\\"a\\": 1}") @db.Json
  tags      String[] @default([])
  moods     Mood[]
  nums      Int[]
  seq       Int      @default(autoincrement())
  computed  String   @default(dbgenerated("lower('X')"))
  opaque    String   @default(dbgenerated())
  weird     Unsupported("circle")?
  big       BigInt   @default(-5)
  when      DateTime @default("2020-01-02T03:04:05Z")
}
model Counter {
  id BigInt @id @default(autoincrement())
}`);
    expect(line(r, 'id')).toBe('id: t.uuid().primaryKey().defaultRandom(),');
    expect(line(r, 'code')).toBe("code: t.string(2).nativeType('char(2)'),");
    expect(line(r, 'title')).toBe('title: t.string(120),');
    expect(line(r, 'small')).toBe("small: t.int().nativeType('smallint'),");
    expect(line(r, 'ratio')).toBe("ratio: t.float().nativeType('real'),");
    expect(line(r, 'price')).toBe('price: t.decimal(),');
    expect(line(r, 'cash')).toBe("cash: t.decimal(19, 2).nativeType('money'),");
    expect(line(r, 'email')).toBe("email: t.text().nativeType('citext'),");
    expect(line(r, 'at')).toBe("at: t.datetime().nativeType('timestamptz(6)'),");
    expect(line(r, 'at3')).toBe('at3: t.datetime().defaultNow(),');
    expect(line(r, 'day')).toBe('day: t.date(),');
    expect(line(r, 'clock')).toBe("clock: t.time().nativeType('time(3)'),");
    expect(line(r, 'doc')).toBe(`doc: t.json().nativeType('json').default({"a":1}),`);
    expect(line(r, 'tags')).toBe("tags: t.json<string[]>().nativeType('text[]').nullable().defaultSql('ARRAY[]::text[]'),");
    expect(line(r, 'moods')).toBe("moods: t.json<Mood[]>().nativeType('Mood[]').nullable(),");
    expect(line(r, 'nums')).toBe("nums: t.json<number[]>().nativeType('int4[]').nullable(),");
    expect(line(r, 'seq')).toBe(`seq: t.int().defaultSql('nextval(\\'"Thing_seq_seq"\\'::regclass)'),`);
    expect(line(r, 'computed')).toBe(`computed: t.text().defaultSql('lower(\\'X\\')'),`);
    expect(line(r, 'opaque')).toBe('opaque: t.text(),');
    expect(line(r, 'weird')).toBe("weird: t.text().nativeType('circle').nullable(),");
    expect(line(r, 'big')).toBe('big: t.bigint().default(-5n),');
    expect(line(r, 'when')).toBe("when: t.datetime().nativeType('timestamp(3)').default(new Date('2020-01-02T03:04:05.000Z')),");
    expect(r.code).toContain('id: t.bigId(),');
    const warns = messages(r, 'warn');
    expect(warns).toContain('Thing.tags is a String[] array column');
    expect(warns).toContain('unsupported database type circle');
    expect(messages(r, 'info')).toContain('dbgenerated() without an expression');
    await evaluate(r);
  });

  it('maps MySQL native types', async () => {
    const r = convert(`${ds('mysql')}
model Row {
  id     Int      @id @default(autoincrement()) @db.UnsignedInt
  body   String   @db.Text
  long   String   @db.LongText
  short  String   @db.VarChar(40)
  flag   Boolean  @db.TinyInt
  tiny   Int      @db.TinyInt
  year   Int      @db.Year
  stamp  DateTime @default(now()) @db.Timestamp(0)
  fine   DateTime @db.DateTime(6)
  blob   Bytes    @db.Blob
  bin    Bytes    @db.Binary(16)
  amount Decimal  @db.Decimal(12, 4)
  f      Float    @db.Float
}`);
    expect(line(r, 'id')).toBe('id: t.id(),');
    expect(line(r, 'body')).toBe("body: t.text().nativeType('TEXT'),");
    expect(line(r, 'long')).toBe('long: t.text(),');
    expect(line(r, 'short')).toBe('short: t.string(40),');
    expect(line(r, 'flag')).toBe('flag: t.boolean(),');
    expect(line(r, 'tiny')).toBe("tiny: t.int().nativeType('TINYINT'),");
    expect(line(r, 'year')).toBe("year: t.int().nativeType('YEAR'),");
    expect(line(r, 'stamp')).toBe("stamp: t.datetime().nativeType('TIMESTAMP').defaultNow(),");
    expect(line(r, 'fine')).toBe('fine: t.datetime(),');
    expect(line(r, 'blob')).toBe("blob: t.bytes().nativeType('BLOB'),");
    expect(line(r, 'bin')).toBe("bin: t.bytes().nativeType('BINARY(16)'),");
    expect(line(r, 'amount')).toBe('amount: t.decimal(12, 4),');
    expect(line(r, 'f')).toBe("f: t.float().nativeType('FLOAT'),");
    expect(messages(r, 'info')).toContain('UNSIGNED');
    expect(messages(r, 'info')).toContain('DATETIME(6)');
    await evaluate(r);
  });

  it('makes the ids Prisma Client generates in JS', async () => {
    const r = convert(`${ds('sqlite')}
model Ids {
  a String @id @default(uuid())
  b String @default(uuid(7))
  c String @default(cuid(2))
  d String @default(nanoid(10))
  e String @default(ulid())
  f String @default(cuid())
}`);
    expect(line(r, 'a')).toBe('a: t.text().primaryKey().default(() => randomUUID()),');
    expect(line(r, 'b')).toBe('b: t.text().default(() => uuidv7()),');
    expect(line(r, 'c')).toBe('c: t.text().default(() => cuid(24)),');
    expect(line(r, 'd')).toBe('d: t.text().default(() => nanoid(10)),');
    expect(line(r, 'e')).toBe('e: t.text().default(() => ulid()),');
    expect(r.code).toContain("import { randomUUID, randomBytes } from 'node:crypto';");
    expect(r.warnings.filter((w) => w.message.startsWith('Ids from'))).toHaveLength(1);
    expect(r.warnings.find((w) => w.message.startsWith('Ids from'))!.where).toBe('Ids.a, Ids.b, Ids.c, Ids.d, Ids.e, Ids.f');
    // The helpers run and make ids of the documented shapes.
    const file = join(tmp, 'ids.ts');
    writeFileSync(file, `${r.code.replace(/from 'kastor'/g, `from '${posix(join(root, 'src/index'))}'`)}\nexport const make = { cuid, nanoid, ulid, uuidv7 };\n`);
    const mod = (await importModule(file)) as { make: Record<string, (n?: number) => string> };
    expect(mod.make.cuid!()).toMatch(/^c[0-9a-z]{24}$/);
    expect(mod.make.cuid!(24)).toHaveLength(24);
    expect(mod.make.nanoid!(10)).toMatch(/^[A-Za-z0-9_-]{10}$/);
    expect(mod.make.ulid!()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(mod.make.uuidv7!()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const a = mod.make.ulid!();
    await new Promise((r2) => setTimeout(r2, 5));
    expect(mod.make.ulid!().slice(0, 10) >= a.slice(0, 10)).toBe(true);
  });

  it('handles named relations, several relations between two models and self relations', async () => {
    const r = convert(`${ds('postgresql')}
model User {
  id          Int     @id @default(autoincrement())
  written     Post[]  @relation("written")
  edited      Post[]  @relation("edited")
  pinned      Post?   @relation("pinned")
  mentor      User?   @relation("mentoring", fields: [mentorId], references: [id])
  mentorId    Int?    @unique
  mentee      User?   @relation("mentoring")
  likes       Post[]  @relation("likes")
}
model Post {
  id        Int   @id @default(autoincrement())
  author    User  @relation("written", fields: [authorId], references: [id], onDelete: Cascade, map: "post_author_fk")
  authorId  Int
  editor    User? @relation("edited", fields: [editorId], references: [id], onUpdate: NoAction)
  editorId  Int?
  pinnedBy  User  @relation("pinned", fields: [pinnedById], references: [id])
  pinnedById Int  @unique
  likedBy   User[] @relation("likes")
}`);
    expect(r.code).toContain("written: many(post, { fields: ['id'], references: ['authorId'] }),");
    expect(r.code).toContain("edited: many(post, { fields: ['id'], references: ['editorId'] }),");
    expect(r.code).toContain("pinned: one(post, { from: 'pinnedBy' }),");
    expect(r.code).toContain("mentee: one(user, { from: 'mentor' }),");
    expect(r.code).not.toContain('//     ');
    expect(r.code).toContain("mentor: one(user, { fields: ['mentorId'], references: ['id'] }),");
    expect(r.code).toContain("authorId: t.int().references(() => user.id, { onDelete: 'cascade', onUpdate: 'cascade', name: 'post_author_fk' }),");
    expect(r.code).toContain("editorId: t.int().nullable().references(() => user.id, { onDelete: 'set null' }),");
    expect(r.code).toContain("export const likes = table('_likes', {");
    expect(r.code).toContain("likes: many(post, { through: { table: likes, fields: ['B'], references: ['A'] } }),");
    expect(messages(r, 'warn')).toBe('');
    await evaluate(r);
  });

  it('keeps a second relation on the same column as its own foreign key', async () => {
    const r = convert(`${ds('postgresql')}
model Shop {
  id       Int     @id
  ownerId  Int
  owner    User    @relation("owner", fields: [ownerId], references: [id])
  manager  User    @relation("manager", fields: [ownerId], references: [id], map: "shop_manager_fkey")
  clash    User    @relation("clash", fields: [ownerId], references: [id])
  touched  Int     @updatedAt
}
model User {
  id      Int    @id
  owned   Shop[] @relation("owner")
  managed Shop[] @relation("manager")
  clashes Shop[] @relation("clash")
}`);
    expect(r.code).toContain("ownerId: t.int().references(() => user.id, { onDelete: 'restrict', onUpdate: 'cascade' }),");
    expect(r.code).toContain("foreignKeys: (c) => [foreignKey([c.ownerId], () => [user.id], { onDelete: 'restrict', onUpdate: 'cascade', name: 'shop_manager_fkey' })],");
    expect(messages(r, 'warn')).toContain('would be named Shop_ownerId_fkey');
    expect(messages(r, 'warn')).toContain('@updatedAt on a Int column');
    await evaluate(r);
  });

  it('orders implicit many-to-many join tables the way Prisma does', () => {
    const r = convert(`${ds('mysql')}
model Zebra {
  id     String  @id
  apples Apple[]
}
model Apple {
  id     Int     @id
  zebras Zebra[]
}`);
    expect(r.code).toContain("export const appleToZebra = table('_AppleToZebra', {");
    expect(r.code).toContain("  A: t.int().references(() => apple.id, { onDelete: 'cascade', onUpdate: 'cascade' }),");
    expect(r.code).toContain("  B: t.string(191).references(() => zebra.id, { onDelete: 'cascade', onUpdate: 'cascade' }),");
    expect(r.code).toContain("apples: many(apple, { through: { table: appleToZebra, fields: ['B'], references: ['A'] } }),");
    expect(r.code).toContain("zebras: many(zebra, { through: { table: appleToZebra, fields: ['A'], references: ['B'] } }),");
  });

  it('declares composite foreign keys with foreignKey()', async () => {
    const r = convert(`${ds('postgresql')}
model Tenant {
  id    Int
  slug  String
  users User[]
  @@id([id, slug])
}
model User {
  id         Int    @id
  tenantId   Int
  tenantSlug String
  tenant     Tenant @relation(fields: [tenantId, tenantSlug], references: [id, slug])
}`);
    expect(r.code).toContain("tenant: one(tenant, { fields: ['tenantId', 'tenantSlug'], references: ['id', 'slug'] }),");
    expect(r.code).toContain("users: many(user, { fields: ['id', 'slug'], references: ['tenantId', 'tenantSlug'] }),");
    expect(r.code).toContain('tenantId: t.int(),');
    expect(r.code).toContain("foreignKeys: (c) => [foreignKey([c.tenantId, c.tenantSlug], () => [tenant.id, tenant.slug], { onDelete: 'restrict', onUpdate: 'cascade' })],");
    expect(r.schemaIR.tables.find((x) => x.name === 'User')!.foreignKeys).toEqual([
      { name: 'User_tenantId_tenantSlug_fkey', columns: ['tenantId', 'tenantSlug'], refTable: 'Tenant', refColumns: ['id', 'slug'], onDelete: 'restrict', onUpdate: 'cascade' },
    ]);
    expect(messages(r, 'warn')).toBe('');
    await evaluate(r);
  });

  it('declares no foreign keys with relationMode = "prisma"', async () => {
    const r = convert(`${ds('mysql', '  relationMode = "prisma"\n')}
model User {
  id      Int      @id
  posts   Post[]
  profile Profile?
}
model Post {
  id       Int  @id
  authorId Int
  author   User @relation(fields: [authorId], references: [id])
  @@index([authorId])
}
model Profile {
  id     Int  @id
  userId Int  @unique
  user   User @relation(fields: [userId], references: [id])
}`);
    expect(r.code).not.toContain('.references(');
    expect(r.relationMode).toBe('prisma');
    expect(r.code).toContain("posts: many(post, { fields: ['id'], references: ['authorId'] }),");
    expect(r.code).toContain("profile: one(profile, { from: 'user' }),");
    expect(messages(r, 'warn')).toContain('relationMode = "prisma"');
    await evaluate(r);
  });

  it('maps indexes, unique constraints and their custom names', async () => {
    const r = convert(`${ds('postgresql')}
model Doc {
  id     Int    @id
  slug   String @unique(map: "doc_slug_unique")
  key    String @unique(sort: Desc)
  a      String
  b      String
  title  String
  @@unique([a, b], name: "pair", map: "doc_pair")
  @@index([a, b])
  @@index([title(ops: raw("gin_trgm_ops"))], type: Gin)
  @@index([b], name: "legacy_name")
  @@fulltext([a])
}`);
    expect(line(r, 'slug')).toBe("slug: t.text().unique('doc_slug_unique'),");
    expect(line(r, 'key')).toBe('key: t.text().unique(),');
    expect(r.code).toContain("indexes: (c) => [uniqueIndex(c.a, c.b).name('doc_pair'), index(c.a, c.b), index(c.title), index(c.b).name('legacy_name'), index(c.a)],");
    const info = messages(r, 'info');
    expect(info).toContain('type: Gin');
    expect(info).toContain('sort: Desc');
    expect(info).toContain('ops: raw("gin_trgm_ops")');
    expect(info).toContain('@@fulltext(a)');
    await evaluate(r);
  });

  it('maps MongoDB ObjectIds, composite types and lists', async () => {
    const r = convert(`${ds('mongodb')}
type Address {
  street String
  zip    String?
  tags   String[]
}
model User {
  id      String   @id @default(auto()) @map("_id") @db.ObjectId
  email   String   @unique
  address Address?
  roles   String[]
  posts   Post[]
  ref     String?  @db.ObjectId
}
model Post {
  id       String @id @default(auto()) @map("_id") @db.ObjectId
  authorId String @db.ObjectId
  author   User   @relation(fields: [authorId], references: [id])
}`);
    expect(r.database).toBe('mongodb');
    expect(line(r, 'id')).toBe('id: t.id(),');
    expect(line(r, 'address')).toBe('address: t.json<Address>().nullable(),');
    expect(line(r, 'roles')).toBe('roles: t.json<string[]>(),');
    expect(line(r, 'ref')).toBe("ref: t.string().nativeType('objectId').nullable(),");
    expect(line(r, 'authorId')).toBe("authorId: t.string().nativeType('objectId').references(() => user.id, { onDelete: 'restrict', onUpdate: 'cascade' }),");
    expect(r.code).toContain('export interface Address {\n  street: string;\n  zip?: string | null;\n  tags: string[];\n}');
    expect(r.code).not.toContain("map('_id')");
    await evaluate(r);
  });

  it('maps SQL Server defaults', async () => {
    const r = convert(`${ds('sqlserver')}
model Item {
  id    Int      @id @default(autoincrement())
  name  String
  big   String   @db.NVarChar(Max)
  at    DateTime @default(now())
  data  Bytes
  money Decimal  @db.Money
}`);
    expect(line(r, 'name')).toBe('name: t.string(1000),');
    expect(line(r, 'big')).toBe("big: t.text().nativeType('nvarchar(max)'),");
    expect(line(r, 'at')).toBe("at: t.datetime().nativeType('datetime2(7)').defaultNow(),");
    expect(line(r, 'data')).toBe("data: t.bytes().nativeType('varbinary(max)'),");
    expect(line(r, 'money')).toBe("money: t.decimal(19, 4).nativeType('money'),");
    await evaluate(r);
  });

  it('keeps ignored models and fields, skips views, and names reserved identifiers safely', async () => {
    const r = convert(`${ds('postgresql', '  schemas = ["public", "audit"]\n  extensions = [pgcrypto]\n')}
model Table {
  id    Int    @id
  index Int    @ignore
  @@ignore
  @@schema("audit")
}
model T {
  id Int @id
}
view Report {
  id Int @unique
}`);
    expect(r.code).toContain("export const tableTable = table('Table', {");
    expect(r.code).toContain("export const tTable = table('T', {");
    expect(r.code).toContain('  index: t.int(),');
    expect(r.code).not.toContain('Report');
    const all = messages(r);
    expect(all).toContain('View Report was skipped');
    expect(all).toContain('@@ignore');
    expect(all).toContain('several database schemas');
    expect(all).toContain('extensions');
    expect(all).toContain('lives in the database schema "audit"');
    await evaluate(r);
  });

  it('assumes PostgreSQL without a datasource and warns on an unknown provider', () => {
    expect(messages(convert('model A {\n  id Int @id\n}'), 'warn')).toContain('no datasource provider');
    const r = convert(`${ds('oracle')}model A {\n  id Int @id\n}`);
    expect(r.database).toBe('postgres');
    expect(messages(r, 'warn')).toContain('Unknown datasource provider "oracle"');
  });

  it('reports what it cannot map', () => {
    const r = convert(`${ds('postgresql')}
model A {
  id   Int     @id
  b    Missing
  c    String  @default(now())
  d    Bytes   @default("AA==")
  e    Int     @db.Weird
  f    B       @relation(fields: [g], references: [id, other])
  g    Int
}
model B {
  id    Int @id
  other Int
}
model C {
  id Int @id
  bs B[]
}`);
    const warns = messages(r, 'warn');
    expect(warns).toContain('Unknown type Missing');
    expect(warns).toContain('now() on a String column');
    expect(warns).toContain('Defaults on Bytes columns');
    expect(warns).toContain('@db.Weird');
    expect(warns).toContain('1 fields and 2 references');
    expect(warns).toContain('C.bs has no matching relation field on B');
  });
});
