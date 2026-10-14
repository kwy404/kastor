import { describe, expect, it } from 'vitest';
import type { ColumnIR, SchemaIR, TableIR } from '../src/core/ir';
import { columnDefinition, createIndex, degradedKeys, mssqlDdl } from '../src/dialects/mssql/ddl';
import { isJsonCheck, neutralColumn, parseDefault, parseEnumCheck, unwrap } from '../src/dialects/mssql/introspect';

const col = (c: Partial<ColumnIR> & Pick<ColumnIR, 'name' | 'type'>): ColumnIR => ({ nullable: false, ...c });
const tbl = (name: string, extra: Partial<TableIR> = {}): TableIR => ({
  name,
  columns: [col({ name: 'id', type: 'int', default: { kind: 'autoincrement' } })],
  primaryKey: ['id'],
  indexes: [],
  foreignKeys: [],
  ...extra,
});

describe('mssql ddl', () => {
  it('creates tables with identity, named defaults and checks', () => {
    const users = tbl('users', {
      columns: [
        col({ name: 'id', type: 'int', default: { kind: 'autoincrement' } }),
        col({ name: 'email', type: 'string', length: 120 }),
        col({ name: 'nick', type: 'string', nullable: true }),
        col({ name: 'role', type: 'enum', enumValues: ['user', 'admin'], default: { kind: 'value', value: 'user' } }),
        col({ name: 'meta', type: 'json', nullable: true }),
        col({ name: 'at', type: 'datetime', default: { kind: 'now' } }),
        col({ name: 'token', type: 'uuid', default: { kind: 'random' } }),
        col({ name: 'ok', type: 'boolean', default: { kind: 'value', value: true } }),
      ],
      indexes: [
        { name: 'users_email_key', columns: ['email'], unique: true },
        { name: 'users_nick_key', columns: ['nick'], unique: true },
      ],
    });
    const out = mssqlDdl({ kind: 'createTable', table: users }, { tables: [users] });
    expect(out[0]).toContain('[id] INT IDENTITY(1, 1) NOT NULL');
    expect(out[0]).toContain("[role] NVARCHAR(5) NOT NULL CONSTRAINT [DF_users_role] DEFAULT N'user' CONSTRAINT [CK_users_role] CHECK ([role] IN (N'user', N'admin'))");
    expect(out[0]).toContain("[meta] NVARCHAR(MAX) NULL CONSTRAINT [CK_users_meta] CHECK (ISJSON(CONCAT('[', [meta], ']')) = 1)");
    expect(out[0]).toContain('[at] DATETIME2(3) NOT NULL CONSTRAINT [DF_users_at] DEFAULT SYSUTCDATETIME()');
    expect(out[0]).toContain('[token] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [DF_users_token] DEFAULT NEWID()');
    expect(out[0]).toContain('[ok] BIT NOT NULL CONSTRAINT [DF_users_ok] DEFAULT 1');
    expect(out[0]).toContain('CONSTRAINT [PK_users] PRIMARY KEY ([id])');
    expect(out[1]).toBe('CREATE UNIQUE INDEX [users_email_key] ON [users] ([email])');
    // Unique indexes on nullable columns ignore NULLs, like every other database.
    expect(out[2]).toBe('CREATE UNIQUE INDEX [users_nick_key] ON [users] ([nick]) WHERE [nick] IS NOT NULL');
  });

  it('turns cascades SQL Server would reject into NO ACTION', () => {
    const users = tbl('users');
    const posts = tbl('posts', {
      columns: [col({ name: 'id', type: 'int' }), col({ name: 'author_id', type: 'int' }), col({ name: 'editor_id', type: 'int', nullable: true })],
      foreignKeys: [
        { name: 'posts_author_fk', columns: ['author_id'], refTable: 'users', refColumns: ['id'], onDelete: 'cascade', onUpdate: 'no action' },
        { name: 'posts_editor_fk', columns: ['editor_id'], refTable: 'users', refColumns: ['id'], onDelete: 'set null', onUpdate: 'no action' },
      ],
    });
    const comments = tbl('comments', {
      columns: [col({ name: 'id', type: 'int' }), col({ name: 'post_id', type: 'int' }), col({ name: 'parent_id', type: 'int', nullable: true })],
      foreignKeys: [
        { name: 'comments_post_fk', columns: ['post_id'], refTable: 'posts', refColumns: ['id'], onDelete: 'cascade', onUpdate: 'cascade' },
        { name: 'comments_parent_fk', columns: ['parent_id'], refTable: 'comments', refColumns: ['id'], onDelete: 'cascade', onUpdate: 'no action' },
      ],
    });
    const schema: SchemaIR = { tables: [users, posts, comments] };
    expect([...degradedKeys(schema, 'onDelete')]).toEqual(['posts\u0000posts_editor_fk']);
    const sql = mssqlDdl({ kind: 'createTable', table: comments }, schema)[0]!;
    expect(sql).toContain('REFERENCES [posts] ([id]) ON DELETE CASCADE ON UPDATE CASCADE');
    expect(sql).toContain('REFERENCES [comments] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION');
    expect(mssqlDdl({ kind: 'createTable', table: posts }, schema)[0]).toContain('[posts_editor_fk] FOREIGN KEY ([editor_id]) REFERENCES [users] ([id]) ON DELETE NO ACTION');
  });

  it('drops constraints that block column changes', () => {
    const users = tbl('users', {
      columns: [col({ name: 'id', type: 'int' }), col({ name: 'age', type: 'bigint', default: { kind: 'value', value: '21' } })],
      indexes: [{ name: 'users_age_idx', columns: ['age'], unique: false }],
    });
    const out = mssqlDdl(
      {
        kind: 'alterColumn',
        table: 'users',
        column: 'age',
        from: col({ name: 'age', type: 'int', default: { kind: 'value', value: 18 } }),
        to: col({ name: 'age', type: 'bigint', default: { kind: 'value', value: '21' } }),
        changes: { type: true, nullable: false, default: true },
      },
      { tables: [users] },
    );
    expect(out[0]).toContain('sys.default_constraints');
    expect(out[0]).toContain('sys.check_constraints');
    expect(out[1]).toBe('DROP INDEX IF EXISTS [users_age_idx] ON [users]');
    expect(out[2]).toBe('ALTER TABLE [users] ALTER COLUMN [age] BIGINT NOT NULL');
    expect(out[3]).toBe('ALTER TABLE [users] ADD CONSTRAINT [DF_users_age] DEFAULT 21 FOR [age]');
    expect(out[4]).toBe('CREATE INDEX [users_age_idx] ON [users] ([age])');
  });

  it('handles the remaining ops', () => {
    const schema: SchemaIR = { tables: [tbl('users')] };
    expect(mssqlDdl({ kind: 'renameTable', from: 'a', to: 'b' }, schema)).toEqual(["EXEC sp_rename N'a', N'b'"]);
    expect(mssqlDdl({ kind: 'renameColumn', table: 'users', from: 'a', to: 'b' }, schema)).toEqual(["EXEC sp_rename N'users.a', N'b', 'COLUMN'"]);
    expect(mssqlDdl({ kind: 'dropColumn', table: 'users', column: 'a' }, schema)[1]).toBe('ALTER TABLE [users] DROP COLUMN [a]');
    expect(mssqlDdl({ kind: 'addColumn', table: 'users', column: col({ name: 'b', type: 'bytes', nullable: true }) }, schema)).toEqual(['ALTER TABLE [users] ADD [b] VARBINARY(MAX) NULL']);
    expect(mssqlDdl({ kind: 'dropIndex', table: 'users', index: { name: 'i', columns: [], unique: false } }, schema)).toEqual(['DROP INDEX [i] ON [users]']);
    expect(mssqlDdl({ kind: 'dropForeignKey', table: 'users', foreignKey: { name: 'f', columns: [], refTable: 'x', refColumns: [], onDelete: 'cascade', onUpdate: 'cascade' } }, schema)).toEqual(['ALTER TABLE [users] DROP CONSTRAINT [f]']);
    expect(mssqlDdl({ kind: 'alterEnum', name: 'e', from: [], to: [], added: [], removed: [], columns: [] }, schema)).toEqual([]);
    expect(mssqlDdl({ kind: 'raw', sql: { mssql: 'SELECT 1' } }, schema)).toEqual(['SELECT 1']);
    expect(columnDefinition('t', col({ name: 'd', type: 'decimal' }))).toBe('[d] DECIMAL(38, 10) NOT NULL');
    expect(createIndex(undefined, 't', { name: 'i', columns: ['a', 'b'], unique: true })).toBe('CREATE UNIQUE INDEX [i] ON [t] ([a], [b])');
  });
});

describe('mssql introspection helpers', () => {
  it('reads enum checks back in declaration order', () => {
    expect(parseEnumCheck("([role]=N'admin' OR [role]=N'it''s' OR [role]=N'user')", 'role')).toEqual(['user', "it's", 'admin']);
    expect(parseEnumCheck('([age]>(0))', 'age')).toBeUndefined();
  });

  it('recognizes json checks', () => {
    expect(isJsonCheck("(isjson(concat('[',[meta],']'))=(1))", 'meta')).toBe(true);
    expect(isJsonCheck('(isjson([meta])=(1))', 'meta')).toBe(true);
    expect(isJsonCheck('(isjson([other])=(1))', 'meta')).toBe(false);
  });

  it('parses stored defaults', () => {
    expect(unwrap('((1))')).toBe('1');
    expect(parseDefault('(sysutcdatetime())', 'datetime')).toEqual({ kind: 'now' });
    expect(parseDefault('(CONVERT([date],sysutcdatetime()))', 'date')).toEqual({ kind: 'now' });
    expect(parseDefault('(CONVERT([time](0),sysutcdatetime()))', 'time')).toEqual({ kind: 'now' });
    expect(parseDefault('(CAST(sysutcdatetime() AS date))', 'date')).toEqual({ kind: 'now' });
    expect(parseDefault('(newid())', 'uuid')).toEqual({ kind: 'random' });
    expect(parseDefault("(N'it''s')", 'string')).toEqual({ kind: 'value', value: "it's" });
    expect(parseDefault('((1))', 'boolean')).toEqual({ kind: 'value', value: true });
    expect(parseDefault('((-1.5))', 'float')).toEqual({ kind: 'value', value: -1.5 });
    expect(parseDefault("(N'{\"a\":1}')", 'json')).toEqual({ kind: 'value', value: { a: 1 } });
  });

  it('maps catalog types', () => {
    expect(neutralColumn('nvarchar', 240, 0, 0)).toEqual({ type: 'string', length: 120 });
    expect(neutralColumn('nvarchar', -1, 0, 0)).toEqual({ type: 'text' });
    expect(neutralColumn('datetime2', 8, 27, 3)).toEqual({ type: 'datetime' });
    expect(neutralColumn('datetime2', 8, 27, 7)).toEqual({ type: 'datetime', nativeType: 'datetime2(7)' });
    expect(neutralColumn('time', 5, 8, 0)).toEqual({ type: 'time' });
    expect(neutralColumn('varbinary', -1, 0, 0)).toEqual({ type: 'bytes' });
    expect(neutralColumn('uniqueidentifier', 16, 0, 0)).toEqual({ type: 'uuid' });
    expect(neutralColumn('decimal', 17, 12, 2)).toEqual({ type: 'decimal', precision: 12, scale: 2 });
    expect(neutralColumn('xml', -1, 0, 0)).toEqual({ type: 'string', nativeType: 'xml' });
  });
});
