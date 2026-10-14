// MongoDB DDL, introspection, migration bookkeeping and raw commands against a real server.
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ColumnIR, SchemaIR, TableIR } from '../src/core/ir';
import { createMongoDialect, mongoExecutor, type MongoExecutor } from '../src/mongodb';
import { schema } from './mongo-fixture';

const url = process.env.KASTOR_MONGO_URL;

describe.skipIf(!url)('mongodb migrations and introspection', () => {
  let client: MongoClient;
  let exec: MongoExecutor;
  const dialect = createMongoDialect();
  const apply = async (op: Parameters<typeof dialect.ddl>[0], after: SchemaIR) => {
    for (const cmd of dialect.ddl(op, after)) await exec.query(cmd, []);
  };

  beforeAll(async () => {
    client = new MongoClient(url as string);
    await client.connect();
    exec = mongoExecutor(client.db('kastor_migrate'));
    await exec.db.dropDatabase();
  });
  afterAll(async () => {
    await exec.db.dropDatabase().catch(() => undefined);
    await client.close();
  });

  it('creates collections from the schema and reads the same schema back', async () => {
    for (const table of schema.tables) await apply({ kind: 'createTable', table }, schema);
    const live = await dialect.introspect(exec);
    const byName = (s: SchemaIR, n: string) => s.tables.find((t) => t.name === n) as TableIR;
    for (const table of schema.tables) {
      const got = byName(live, table.name);
      expect(got.primaryKey).toEqual(table.primaryKey);
      expect(got.indexes).toEqual(table.indexes);
      expect(got.columns.map((c) => c.name).sort()).toEqual(table.columns.map((c) => c.name).sort());
      for (const col of table.columns) {
        const g = got.columns.find((c) => c.name === col.name) as ColumnIR;
        expect({ name: g.name, type: g.type, nullable: g.nullable }).toEqual({ name: col.name, type: col.type, nullable: col.nullable });
      }
    }
    const users = byName(live, 'users');
    expect(users.columns.find((c) => c.name === 'email')?.length).toBe(255);
    expect(users.columns.find((c) => c.name === 'role')).toMatchObject({ enumValues: ['user', 'admin'], default: { kind: 'value', value: 'user' } });
    expect(users.columns.find((c) => c.name === 'score')).toMatchObject({ precision: 10, scale: 2 });
    expect(users.columns.find((c) => c.name === 'id')?.default).toEqual({ kind: 'autoincrement' });
  });

  it('adds, renames and drops fields on existing documents', async () => {
    const tags = schema.tables.find((t) => t.name === 'tags') as TableIR;
    await exec.db.collection('tags').insertMany([{ label: 'a' }, { label: 'b' }]);
    const color: ColumnIR = { name: 'color', type: 'string', nullable: false, default: { kind: 'value', value: 'red' } };
    const withColor: SchemaIR = { tables: [{ ...tags, columns: [...tags.columns, color] }] };
    await apply({ kind: 'addColumn', table: 'tags', column: color }, withColor);
    expect(await exec.db.collection('tags').countDocuments({ color: 'red' })).toBe(2);
    const renamed: SchemaIR = { tables: [{ ...tags, columns: [...tags.columns, { ...color, name: 'colour' }] }] };
    await apply({ kind: 'renameColumn', table: 'tags', from: 'color', to: 'colour' }, renamed);
    expect(await exec.db.collection('tags').countDocuments({ colour: 'red', color: { $exists: false } })).toBe(2);
    // the validator now requires colour
    await expect(exec.db.collection('tags').insertOne({ label: 'c' })).rejects.toMatchObject({ code: 121 });
    await apply({ kind: 'dropColumn', table: 'tags', column: 'colour' }, { tables: [tags] });
    expect(await exec.db.collection('tags').countDocuments({ colour: { $exists: true } })).toBe(0);
    await exec.db.collection('tags').insertOne({ label: 'c' });
  });

  it('creates and drops indexes, renames and drops collections', async () => {
    const idx = { name: 'tags_label_key', columns: ['label'], unique: true };
    await apply({ kind: 'createIndex', table: 'tags', index: idx }, schema);
    expect((await exec.db.collection('tags').listIndexes().toArray()).map((i) => i.name)).toContain('tags_label_key');
    await apply({ kind: 'dropIndex', table: 'tags', index: idx }, schema);
    expect((await exec.db.collection('tags').listIndexes().toArray()).map((i) => i.name)).not.toContain('tags_label_key');
    await apply({ kind: 'renameTable', from: 'tags', to: 'labels' }, schema);
    expect((await exec.db.listCollections({ name: 'labels' }).toArray()).length).toBe(1);
    await apply({ kind: 'dropTable', table: 'labels' }, schema);
    expect((await exec.db.listCollections({ name: 'labels' }).toArray()).length).toBe(0);
  });

  it('infers columns by sampling collections without a validator', async () => {
    await exec.db.collection('legacy').insertMany([
      { name: 'a', n: 1, at: new Date() },
      { name: 'b', n: 2, extra: { x: 1 } },
    ]);
    await exec.db.collection('legacy').createIndex({ name: 1 }, { unique: true, name: 'legacy_name_key' });
    const live = await dialect.introspect(exec);
    const legacy = live.tables.find((t) => t.name === 'legacy') as TableIR;
    expect(legacy.primaryKey).toEqual(['id']);
    expect(legacy.indexes).toEqual([{ name: 'legacy_name_key', columns: ['name'], unique: true }]);
    expect(legacy.columns.find((c) => c.name === 'n')).toEqual({ name: 'n', type: 'int', nullable: false });
    expect(legacy.columns.find((c) => c.name === 'extra')).toEqual({ name: 'extra', type: 'json', nullable: true });
  });

  it('keeps applied migrations in _kastor_migrations', async () => {
    const mt = dialect.migrationTable;
    await mt.ensure(exec);
    await mt.ensure(exec);
    const at = new Date('2026-01-01T00:00:00Z');
    await mt.record(exec, { id: '20260101000000_init', checksum: 'abc', appliedAt: at });
    await mt.record(exec, { id: '20260102000000_next', checksum: 'def', appliedAt: at });
    expect((await mt.list(exec)).map((m) => m.id)).toEqual(['20260101000000_init', '20260102000000_next']);
    await mt.remove(exec, '20260102000000_next');
    expect(await mt.list(exec)).toEqual([{ id: '20260101000000_init', checksum: 'abc', appliedAt: at }]);
    expect((await dialect.introspect(exec)).tables.map((t) => t.name)).not.toContain('_kastor_migrations');
  });

  it('runs JSON commands with parameters and drains cursors', async () => {
    const docs = Array.from({ length: 250 }, (_, i) => ({ i }));
    await exec.query('{"insert": "numbers", "documents": {"$param": 1}}', [docs]);
    const res = await exec.query('{"find": "numbers", "filter": {"i": {"$gte": {"$param": 1}}}, "batchSize": 50}', [10]);
    expect(res.rows.length).toBe(240);
    const del = await exec.query('{"delete": "numbers", "deletes": [{"q": {}, "limit": 0}]}', []);
    expect(del.rowsAffected).toBe(250);
    const script = dialect.splitScript!('{"create": "split_a"}\n-- comment\n{"create": "split_b"}\n');
    for (const cmd of script) await exec.query(cmd, []);
    expect((await exec.db.listCollections({ name: /^split_/ }).toArray()).length).toBe(2);
  });
});
