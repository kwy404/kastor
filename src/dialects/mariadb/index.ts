// MariaDB shares the MySQL implementation; the differences (JSON flavor,
// introspection of JSON columns) are switched by the flavor argument.
export { mariadbDialect } from '../mysql/dialect';
export { mariadbHooks } from '../mysql/hooks';
