import { errors } from '../../core/errors';

interface OracleDriverError {
  errorNum?: number;
  code?: string;
  message?: string;
}

/** Maps `oracledb` errors (ORA-xxxxx and NJS-xxx) to KastorError. */
export function mapOracleError(error: unknown): Error | null {
  if (!error || typeof error !== 'object') return null;
  const e = error as OracleDriverError;
  const message = e.message ?? '';
  const num = e.errorNum ?? Number(/ORA-(\d{5})/.exec(message)?.[1] ?? NaN);
  switch (num) {
    case 1: {
      // ORA-00001: unique constraint (KASTOR.users_email_key) violated
      const name = /constraint \(([^)]+)\)/i.exec(message)?.[1];
      return errors.uniqueViolation(name ? name.slice(name.lastIndexOf('.') + 1).replace(/"/g, '') : undefined, error, { errorNum: num });
    }
    case 2291: // parent key not found
    case 2292: {
      // child record found
      const name = /constraint \(([^)]+)\)/i.exec(message)?.[1];
      return errors.foreignKeyViolation(name ? name.slice(name.lastIndexOf('.') + 1).replace(/"/g, '') : undefined, error, { errorNum: num });
    }
    case 1400: // cannot insert NULL into ("KASTOR"."users"."email")
    case 1407: {
      const column = /\("(?:[^"]+)"\."(?:[^"]+)"\."([^"]+)"\)/.exec(message)?.[1];
      return errors.notNullViolation(column, error, { errorNum: num });
    }
    case 2290: {
      const name = /constraint \(([^)]+)\)/i.exec(message)?.[1];
      return errors.checkViolation(name ? name.slice(name.lastIndexOf('.') + 1).replace(/"/g, '') : undefined, error, { errorNum: num });
    }
    case 60:
      return errors.deadlock(error, { errorNum: num });
    case 8177:
      return errors.serialization(error, { errorNum: num });
    case 30006: // resource busy; acquire with WAIT timeout expired
    case 51:
      return errors.timeout(error, { errorNum: num });
    case 1017: // invalid username/password
    case 12541: // no listener
    case 12514: // service not known
    case 12170:
    case 3113:
    case 3114:
      return errors.connection(error, { errorNum: num });
    default:
      break;
  }
  if (/^NJS-(500|501|503|510|511|521)/.test(message)) return errors.connection(error, { code: message.slice(0, 7) });
  return null;
}
