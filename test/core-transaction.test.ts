import { describe, expect, it } from 'vitest';
import { isKastorError, kastor, type Adapter, type Executor } from '../src/index';
import { fixture, resetWithDdl } from './helpers/conformance';
import { memorySqlite } from './helpers/sqlite-memory';

class PaymentDeclined extends Error {}

async function setup() {
  const mem = memorySqlite();
  await resetWithDdl(mem.adapter);
  return { mem, db: kastor({ adapter: mem.adapter, schema: fixture.schema, relations: fixture.relations }) };
}

describe('$transaction errors', () => {
  it('rethrows the callback error unchanged after rolling back', async () => {
    const { db } = await setup();
    const declined = new PaymentDeclined('card declined');
    const caught = await db
      .$transaction(async (tx) => {
        await tx.tags.create({ data: { name: 'paid' } });
        throw declined;
      })
      .catch((e: unknown) => e);
    expect(caught).toBe(declined);
    expect(caught).toBeInstanceOf(PaymentDeclined);
    expect(isKastorError(caught)).toBe(false);
    expect(await db.tags.count()).toBe(0);
  });

  it('rethrows non Error values and query errors as they are', async () => {
    const { db } = await setup();
    expect(await db.$transaction(() => Promise.reject('plain string')).catch((e: unknown) => e)).toBe('plain string');
    let inner: unknown;
    const caught = await db
      .$transaction(async (tx) => {
        await tx.tags.create({ data: { name: 'dup' } });
        try {
          await tx.tags.create({ data: { name: 'dup' } });
        } catch (e) {
          inner = e;
          throw e;
        }
      })
      .catch((e: unknown) => e);
    expect(caught).toBe(inner);
    expect(isKastorError(caught, 'UNIQUE_VIOLATION')).toBe(true);
  });

  it('still maps failures of the transaction itself', async () => {
    const { mem } = await setup();
    const executor: Executor = {
      query: (sql, params) => mem.adapter.executor.query(sql, params),
      async transaction(fn) {
        await fn(this);
        throw new Error('COMMIT failed: connection reset');
      },
    };
    const db = kastor({ adapter: { dialect: mem.adapter.dialect, executor } as Adapter, schema: fixture.schema });
    const caught = await db.$transaction(async () => 1).catch((e: unknown) => e);
    expect(isKastorError(caught, 'QUERY_FAILED')).toBe(true);
    expect((caught as Error).message).toContain('COMMIT failed');
    expect((caught as { meta: Record<string, unknown> }).meta.operation).toBe('transaction');
  });

  it('keeps the original error in nested transactions and batches', async () => {
    const { db } = await setup();
    const marker = new Error('inner');
    const caught = await db.$transaction(async (tx) => tx.$transaction(async () => Promise.reject(marker))).catch((e: unknown) => e);
    expect(caught).toBe(marker);
    const batch = await db.$transaction([db.tags.create({ data: { name: 'b' } }), db.tags.create({ data: { name: 'b' } })]).catch((e: unknown) => e);
    expect(isKastorError(batch, 'UNIQUE_VIOLATION')).toBe(true);
  });
});
