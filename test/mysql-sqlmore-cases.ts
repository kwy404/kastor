/**
 * Dialect specific cases shared by the MySQL, MariaDB, SQL Server and Oracle
 * integration tests: value round trips for every neutral type, text matching
 * under case insensitive collations, wildcard escaping, transactions, error
 * mapping, upserts, paged includes and raw SQL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Adapter } from '../src/core/ir';
import { isKastorError, kastor, many, one, sql, t, table, toSchemaIR } from '../src/index';
import { resetWithDdl } from './helpers/conformance';

export const kinds = table('sm_kinds', {
  id: t.id(),
  label: t.string(100),
  note: t.text().nullable(),
  count: t.int().nullable(),
  big: t.bigint().nullable(),
  ratio: t.float().nullable(),
  price: t.decimal(30, 10).nullable(),
  flag: t.boolean().default(false),
  at: t.datetime().nullable(),
  day: t.date().nullable(),
  clock: t.time().nullable(),
  data: t.json<unknown>().nullable(),
  blob: t.bytes().nullable(),
  token: t.uuid().nullable(),
  mood: t.enum(['happy', 'sad', "it's"]).nullable(),
  createdAt: t.datetime().defaultNow(),
});

export const owners = table('sm_owners', {
  id: t.id(),
  email: t.string(120).unique(),
  name: t.string(60).nullable(),
});

export const items = table('sm_items', {
  id: t.uuid().primaryKey().defaultRandom(),
  ownerId: t.int().references(() => owners.id, { onDelete: 'cascade' }),
  title: t.string(100),
  rank: t.int(),
});

export const counters = table('sm_counters', {
  id: t.id(),
  hits: t.int().default(0),
  at: t.datetime().defaultNow(),
});

/** Accented, CJK and astral characters, written as code points to keep the source ASCII. */
const UNICODE = String.fromCodePoint(0xe9, 0x4e2d, 0x1f600);

const schema = { kinds, owners, items, counters };
const relations = ({ owners, items }: typeof schema) => ({
  owners: { items: many(items) },
  items: { owner: one(owners, { fields: ['ownerId'], references: ['id'] }) },
});

export interface CasesTarget {
  name: string;
  enabled: boolean;
  connect(): Promise<{ adapter: Adapter; close(): Promise<void> }>;
}

export function sqlmoreCases(target: CasesTarget): void {
  describe.skipIf(!target.enabled)(`${target.name} dialect cases`, () => {
    let close: () => Promise<void>;
    let db: ReturnType<typeof makeDb>;
    const makeDb = (adapter: Adapter) => kastor({ adapter, schema, relations });

    beforeAll(async () => {
      const connected = await target.connect();
      close = connected.close;
      await resetWithDdl(connected.adapter, toSchemaIR(schema));
      db = makeDb(connected.adapter);
    });

    afterAll(async () => {
      await close?.();
    });

    it('round trips every neutral type at its edges', async () => {
      const at = new Date('2024-02-29T23:59:58.123Z');
      const bytes = new Uint8Array([0, 1, 2, 254, 255]);
      const created = await db.kinds.create({
        data: {
          label: `edges ${UNICODE}`,
          note: 'x'.repeat(5000),
          count: -2147483648,
          big: 9223372036854775807n,
          ratio: 0.1 + 0.2,
          price: '12345678901234567890.1234567891',
          flag: true,
          at,
          day: '2024-02-29',
          clock: '23:59:58',
          data: { nested: [1, 'two', null, { deep: true }], big: 2 ** 53 },
          blob: bytes,
          token: '0e984725-c51c-4bf4-9960-e1c80e27aba0',
          mood: "it's",
        },
      });
      const row = await db.kinds.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.label).toBe(`edges ${UNICODE}`);
      expect(row.note).toBe('x'.repeat(5000));
      expect(row.count).toBe(-2147483648);
      expect(row.big).toBe(9223372036854775807n);
      expect(row.ratio).toBeCloseTo(0.3, 12);
      expect(row.price).toBe('12345678901234567890.1234567891');
      expect(row.flag).toBe(true);
      expect(row.at).toEqual(at);
      expect(row.day).toBe('2024-02-29');
      expect(row.clock).toBe('23:59:58');
      expect(row.data).toEqual({ nested: [1, 'two', null, { deep: true }], big: 2 ** 53 });
      expect(row.blob).toEqual(bytes);
      expect(row.token).toBe('0e984725-c51c-4bf4-9960-e1c80e27aba0');
      expect(row.mood).toBe("it's");
      expect(row.createdAt).toBeInstanceOf(Date);
      expect(Math.abs(row.createdAt.getTime() - Date.now())).toBeLessThan(5 * 60 * 1000);
      expect(created).toEqual(row);

      const empty = await db.kinds.create({ data: { label: 'nulls' } });
      expect(empty).toMatchObject({ note: null, count: null, big: null, price: null, flag: false, at: null, day: null, clock: null, data: null, blob: null, token: null, mood: null });
    });

    it('inserts a row that only uses defaults', async () => {
      const first = await db.counters.create({ data: {} });
      const second = await db.counters.create({ data: {} });
      expect(first.hits).toBe(0);
      expect(first.at).toBeInstanceOf(Date);
      expect(second.id).toBeGreaterThan(first.id);
    });

    it('filters on every type with the encoded values', async () => {
      const at = new Date('2024-02-29T23:59:58.123Z');
      expect(await db.kinds.count({ where: { big: 9223372036854775807n } })).toBe(1);
      expect(await db.kinds.count({ where: { price: '12345678901234567890.1234567891' } })).toBe(1);
      expect(await db.kinds.count({ where: { at } })).toBe(1);
      expect(await db.kinds.count({ where: { at: { gt: new Date('2024-02-29T23:59:58.122Z') } } })).toBe(1);
      expect(await db.kinds.count({ where: { day: '2024-02-29' } })).toBe(1);
      expect(await db.kinds.count({ where: { clock: { gte: '23:00:00' } } })).toBe(1);
      expect(await db.kinds.count({ where: { flag: true } })).toBe(1);
      expect(await db.kinds.count({ where: { token: '0e984725-c51c-4bf4-9960-e1c80e27aba0' } })).toBe(1);
      expect(await db.kinds.count({ where: { mood: { in: ["it's", 'sad'] } } })).toBe(1);
      expect(await db.kinds.count({ where: { note: { startsWith: 'xxx' } } })).toBe(1);
      expect(await db.kinds.count({ where: { blob: null } })).toBe(1);
    });

    it('updates json, bytes and nulls', async () => {
      const row = await db.kinds.findFirstOrThrow({ where: { label: 'nulls' } });
      const next = await db.kinds.update({ where: { id: row.id }, data: { data: 'just a string', blob: new Uint8Array([7]), count: { increment: 5 } as never } });
      expect(next.data).toBe('just a string');
      expect(next.blob).toEqual(new Uint8Array([7]));
      const cleared = await db.kinds.update({ where: { id: row.id }, data: { data: null, blob: null } });
      expect(cleared.data).toBeNull();
      expect(cleared.blob).toBeNull();
    });

    it('matches text exactly unless mode is insensitive, whatever the collation', async () => {
      await db.owners.createMany({
        data: [
          { email: 'ada@acme.com', name: 'Ada' },
          { email: 'ADA2@acme.com', name: 'ADA' },
          { email: 'pct@acme.com', name: '100% _real_ [x]' },
        ],
      });
      expect((await db.owners.findMany({ where: { name: { contains: 'da' } } })).map((o) => o.name)).toEqual(['Ada']);
      expect((await db.owners.findMany({ where: { name: { contains: 'da', mode: 'insensitive' } }, orderBy: { id: 'asc' } })).map((o) => o.name)).toEqual(['Ada', 'ADA']);
      expect((await db.owners.findMany({ where: { name: { startsWith: 'AD' } } })).map((o) => o.name)).toEqual(['ADA']);
      expect((await db.owners.findMany({ where: { name: { endsWith: 'DA', mode: 'insensitive' } }, orderBy: { id: 'asc' } })).map((o) => o.name)).toEqual(['Ada', 'ADA']);
      expect((await db.owners.findMany({ where: { name: { contains: '0% _' } } })).map((o) => o.name)).toEqual(['100% _real_ [x]']);
      expect((await db.owners.findMany({ where: { name: { contains: '[x]' } } })).map((o) => o.name)).toEqual(['100% _real_ [x]']);
      expect(await db.owners.count({ where: { name: { contains: '_r_' } } })).toBe(0);
      expect(await db.owners.count({ where: { email: { equals: 'ADA@ACME.COM', mode: 'insensitive' } } })).toBe(1);
    });

    it('maps unique, foreign key and not null errors', async () => {
      const dup = await db.owners.create({ data: { email: 'ada@acme.com' } }).catch((e: unknown) => e);
      expect(isKastorError(dup, 'UNIQUE_VIOLATION')).toBe(true);
      const fk = await db.items.create({ data: { ownerId: 999999, title: 'orphan', rank: 1 } }).catch((e: unknown) => e);
      expect(isKastorError(fk, 'FOREIGN_KEY_VIOLATION') || isKastorError(fk, 'NOT_FOUND') || isKastorError(fk, 'VALIDATION_FAILED')).toBe(true);
      const raw = await db.$execute`INSERT INTO ${sql.ident('sm_items')} (${sql.ident('id')}, ${sql.ident('ownerId')}, ${sql.ident('title')}, ${sql.ident('rank')}) VALUES (${'00000000-0000-0000-0000-000000000001'}, ${null}, ${'t'}, ${1})`.catch((e: unknown) => e);
      expect(isKastorError(raw, 'NOT_NULL_VIOLATION')).toBe(true);
    });

    it('commits and rolls back transactions on one connection', async () => {
      const owner = await db.owners.findFirstOrThrow({ where: { email: 'ada@acme.com' } });
      await db.$transaction(async (tx) => {
        await tx.items.create({ data: { ownerId: owner.id, title: 'kept', rank: 1 } });
        expect(await tx.items.count({ where: { title: 'kept' } })).toBe(1);
      });
      const failed = await db
        .$transaction(async (tx) => {
          await tx.items.create({ data: { ownerId: owner.id, title: 'dropped', rank: 2 } });
          throw new Error('boom');
        })
        .catch((e: Error) => e);
      expect((failed as Error).message).toContain('boom');
      expect(await db.items.count({ where: { title: 'kept' } })).toBe(1);
      expect(await db.items.count({ where: { title: 'dropped' } })).toBe(0);
      const [a, b] = await db.$transaction([db.items.count(), db.owners.count()], { isolationLevel: 'serializable' });
      expect(a).toBe(1);
      expect(b).toBe(3);
    });

    it('loads ordered and paged includes in one call', async () => {
      const owner = await db.owners.findFirstOrThrow({ where: { email: 'ada@acme.com' } });
      await db.items.createMany({ data: [3, 5, 4, 2].map((rank) => ({ ownerId: owner.id, title: `r${rank}`, rank })) });
      const loaded = await db.owners.findUniqueOrThrow({
        where: { id: owner.id },
        include: { items: { orderBy: { rank: 'desc' }, skip: 1, take: 2, include: { owner: true } } },
      });
      expect(loaded.items.map((i) => i.rank)).toEqual([4, 3]);
      expect(loaded.items[0]!.owner.email).toBe('ada@acme.com');
      const counted = await db.owners.findMany({ orderBy: { id: 'asc' }, include: { _count: { select: { items: true } } } as never });
      expect((counted[0] as unknown as { _count: { items: number } })._count.items).toBe(5);
    });

    it('upserts through the native syntax', async () => {
      const first = await db.owners.upsert({ where: { email: 'up@acme.com' }, create: { email: 'up@acme.com', name: 'one' }, update: { name: 'two' } });
      expect(first.name).toBe('one');
      const second = await db.owners.upsert({ where: { email: 'up@acme.com' }, create: { email: 'up@acme.com', name: 'one' }, update: { name: 'two' } });
      expect(second).toEqual({ ...first, name: 'two' });
      const skipped = await db.owners.createMany({ data: [{ email: 'up@acme.com' }, { email: 'new@acme.com' }], skipDuplicates: true });
      expect(skipped).toEqual({ count: 1 });
    });

    it('updates and deletes with relation filters and returns rows', async () => {
      const moved = await db.items.updateMany({ where: { owner: { is: { email: 'ada@acme.com' } }, rank: { gte: 4 } }, data: { title: 'top' } });
      expect(moved).toEqual({ count: 2 });
      const removed = await db.items.delete({ where: { id: (await db.items.findFirstOrThrow({ where: { title: 'top' }, orderBy: { rank: 'asc' } })).id } });
      expect(removed.title).toBe('top');
      const gone = await db.items.deleteMany({ where: { owner: { is: { email: { endsWith: '@acme.com' } } }, title: 'top' } });
      expect(gone).toEqual({ count: 1 });
    });

    it('runs raw SQL with typed parameters', async () => {
      const at = new Date('2024-02-29T23:59:58.123Z');
      const rows = await db.$sql<{ n: unknown }>`SELECT COUNT(*) AS ${sql.ident('n')} FROM ${sql.ident('sm_kinds')} WHERE ${sql.ident('at')} = ${at} AND ${sql.ident('big')} = ${9223372036854775807n}`;
      expect(Number(rows[0]!.n)).toBe(1);
      const changed = await db.$execute`UPDATE ${sql.ident('sm_kinds')} SET ${sql.ident('flag')} = ${true} WHERE ${sql.ident('label')} = ${'nulls'}`;
      expect(changed).toBe(1);
    });
  });
}
