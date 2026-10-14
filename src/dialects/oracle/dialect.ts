import type { Dialect } from '../../core/ir';
import { createSqlDialect, sqlMigrationTable } from '../../core/sql/dialect';
import { oracleDdl } from './ddl';
import { mapOracleError } from './errors';
import { oracleHooks } from './hooks';
import { introspectOracle } from './introspect';

/** Oracle Database 19c+ (23ai tested), through node-oracledb in thin mode. */
export const oracleDialect: Dialect = createSqlDialect({
  name: 'oracle',
  hooks: oracleHooks,
  // DDL commits implicitly in Oracle.
  features: { transactionalDdl: false },
  ddl: oracleDdl,
  introspect: introspectOracle,
  migrationTable: sqlMigrationTable(oracleHooks, { timestampType: 'TIMESTAMP(3) WITH TIME ZONE', textType: 'VARCHAR2(255 CHAR)' }),
  mapError: mapOracleError,
});
