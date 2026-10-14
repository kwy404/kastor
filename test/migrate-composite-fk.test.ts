/**
 * Composite foreign keys (the `foreignKeys` table option) through the whole
 * migration path: SchemaIR, the diff, DDL on SQLite, introspection, db pull
 * code generation and migrate dev.
 */
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { SchemaIR, TableIR } from '../src/core/ir';
import { foreignKey, index, one, t, table, type AnyColumn } from '../src/core/schema';
import { toSchemaIR } from '../src/core/schema-ir';
import { kastor } from '../src/index';
import { generateSchema } from '../src/migrate/codegen';
import { importModule } from '../src/migrate/config';
import { diffSchemas } from '../src/migrate/diff';
import { dev, introspect, push } from '../src/migrate/engine';
import { sqlite } from '../src/sqlite';

const root = resolve('.');
const posix = (p: string): string => p.replace(/\\/g, '/');
mkdirSync(join(root, '.kastor'), { recursive: true });
const tmp = mkdtempSync(join(root, '.kastor', 'composite-fk-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function schema(options: { onDelete?: 'cascade' | 'restrict'; withFk?: boolean; extraFk?: boolean } = {}): SchemaIR {
  const lines = table(
    'lines',
    { orderId: t.int(), productId: t.string(40), quantity: t.int() },
    { primaryKey: (c) => [c.orderId, c.productId] },
  );
  const reviews = table(
    'reviews',
    { id: t.id(), orderId: t.int(), productId: t.string(40), parentOrderId: t.int().nullable(), parentProductId: t.string(40).nullable(), rating: t.int() },
    {
      indexes: (c) => [index(c.orderId, c.productId)],
      foreignKeys: (c) => [
        ...(options.withFk === false ? [] : [foreignKey([c.orderId, c.productId], () => [lines.orderId, lines.productId], { onDelete: options.onDelete ?? 'cascade' })]),
        ...(options.extraFk ? [foreignKey([c.parentOrderId, c.parentProductId], (): AnyColumn[] => [lines.orderId, lines.productId], { onDelete: 'set null', name: 'reviews_parent_fkey' })] : []),
      ],
    },
  );
  return toSchemaIR({ lines, reviews });
}

describe('composite foreign keys in the diff', () => {
  it('declares them in SchemaIR after the one column keys', () => {
    const reviews = schema({ extraFk: true }).tables.find((x) => x.name === 'reviews')!;
    expect(reviews.foreignKeys).toEqual([
      { name: 'reviews_orderId_productId_fkey', columns: ['orderId', 'productId'], refTable: 'lines', refColumns: ['orderId', 'productId'], onDelete: 'cascade', onUpdate: 'no action' },
      { name: 'reviews_parent_fkey', columns: ['parentOrderId', 'parentProductId'], refTable: 'lines', refColumns: ['orderId', 'productId'], onDelete: 'set null', onUpdate: 'no action' },
    ]);
  });

  it('creates, keeps, changes and drops them', () => {
    const base = schema();
    expect(diffSchemas(base, schema()).ops).toEqual([]);
    const created = diffSchemas({ tables: [] }, base).ops;
    expect(created.map((o) => o.kind)).toEqual(['createTable', 'createTable']);
    expect((created[1] as { table: TableIR }).table.foreignKeys[0]!.columns).toEqual(['orderId', 'productId']);
    const added = diffSchemas(schema({ withFk: false }), base).ops;
    expect(added).toEqual([{ kind: 'addForeignKey', table: 'reviews', foreignKey: base.tables[1]!.foreignKeys[0] }]);
    const dropped = diffSchemas(base, schema({ withFk: false })).ops;
    expect(dropped.map((o) => o.kind)).toEqual(['dropForeignKey']);
    const changed = diffSchemas(base, schema({ onDelete: 'restrict' })).ops;
    expect(changed.map((o) => o.kind)).toEqual(['dropForeignKey', 'addForeignKey']);
    // Column order matters: (productId, orderId) is another key.
    const swapped: SchemaIR = JSON.parse(JSON.stringify(base));
    const fk = swapped.tables[1]!.foreignKeys[0]!;
    fk.columns.reverse();
    fk.refColumns.reverse();
    expect(diffSchemas(base, swapped).ops.map((o) => o.kind)).toEqual(['dropForeignKey', 'addForeignKey']);
  });

  it('runs on SQLite, reads back equal, and db pull writes them with foreignKey()', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    const adapter = sqlite(db);
    const target = schema({ extraFk: true });
    expect((await push(adapter, target)).kind).toBe('pushed');
    const live = await introspect(adapter);
    expect(diffSchemas(live, target, { dialect: adapter.dialect }).ops).toEqual([]);
    expect(live.tables.find((x) => x.name === 'reviews')!.foreignKeys.map((f) => f.columns)).toEqual(
      expect.arrayContaining([
        ['orderId', 'productId'],
        ['parentOrderId', 'parentProductId'],
      ]),
    );

    const { code, notes } = generateSchema(live, { dialect: adapter.dialect, importFrom: posix(join(root, 'src/index')), date: new Date(Date.UTC(2026, 0, 1)) });
    expect(notes).toEqual([]);
    expect(code).toContain("import { table, t, index, foreignKey, one, many } from");
    expect(code).toContain("foreignKey([c.orderId, c.productId], () => [lines.orderId, lines.productId], { onDelete: 'cascade' })");
    expect(code).toContain("foreignKey([c.parentOrderId, c.parentProductId], () => [lines.orderId, lines.productId], { onDelete: 'set null', name: 'reviews_parent_fkey' })");
    expect(code).toContain("line: one(lines, { fields: ['orderId', 'productId'], references: ['orderId', 'productId'] }),");
    const file = join(tmp, 'pulled.ts');
    writeFileSync(file, code);
    const mod = await importModule(file);
    // Loaded through jiti, like the CLI loads schemas: foreignKey() comes from another module copy.
    const pulledSchema = mod.schema as Record<string, unknown>;
    expect(diffSchemas(live, toSchemaIR(pulledSchema), { dialect: adapter.dialect }).ops).toEqual([]);

    // The client follows the composite key, and the database enforces it.
    const client = kastor({ adapter, schema: pulledSchema as never, relations: mod.relations as never }) as any;
    await client.lines.create({ data: { orderId: 1, productId: 'p1', quantity: 2 } });
    await client.reviews.create({ data: { orderId: 1, productId: 'p1', rating: 5 } });
    const found = await client.reviews.findFirst({ include: { line: true } });
    expect(found.line.quantity).toBe(2);
    await expect(client.reviews.create({ data: { orderId: 2, productId: 'p1', rating: 1 } })).rejects.toMatchObject({ code: 'FOREIGN_KEY_VIOLATION' });
    await client.lines.delete({ where: { orderId: 1, productId: 'p1' } });
    expect(await client.reviews.count()).toBe(0);
    db.close();
  });

  it('migrate dev writes ADD and DROP for composite keys and is in sync afterwards', async () => {
    const dir = join(tmp, 'migrations');
    const db = new Database(':memory:');
    const adapter = sqlite(db);
    const first = await dev(adapter, schema({ withFk: false }), dir, { version: 'test', name: 'init' });
    expect(first.kind).toBe('created');
    const second = await dev(adapter, schema(), dir, { version: 'test', name: 'add_fk' });
    expect(second.kind).toBe('created');
    if (second.kind === 'created') {
      expect(second.diff.ops.map((o) => o.kind)).toEqual(['addForeignKey']);
      expect(second.migration.sql).toContain('FOREIGN KEY ("orderId", "productId") REFERENCES "lines" ("orderId", "productId")');
    }
    expect((await dev(adapter, schema(), dir, { version: 'test' })).kind).toBe('in-sync');
    const third = await dev(adapter, schema({ onDelete: 'restrict' }), dir, { version: 'test', name: 'restrict' });
    expect(third.kind === 'created' && third.diff.ops.map((o) => o.kind)).toEqual(['dropForeignKey', 'addForeignKey']);
    expect((await dev(adapter, schema({ onDelete: 'restrict' }), dir, { version: 'test' })).kind).toBe('in-sync');
    db.close();
  });

  it('a one() over a composite key keeps working through relations', () => {
    const parents = table('parents', { a: t.int(), b: t.int() }, { primaryKey: (c) => [c.a, c.b] });
    const kids = table('kids', { id: t.id(), a: t.int(), b: t.int() }, { foreignKeys: (c) => [foreignKey([c.a, c.b], () => [parents.a, parents.b])] });
    const db = kastor({
      adapter: sqlite(new Database(':memory:')),
      schema: { parents, kids },
      relations: ({ parents: p }) => ({ kids: { parent: one(p, { fields: ['a', 'b'], references: ['a', 'b'] }) } }),
    });
    expect(() => db.kids.findMany({ include: { parent: true } }).toSQL()).not.toThrow();
  });
});
