import { describe, expect, it } from 'vitest';
import { compileOnlyDialect, createSqlDialect, ansiHooks } from '../src/core/sql';
import { isKastorError } from '../src/index';
import { memorySqlite } from './helpers/sqlite-memory';

describe('sqlMigrationTable', () => {
  it('creates the table once and records, lists and removes migrations', async () => {
    const mem = memorySqlite();
    const { migrationTable } = mem.adapter.dialect;
    const exec = mem.adapter.executor;
    expect(await migrationTable.list(exec)).toEqual([]);
    await migrationTable.ensure(exec);
    await migrationTable.ensure(exec);
    const appliedAt = new Date('2026-10-01T12:00:00.000Z');
    await migrationTable.record(exec, { id: '20261001120000_init', checksum: 'abc', appliedAt });
    await migrationTable.record(exec, { id: '20261002120000_more', checksum: 'def', appliedAt });
    const list = await migrationTable.list(exec);
    expect(list.map((m) => m.id)).toEqual(['20261001120000_init', '20261002120000_more']);
    expect(list[0]!.appliedAt.toISOString()).toBe(appliedAt.toISOString());
    await migrationTable.remove(exec, '20261001120000_init');
    expect((await migrationTable.list(exec)).map((m) => m.checksum)).toEqual(['def']);
    expect(mem.adapter.dialect.splitScript!('SELECT 1; SELECT 2;')).toEqual(['SELECT 1', 'SELECT 2']);
    await mem.close();
  });

  it('requires a migration table or a timestamp type', () => {
    let error: unknown;
    try {
      createSqlDialect({ name: 'sqlite', hooks: ansiHooks, ddl: () => [], introspect: async () => ({ tables: [] }) });
    } catch (e) {
      error = e;
    }
    expect(isKastorError(error, 'SCHEMA_INVALID')).toBe(true);
  });

  it('compile only dialects refuse to run DDL', async () => {
    const d = compileOnlyDialect('postgres', ansiHooks);
    expect(d.features).toMatchObject({ returning: false, jsonAggregation: false, upsert: false, rawSql: true });
    expect(() => d.ddl({ kind: 'createTable' }, { tables: [] })).toThrow(/compile only/);
    await expect(Promise.resolve().then(() => d.introspect({} as never))).rejects.toThrow(/compile only/);
    expect(d.encodeParam!(true)).toBe(true);
  });
});
