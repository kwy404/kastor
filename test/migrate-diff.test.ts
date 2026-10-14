import { describe, expect, it } from 'vitest';
import type { ColumnIR, SchemaIR, TableIR } from '../src/core/ir';
import {
  compareColumns,
  diffSchemas,
  findColumnRenameCandidates,
  findTableRenameCandidates,
  normalizeDefault,
  orderTables,
  RenameError,
  schemasMatch,
  storesForeignKeys,
} from '../src/migrate/diff';
import { applyOp, describeOp, isDestructive, isWidening, type MigrationOp } from '../src/migrate/ops';

const col = (name: string, type: ColumnIR['type'], extra: Partial<ColumnIR> = {}): ColumnIR => ({ name, type, nullable: false, ...extra });
const id = (name = 'id'): ColumnIR => col(name, 'int', { default: { kind: 'autoincrement' } });
const tbl = (name: string, columns: ColumnIR[], extra: Partial<TableIR> = {}): TableIR => ({
  name,
  columns,
  primaryKey: [columns[0]!.name],
  indexes: [],
  foreignKeys: [],
  ...extra,
});
const fk = (table: string, column: string, refTable: string, extra: Partial<TableIR['foreignKeys'][number]> = {}) => ({
  name: `${table}_${column}_fkey`,
  columns: [column],
  refTable,
  refColumns: ['id'],
  onDelete: 'no action' as const,
  onUpdate: 'no action' as const,
  ...extra,
});

const users = (): TableIR =>
  tbl('users', [id(), col('email', 'string', { length: 255 }), col('name', 'string', { nullable: true })], {
    indexes: [{ name: 'users_email_key', columns: ['email'], unique: true }],
  });
const posts = (): TableIR =>
  tbl('posts', [id(), col('title', 'string', { length: 200 }), col('author_id', 'int')], {
    foreignKeys: [fk('posts', 'author_id', 'users', { onDelete: 'cascade' })],
    indexes: [{ name: 'posts_author_id_idx', columns: ['author_id'], unique: false }],
  });
const schema = (...tables: TableIR[]): SchemaIR => ({ tables });
const kinds = (ops: MigrationOp[]): string[] => ops.map((o) => o.kind);

/** Applying the ops to the live schema must give a schema with nothing left to diff. */
function expectConverges(current: SchemaIR, target: SchemaIR, ops: MigrationOp[], namedEnums = false): void {
  const after = ops.reduce(applyOp, current);
  expect(diffSchemas(after, target, { namedEnums }).ops).toEqual([]);
}

describe('diffSchemas: tables', () => {
  it('returns nothing for identical schemas', () => {
    const s = schema(users(), posts());
    expect(diffSchemas(s, s).ops).toEqual([]);
    expect(schemasMatch(s, structuredClone(s))).toBe(true);
  });

  it('creates tables with referenced tables first, whatever the input order', () => {
    const target = schema(posts(), users());
    const { ops, destructive } = diffSchemas(schema(), target);
    expect(kinds(ops)).toEqual(['createTable', 'createTable']);
    expect(ops.map((o) => (o.kind === 'createTable' ? o.table.name : ''))).toEqual(['users', 'posts']);
    expect(destructive).toBe(false);
    expectConverges(schema(), target, ops);
  });

  it('orders a chain of three tables and keeps self references inline', () => {
    const comments = tbl('comments', [id(), col('post_id', 'int'), col('parent_id', 'int', { nullable: true })], {
      foreignKeys: [fk('comments', 'post_id', 'posts'), fk('comments', 'parent_id', 'comments')],
    });
    const { ops } = diffSchemas(schema(), schema(comments, posts(), users()));
    expect(ops.map((o) => (o.kind === 'createTable' ? o.table.name : o.kind))).toEqual(['users', 'posts', 'comments']);
    const created = ops[2]!;
    expect(created.kind === 'createTable' && created.table.foreignKeys).toHaveLength(2);
  });

  it('breaks foreign key cycles with addForeignKey after both tables exist', () => {
    const a = tbl('a', [id(), col('b_id', 'int', { nullable: true })], { foreignKeys: [fk('a', 'b_id', 'b')] });
    const b = tbl('b', [id(), col('a_id', 'int', { nullable: true })], { foreignKeys: [fk('b', 'a_id', 'a')] });
    const target = schema(a, b);
    const { ops } = diffSchemas(schema(), target);
    expect(kinds(ops)).toEqual(['createTable', 'createTable', 'addForeignKey']);
    const first = ops[0]!;
    expect(first.kind === 'createTable' && first.table.name).toBe('a');
    expect(first.kind === 'createTable' && first.table.foreignKeys).toEqual([]);
    expect(ops[2]).toMatchObject({ kind: 'addForeignKey', table: 'a', foreignKey: { refTable: 'b' } });
    expectConverges(schema(), target, ops);
  });

  it('drops tables that reference others before the tables they reference', () => {
    const { ops, destructive, warnings } = diffSchemas(schema(users(), posts()), schema());
    expect(ops.map((o) => (o.kind === 'dropTable' ? o.table : o.kind))).toEqual(['posts', 'users']);
    expect(destructive).toBe(true);
    expect(warnings.filter((w) => w.level === 'danger')).toHaveLength(2);
    expect(warnings[0]!.hint).toContain('--rename');
  });

  it('drops a foreign key cycle before dropping its tables', () => {
    const a = tbl('a', [id(), col('b_id', 'int')], { foreignKeys: [fk('a', 'b_id', 'b')] });
    const b = tbl('b', [id(), col('a_id', 'int')], { foreignKeys: [fk('b', 'a_id', 'a')] });
    const { ops } = diffSchemas(schema(a, b), schema());
    expect(kinds(ops)).toEqual(['dropForeignKey', 'dropTable', 'dropTable']);
  });

  it('drops the foreign key of a kept table when its target table goes away', () => {
    const kept = tbl('posts', [id(), col('title', 'string', { length: 200 }), col('author_id', 'int')]);
    const { ops } = diffSchemas(schema(users(), posts()), schema(kept));
    expect(kinds(ops)).toEqual(['dropForeignKey', 'dropIndex', 'dropTable']);
  });
});

describe('diffSchemas: columns', () => {
  it('adds a nullable column without warnings', () => {
    const target = users();
    target.columns.push(col('bio', 'text', { nullable: true }));
    const { ops, warnings } = diffSchemas(schema(users()), schema(target));
    expect(ops).toEqual([{ kind: 'addColumn', table: 'users', column: col('bio', 'text', { nullable: true }) }]);
    expect(warnings).toEqual([]);
  });

  it('warns when a required column without default is added', () => {
    const target = users();
    target.columns.push(col('age', 'int'));
    const { warnings } = diffSchemas(schema(users()), schema(target));
    expect(warnings[0]).toMatchObject({ level: 'warn' });
    expect(warnings[0]!.message).toContain('users.age is required');
  });

  it('does not warn for a required column with a default', () => {
    const target = users();
    target.columns.push(col('active', 'boolean', { default: { kind: 'value', value: true } }));
    expect(diffSchemas(schema(users()), schema(target)).warnings).toEqual([]);
  });

  it('drops a column and marks it destructive', () => {
    const target = users();
    target.columns = target.columns.filter((c) => c.name !== 'name');
    const { ops, destructive, warnings } = diffSchemas(schema(users()), schema(target));
    expect(ops).toMatchObject([{ kind: 'dropColumn', table: 'users', column: 'name' }]);
    expect(destructive).toBe(true);
    expect(warnings[0]!.message).toContain('users.name will be dropped');
  });

  it('alters type, nullability and default separately', () => {
    const target = users();
    target.columns[2] = col('name', 'string', { length: 100, default: { kind: 'value', value: 'anon' } });
    const { ops, warnings } = diffSchemas(schema(users()), schema(target));
    expect(ops).toHaveLength(1);
    const op = ops[0]!;
    expect(op.kind).toBe('alterColumn');
    if (op.kind !== 'alterColumn') return;
    expect(op.changes).toEqual({ type: true, nullable: true, default: true });
    expect(isDestructive(op)).toBe(true);
    expect(warnings.map((w) => w.level).sort()).toEqual(['danger', 'warn']);
    expect(describeOp(op)).toBe('Alter column users.name: type string to string(100), make required, default "anon"');
  });

  it('treats widening type changes as safe', () => {
    const from = schema(tbl('t', [id(), col('n', 'int')]));
    const to = schema(tbl('t', [id(), col('n', 'bigint')]));
    const { ops, destructive, warnings } = diffSchemas(from, to);
    expect(kinds(ops)).toEqual(['alterColumn']);
    expect(destructive).toBe(false);
    expect(warnings).toEqual([]);
  });

  it('treats a string without length as 255', () => {
    const live = schema(tbl('t', [id(), col('s', 'string', { length: 255 })]));
    const code = schema(tbl('t', [id(), col('s', 'string')]));
    expect(diffSchemas(live, code).ops).toEqual([]);
    const longer = schema(tbl('t', [id(), col('s', 'string', { length: 300 })]));
    expect(kinds(diffSchemas(live, longer).ops)).toEqual(['alterColumn']);
  });

  it('ignores a native type found by introspection unless the schema sets one', () => {
    const live = schema(tbl('t', [id(), col('s', 'text', { nativeType: 'citext' })]));
    expect(diffSchemas(live, schema(tbl('t', [id(), col('s', 'text')]))).ops).toEqual([]);
    expect(diffSchemas(live, schema(tbl('t', [id(), col('s', 'text', { nativeType: 'CITEXT' })]))).ops).toEqual([]);
    expect(kinds(diffSchemas(live, schema(tbl('t', [id(), col('s', 'text', { nativeType: 'varchar(10)' })]))).ops)).toEqual(['alterColumn']);
  });

  it('compares defaults the way databases report them', () => {
    const live = schema(
      tbl('t', [
        id(),
        col('role', 'string', { default: { kind: 'sql', value: "'user'::character varying" } }),
        col('at', 'datetime', { default: { kind: 'sql', value: 'CURRENT_TIMESTAMP' } }),
        col('ok', 'boolean', { default: { kind: 'sql', value: '1' } }),
        col('n', 'int', { default: { kind: 'sql', value: '(0)' } }),
        col('u', 'uuid', { default: { kind: 'sql', value: 'gen_random_uuid()' } }),
        col('price', 'decimal', { precision: 10, scale: 2, default: { kind: 'sql', value: '9.50' } }),
      ]),
    );
    const code = schema(
      tbl('t', [
        id(),
        col('role', 'string', { default: { kind: 'value', value: 'user' } }),
        col('at', 'datetime', { default: { kind: 'now' } }),
        col('ok', 'boolean', { default: { kind: 'value', value: true } }),
        col('n', 'int', { default: { kind: 'value', value: 0 } }),
        col('u', 'uuid', { default: { kind: 'random' } }),
        col('price', 'decimal', { precision: 10, scale: 2, default: { kind: 'value', value: '9.5' } }),
      ]),
    );
    expect(diffSchemas(live, code).ops).toEqual([]);
  });

  it('normalizes SQL defaults', () => {
    expect(normalizeDefault({ kind: 'sql', value: 'now()' }, 'datetime')).toEqual({ kind: 'now' });
    expect(normalizeDefault({ kind: 'sql', value: "nextval('t_id_seq'::regclass)" }, 'int')).toEqual({ kind: 'autoincrement' });
    expect(normalizeDefault({ kind: 'sql', value: "'it''s'" }, 'string')).toEqual({ kind: 'value', value: "it's" });
    expect(normalizeDefault({ kind: 'sql', value: 'NULL' }, 'string')).toBeUndefined();
    expect(normalizeDefault({ kind: 'sql', value: 'lower(x)' }, 'string')).toEqual({ kind: 'sql', value: 'lower(x)' });
    expect(normalizeDefault({ kind: 'value', value: { a: 1 } }, 'json')).toEqual({ kind: 'value', value: '{"a":1}' });
    expect(normalizeDefault({ kind: 'sql', value: '\'{"a": 1}\'::jsonb' }, 'json')).toEqual({ kind: 'value', value: '{"a":1}' });
  });

  it('notices when autoincrement is added or removed', () => {
    const live = schema(tbl('t', [col('id', 'int')]));
    const code = schema(tbl('t', [id()]));
    const op = diffSchemas(live, code).ops[0]!;
    expect(op.kind === 'alterColumn' && op.changes).toEqual({ type: true, nullable: false, default: false });
  });

  it('uses the dialect to accept columns that render the same DDL', () => {
    const dialect = {
      name: 'sqlite' as const,
      features: { namedEnums: false } as never,
      ddl: (op: { kind: string; column?: ColumnIR }) => [op.column ? `ADD ${op.column.name} ${op.column.type === 'uuid' || op.column.type === 'string' ? 'TEXT' : op.column.type}` : ''],
    };
    const live = schema(tbl('t', [id(), col('u', 'string', { length: 36 })]));
    const code = schema(tbl('t', [id(), col('u', 'uuid')]));
    expect(diffSchemas(live, code).ops).toHaveLength(1);
    expect(diffSchemas(live, code, { dialect }).ops).toEqual([]);
  });

  it('compareColumns reports each aspect', () => {
    expect(compareColumns('t', col('a', 'int'), col('a', 'int', { nullable: true }), false)).toEqual({ type: false, nullable: true, default: false });
    expect(compareColumns('t', col('a', 'decimal', { precision: 10, scale: 2 }), col('a', 'decimal', { precision: 12, scale: 2 }), false).type).toBe(true);
  });
});

describe('diffSchemas: renames', () => {
  it('renames a column instead of dropping it', () => {
    const target = users();
    target.columns[2] = col('full_name', 'string', { nullable: true });
    const { ops, destructive } = diffSchemas(schema(users()), schema(target), {
      renames: [{ kind: 'column', table: 'users', from: 'name', to: 'full_name' }],
    });
    expect(ops).toEqual([{ kind: 'renameColumn', table: 'users', from: 'name', to: 'full_name' }]);
    expect(destructive).toBe(false);
  });

  it('renames a column and then alters it', () => {
    const target = users();
    target.columns[2] = col('full_name', 'text');
    const { ops } = diffSchemas(schema(users()), schema(target), {
      renames: [{ kind: 'column', table: 'users', from: 'name', to: 'full_name' }],
    });
    expect(kinds(ops)).toEqual(['renameColumn', 'alterColumn']);
    expectConverges(schema(users()), schema(target), ops);
  });

  it('renames a table and keeps foreign keys that point at it', () => {
    const accounts = { ...users(), name: 'accounts' };
    const p = posts();
    p.foreignKeys[0]!.refTable = 'accounts';
    const { ops } = diffSchemas(schema(users(), posts()), schema(accounts, p), {
      renames: [{ kind: 'table', from: 'users', to: 'accounts' }],
    });
    expect(ops).toEqual([{ kind: 'renameTable', from: 'users', to: 'accounts' }]);
  });

  it('renames a table and a column in it together', () => {
    const accounts = users();
    accounts.name = 'accounts';
    accounts.columns[1] = col('mail', 'string', { length: 255 });
    accounts.indexes = [{ name: 'accounts_mail_key', columns: ['mail'], unique: true }];
    const { ops } = diffSchemas(schema(users()), schema(accounts), {
      renames: [
        { kind: 'table', from: 'users', to: 'accounts' },
        { kind: 'column', table: 'accounts', from: 'email', to: 'mail' },
      ],
    });
    expect(kinds(ops)).toEqual(['renameTable', 'renameColumn']);
  });

  it('rejects renames that point nowhere', () => {
    expect(() => diffSchemas(schema(users()), schema(users()), { renames: [{ kind: 'table', from: 'users', to: 'nope' }] })).toThrow(RenameError);
    expect(() => diffSchemas(schema(users()), schema(users()), { renames: [{ kind: 'column', table: 'users', from: 'zzz', to: 'name' }] })).toThrow(RenameError);
    const target = users();
    target.columns.push(col('x', 'int', { nullable: true }));
    expect(() => diffSchemas(schema(), schema(target), { renames: [{ kind: 'column', table: 'users', from: 'a', to: 'x' }] })).toThrow(/no table users/);
  });

  it('finds table rename candidates by column similarity', () => {
    const accounts = { ...users(), name: 'accounts' };
    const other = tbl('logs', [id(), col('line', 'text')]);
    const cands = findTableRenameCandidates(schema(users()), schema(accounts, other));
    expect(cands).toEqual([{ kind: 'table', from: 'users', to: ['accounts'] }]);
  });

  it('offers the single added table as a candidate even when nothing matches', () => {
    const cands = findTableRenameCandidates(schema(users()), schema(tbl('logs', [col('line', 'text')])));
    expect(cands).toEqual([{ kind: 'table', from: 'users', to: ['logs'] }]);
  });

  it('finds column rename candidates of a compatible type, same type first', () => {
    const target = users();
    target.columns = [id(), col('email', 'string', { length: 255 }), col('display', 'text', { nullable: true }), col('nick', 'string', { nullable: true }), col('age', 'int', { nullable: true })];
    const cands = findColumnRenameCandidates(schema(users()), schema(target));
    expect(cands).toEqual([{ kind: 'column', table: 'users', from: 'name', to: ['nick', 'display'] }]);
  });

  it('finds column candidates inside a renamed table', () => {
    const accounts = users();
    accounts.name = 'accounts';
    accounts.columns[2] = col('nick', 'string', { nullable: true });
    const cands = findColumnRenameCandidates(schema(users()), schema(accounts), [{ kind: 'table', from: 'users', to: 'accounts' }]);
    expect(cands).toEqual([{ kind: 'column', table: 'accounts', from: 'name', to: ['nick'] }]);
  });
});

describe('diffSchemas: indexes and foreign keys', () => {
  it('ignores index name differences', () => {
    const live = users();
    live.indexes[0]!.name = 'UQ_something_else';
    expect(diffSchemas(schema(live), schema(users())).ops).toEqual([]);
  });

  it('adds and drops indexes and warns about new unique ones', () => {
    const target = users();
    target.indexes = [{ name: 'users_name_key', columns: ['name'], unique: true }];
    const { ops, warnings } = diffSchemas(schema(users()), schema(target));
    expect(kinds(ops)).toEqual(['dropIndex', 'createIndex']);
    expect(warnings[0]!.message).toContain('fails if duplicates');
  });

  it('keeps the index MySQL creates for a foreign key', () => {
    const p = posts();
    p.indexes = [];
    const live = posts();
    live.indexes = [{ name: 'author_id', columns: ['author_id'], unique: false }];
    expect(diffSchemas(schema(users(), live), schema(users(), p)).ops).toEqual([]);
  });

  it('replaces a foreign key whose action changes', () => {
    const target = posts();
    target.foreignKeys[0]!.onDelete = 'set null';
    const { ops } = diffSchemas(schema(users(), posts()), schema(users(), target));
    expect(kinds(ops)).toEqual(['dropForeignKey', 'addForeignKey']);
  });

  it('treats restrict and no action as the same', () => {
    const live = posts();
    live.foreignKeys[0]!.onUpdate = 'restrict';
    expect(diffSchemas(schema(users(), live), schema(users(), posts())).ops).toEqual([]);
  });

  it('drops and re-adds foreign keys around a type change of the referenced key', () => {
    const u = users();
    u.columns[0] = col('id', 'bigint', { default: { kind: 'autoincrement' } });
    const p = posts();
    p.columns[2] = col('author_id', 'bigint');
    const { ops } = diffSchemas(schema(users(), posts()), schema(u, p));
    expect(kinds(ops)).toEqual(['dropForeignKey', 'alterColumn', 'alterColumn', 'addForeignKey']);
    expectConverges(schema(users(), posts()), schema(u, p), ops);
  });

  it('adds a foreign key from an existing table to a new one after creating it', () => {
    const p = tbl('posts', [id(), col('title', 'string', { length: 200 }), col('author_id', 'int')]);
    const target = posts();
    target.indexes = [];
    const { ops } = diffSchemas(schema(p), schema(users(), target));
    expect(kinds(ops)).toEqual(['createTable', 'addForeignKey']);
  });

  it('rebuilds indexes on columns whose type changes on SQL Server', () => {
    const dialect = { name: 'mssql' as const, features: { namedEnums: false } as never, ddl: () => [] };
    const target = users();
    target.columns[1] = col('email', 'string', { length: 320 });
    const { ops } = diffSchemas(schema(users()), schema(target), { dialect });
    expect(kinds(ops)).toEqual(['dropIndex', 'alterColumn', 'createIndex']);
  });

  it('gives the dialect the whole target schema when comparing foreign keys', () => {
    // Like SQL Server: a second cascade path to the same table is created as NO ACTION.
    const seen: string[][] = [];
    const dialect = {
      name: 'mssql' as const,
      features: { namedEnums: false } as never,
      ddl: (op: { kind: string; table?: string; foreignKey?: { refTable: string; onDelete: string } }, s: SchemaIR) => {
        if (op.kind !== 'addForeignKey' || !op.foreignKey) return [];
        if (op.table === 'comments') seen.push(s.tables.map((x) => x.name));
        const otherCascade = s.tables.some((x) => x.name !== op.table && x.foreignKeys.some((f) => f.refTable === op.foreignKey!.refTable && f.onDelete === 'cascade'));
        return [`FK ${op.foreignKey.refTable} ${otherCascade ? 'no action' : op.foreignKey.onDelete}`];
      },
    };
    const comments = tbl('comments', [id(), col('author_id', 'int')], { foreignKeys: [fk('comments', 'author_id', 'users', { onDelete: 'cascade' })] });
    const target = schema(users(), posts(), comments);
    const live = schema(users(), posts(), { ...comments, foreignKeys: [fk('comments', 'author_id', 'users', { onDelete: 'no action' })] });
    expect(diffSchemas(live, target, { dialect }).ops).toEqual([]);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((names) => names.length === 3)).toBe(true);
    expect(kinds(diffSchemas(live, target).ops)).toEqual(['dropForeignKey', 'addForeignKey']);
  });

  it('ignores foreign keys on databases that do not keep them', () => {
    const noFks = { name: 'mongodb' as const, features: { namedEnums: false } as never, ddl: () => [] };
    expect(storesForeignKeys(noFks)).toBe(false);
    expect(storesForeignKeys(undefined)).toBe(true);
    expect(storesForeignKeys({ ...noFks, ddl: () => { throw new Error('x'); } })).toBe(true);
    const live = posts();
    live.foreignKeys = [];
    expect(diffSchemas(schema(users(), live), schema(users(), posts()), { dialect: noFks }).ops).toEqual([]);
    expect(kinds(diffSchemas(schema(users(), live), schema(users(), posts())).ops)).toEqual(['addForeignKey']);
  });

  it('warns when the primary key changes', () => {
    const target = users();
    target.primaryKey = ['email'];
    const { warnings } = diffSchemas(schema(users()), schema(target));
    expect(warnings[0]!.message).toContain('primary key');
  });
});

describe('diffSchemas: enums', () => {
  const withEnum = (values: string[], name?: string): TableIR =>
    tbl('users', [id(), col('role', 'enum', { enumValues: values, ...(name ? { enumName: name } : {}) })]);

  it('creates named enums before the tables that use them', () => {
    const target: SchemaIR = { tables: [withEnum(['user', 'admin'])], enums: [{ name: 'users_role', values: ['user', 'admin'] }] };
    const { ops } = diffSchemas(schema(), target, { namedEnums: true });
    expect(kinds(ops)).toEqual(['createEnum', 'createTable']);
    expectConverges(schema(), target, ops, true);
  });

  it('collects enums from columns when the schema has no enums list', () => {
    const { ops } = diffSchemas(schema(), schema(withEnum(['a', 'b'], 'role_kind')), { namedEnums: true });
    expect(ops[0]).toEqual({ kind: 'createEnum', enum: { name: 'role_kind', values: ['a', 'b'] } });
  });

  it('alters a named enum with added values only', () => {
    const { ops, destructive, warnings } = diffSchemas(schema(withEnum(['user', 'admin'])), schema(withEnum(['user', 'admin', 'owner'])), { namedEnums: true });
    expect(ops).toEqual([
      { kind: 'alterEnum', name: 'users_role', from: ['user', 'admin'], to: ['user', 'admin', 'owner'], added: ['owner'], removed: [], columns: [{ table: 'users', column: 'role' }] },
    ]);
    expect(destructive).toBe(false);
    expect(warnings).toEqual([]);
  });

  it('warns when enum values are removed', () => {
    const { ops, destructive, warnings } = diffSchemas(schema(withEnum(['user', 'admin', 'guest'])), schema(withEnum(['user', 'admin'])), { namedEnums: true });
    expect(ops[0]).toMatchObject({ kind: 'alterEnum', removed: ['guest'] });
    expect(destructive).toBe(true);
    expect(warnings[0]!.message).toContain('guest');
  });

  it('drops named enums nobody uses anymore, last', () => {
    const live: SchemaIR = { tables: [withEnum(['a'])], enums: [{ name: 'users_role', values: ['a'] }, { name: 'old_kind', values: ['x'] }] };
    const { ops } = diffSchemas(live, schema(withEnum(['a'])), { namedEnums: true });
    expect(ops).toEqual([{ kind: 'dropEnum', enum: { name: 'old_kind', values: ['x'] } }]);
  });

  it('switches a column to another named enum', () => {
    const { ops } = diffSchemas(schema(withEnum(['a'])), schema(withEnum(['a'], 'kind')), { namedEnums: true });
    expect(kinds(ops)).toEqual(['createEnum', 'alterColumn', 'dropEnum']);
  });

  it('turns enum changes into column type changes without named enums', () => {
    const { ops, destructive } = diffSchemas(schema(withEnum(['a', 'b'])), schema(withEnum(['a', 'b', 'c'])));
    expect(kinds(ops)).toEqual(['alterColumn']);
    expect(destructive).toBe(false);
    const narrower = diffSchemas(schema(withEnum(['a', 'b'])), schema(withEnum(['a'])));
    expect(narrower.destructive).toBe(true);
  });
});

describe('orderTables', () => {
  it('is deterministic and stable by name', () => {
    const order = orderTables([tbl('c', [id()]), tbl('a', [id()]), tbl('b', [id()])]).order.map((t) => t.name);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('defers only the foreign keys inside a three table cycle', () => {
    const a = tbl('a', [id(), col('c_id', 'int')], { foreignKeys: [fk('a', 'c_id', 'c')] });
    const b = tbl('b', [id(), col('a_id', 'int')], { foreignKeys: [fk('b', 'a_id', 'a')] });
    const c = tbl('c', [id(), col('b_id', 'int')], { foreignKeys: [fk('c', 'b_id', 'b')] });
    const { order, deferred } = orderTables([c, b, a]);
    expect(order.map((t) => t.name)).toEqual(['a', 'b', 'c']);
    expect(deferred).toEqual([{ table: 'a', foreignKey: a.foreignKeys[0] }]);
  });
});

describe('ops helpers', () => {
  it('knows which type changes widen', () => {
    expect(isWidening(col('a', 'int'), col('a', 'bigint'))).toBe(true);
    expect(isWidening(col('a', 'bigint'), col('a', 'int'))).toBe(false);
    expect(isWidening(col('a', 'string', { length: 10 }), col('a', 'string', { length: 20 }))).toBe(true);
    expect(isWidening(col('a', 'string', { length: 20 }), col('a', 'string', { length: 10 }))).toBe(false);
    expect(isWidening(col('a', 'string'), col('a', 'text'))).toBe(true);
    expect(isWidening(col('a', 'int'), col('a', 'string', { length: 5 }))).toBe(false);
    expect(isWidening(col('a', 'decimal', { precision: 10, scale: 2 }), col('a', 'decimal', { precision: 12, scale: 4 }))).toBe(true);
    expect(isWidening(col('a', 'decimal', { precision: 10, scale: 2 }), col('a', 'decimal', { precision: 10, scale: 4 }))).toBe(false);
  });

  it('describes every op kind', () => {
    const ops: MigrationOp[] = [
      { kind: 'createTable', table: users() },
      { kind: 'dropTable', table: 'x' },
      { kind: 'renameTable', from: 'a', to: 'b' },
      { kind: 'addColumn', table: 't', column: col('c', 'int') },
      { kind: 'dropColumn', table: 't', column: 'c' },
      { kind: 'renameColumn', table: 't', from: 'a', to: 'b' },
      { kind: 'createIndex', table: 't', index: { name: 'i', columns: ['a', 'b'], unique: true } },
      { kind: 'dropIndex', table: 't', index: { name: 'i', columns: ['a'], unique: false } },
      { kind: 'addForeignKey', table: 't', foreignKey: fk('t', 'u_id', 'u') },
      { kind: 'dropForeignKey', table: 't', foreignKey: fk('t', 'u_id', 'u') },
      { kind: 'createEnum', enum: { name: 'e', values: ['a'] } },
      { kind: 'dropEnum', enum: { name: 'e', values: ['a'] } },
      { kind: 'alterEnum', name: 'e', from: ['a', 'b'], to: ['b', 'a'], added: [], removed: [], columns: [] },
      { kind: 'raw', sql: 'SELECT 1' },
    ];
    expect(ops.map(describeOp)).toMatchInlineSnapshot(`
      [
        "Create table users",
        "Drop table x",
        "Rename table a to b",
        "Add column t.c",
        "Drop column t.c",
        "Rename column t.a to b",
        "Create unique index i on t (a, b)",
        "Drop index i on t",
        "Add foreign key t_u_id_fkey on t (u_id) to u",
        "Drop foreign key t_u_id_fkey on t",
        "Create enum e (a)",
        "Drop enum e",
        "Alter enum e: reorder values",
        "Custom SQL",
      ]
    `);
  });

  it('applyOp leaves its input alone and follows renames into foreign keys', () => {
    const s = schema(users(), posts());
    const before = JSON.stringify(s);
    const next = applyOp(s, { kind: 'renameColumn', table: 'users', from: 'id', to: 'user_id' });
    expect(JSON.stringify(s)).toBe(before);
    expect(next.tables[1]!.foreignKeys[0]!.refColumns).toEqual(['user_id']);
    expect(next.tables[0]!.primaryKey).toEqual(['user_id']);
    const dropped = applyOp(s, { kind: 'dropColumn', table: 'posts', column: 'author_id' });
    expect(dropped.tables[1]!.foreignKeys).toEqual([]);
    expect(dropped.tables[1]!.indexes).toEqual([]);
    expect(() => applyOp(s, { kind: 'addColumn', table: 'nope', column: col('a', 'int') })).toThrow(/nope/);
  });
});

describe('convergence over many changes at once', () => {
  it('reaches the target schema', () => {
    const live = schema(users(), posts(), tbl('old_logs', [id(), col('line', 'text')]));
    const u = users();
    u.columns.push(col('created_at', 'datetime', { default: { kind: 'now' } }));
    u.columns[2] = col('name', 'string', { length: 120, nullable: true });
    const p = posts();
    p.columns.push(col('published', 'boolean', { default: { kind: 'value', value: false } }));
    p.indexes.push({ name: 'posts_title_key', columns: ['title'], unique: true });
    p.foreignKeys[0]!.onDelete = 'restrict';
    const tags = tbl('tags', [id(), col('label', 'string', { length: 50 })]);
    const postTags = tbl('post_tags', [col('post_id', 'int'), col('tag_id', 'int')], {
      primaryKey: ['post_id', 'tag_id'],
      foreignKeys: [fk('post_tags', 'post_id', 'posts'), fk('post_tags', 'tag_id', 'tags')],
    });
    const target = schema(postTags, tags, u, p);
    const { ops } = diffSchemas(live, target);
    expectConverges(live, target, ops);
    expect(ops.findIndex((o) => o.kind === 'createTable' && o.table.name === 'tags')).toBeLessThan(
      ops.findIndex((o) => o.kind === 'createTable' && o.table.name === 'post_tags'),
    );
  });
});
