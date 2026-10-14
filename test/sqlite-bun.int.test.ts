/**
 * bun:sqlite only exists inside Bun. Run this file with `bun test test/sqlite-bun.int.test.ts`;
 * under Node (vitest) it skips itself.
 */
import { describe, it } from 'vitest';
import { sqlite } from '../src/sqlite';
import { runConformance } from './helpers/conformance';

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';

let BunDatabase: (new (path: string) => unknown) | undefined;
if (isBun) {
  const specifier = 'bun:sqlite';
  BunDatabase = ((await import(/* @vite-ignore */ specifier)) as { Database: new (path: string) => unknown }).Database;
}

runConformance(
  'sqlite (bun:sqlite)',
  () => {
    const adapter = sqlite(new BunDatabase!(':memory:') as never);
    return { adapter, close: () => adapter.executor.close!() };
  },
  { enabled: isBun },
);

describe.skipIf(isBun)('bun:sqlite under Node', () => {
  it('is covered by running this file with bun test', () => undefined);
});
