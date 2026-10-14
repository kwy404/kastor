/** MongoDB driver errors to KastorError. */
import { errors, KastorError, type KastorErrorCode } from '../../core/errors';

export function mongoError(code: KastorErrorCode | 'UNKNOWN_TABLE', message: string, hint: string, meta: Record<string, unknown> = {}): KastorError {
  return new KastorError(code === 'UNKNOWN_TABLE' ? 'UNKNOWN_MODEL' : code, message, { hint, meta: { dialect: 'mongodb', ...meta } });
}

interface DriverError {
  name?: string;
  code?: number | string;
  codeName?: string;
  message?: string;
  keyPattern?: Record<string, unknown>;
  keyValue?: Record<string, unknown>;
  errInfo?: unknown;
  errorLabels?: string[];
  hasErrorLabel?: (label: string) => boolean;
  writeErrors?: Array<{ code?: number; errmsg?: string; err?: { code?: number; errmsg?: string } }>;
  writeErrorsList?: unknown;
}

function codeOf(e: DriverError): number | undefined {
  if (typeof e.code === 'number') return e.code;
  const first = Array.isArray(e.writeErrors) ? e.writeErrors[0] : undefined;
  return first?.code ?? first?.err?.code;
}

function hasLabel(e: DriverError, label: string): boolean {
  if (typeof e.hasErrorLabel === 'function') return e.hasErrorLabel(label);
  return Array.isArray(e.errorLabels) && e.errorLabels.includes(label);
}

/** Finds the first column a `$jsonSchema` validation failure complains about. */
function validationDetail(errInfo: unknown): { column?: string; missing: boolean } {
  const text = JSON.stringify(errInfo ?? {});
  const missing = /"missingProperties":\["([^"]+)"/.exec(text);
  if (missing) return { column: missing[1], missing: true };
  const prop = /"propertyName":"([^"]+)"/.exec(text);
  return { column: prop?.[1], missing: false };
}

/** Turns a driver error into a KastorError, or null when it is not a driver error. */
export function mapMongoError(error: unknown): Error | null {
  if (error instanceof KastorError) return error;
  if (!error || typeof error !== 'object') return null;
  const e = error as DriverError;
  const name = e.name ?? '';
  if (!name.startsWith('Mongo') && !('codeName' in e) && !('errorLabels' in e)) return null;
  const code = codeOf(e);
  if (code === 11000 || code === 11001) {
    const keys = e.keyPattern ? Object.keys(e.keyPattern) : undefined;
    return errors.uniqueViolation(keys, error, { dialect: 'mongodb' });
  }
  if (code === 121) {
    const detail = validationDetail(e.errInfo ?? e.writeErrors?.[0]);
    if (detail.missing) return errors.notNullViolation(detail.column, error, { dialect: 'mongodb' });
    if (detail.column && /"null"|consideredValue":null/.test(JSON.stringify(e.errInfo ?? {}))) {
      return errors.notNullViolation(detail.column, error, { dialect: 'mongodb' });
    }
    return errors.checkViolation(detail.column ? `$jsonSchema (${detail.column})` : '$jsonSchema', error, { dialect: 'mongodb' });
  }
  if (code === 112 || hasLabel(e, 'TransientTransactionError')) return errors.serialization(error, { dialect: 'mongodb' });
  if (code === 50 || name === 'MongoOperationTimeoutError') return errors.timeout(error, { dialect: 'mongodb' });
  if (name === 'MongoNetworkError' || name === 'MongoServerSelectionError' || name === 'MongoNetworkTimeoutError' || name === 'MongoTopologyClosedError') {
    return errors.connection(error, { dialect: 'mongodb' });
  }
  return null;
}
