import { errors } from '../../core/errors';

interface PgErrorLike {
  code?: unknown;
  constraint?: unknown;
  constraint_name?: unknown;
  detail?: unknown;
  column?: unknown;
  column_name?: unknown;
  table?: unknown;
  table_name?: unknown;
  message?: unknown;
}

const str = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

/** Columns named in `Key (a, b)=(1, 2) already exists.` */
function keyColumns(detail: string | undefined): string[] | undefined {
  const m = detail ? /Key \((.+?)\)=/.exec(detail) : null;
  return m ? m[1]!.split(',').map((c) => c.trim().replace(/^"|"$/g, '')) : undefined;
}

/**
 * Maps Postgres and CockroachDB SQLSTATE codes (from `pg` or `postgres`) to
 * KastorError. Returns null for errors that are not database errors.
 */
export function mapPgError(error: unknown): Error | null {
  if (!error || typeof error !== 'object') return null;
  const e = error as PgErrorLike;
  const code = str(e.code);
  if (!code) return null;
  const constraint = str(e.constraint) ?? str(e.constraint_name);
  const table = str(e.table) ?? str(e.table_name);
  const meta = { table, constraint, sqlState: code };
  switch (code) {
    case '23505':
      return errors.uniqueViolation(keyColumns(str(e.detail)) ?? constraint, error, meta);
    case '23503':
      return errors.foreignKeyViolation(constraint, error, meta);
    case '23502': {
      const column = str(e.column) ?? str(e.column_name) ?? /column "([^"]+)"/.exec(String(e.message ?? ''))?.[1];
      return errors.notNullViolation(column, error, meta);
    }
    case '23514':
      return errors.checkViolation(constraint, error, meta);
    case '40001':
      return errors.serialization(error, meta);
    case '40P01':
      return errors.deadlock(error, meta);
    case '57014':
    case '55P03':
      return errors.timeout(error, meta);
    case 'ECONNREFUSED':
    case 'ENOTFOUND':
    case 'ECONNRESET':
    case 'ETIMEDOUT':
    case 'CONNECTION_CLOSED':
    case 'CONNECTION_ENDED':
    case 'CONNECTION_DESTROYED':
    case 'CONNECT_TIMEOUT':
      return errors.connection(error, meta);
  }
  if (code.startsWith('08') || code === '57P01' || code === '53300') return errors.connection(error, meta);
  return null;
}
