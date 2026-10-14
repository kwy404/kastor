import { describe, expect, it } from 'vitest';
import { index, isKastorError, KastorError, many, one, t, table, toSchemaIR, uniqueIndex, type AnyColumn } from '../src/index';
import { buildModels } from '../src/core/model';
import { constraintName, sortByDependencies } from '../src/core/schema-ir';
import { fixture } from './helpers/fixture';

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (isKastorError(e)) return e.code;
    throw e;
  }
  return 'NO_ERROR';
}

describe('column builders', () => {
  it('are immutable', () => {
    const base = t.string(20);
    const nullable = base.nullable();
    expect(base.config.nullable).toBe(false);
    expect(nullable.config.nullable).toBe(true);
    expect(nullable.config.length).toBe(20);
  });

  it('record defaults', () => {
    expect(t.int().default(3).config.default).toEqual({ kind: 'value', value: 3 });
    expect(t.datetime().default(new Date('2020-01-01T00:00:00Z')).config.default).toEqual({ kind: 'value', value: '2020-01-01T00:00:00.000Z' });
    expect(t.bigint().default(5n).config.default).toEqual({ kind: 'value', value: '5' });
    expect(t.bytes().default(new Uint8Array([1, 2])).config.default).toEqual({ kind: 'value', value: [1, 2] });
    const fn = () => 'x';
    expect(t.string().default(fn).config.defaultFn).toBe(fn);
    expect(t.datetime().defaultNow().config.default).toEqual({ kind: 'now' });
    expect(t.uuid().defaultRandom().config.default).toEqual({ kind: 'random' });
    expect(t.int().defaultSql('42').config.default).toEqual({ kind: 'sql', value: '42' });
    expect(t.id().config).toMatchObject({ type: 'int', primaryKey: true, default: { kind: 'autoincrement' } });
    expect(t.bigId().config.type).toBe('bigint');
  });

  it('reject impossible definitions', () => {
    expect(code(() => t.int().defaultNow())).toBe('SCHEMA_INVALID');
    expect(code(() => t.string().defaultRandom())).toBe('SCHEMA_INVALID');
    expect(code(() => t.string(0))).toBe('SCHEMA_INVALID');
    expect(code(() => t.decimal(5, 6))).toBe('SCHEMA_INVALID');
    expect(code(() => t.enum([] as unknown as ['a']))).toBe('SCHEMA_INVALID');
    expect(code(() => t.enum(['a', 'a']))).toBe('SCHEMA_INVALID');
  });

  it('carry enum names, native types and mapped names', () => {
    const c = t.enum(['a', 'b'], 'my_enum').nativeType('text').map('kind');
    expect(c.config).toMatchObject({ enumValues: ['a', 'b'], enumName: 'my_enum', nativeType: 'text', dbName: 'kind' });
    expect(t.string().$type<'x'>().config.type).toBe('string');
  });
});

describe('table()', () => {
  it('binds columns to the table and exposes metadata', () => {
    const things = table('things', { id: t.id(), label: t.string().map('the_label') });
    expect(things.label.tableName).toBe('things');
    expect(things.label.name).toBe('the_label');
    expect(things.$table.name).toBe('things');
    expect(Object.keys(things)).toEqual(['id', 'label']);
  });

  it('validates names and soft delete columns', () => {
    expect(code(() => table('', { id: t.id() }))).toBe('SCHEMA_INVALID');
    expect(code(() => table('x', {}))).toBe('SCHEMA_INVALID');
    expect(code(() => table('x', { id: 'nope' as unknown as AnyColumn }))).toBe('SCHEMA_INVALID');
    expect(code(() => table('x', { $table: t.id() }))).toBe('SCHEMA_INVALID');
    expect(code(() => table('x', { a: t.int(), b: t.int().map('a') }))).toBe('SCHEMA_INVALID');
    expect(code(() => table('x', { id: t.id(), gone: t.datetime() }, { softDelete: 'gone' }))).toBe('SCHEMA_INVALID');
    expect(code(() => table('x', { id: t.id() }, { softDelete: 'missing' as 'id' }))).toBe('SCHEMA_INVALID');
    expect(code(() => index())).toBe('SCHEMA_INVALID');
  });
});

describe('toSchemaIR', () => {
  it('converts the fixture with keys, indexes, foreign keys and enums', () => {
    const ir = toSchemaIR(fixture.schema);
    expect(ir.tables.map((tb) => tb.name)).toEqual(['users', 'profiles', 'posts', 'tags', 'post_tags', 'comments']);
    const posts = ir.tables.find((tb) => tb.name === 'posts')!;
    expect(posts.primaryKey).toEqual(['id']);
    expect(posts.indexes).toEqual([
      { name: 'posts_author_id_idx', columns: ['author_id'], unique: false },
      { name: 'posts_author_id_title_key', columns: ['author_id', 'title'], unique: true },
    ]);
    expect(posts.foreignKeys).toEqual([
      { name: 'posts_author_id_fkey', columns: ['author_id'], refTable: 'users', refColumns: ['id'], onDelete: 'cascade', onUpdate: 'no action' },
    ]);
    const users = ir.tables.find((tb) => tb.name === 'users')!;
    expect(users.columns.find((c) => c.name === 'role')).toEqual({ name: 'role', type: 'enum', nullable: false, default: { kind: 'value', value: 'user' }, enumValues: ['user', 'admin'], enumName: 'users_role' });
    expect(users.indexes).toEqual([{ name: 'users_email_key', columns: ['email'], unique: true }]);
    expect(ir.enums).toEqual([{ name: 'users_role', values: ['user', 'admin'] }]);
    const joins = ir.tables.find((tb) => tb.name === 'post_tags')!;
    expect(joins.primaryKey).toEqual(['post_id', 'tag_id']);
  });

  it('accepts arrays and module namespaces and ignores other exports', () => {
    const a = table('a', { id: t.id() });
    expect(toSchemaIR([a]).tables).toHaveLength(1);
    expect(toSchemaIR({ a, helper: () => 1, value: 3 } as Record<string, unknown>).tables).toHaveLength(1);
  });

  it('reports schema mistakes', () => {
    const a = table('a', { id: t.id() });
    const b = table('b', { id: t.id(), aId: t.int().references(() => a.id) });
    expect(code(() => toSchemaIR({ b }))).toBe('SCHEMA_INVALID');
    expect(code(() => toSchemaIR({ a, a2: table('a', { id: t.id() }) }))).toBe('SCHEMA_INVALID');
    expect(code(() => toSchemaIR({ x: table('x', { a: t.int().primaryKey(), b: t.int().primaryKey() }) }))).toBe('SCHEMA_INVALID');
    expect(code(() => toSchemaIR({ x: table('x', { a: t.int().primaryKey(), b: t.int() }, { primaryKey: (c) => [c.a, c.b] }) }))).toBe('SCHEMA_INVALID');
    expect(code(() => toSchemaIR({ x: table('x', { a: t.int(), b: t.int() }, { indexes: (c) => [index(c.a).name('dup'), uniqueIndex(c.b).name('dup')] }) }))).toBe('SCHEMA_INVALID');
    expect(code(() => toSchemaIR({ x: table('x', { a: t.int() }, { indexes: () => [index(a.id)] }) }))).toBe('SCHEMA_INVALID');
    expect(code(() => toSchemaIR({ x: table('x', { a: t.enum(['p']).map('e1').$type<'p'>(), b: t.enum(['q'], 'x_e1') }), y: table('y', { e: t.enum(['z'], 'x_e1') }) }))).toBe('SCHEMA_INVALID');
  });

  it('shortens long constraint names with a stable hash', () => {
    const name = constraintName('a'.repeat(40), 'b'.repeat(40), 'fkey');
    expect(name.length).toBeLessThanOrEqual(63);
    expect(name).toBe(constraintName('a'.repeat(40), 'b'.repeat(40), 'fkey'));
    expect(constraintName('t', 'c', 'key')).toBe('t_c_key');
  });

  it('orders tables so referenced tables come first, tolerating cycles', () => {
    const ir = toSchemaIR(fixture.schema);
    const shuffled = [...ir.tables].reverse();
    expect(sortByDependencies(shuffled).map((tb) => tb.name).indexOf('users')).toBeLessThan(sortByDependencies(shuffled).map((tb) => tb.name).indexOf('posts'));
    const cyc = sortByDependencies([
      { name: 'p', columns: [], primaryKey: [], indexes: [], foreignKeys: [{ name: 'f', columns: [], refTable: 'q', refColumns: [], onDelete: 'no action', onUpdate: 'no action' }] },
      { name: 'q', columns: [], primaryKey: [], indexes: [], foreignKeys: [{ name: 'g', columns: [], refTable: 'p', refColumns: [], onDelete: 'no action', onUpdate: 'no action' }] },
    ]);
    expect(cyc.map((tb) => tb.name).sort()).toEqual(['p', 'q']);
  });
});

describe('relations', () => {
  it('resolves direct, reverse, many-to-many and self relations', () => {
    const models = buildModels(fixture.schema, fixture.relations);
    const users = models.model('users');
    expect(users.relations.get('profile')).toMatchObject({ kind: 'one', owner: false, nullable: true, fromFields: ['id'], toFields: ['userId'] });
    expect(users.relations.get('posts')!.ir).toMatchObject({ cardinality: 'many', from: 'users', to: 'posts', fromColumns: ['id'], toColumns: ['author_id'] });
    const posts = models.model('posts');
    expect(posts.relations.get('author')).toMatchObject({ owner: true, nullable: false });
    expect(posts.relations.get('tags')!.ir.through).toEqual({ table: 'post_tags', sourceColumns: ['post_id'], targetColumns: ['tag_id'] });
    const comments = models.model('comments');
    expect(comments.relations.get('parent')).toMatchObject({ owner: true, nullable: true });
    expect(comments.relations.get('replies')!.ir).toMatchObject({ fromColumns: ['id'], toColumns: ['parent_id'] });
    expect(posts.relations.get('comments')!.ir.softDeleteColumn).toBe('deleted_at');
  });

  it('infers relations from foreign keys when no config is given', () => {
    const a = table('a', { id: t.id() });
    const b = table('b', { id: t.id(), aId: t.int().references(() => a.id) });
    const models = buildModels({ a, b }, () => ({ a: { bs: many(b) }, b: { a: one(a) } }));
    expect(models.model('a').relations.get('bs')!.toFields).toEqual(['aId']);
    expect(models.model('b').relations.get('a')).toMatchObject({ owner: true, fromFields: ['aId'] });
  });

  it('explains ambiguous or broken relations', () => {
    const a = table('a', { id: t.id() });
    const b = table('b', { id: t.id(), x: t.int().references(() => a.id), y: t.int().references(() => a.id) });
    const c = table('c', { id: t.id() });
    const err = (fn: () => unknown): KastorError => {
      try {
        fn();
      } catch (e) {
        return e as KastorError;
      }
      throw new Error('no error');
    };
    expect(err(() => buildModels({ a, b }, () => ({ a: { bs: many(b) } }))).code).toBe('RELATION_AMBIGUOUS');
    expect(err(() => buildModels({ a, c }, () => ({ a: { c: one(c) } }))).code).toBe('RELATION_AMBIGUOUS');
    expect(err(() => buildModels({ a }, () => ({ a: { c: one(c) } }))).code).toBe('SCHEMA_INVALID');
    expect(err(() => buildModels({ a }, () => ({ z: {} }))).code).toBe('UNKNOWN_MODEL');
    expect(err(() => buildModels({ a, b }, () => ({ a: { id: many(b, { fields: ['id'], references: ['x'] }) } }))).code).toBe('SCHEMA_INVALID');
    expect(err(() => buildModels({ a, b }, () => ({ b: { a: one(a, { fields: ['nope'], references: ['id'] }) } }))).code).toBe('UNKNOWN_FIELD');
    expect(err(() => buildModels({ a }, () => ({ a: { x: 1 as never } }))).code).toBe('SCHEMA_INVALID');
    expect(err(() => buildModels({})).code).toBe('SCHEMA_INVALID');
    expect(err(() => one({} as never)).code).toBe('SCHEMA_INVALID');
    expect(err(() => one(a, { fields: ['x'], references: [] as never })).code).toBe('SCHEMA_INVALID');
    expect(err(() => many(a, { fields: ['x'] })).code).toBe('SCHEMA_INVALID');
    const hint = err(() => buildModels({ a, b }, () => ({ a: { bs: many(b) } }))).hint;
    expect(hint).toContain('many(');
  });
});
