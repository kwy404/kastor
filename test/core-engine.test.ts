/**
 * Runs the conformance suite on in-memory SQLite through the shared SQL base
 * in three configurations: JSON aggregation with RETURNING, the IN-list
 * include loader without RETURNING, and emulated upserts.
 */
import { runConformance } from './helpers/conformance';
import { memorySqlite } from './helpers/sqlite-memory';

runConformance('core engine, JSON includes and RETURNING', () => memorySqlite());

runConformance('core engine, IN-list includes, re-select after writes', () =>
  memorySqlite({ json: null, returning: 'none', multiRowInsert: false, maxInList: 2, maxParams: 40 }),
);

runConformance('core engine, emulated upsert and self reference rules', () =>
  memorySqlite({ upsert: 'none', mutationSelfReference: false, nullsOrder: false }),
);
