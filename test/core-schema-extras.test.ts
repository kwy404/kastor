/**
 * Composite foreign keys, back sides named with `from`, and `.updatedAt()`.
 */
import { describe, expect, it } from 'vitest';
import { foreignKey, isKastorError, kastor, KastorError, many, one, t, table, toSchemaIR } from '../src/index';
import { buildModels } from '../src/core/model';
import { memorySqlite } from './helpers/sqlite-memory';

function failure(fn: () => unknown): KastorError {
  try {
    fn();
  } catch (e) {
    if (isKastorError(e)) return e;
    throw e;
  }
  throw new Error('expected a KastorError');
}

const orders = table('orders', { shop: t.int(), number: t.int(), total: t.int() }, { primaryKey: (c) => [c.shop, c.number] });
const lines = table(
  'order_lines',
  { id: t.id(), shop: t.int().map('shop_id'), number: t.int().map('order_number'), sku: t.string(20) },
  { foreignKeys: (c) => [foreignKey([c.shop, c.number], () => [orders.shop, orders.number], { onDelete: 'cascade', onUpdate: 'cascade' })] },
);

describe('composite foreign keys', () => {
  it('flow into SchemaIR with names and actions', () => {
    const ir = toSchemaIR({ lines, orders });
    expect(ir.tables.map((tb) => tb.name)).toEqual(['orders', 'order_lines']);
    expect(ir.tables[1]!.foreignKeys).toEqual([
      { name: 'order_lines_shop_id_order_number_fkey', columns: ['shop_id', 'order_number'], refTable: 'orders', refColumns: ['shop', 'number'], onDelete: 'cascade', onUpdate: 'cascade' },
    ]);
    const named = table('x', { a: t.int(), b: t.int() }, { foreignKeys: (c) => [foreignKey([c.a, c.b], () => [orders.shop, orders.number], { name: 'x_order' })] });
    expect(toSchemaIR({ orders, named }).tables[1]!.foreignKeys[0]).toMatchObject({ name: 'x_order', onDelete: 'no action', onUpdate: 'no action' });
  });

  it('let relations be inferred and still accept explicit fields', () => {
    const inferred = buildModels({ orders, lines }, () => ({ orders: { lines: many(lines) }, lines: { order: one(orders) } }));
    expect(inferred.model('orders').relations.get('lines')).toMatchObject({ fromFields: ['shop', 'number'], toFields: ['shop', 'number'] });
    expect(inferred.model('lines').relations.get('order')).toMatchObject({ owner: true, nullable: false });
    const explicit = buildModels({ orders, lines }, () => ({ lines: { order: one(orders, { fields: ['shop', 'number'], references: ['shop', 'number'] }) } }));
    expect(explicit.model('lines').relations.get('order')!.ir.fromColumns).toEqual(['shop_id', 'order_number']);
  });

  it('load and cascade on a real database', async () => {
    const mem = memorySqlite();
    const schema = { orders, lines };
    await mem.reset(toSchemaIR(schema));
    // The owning side names its columns so the types know which ones a nested create fills in.
    const db = kastor({
      adapter: mem.adapter,
      schema,
      relations: () => ({ orders: { lines: many(lines) }, lines: { order: one(orders, { fields: ['shop', 'number'], references: ['shop', 'number'] }) } }),
    });
    await db.orders.create({ data: { shop: 1, number: 7, total: 30, lines: { create: [{ sku: 'a' }, { sku: 'b' }] } } });
    const order = await db.orders.findUniqueOrThrow({ where: { shop: 1, number: 7 }, include: { lines: { orderBy: { sku: 'asc' } } } });
    expect(order.lines.map((l) => [l.shop, l.number, l.sku])).toEqual([
      [1, 7, 'a'],
      [1, 7, 'b'],
    ]);
    await expect(db.lines.create({ data: { shop: 1, number: 8, sku: 'c' } })).rejects.toMatchObject({ code: 'FOREIGN_KEY_VIOLATION' });
    await db.orders.delete({ where: { shop: 1, number: 7 } });
    expect(await db.lines.count()).toBe(0);
    await mem.close();
  });

  it('reject broken definitions', () => {
    expect(failure(() => foreignKey([], () => [])).code).toBe('SCHEMA_INVALID');
    expect(failure(() => foreignKey([orders.shop], [orders.shop] as never)).code).toBe('SCHEMA_INVALID');
    const short = table('s', { a: t.int(), b: t.int() }, { foreignKeys: (c) => [foreignKey([c.a, c.b], () => [orders.shop])] });
    expect(failure(() => toSchemaIR({ orders, short })).code).toBe('SCHEMA_INVALID');
    const other = table('other', { id: t.id() });
    const mixed = table('m', { a: t.int(), b: t.int() }, { foreignKeys: (c) => [foreignKey([c.a, c.b], () => [orders.shop, other.id])] });
    expect(failure(() => toSchemaIR({ orders, other, mixed })).code).toBe('SCHEMA_INVALID');
    const foreign = table('f', { a: t.int() }, { foreignKeys: () => [foreignKey([orders.shop], () => [orders.shop])] });
    expect(failure(() => toSchemaIR({ orders, foreign })).code).toBe('SCHEMA_INVALID');
    const notBuilder = table('n', { a: t.int() }, { foreignKeys: () => [{} as never] });
    expect(failure(() => toSchemaIR({ notBuilder })).code).toBe('SCHEMA_INVALID');
    const twice = table('w', { a: t.int().references(() => orders.shop, { name: 'dup' }) }, { foreignKeys: (c) => [foreignKey([c.a], () => [orders.shop], { name: 'dup' })] });
    expect(failure(() => toSchemaIR({ orders, twice })).code).toBe('SCHEMA_INVALID');
  });
});

describe('back sides named with from', () => {
  const people = table('people', {
    id: t.id(),
    partnerId: t.int().nullable().map('partner_id'),
    managerId: t.int().nullable().map('manager_id'),
  });

  it('resolve self relations and repeated links', () => {
    const models = buildModels({ people }, (s) => ({
      people: {
        partner: one(s.people, { fields: ['partnerId'], references: ['id'] }),
        partnerOf: one(s.people, { from: 'partner' }),
        manager: one(s.people, { fields: ['managerId'], references: ['id'] }),
        reports: many(s.people, { from: 'manager' }),
      },
    }));
    const m = models.model('people');
    expect(m.relationKeys).toEqual(['partner', 'partnerOf', 'manager', 'reports']);
    expect(m.relations.get('partnerOf')).toMatchObject({ kind: 'one', owner: false, nullable: true, fromFields: ['id'], toFields: ['partnerId'] });
    expect(m.relations.get('reports')!.ir).toMatchObject({ cardinality: 'many', fromColumns: ['id'], toColumns: ['manager_id'] });
  });

  it('work end to end', async () => {
    const mem = memorySqlite();
    await mem.reset(toSchemaIR({ people }));
    const db = kastor({
      adapter: mem.adapter,
      schema: { people },
      relations: (s) => ({
        people: {
          partner: one(s.people, { fields: ['partnerId'], references: ['id'] }),
          partnerOf: one(s.people, { from: 'partner' }),
          manager: one(s.people, { fields: ['managerId'], references: ['id'] }),
          reports: many(s.people, { from: 'manager' }),
        },
      }),
    });
    const boss = await db.people.create({ data: {} });
    const a = await db.people.create({ data: { manager: { connect: { id: boss.id } } } });
    const b = await db.people.create({ data: { managerId: boss.id, partner: { connect: { id: a.id } } } });
    const read = await db.people.findUniqueOrThrow({ where: { id: a.id }, include: { partnerOf: true, partner: true } });
    expect(read.partnerOf?.id).toBe(b.id);
    expect(read.partner).toBeNull();
    const bossRead = await db.people.findUniqueOrThrow({ where: { id: boss.id }, include: { reports: { orderBy: { id: 'asc' } }, partnerOf: true } });
    expect(bossRead.reports.map((p) => p.id)).toEqual([a.id, b.id]);
    expect(bossRead.partnerOf).toBeNull();
    await mem.close();
  });

  it('explain wrong owners', () => {
    const users = table('users', { id: t.id() });
    const posts = table('posts', { id: t.id(), authorId: t.int(), editorId: t.int() });
    const base = (extra: object) => (): never => ({ posts: { author: one(users, { fields: ['authorId'], references: ['id'] }), editor: one(users, { fields: ['editorId'], references: ['id'] }) }, users: extra }) as never;
    expect(failure(() => buildModels({ users, posts }, base({ edited: many(posts, { from: 'nope' }) }))).hint).toContain('"author", "editor"');
    const backOfBack = () => ({ users: { me: one(users, { from: 'x' }) } });
    expect(failure(() => buildModels({ users }, backOfBack)).code).toBe('SCHEMA_INVALID');
    expect(failure(() => buildModels({ users, posts }, () => ({ posts: { author: one(users, { fields: ['authorId'], references: ['id'] }) }, users: { posts: many(posts, { from: 'author' }), again: one(posts, { from: 'posts' }) } }))).code).toBe('SCHEMA_INVALID');
    expect(failure(() => one(users, { from: '' })).code).toBe('SCHEMA_INVALID');
    expect(failure(() => many(users, { from: 'x', fields: ['id'], references: ['id'] } as never)).code).toBe('SCHEMA_INVALID');
    const linked = table('linked', { id: t.id(), a: t.int().references(() => users.id), b: t.int().references(() => users.id) });
    expect(failure(() => buildModels({ users, linked }, () => ({ users: { linked: one(linked) } }))).hint).toContain('from:');
  });
});

describe('updatedAt', () => {
  it('is a modifier for time columns that makes the column optional on insert', () => {
    expect(t.datetime().updatedAt().config.updatedAt).toBe(true);
    expect(failure(() => t.int().updatedAt()).code).toBe('SCHEMA_INVALID');
  });

  it('is set on create and on every update kind, without touching SchemaIR', async () => {
    const notes = table('notes', {
      id: t.id(),
      body: t.text(),
      touched: t.datetime().updatedAt(),
      day: t.date().nullable().updatedAt(),
      removed: t.datetime().nullable(),
    }, { softDelete: 'removed' });
    expect(toSchemaIR({ notes }).tables[0]!.columns.find((c) => c.name === 'touched')).toEqual({ name: 'touched', type: 'datetime', nullable: false });
    const mem = memorySqlite();
    await mem.reset(toSchemaIR({ notes }));
    const db = kastor({ adapter: mem.adapter, schema: { notes } });
    const past = new Date('2001-01-01T00:00:00Z');
    const n = await db.notes.create({ data: { body: 'x' } });
    expect(n.touched).toBeInstanceOf(Date);
    expect(n.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const reset = async () => db.notes.update({ where: { id: n.id }, data: { touched: past } });
    await reset();
    expect((await db.notes.update({ where: { id: n.id }, data: { body: 'y' } })).touched.getTime()).toBeGreaterThan(past.getTime());
    await reset();
    await db.notes.updateMany({ data: { body: 'z' } });
    expect((await db.notes.findUniqueOrThrow({ where: { id: n.id } })).touched.getTime()).toBeGreaterThan(past.getTime());
    await reset();
    await db.notes.update({ where: { id: n.id }, data: {} });
    expect((await db.notes.findUniqueOrThrow({ where: { id: n.id } })).touched.getTime()).toBe(past.getTime());
    await db.notes.delete({ where: { id: n.id } });
    const deleted = await db.notes.findUniqueOrThrow({ where: { id: n.id }, withDeleted: true });
    expect(deleted.touched.getTime()).toBeGreaterThan(past.getTime());
    await mem.close();
  });
});
