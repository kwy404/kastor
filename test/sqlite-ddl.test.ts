import { describe, expect, it } from 'vitest';
import type { ColumnIR, SchemaIR } from '../src/core/ir';
import { RANDOM_UUID, needsForeignKeysOff, sqliteDdl } from '../src/dialects/sqlite/ddl';
import { parseCreateTable, parseDefault, readIdentifier, splitDefinitions, typeFromDeclared } from '../src/dialects/sqlite/introspect';
import { applyOp, type MigrationOp } from '../src/migrate/ops';
import { roundTripSchema } from './pg-sqlite-shared';

const users = roundTripSchema.tables.find((tbl) => tbl.name === 'rt_users')!;
const tags = roundTripSchema.tables.find((tbl) => tbl.name === 'rt_tags')!;
const col = (name: string): ColumnIR => users.columns.find((c) => c.name === name)!;
const ddl = (op: MigrationOp, schema: SchemaIR = roundTripSchema) => sqliteDdl(op as never, applyOp(schema, op));

describe('sqlite ddl', () => {
  it('creates tables with declared types that read back as neutral types', () => {
    const [create, ...indexes] = ddl({ kind: 'createTable', table: users });
    expect(create).toContain('"id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT');
    expect(create).toContain(`"role" TEXT NOT NULL DEFAULT 'user' CONSTRAINT "rt_users_role" CHECK ("role" IN ('user', 'admin', 'it''s'))`);
    expect(create).toContain('"balance" DECIMAL(12, 2) NOT NULL DEFAULT 10.50');
    expect(create).toContain('"active" BOOLEAN NOT NULL DEFAULT 1');
    expect(create).toContain(`"createdAt" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`);
    expect(create).toContain(`"meta" JSON NOT NULL DEFAULT '{"a":[1,2]}'`);
    expect(create).toContain(`"token" UUID NOT NULL DEFAULT ${RANDOM_UUID}`);
    expect(create).not.toContain('PRIMARY KEY ("id")');
    expect(indexes).toEqual(['CREATE UNIQUE INDEX "rt_users_email_key" ON "rt_users" ("email")']);
    expect(ddl({ kind: 'createTable', table: tags })[0]).toContain('"id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT /* kastor:bigint */');
  });

  it('adds simple columns in place and rebuilds for the rest', () => {
    expect(ddl({ kind: 'addColumn', table: 'rt_users', column: { name: 'n', type: 'int', nullable: true } })).toEqual([
      'ALTER TABLE "rt_users" ADD COLUMN "n" INTEGER',
    ]);
    const rebuilt = ddl({ kind: 'addColumn', table: 'rt_users', column: { name: 'seen', type: 'datetime', nullable: false, default: { kind: 'now' } } });
    expect(rebuilt[0]).toBe('PRAGMA foreign_keys = OFF');
    expect(rebuilt[1]).toMatch(/^SELECT json_extract\('\{\}', 'kastor: rebuilding table rt_users needs foreign keys off/);
    expect(rebuilt[2]).toMatch(/^CREATE TABLE "__kastor_new_rt_users" \(/);
    expect(rebuilt[3]).toMatch(/^INSERT INTO "__kastor_new_rt_users" \("id", "email", .*\) SELECT "id", "email", .* FROM "rt_users"$/);
    expect(rebuilt[3]).not.toContain('"seen"');
    expect(rebuilt.slice(4)).toEqual([
      'DROP TABLE "rt_users"',
      'ALTER TABLE "__kastor_new_rt_users" RENAME TO "rt_users"',
      'CREATE UNIQUE INDEX "rt_users_email_key" ON "rt_users" ("email")',
      'PRAGMA foreign_keys = ON',
    ]);
    expect(needsForeignKeysOff(rebuilt)).toBe(true);
    expect(needsForeignKeysOff(['ALTER TABLE "t" ADD COLUMN "n" INTEGER'])).toBe(false);
  });

  it('skips the guard when nothing references the rebuilt table', () => {
    const comments = roundTripSchema.tables.find((tbl) => tbl.name === 'rt_comments')!;
    const body = comments.columns.find((c) => c.name === 'body')!;
    const statements = ddl({ kind: 'alterColumn', table: 'rt_comments', column: 'body', from: body, to: { ...body, nullable: true }, changes: { type: false, nullable: true, default: false } });
    expect(statements.some((s) => s.includes('json_extract'))).toBe(false);
  });

  it('maps every op', () => {
    const idx = { name: 'i', columns: ['age'], unique: false };
    expect(ddl({ kind: 'createIndex', table: 'rt_users', index: idx })).toEqual(['CREATE INDEX "i" ON "rt_users" ("age")']);
    expect(ddl({ kind: 'dropIndex', table: 'rt_users', index: { name: 'rt_users_email_key', columns: ['email'], unique: true } })).toEqual(['DROP INDEX "rt_users_email_key"']);
    expect(ddl({ kind: 'renameColumn', table: 'rt_users', from: 'bio', to: 'about' })).toEqual(['ALTER TABLE "rt_users" RENAME COLUMN "bio" TO "about"']);
    expect(ddl({ kind: 'renameTable', from: 'rt_comments', to: 'rt_notes' })).toEqual(['ALTER TABLE "rt_comments" RENAME TO "rt_notes"']);
    expect(ddl({ kind: 'dropTable', table: 'rt_comments' })).toEqual(['DROP TABLE "rt_comments"']);
    expect(ddl({ kind: 'createEnum', enum: { name: 'e', values: ['a'] } })).toEqual([]);
    expect(ddl({ kind: 'dropEnum', enum: { name: 'rt_users_role', values: ['a'] } })).toEqual([]);
    expect(ddl({ kind: 'raw', sql: 'VACUUM' })).toEqual(['VACUUM']);
    expect(ddl({ kind: 'dropColumn', table: 'rt_users', column: 'bio' })).toContain('DROP TABLE "rt_users"');
    const altered = ddl({
      kind: 'alterEnum',
      name: 'rt_users_role',
      from: ['user', 'admin', "it's"],
      to: ['user', 'admin'],
      added: [],
      removed: ["it's"],
      columns: [{ table: 'rt_users', column: 'role' }],
    });
    expect(altered.find((s) => s.startsWith('CREATE TABLE'))).toContain(`CHECK ("role" IN ('user', 'admin'))`);
    expect(ddl({ kind: 'alterColumn', table: 'rt_users', column: 'age', from: col('age'), to: { ...col('age'), nullable: true }, changes: { type: false, nullable: true, default: false } })).toContain(
      'DROP TABLE "rt_users"',
    );
  });
});

describe('sqlite introspection parsing', () => {
  it('splits CREATE TABLE bodies, skipping quotes, comments and nested parentheses', () => {
    const sql = `CREATE TABLE "a, b" ("x" INTEGER DEFAULT (abs(-1)), "y" TEXT DEFAULT 'a,b' -- note, with comma
, CONSTRAINT "f" FOREIGN KEY ("x") REFERENCES "o" ("id"))`;
    expect(splitDefinitions(sql)).toEqual([
      '"x" INTEGER DEFAULT (abs(-1))',
      `"y" TEXT DEFAULT 'a,b'`,
      'CONSTRAINT "f" FOREIGN KEY ("x") REFERENCES "o" ("id")',
    ]);
  });

  it('reads identifiers in every quoting style', () => {
    expect(readIdentifier('"we""ird" INT')).toEqual({ name: 'we"ird', rest: ' INT' });
    expect(readIdentifier('`tick` INT')?.name).toBe('tick');
    expect(readIdentifier('[br] INT')?.name).toBe('br');
    expect(readIdentifier('plain INT')?.name).toBe('plain');
  });

  it('finds autoincrement, bigint markers, enum checks and foreign key names', () => {
    const parsed = parseCreateTable(
      `CREATE TABLE "t" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT /* kastor:bigint */, "mood" TEXT CHECK ("mood" IN ('ok', 'it''s')), ` +
        `"m2" TEXT NOT NULL CONSTRAINT "named" CHECK ("m2" IN ('a')), CONSTRAINT "t_owner_fk" FOREIGN KEY ("a", "b") REFERENCES "o" ("x", "y"))`,
    );
    expect(parsed.columns.get('id')).toEqual({ autoincrement: true, bigint: true });
    expect(parsed.columns.get('mood')).toEqual({ autoincrement: false, bigint: false, enumValues: ['ok', "it's"] });
    expect(parsed.columns.get('m2')).toMatchObject({ enumName: 'named', enumValues: ['a'] });
    expect(parsed.foreignKeyNames.get('a\u0000b')).toBe('t_owner_fk');
  });

  it('maps declared types, including ones kastor did not write', () => {
    const map = (declared: string) => {
      const c: ColumnIR = { name: 'c', type: 'text', nullable: true };
      typeFromDeclared(declared, c);
      return c;
    };
    expect(map('VARCHAR(80)')).toMatchObject({ type: 'string', length: 80 });
    expect(map('DECIMAL(10, 2)')).toMatchObject({ type: 'decimal', precision: 10, scale: 2 });
    expect(map('varchar')).toEqual({ name: 'c', type: 'string', nullable: true });
    expect(map('UNSIGNED BIG INT')).toMatchObject({ type: 'bigint', nativeType: 'UNSIGNED BIG INT' });
    expect(map('NVARCHAR(20)')).toMatchObject({ type: 'text', nativeType: 'NVARCHAR(20)' });
    expect(map('DOUBLE')).toMatchObject({ type: 'float' });
    expect(map('TIMESTAMP')).toMatchObject({ type: 'datetime' });
    expect(map('')).toMatchObject({ type: 'bytes' });
    expect(map('NUMERIC')).toMatchObject({ type: 'decimal', nativeType: 'NUMERIC' });
  });

  it('parses defaults', () => {
    const c = (type: ColumnIR['type']): ColumnIR => ({ name: 'c', type, nullable: true });
    expect(parseDefault("strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", c('datetime'))).toEqual({ kind: 'now' });
    expect(parseDefault("(date('now'))", c('date'))).toEqual({ kind: 'now' });
    expect(parseDefault(RANDOM_UUID.slice(1, -1), c('uuid'))).toEqual({ kind: 'random' });
    expect(parseDefault("'O''Brien'", c('string'))).toEqual({ kind: 'value', value: "O'Brien" });
    expect(parseDefault('1', c('boolean'))).toEqual({ kind: 'value', value: true });
    expect(parseDefault('-3', c('int'))).toEqual({ kind: 'value', value: -3 });
    expect(parseDefault('9007199254740993', c('bigint'))).toEqual({ kind: 'value', value: '9007199254740993' });
    expect(parseDefault('10.50', c('decimal'))).toEqual({ kind: 'value', value: '10.50' });
    expect(parseDefault(`'{"a":1}'`, c('json'))).toEqual({ kind: 'value', value: { a: 1 } });
    expect(parseDefault("X'01FF'", c('bytes'))).toEqual({ kind: 'value', value: [1, 255] });
    expect(parseDefault('CURRENT_TIMESTAMP', c('datetime'))).toEqual({ kind: 'sql', value: 'CURRENT_TIMESTAMP' });
    expect(parseDefault('(random())', c('int'))).toEqual({ kind: 'sql', value: 'random()' });
    expect(parseDefault('NULL', c('int'))).toBeUndefined();
    expect(parseDefault(null, c('int'))).toBeUndefined();
  });
});
