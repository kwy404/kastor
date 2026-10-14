import { errors } from '../../core/errors';

interface MysqlDriverError {
  errno?: number;
  code?: string;
  sqlMessage?: string;
  message?: string;
}

const CONNECTION_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH', 'EPIPE', 'PROTOCOL_CONNECTION_LOST', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR', 'ER_CON_COUNT_ERROR', 'ER_GET_CONNECTION_TIMEOUT']);

/** Maps mysql2 and mariadb driver errors to KastorError. */
export function mapMysqlError(error: unknown): Error | null {
  if (!error || typeof error !== 'object') return null;
  const e = error as MysqlDriverError;
  const message = e.sqlMessage ?? e.message ?? '';
  switch (e.errno) {
    case 1062: // ER_DUP_ENTRY: Duplicate entry 'x' for key 'users.users_email_key'
    case 1586: {
      const key = /for key '([^']+)'/.exec(message)?.[1];
      return errors.uniqueViolation(key ? key.slice(key.lastIndexOf('.') + 1) : undefined, error, { errno: e.errno });
    }
    case 1451: // ER_ROW_IS_REFERENCED_2
    case 1452: // ER_NO_REFERENCED_ROW_2
    case 1216:
    case 1217: {
      const constraint = /CONSTRAINT `([^`]+)`/.exec(message)?.[1];
      return errors.foreignKeyViolation(constraint, error, { errno: e.errno });
    }
    case 1048: // ER_BAD_NULL_ERROR: Column 'x' cannot be null
    case 1364: {
      // ER_NO_DEFAULT_FOR_FIELD: Field 'x' doesn't have a default value
      const column = /(?:Column|Field) '([^']+)'/.exec(message)?.[1];
      return errors.notNullViolation(column, error, { errno: e.errno });
    }
    case 3819: // MySQL: Check constraint 'x' is violated.
    case 4025: {
      // MariaDB: CONSTRAINT `x` failed for `db`.`t`
      const constraint = /constraint '([^']+)'/i.exec(message)?.[1] ?? /CONSTRAINT `([^`]+)`/.exec(message)?.[1];
      return errors.checkViolation(constraint, error, { errno: e.errno });
    }
    case 1213:
      return errors.deadlock(error, { errno: e.errno });
    case 1205:
      return errors.timeout(error, { errno: e.errno });
    default:
      break;
  }
  if (e.code && CONNECTION_CODES.has(e.code)) return errors.connection(error, { code: e.code });
  if (e.code === 'ETIMEDOUT' || e.code === 'PROTOCOL_SEQUENCE_TIMEOUT') return errors.timeout(error, { code: e.code });
  return null;
}
