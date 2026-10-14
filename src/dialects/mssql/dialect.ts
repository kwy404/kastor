import type { Dialect } from '../../core/ir';
import { createSqlDialect } from '../../core/sql/dialect';
import { mssqlDdl } from './ddl';
import { mapMssqlError } from './errors';
import { mssqlHooks } from './hooks';
import { introspectMssql } from './introspect';

/** SQL Server 2017+ and Azure SQL. */
export const mssqlDialect: Dialect = createSqlDialect({
  name: 'mssql',
  hooks: mssqlHooks,
  features: { transactionalDdl: true },
  ddl: mssqlDdl,
  introspect: introspectMssql,
  timestampType: 'DATETIME2(3)',
  mapError: mapMssqlError,
});
