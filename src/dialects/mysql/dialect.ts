import type { Dialect } from '../../core/ir';
import { createSqlDialect } from '../../core/sql/dialect';
import { mysqlDdl } from './ddl';
import { mapMysqlError } from './errors';
import { mariadbHooks, mysqlHooks } from './hooks';
import { introspectMysql } from './introspect';

/** MySQL 8.0.14+ (also PlanetScale and other MySQL compatible servers). */
export const mysqlDialect: Dialect = createSqlDialect({
  name: 'mysql',
  hooks: mysqlHooks,
  // DDL commits implicitly in MySQL.
  features: { transactionalDdl: false },
  ddl: mysqlDdl('mysql'),
  introspect: (exec) => introspectMysql(exec, 'mysql'),
  timestampType: 'DATETIME(3)',
  mapError: mapMysqlError,
});

/** MariaDB 10.6+. */
export const mariadbDialect: Dialect = createSqlDialect({
  name: 'mariadb',
  hooks: mariadbHooks,
  features: { transactionalDdl: false },
  ddl: mysqlDdl('mariadb'),
  introspect: (exec) => introspectMysql(exec, 'mariadb'),
  timestampType: 'DATETIME(3)',
  mapError: mapMysqlError,
});
