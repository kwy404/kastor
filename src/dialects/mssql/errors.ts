import { errors } from '../../core/errors';

interface MssqlDriverError {
  number?: number;
  code?: string;
  message?: string;
  originalError?: { info?: { number?: number; message?: string }; code?: string };
  precedingErrors?: MssqlDriverError[];
}

function errorNumber(e: MssqlDriverError): number | undefined {
  return e.number ?? e.originalError?.info?.number;
}

/** Maps `mssql` (tedious) errors to KastorError. */
export function mapMssqlError(error: unknown): Error | null {
  if (!error || typeof error !== 'object') return null;
  const e = error as MssqlDriverError;
  const message = e.originalError?.info?.message ?? e.message ?? '';
  switch (errorNumber(e)) {
    case 2627: // Violation of UNIQUE KEY / PRIMARY KEY constraint 'x'
    case 2601: {
      // Cannot insert duplicate key row in object 'dbo.t' with unique index 'x'
      const name = /(?:constraint|index) '([^']+)'/i.exec(message)?.[1];
      return errors.uniqueViolation(name, error, { number: errorNumber(e) });
    }
    case 547: {
      const name = /constraint "([^"]+)"/i.exec(message)?.[1];
      if (/CHECK constraint/i.test(message)) return errors.checkViolation(name, error, { number: 547 });
      return errors.foreignKeyViolation(name, error, { number: 547 });
    }
    case 515: {
      // Cannot insert the value NULL into column 'x', table 'db.dbo.t'
      const column = /column '([^']+)'/i.exec(message)?.[1];
      return errors.notNullViolation(column, error, { number: 515 });
    }
    case 1205:
      return errors.deadlock(error, { number: 1205 });
    case 3960: // snapshot isolation update conflict
      return errors.serialization(error, { number: 3960 });
    case 1222: // lock request time out
      return errors.timeout(error, { number: 1222 });
    case 18456: // login failed
    case 4060: // cannot open database
      return errors.connection(error, { number: errorNumber(e) });
    default:
      break;
  }
  const code = e.code ?? e.originalError?.code;
  if (code === 'ETIMEOUT') return errors.timeout(error, { code });
  if (code === 'ESOCKET' || code === 'ELOGIN' || code === 'ECONNCLOSED' || code === 'ENOTOPEN' || code === 'EINSTLOOKUP') return errors.connection(error, { code });
  return null;
}
