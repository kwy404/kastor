// Introspection of MySQL, MariaDB, SQL Server and Oracle catalogs, fed with recorded catalog rows.
import { describe, expect, it } from 'vitest';
import type { Executor } from '../src/core/ir';
import { introspectMssql } from '../src/dialects/mssql/introspect';
import { introspectMysql } from '../src/dialects/mysql/introspect';
import { introspectOracle } from '../src/dialects/oracle/introspect';

/** An executor that answers each catalog query by the first matching fragment. */
function catalog(answers: Array<[RegExp, Record<string, unknown>[]]>): Executor {
  const exec: Executor = {
    async query(sql) {
      const hit = answers.find(([re]) => re.test(sql));
      return { rows: hit ? hit[1] : [] };
    },
    transaction: (fn) => fn(exec),
  };
  return exec;
}

describe('mysql introspection', () => {
  const columns = [
    { TABLE_NAME: 'posts', COLUMN_NAME: 'id', DATA_TYPE: 'int', COLUMN_TYPE: 'int', IS_NULLABLE: 'NO', COLUMN_DEFAULT: null, EXTRA: 'auto_increment' },
    { TABLE_NAME: 'posts', COLUMN_NAME: 'title', DATA_TYPE: 'varchar', COLUMN_TYPE: 'varchar(200)', IS_NULLABLE: 'NO', COLUMN_DEFAULT: null, EXTRA: '', CHAR_LENGTH: '200' },
    { TABLE_NAME: 'posts', COLUMN_NAME: 'meta', DATA_TYPE: 'longtext', COLUMN_TYPE: 'longtext', IS_NULLABLE: 'YES', COLUMN_DEFAULT: 'NULL', EXTRA: '' },
    { TABLE_NAME: 'posts', COLUMN_NAME: 'author_id', DATA_TYPE: 'int', COLUMN_TYPE: 'int(11)', IS_NULLABLE: 'NO', COLUMN_DEFAULT: null, EXTRA: '' },
    { TABLE_NAME: 'posts', COLUMN_NAME: 'at', DATA_TYPE: 'datetime', COLUMN_TYPE: 'datetime(3)', IS_NULLABLE: 'NO', COLUMN_DEFAULT: 'utc_timestamp(3)', EXTRA: '' },
    { TABLE_NAME: 'users', COLUMN_NAME: 'id', DATA_TYPE: 'int', COLUMN_TYPE: 'int', IS_NULLABLE: 'NO', COLUMN_DEFAULT: null, EXTRA: 'auto_increment' },
  ];
  const exec = catalog([
    [/information_schema\.TABLES/, [{ TABLE_NAME: 'posts' }, { TABLE_NAME: 'users' }]],
    [/information_schema\.COLUMNS/, columns],
    [
      /information_schema\.STATISTICS/,
      [
        { TABLE_NAME: 'posts', INDEX_NAME: 'PRIMARY', NON_UNIQUE: 0, COLUMN_NAME: 'id' },
        { TABLE_NAME: 'posts', INDEX_NAME: 'posts_author_fk', NON_UNIQUE: '1', COLUMN_NAME: 'author_id' },
        { TABLE_NAME: 'posts', INDEX_NAME: 'posts_title_key', NON_UNIQUE: 0, COLUMN_NAME: 'title' },
        { TABLE_NAME: 'users', INDEX_NAME: 'PRIMARY', NON_UNIQUE: 0, COLUMN_NAME: 'id' },
      ],
    ],
    [
      /KEY_COLUMN_USAGE/,
      [{ TABLE_NAME: 'posts', CONSTRAINT_NAME: 'posts_author_fk', COLUMN_NAME: 'author_id', REF_TABLE: 'users', REF_COLUMN: 'id', DELETE_RULE: 'CASCADE', UPDATE_RULE: 'NO ACTION' }],
    ],
    [/CHECK_CONSTRAINTS/, [{ table_name: 'posts', check_clause: 'json_valid(`meta`)' }]],
  ]);

  it('assembles tables, keys and MariaDB json columns, hiding the index InnoDB made for a foreign key', async () => {
    // Upper case keys, as MySQL 8 names information_schema columns; aliases come back in lower case.
    expect((await introspectMysql(catalog([]), 'mysql')).tables).toEqual([]);
    const schema = await introspectMysql(exec, 'mariadb');
    const posts = schema.tables.find((t) => t.name === 'posts')!;
    expect(posts.primaryKey).toEqual(['id']);
    expect(posts.columns.map((c) => [c.name, c.type])).toEqual([
      ['id', 'int'],
      ['title', 'string'],
      ['meta', 'json'],
      ['author_id', 'int'],
      ['at', 'datetime'],
    ]);
    expect(posts.columns[0]!.default).toEqual({ kind: 'autoincrement' });
    expect(posts.columns[2]!.default).toBeUndefined();
    expect(posts.columns[4]!.default).toEqual({ kind: 'now' });
    expect(posts.indexes).toEqual([{ name: 'posts_title_key', columns: ['title'], unique: true }]);
    expect(posts.foreignKeys).toEqual([{ name: 'posts_author_fk', columns: ['author_id'], refTable: 'users', refColumns: ['id'], onDelete: 'cascade', onUpdate: 'no action' }]);
    const mysqlSchema = await introspectMysql(exec, 'mysql');
    expect(mysqlSchema.tables.find((t) => t.name === 'posts')!.columns[2]!.type).toBe('text');
  });
});

describe('mssql introspection', () => {
  it('assembles columns, checks, defaults, indexes and keys', async () => {
    const exec = catalog([
      [
        /FROM sys\.tables t\s+JOIN sys\.columns/,
        [
          { table_name: 'users', column_name: 'id', type_name: 'int', max_length: 4, precision: 10, scale: 0, is_nullable: false, is_identity: true, default_definition: null },
          { table_name: 'users', column_name: 'role', type_name: 'nvarchar', max_length: 10, precision: 0, scale: 0, is_nullable: false, is_identity: false, default_definition: "(N'user')" },
          { table_name: 'users', column_name: 'meta', type_name: 'nvarchar', max_length: -1, precision: 0, scale: 0, is_nullable: true, is_identity: false, default_definition: null },
          { table_name: 'posts', column_name: 'id', type_name: 'uniqueidentifier', max_length: 16, precision: 0, scale: 0, is_nullable: false, is_identity: false, default_definition: '(newid())' },
          { table_name: 'posts', column_name: 'user_id', type_name: 'int', max_length: 4, precision: 10, scale: 0, is_nullable: true, is_identity: false, default_definition: null },
        ],
      ],
      [
        /sys\.check_constraints/,
        [
          { table_name: 'users', column_name: 'role', definition: "([role]=N'admin' OR [role]=N'user')" },
          { table_name: 'users', column_name: 'meta', definition: "(isjson(concat('[',[meta],']'))=(1))" },
        ],
      ],
      [
        /sys\.indexes/,
        [
          { table_name: 'users', index_name: 'PK_users', is_unique: true, is_primary_key: true, column_name: 'id' },
          { table_name: 'posts', index_name: 'PK_posts', is_unique: true, is_primary_key: true, column_name: 'id' },
          { table_name: 'posts', index_name: 'posts_user_idx', is_unique: false, is_primary_key: false, column_name: 'user_id' },
        ],
      ],
      [
        /sys\.foreign_keys/,
        [{ table_name: 'posts', constraint_name: 'posts_user_fk', column_name: 'user_id', ref_table: 'users', ref_column: 'id', delete_rule: 'SET_NULL', update_rule: 'NO_ACTION' }],
      ],
    ]);
    const schema = await introspectMssql(exec);
    expect(schema.tables.map((t) => t.name)).toEqual(['posts', 'users']);
    const users = schema.tables[1]!;
    expect(users.columns).toEqual([
      { name: 'id', type: 'int', nullable: false, default: { kind: 'autoincrement' } },
      { name: 'role', type: 'enum', nullable: false, enumValues: ['user', 'admin'], default: { kind: 'value', value: 'user' } },
      { name: 'meta', type: 'json', nullable: true },
    ]);
    const posts = schema.tables[0]!;
    expect(posts.columns[0]).toEqual({ name: 'id', type: 'uuid', nullable: false, default: { kind: 'random' } });
    expect(posts.primaryKey).toEqual(['id']);
    expect(posts.indexes).toEqual([{ name: 'posts_user_idx', columns: ['user_id'], unique: false }]);
    expect(posts.foreignKeys[0]).toMatchObject({ name: 'posts_user_fk', refTable: 'users', onDelete: 'set null', onUpdate: 'no action' });
  });
});

describe('oracle introspection', () => {
  it('assembles columns, constraints and indexes from the USER_* views', async () => {
    const exec = catalog([
      [
        /user_tab_columns/,
        [
          { TABLE_NAME: 'users', COLUMN_NAME: 'id', DATA_TYPE: 'NUMBER', DATA_PRECISION: 10, DATA_SCALE: 0, NULLABLE: 'N', DATA_DEFAULT: '"KASTOR"."ISEQ$$_1".nextval', IDENTITY_COLUMN: 'YES' },
          { TABLE_NAME: 'users', COLUMN_NAME: 'role', DATA_TYPE: 'VARCHAR2', CHAR_LENGTH: 5, CHAR_USED: 'C', NULLABLE: 'N', DATA_DEFAULT: "'user' ", IDENTITY_COLUMN: 'NO' },
          { TABLE_NAME: 'users', COLUMN_NAME: 'meta', DATA_TYPE: 'CLOB', NULLABLE: 'Y', DATA_DEFAULT: null, IDENTITY_COLUMN: 'NO' },
          { TABLE_NAME: 'users', COLUMN_NAME: 'ok', DATA_TYPE: 'NUMBER', DATA_PRECISION: 1, DATA_SCALE: 0, NULLABLE: 'N', DATA_DEFAULT: '1', IDENTITY_COLUMN: 'NO' },
          { TABLE_NAME: 'posts', COLUMN_NAME: 'id', DATA_TYPE: 'CHAR', CHAR_LENGTH: 36, CHAR_USED: 'C', NULLABLE: 'N', DATA_DEFAULT: null, IDENTITY_COLUMN: 'NO' },
          { TABLE_NAME: 'posts', COLUMN_NAME: 'user_id', DATA_TYPE: 'NUMBER', DATA_PRECISION: 10, DATA_SCALE: 0, NULLABLE: 'Y', DATA_DEFAULT: null, IDENTITY_COLUMN: 'NO' },
        ],
      ],
      [
        /user_constraints/,
        [
          { TABLE_NAME: 'users', CONSTRAINT_NAME: 'PK_users', CONSTRAINT_TYPE: 'P', INDEX_NAME: 'PK_users', COLUMN_NAME: 'id', POSITION: 1 },
          { TABLE_NAME: 'users', CONSTRAINT_NAME: 'SYS_C1', CONSTRAINT_TYPE: 'C', SEARCH_CONDITION_VC: '"id" IS NOT NULL', COLUMN_NAME: 'id' },
          { TABLE_NAME: 'users', CONSTRAINT_NAME: 'CK_users_role', CONSTRAINT_TYPE: 'C', SEARCH_CONDITION_VC: `"role" IN ('user', 'admin')`, COLUMN_NAME: 'role' },
          { TABLE_NAME: 'users', CONSTRAINT_NAME: 'CK_users_meta', CONSTRAINT_TYPE: 'C', SEARCH_CONDITION_VC: '"meta" IS JSON', COLUMN_NAME: 'meta' },
          { TABLE_NAME: 'users', CONSTRAINT_NAME: 'CK_users_ok', CONSTRAINT_TYPE: 'C', SEARCH_CONDITION_VC: '"ok" IN (0, 1)', COLUMN_NAME: 'ok' },
          { TABLE_NAME: 'posts', CONSTRAINT_NAME: 'PK_posts', CONSTRAINT_TYPE: 'P', INDEX_NAME: 'PK_posts', COLUMN_NAME: 'id', POSITION: 1 },
          { TABLE_NAME: 'posts', CONSTRAINT_NAME: 'posts_user_fk', CONSTRAINT_TYPE: 'R', R_CONSTRAINT_NAME: 'PK_users', DELETE_RULE: 'CASCADE', COLUMN_NAME: 'user_id', POSITION: 1 },
        ],
      ],
      [
        /user_indexes/,
        [
          { TABLE_NAME: 'users', INDEX_NAME: 'PK_users', UNIQUENESS: 'UNIQUE', COLUMN_NAME: 'id' },
          { TABLE_NAME: 'posts', INDEX_NAME: 'PK_posts', UNIQUENESS: 'UNIQUE', COLUMN_NAME: 'id' },
          { TABLE_NAME: 'posts', INDEX_NAME: 'posts_user_idx', UNIQUENESS: 'NONUNIQUE', COLUMN_NAME: 'user_id' },
        ],
      ],
    ]);
    const schema = await introspectOracle(exec);
    const users = schema.tables.find((t) => t.name === 'users')!;
    expect(users.columns).toEqual([
      { name: 'id', type: 'int', nullable: false, default: { kind: 'autoincrement' } },
      { name: 'role', type: 'enum', nullable: false, enumValues: ['user', 'admin'], default: { kind: 'value', value: 'user' } },
      { name: 'meta', type: 'json', nullable: true },
      { name: 'ok', type: 'boolean', nullable: false, default: { kind: 'value', value: true } },
    ]);
    expect(users.primaryKey).toEqual(['id']);
    expect(users.indexes).toEqual([]);
    const posts = schema.tables.find((t) => t.name === 'posts')!;
    expect(posts.columns[0]!.type).toBe('uuid');
    expect(posts.indexes).toEqual([{ name: 'posts_user_idx', columns: ['user_id'], unique: false }]);
    expect(posts.foreignKeys).toEqual([{ name: 'posts_user_fk', columns: ['user_id'], refTable: 'users', refColumns: ['id'], onDelete: 'cascade', onUpdate: 'no action' }]);
  });
});
