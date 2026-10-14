/**
 * Postgres and CockroachDB specific behaviour against real servers: driver
 * quirks (json with postgres.js, local time zone date parsing), isolation
 * levels, error mapping, named enums and introspecting a schema kastor did
 * not write.
 */
import pg from 'pg';
import postgresJsDriver from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Adapter } from '../src/core/ir';
import { cockroach } from '../src/cockroach';
import { isKastorError, kastor, t, table, toSchemaIR } from '../src/index';
import { postgres, postgresJs } from '../src/postgres';
import { createSchema, dropSchema } from './pg-sqlite-shared';

const pgUrl = process.env.KASTOR_PG_URL;
const crdbUrl = process.env.KASTOR_COCKROACH_URL;

const things = table('pgd_things', {
  id: t.id(),
  name: t.string(50).unique(),
  doc: t.json<unknown>().nullable(),
  day: t.date().nullable(),
  at: t.datetime().nullable(),
  big: t.bigint().nullable(),
  mood: t.enum(['ok', 'meh']).default('ok'),
  amount: t.decimal(30, 10).nullable(),
});
const schema = { things };
const schemaIR = toSchemaIR(schema);

interface Target {
  name: string;
  url: string | undefined;
  make(): { adapter: Adapter; close(): Promise<void> };
}

const targets: Target[] = [
  {
    name: 'postgres (pg)',
    url: pgUrl,
    make() {
      const pool = new pg.Pool({ connectionString: pgUrl, max: 4 });
      return { adapter: postgres(pool), close: () => pool.end() };
    },
  },
  {
    name: 'postgres (postgres.js)',
    url: pgUrl,
    make() {
      const sql = postgresJsDriver(pgUrl!, { max: 4, onnotice: () => undefined });
      return { adapter: postgresJs(sql), close: () => sql.end({ timeout: 5 }) };
    },
  },
  {
    name: 'cockroach (pg)',
    url: crdbUrl,
    make() {
      const pool = new pg.Pool({ connectionString: crdbUrl, max: 4 });
      return { adapter: cockroach(pool), close: () => pool.end() };
    },
  },
];

for (const target of targets) {
  describe.skipIf(!target.url)(`pg family specifics: ${target.name}`, () => {
    let handle: ReturnType<Target['make']>;
    let db: ReturnType<typeof kastor<typeof schema>>;

    beforeAll(async () => {
      handle = target.make();
      await dropSchema(handle.adapter.executor, schemaIR, 'postgres');
      await createSchema(handle.adapter.dialect, handle.adapter.executor, schemaIR);
      db = kastor({ adapter: handle.adapter, schema });
    });

    afterAll(async () => {
      await dropSchema(handle.adapter.executor, schemaIR, 'postgres');
      await handle.close();
    });

    it('stores json values as json, not as quoted strings', async () => {
      for (const [name, doc] of [
        ['object', { a: [1, 'two', null], b: { c: true } }],
        ['array', [1, 2]],
        ['string', 'plain text'],
        ['number', 42],
      ] as const) {
        await db.things.create({ data: { name, doc } });
        const row = await db.things.findUnique({ where: { name } });
        expect(row!.doc).toEqual(doc);
      }
      const kinds = await db.$sql<{ name: string; kind: string }>`SELECT "name", jsonb_typeof("doc") AS "kind" FROM "pgd_things" ORDER BY "name"`;
      expect(Object.fromEntries(kinds.map((r) => [r.name, r.kind]))).toEqual({ array: 'array', number: 'number', object: 'object', string: 'string' });
    });

    it('reads dates without shifting them into the local time zone', async () => {
      await db.things.create({ data: { name: 'dated', day: '2024-03-01', at: new Date('2024-03-01T00:30:00.123Z') } });
      const row = await db.things.findUnique({ where: { name: 'dated' } });
      expect(row!.day).toBe('2024-03-01');
      expect(row!.at!.toISOString()).toBe('2024-03-01T00:30:00.123Z');
      const raw = await handle.adapter.executor.query(`SELECT '2024-03-01'::date AS d, '2024-03-01 00:30:00.5'::timestamp AS ts`, []);
      expect(raw.rows[0]).toEqual({ d: '2024-03-01', ts: new Date('2024-03-01T00:30:00.500Z') });
    });

    it('keeps bigints and wide decimals exact', async () => {
      await db.things.create({ data: { name: 'wide', big: 2n ** 62n + 1n, amount: '12345678901234567890.1234567891' } });
      const row = await db.things.findUnique({ where: { name: 'wide' } });
      expect(row!.big).toBe(2n ** 62n + 1n);
      expect(row!.amount).toBe('12345678901234567890.1234567891');
      const found = await db.things.findMany({ where: { big: { gt: 2n ** 62n } } });
      expect(found.map((r) => r.name)).toEqual(['wide']);
    });

    it('maps constraint errors to KastorError', async () => {
      await db.things.create({ data: { name: 'dup' } });
      const unique = await db.things.create({ data: { name: 'dup' } }).catch((e: unknown) => e);
      expect(isKastorError(unique, 'UNIQUE_VIOLATION')).toBe(true);
      expect((unique as Error).message).toContain('name');
      const badEnum = await handle.adapter.executor.query(`INSERT INTO "pgd_things" ("name", "mood") VALUES ('x', 'angry')`, []).catch((e: unknown) => e);
      expect(badEnum).toBeInstanceOf(Error);
    });

    it('runs serializable transactions and rolls back on error', async () => {
      await expect(
        db.$transaction(
          async (tx) => {
            await tx.things.create({ data: { name: 'tx-lost' } });
            throw new Error('abort');
          },
          { isolationLevel: 'serializable' },
        ),
      ).rejects.toThrow('abort');
      expect(await db.things.count({ where: { name: 'tx-lost' } })).toBe(0);
      const kept = await db.$transaction(async (tx) => tx.things.create({ data: { name: 'tx-kept' } }), { isolationLevel: 'serializable' });
      expect(kept.name).toBe('tx-kept');
    });

    it('keeps applied migrations in _kastor_migrations', async () => {
      // The bookkeeping table may be shared with other suites: only touch our own rows.
      const { dialect, executor } = handle.adapter;
      const tag = Math.random().toString(36).slice(2, 10);
      const first = `20260102030405_init_${tag}`;
      const second = `20260103000000_more_${tag}`;
      await dialect.migrationTable.ensure(executor);
      await dialect.migrationTable.ensure(executor);
      const appliedAt = new Date('2026-01-02T03:04:05.678Z');
      await dialect.migrationTable.record(executor, { id: first, checksum: 'abc', appliedAt });
      await dialect.migrationTable.record(executor, { id: second, checksum: 'def', appliedAt });
      const ours = async () => (await dialect.migrationTable.list(executor)).filter((m) => m.id.endsWith(tag));
      expect(await ours()).toEqual([
        { id: first, checksum: 'abc', appliedAt },
        { id: second, checksum: 'def', appliedAt },
      ]);
      await dialect.migrationTable.remove(executor, second);
      await dialect.migrationTable.remove(executor, first);
      expect(await ours()).toEqual([]);
    });

    it('runs concurrent transactions on separate connections', async () => {
      const names = Array.from({ length: 6 }, (_, i) => `par-${i}`);
      await Promise.all(names.map((name) => db.$transaction(async (tx) => tx.things.create({ data: { name } }))));
      expect(await db.things.count({ where: { name: { startsWith: 'par-' } } })).toBe(6);
    });
  });
}

describe.skipIf(!pgUrl)('postgres introspection of a hand written schema', () => {
  let pool: pg.Pool;
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: pgUrl, max: 2 });
  });
  afterAll(async () => {
    await pool.query('DROP TABLE IF EXISTS "pgd_legacy_child", "pgd_legacy" CASCADE');
    await pool.end();
  });

  it('reads serial keys, plain timestamps, arrays and skips partial indexes', async () => {
    await pool.query('DROP TABLE IF EXISTS "pgd_legacy_child", "pgd_legacy" CASCADE');
    await pool.query(`CREATE TABLE "pgd_legacy" (
      id serial PRIMARY KEY,
      code char(3) NOT NULL,
      small smallint DEFAULT 7,
      stamp timestamp DEFAULT now(),
      tags text[],
      price real,
      note varchar,
      CONSTRAINT pgd_legacy_code_key UNIQUE (code)
    )`);
    await pool.query(`CREATE INDEX pgd_legacy_partial ON "pgd_legacy" (small) WHERE small > 0`);
    await pool.query(`CREATE TABLE "pgd_legacy_child" (id bigserial PRIMARY KEY, parent int REFERENCES "pgd_legacy" (id) ON DELETE SET NULL)`);
    const live = await postgres(pool).dialect.introspect(postgres(pool).executor);
    const legacy = live.tables.find((tbl) => tbl.name === 'pgd_legacy')!;
    expect(legacy.columns).toEqual([
      { name: 'id', type: 'int', nullable: false, default: { kind: 'autoincrement' } },
      { name: 'code', type: 'string', nullable: false, nativeType: 'char(3)' },
      { name: 'small', type: 'int', nullable: true, nativeType: 'smallint', default: { kind: 'value', value: 7 } },
      { name: 'stamp', type: 'datetime', nullable: true, nativeType: 'timestamp(6)', default: { kind: 'now' } },
      { name: 'tags', type: 'text', nullable: true, nativeType: 'text[]' },
      { name: 'price', type: 'float', nullable: true, nativeType: 'real' },
      { name: 'note', type: 'string', nullable: true },
    ]);
    expect(legacy.primaryKey).toEqual(['id']);
    expect(legacy.indexes).toEqual([{ name: 'pgd_legacy_code_key', columns: ['code'], unique: true }]);
    const child = live.tables.find((tbl) => tbl.name === 'pgd_legacy_child')!;
    expect(child.columns[0]).toEqual({ name: 'id', type: 'bigint', nullable: false, default: { kind: 'autoincrement' } });
    expect(child.foreignKeys).toEqual([
      { name: 'pgd_legacy_child_parent_fkey', columns: ['parent'], refTable: 'pgd_legacy', refColumns: ['id'], onDelete: 'set null', onUpdate: 'no action' },
    ]);
    // referenced tables come first
    expect(live.tables.findIndex((tbl) => tbl.name === 'pgd_legacy')).toBeLessThan(live.tables.findIndex((tbl) => tbl.name === 'pgd_legacy_child'));
  });
});
