import { describe, expect, it } from 'vitest';
import type { ColumnIR, TableIR } from '../src/core/ir';
import { columnDefinition, columnType, mysqlDdl } from '../src/dialects/mysql/ddl';
import { neutralColumn, parseDefault, parseEnumValues } from '../src/dialects/mysql/introspect';

const ddl = mysqlDdl('mysql');
const col = (c: Partial<ColumnIR> & Pick<ColumnIR, 'name' | 'type'>): ColumnIR => ({ nullable: false, ...c });

const users: TableIR = {
  name: 'users',
  columns: [
    col({ name: 'id', type: 'int', default: { kind: 'autoincrement' } }),
    col({ name: 'email', type: 'string', length: 255 }),
    col({ name: 'name', type: 'string', nullable: true }),
    col({ name: 'role', type: 'enum', enumValues: ['user', 'admin'], default: { kind: 'value', value: 'user' } }),
    col({ name: 'active', type: 'boolean', default: { kind: 'value', value: true } }),
    col({ name: 'created_at', type: 'datetime', default: { kind: 'now' } }),
    col({ name: 'meta', type: 'json', nullable: true, default: { kind: 'value', value: { a: 1 } } }),
  ],
  primaryKey: ['id'],
  indexes: [{ name: 'users_email_key', columns: ['email'], unique: true }],
  foreignKeys: [],
};

describe('mysql ddl', () => {
  it('creates a table with its keys and indexes', () => {
    const out = ddl({ kind: 'createTable', table: users }, { tables: [users] });
    expect(out).toHaveLength(2);
    expect(out[0]).toContain('CREATE TABLE `users` (');
    expect(out[0]).toContain('`id` INT NOT NULL AUTO_INCREMENT');
    expect(out[0]).toContain("`role` ENUM('user', 'admin') NOT NULL DEFAULT 'user'");
    expect(out[0]).toContain('`active` TINYINT(1) NOT NULL DEFAULT 1');
    expect(out[0]).toContain('`created_at` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3))');
    expect(out[0]).toContain('`meta` JSON NULL DEFAULT (\'{"a":1}\')');
    expect(out[0]).toContain('PRIMARY KEY (`id`)');
    expect(out[1]).toBe('CREATE UNIQUE INDEX `users_email_key` ON `users` (`email`)');
  });

  it('maps every neutral type', () => {
    const types: Array<[ColumnIR, string]> = [
      [col({ name: 'a', type: 'string' }), 'VARCHAR(255)'],
      [col({ name: 'a', type: 'text' }), 'LONGTEXT'],
      [col({ name: 'a', type: 'bigint' }), 'BIGINT'],
      [col({ name: 'a', type: 'float' }), 'DOUBLE'],
      [col({ name: 'a', type: 'decimal', precision: 10, scale: 2 }), 'DECIMAL(10, 2)'],
      [col({ name: 'a', type: 'decimal' }), 'DECIMAL(65, 30)'],
      [col({ name: 'a', type: 'date' }), 'DATE'],
      [col({ name: 'a', type: 'time' }), 'TIME'],
      [col({ name: 'a', type: 'bytes' }), 'LONGBLOB'],
      [col({ name: 'a', type: 'uuid' }), 'CHAR(36)'],
      [col({ name: 'a', type: 'string', nativeType: 'varchar(64)' }), 'varchar(64)'],
    ];
    for (const [c, expected] of types) expect(columnType(c, 'mysql')).toBe(expected);
  });

  it('writes defaults that need an expression in parentheses', () => {
    expect(columnDefinition(col({ name: 'id', type: 'uuid', default: { kind: 'random' } }), 'mysql')).toBe('`id` CHAR(36) NOT NULL DEFAULT (UUID())');
    expect(columnDefinition(col({ name: 'body', type: 'text', default: { kind: 'value', value: "it's" } }), 'mysql')).toBe("`body` LONGTEXT NOT NULL DEFAULT ('it''s')");
    expect(columnDefinition(col({ name: 'd', type: 'date', default: { kind: 'now' } }), 'mysql')).toBe('`d` DATE NOT NULL DEFAULT (UTC_DATE())');
    expect(columnDefinition(col({ name: 'n', type: 'int', default: { kind: 'sql', value: '1 + 1' } }), 'mysql')).toBe('`n` INT NOT NULL DEFAULT (1 + 1)');
    expect(columnDefinition(col({ name: 's', type: 'string', default: { kind: 'value', value: 'a\\b' } }), 'mysql')).toBe("`s` VARCHAR(255) NOT NULL DEFAULT 'a\\\\b'");
  });

  it('handles every migration op', () => {
    const schema = { tables: [users] };
    expect(ddl({ kind: 'dropTable', table: 'users' }, schema)).toEqual(['DROP TABLE `users`']);
    expect(ddl({ kind: 'renameTable', from: 'a', to: 'b' }, schema)).toEqual(['RENAME TABLE `a` TO `b`']);
    expect(ddl({ kind: 'addColumn', table: 'users', column: col({ name: 'age', type: 'int', nullable: true }) }, schema)).toEqual([
      'ALTER TABLE `users` ADD COLUMN `age` INT NULL',
    ]);
    expect(ddl({ kind: 'dropColumn', table: 'users', column: 'age' }, schema)).toEqual(['ALTER TABLE `users` DROP COLUMN `age`']);
    expect(ddl({ kind: 'renameColumn', table: 'users', from: 'a', to: 'b' }, schema)).toEqual(['ALTER TABLE `users` RENAME COLUMN `a` TO `b`']);
    expect(
      ddl(
        {
          kind: 'alterColumn',
          table: 'users',
          column: 'name',
          from: col({ name: 'name', type: 'string', nullable: true }),
          to: col({ name: 'name', type: 'string', length: 100 }),
          changes: { type: true, nullable: true, default: false },
        },
        schema,
      ),
    ).toEqual(['ALTER TABLE `users` MODIFY COLUMN `name` VARCHAR(100) NOT NULL']);
    expect(ddl({ kind: 'dropIndex', table: 'users', index: { name: 'i', columns: ['a'], unique: false } }, schema)).toEqual(['DROP INDEX `i` ON `users`']);
    expect(
      ddl(
        {
          kind: 'addForeignKey',
          table: 'posts',
          foreignKey: { name: 'fk', columns: ['author_id'], refTable: 'users', refColumns: ['id'], onDelete: 'cascade', onUpdate: 'no action' },
        },
        schema,
      ),
    ).toEqual(['ALTER TABLE `posts` ADD CONSTRAINT `fk` FOREIGN KEY (`author_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION']);
    expect(
      ddl(
        { kind: 'dropForeignKey', table: 'posts', foreignKey: { name: 'fk', columns: [], refTable: 'users', refColumns: [], onDelete: 'cascade', onUpdate: 'cascade' } },
        schema,
      ),
    ).toEqual(['ALTER TABLE `posts` DROP FOREIGN KEY `fk`']);
    expect(ddl({ kind: 'createEnum', enum: { name: 'e', values: ['a'] } }, schema)).toEqual([]);
    expect(ddl({ kind: 'raw', sql: { mysql: 'SELECT 1', postgres: 'SELECT 2' } }, schema)).toEqual(['SELECT 1']);
    expect(mysqlDdl('mariadb')({ kind: 'raw', sql: { mysql: 'SELECT 1' } }, schema)).toEqual(['SELECT 1']);
    expect(() => ddl({ kind: 'nope' }, schema)).toThrow(/unknown migration op/);
  });
});

describe('mysql introspection helpers', () => {
  it('parses enum values with quotes', () => {
    expect(parseEnumValues("enum('a','b''c','d\\\\e')")).toEqual(['a', "b'c", 'd\\e']);
  });

  it('maps native types back to neutral ones', () => {
    const base = { length: undefined, precision: undefined, scale: undefined, isJsonChecked: false };
    expect(neutralColumn({ ...base, dataType: 'tinyint', columnType: 'tinyint(1)' }).type).toBe('boolean');
    expect(neutralColumn({ ...base, dataType: 'char', columnType: 'char(36)', length: 36 }).type).toBe('uuid');
    expect(neutralColumn({ ...base, dataType: 'longtext', columnType: 'longtext', isJsonChecked: true }).type).toBe('json');
    expect(neutralColumn({ ...base, dataType: 'longtext', columnType: 'longtext' })).toEqual({ type: 'text' });
    expect(neutralColumn({ ...base, dataType: 'int', columnType: 'int(11)' })).toEqual({ type: 'int' });
    expect(neutralColumn({ ...base, dataType: 'smallint', columnType: 'smallint(6)' })).toEqual({ type: 'int', nativeType: 'smallint' });
    expect(neutralColumn({ ...base, dataType: 'decimal', columnType: 'decimal(10,2)', precision: 10, scale: 2 })).toEqual({ type: 'decimal', precision: 10, scale: 2 });
    expect(neutralColumn({ ...base, dataType: 'enum', columnType: "enum('x','y')" })).toEqual({ type: 'enum', enumValues: ['x', 'y'] });
  });

  it('reads defaults from MySQL and MariaDB', () => {
    expect(parseDefault(null, 'auto_increment', 'int', 'mysql')).toEqual({ kind: 'autoincrement' });
    expect(parseDefault('utc_timestamp(3)', 'DEFAULT_GENERATED', 'datetime', 'mysql')).toEqual({ kind: 'now' });
    expect(parseDefault('CURRENT_TIMESTAMP(3)', 'DEFAULT_GENERATED', 'datetime', 'mysql')).toEqual({ kind: 'now' });
    expect(parseDefault('uuid()', 'DEFAULT_GENERATED', 'uuid', 'mysql')).toEqual({ kind: 'random' });
    expect(parseDefault('user', '', 'enum', 'mysql')).toEqual({ kind: 'value', value: 'user' });
    expect(parseDefault("'user'", '', 'enum', 'mariadb')).toEqual({ kind: 'value', value: 'user' });
    expect(parseDefault('NULL', '', 'string', 'mariadb')).toBeUndefined();
    expect(parseDefault('1', '', 'boolean', 'mysql')).toEqual({ kind: 'value', value: true });
    expect(parseDefault("_utf8mb4\\'{\"a\":1}\\'", 'DEFAULT_GENERATED', 'json', 'mysql')).toEqual({ kind: 'value', value: { a: 1 } });
    expect(parseDefault('(1 + 1)', 'DEFAULT_GENERATED', 'int', 'mysql')).toEqual({ kind: 'sql', value: '(1 + 1)' });
    expect(parseDefault('42', '', 'bigint', 'mariadb')).toEqual({ kind: 'value', value: '42' });
  });
});
