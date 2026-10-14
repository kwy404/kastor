/**
 * Every error kastor throws on purpose is a KastorError: a stable `code` to
 * branch on, a plain English `message` that says what happened and a `hint`
 * that says how to fix it.
 */

export type KastorErrorCode =
  // query results
  | 'NOT_FOUND'
  // constraint violations reported by the database
  | 'UNIQUE_VIOLATION'
  | 'FOREIGN_KEY_VIOLATION'
  | 'NOT_NULL_VIOLATION'
  | 'CHECK_VIOLATION'
  // concurrency
  | 'SERIALIZATION_FAILURE'
  | 'DEADLOCK'
  | 'TRANSACTION_FAILED'
  // connection
  | 'CONNECTION_FAILED'
  | 'TIMEOUT'
  // bad input caught before reaching the database
  | 'VALIDATION_FAILED'
  | 'UNKNOWN_FIELD'
  | 'UNKNOWN_RELATION'
  | 'UNKNOWN_MODEL'
  | 'INVALID_ARGUMENT'
  | 'MISSING_UNIQUE_FIELD'
  | 'INVALID_CURSOR'
  // schema problems found while building the client
  | 'SCHEMA_INVALID'
  | 'RELATION_AMBIGUOUS'
  // capability gaps
  | 'UNSUPPORTED'
  // anything the dialect could not classify
  | 'QUERY_FAILED'
  // migrations
  | 'MIGRATION_FAILED'
  | 'MIGRATION_DRIFT';

export interface KastorErrorOptions {
  hint?: string;
  meta?: Record<string, unknown>;
  cause?: unknown;
}

export class KastorError extends Error {
  override readonly name = 'KastorError';
  readonly code: KastorErrorCode;
  /** How to fix it, in one or two sentences. */
  readonly hint: string;
  /** Structured details: model, field, constraint, sql, ... */
  readonly meta: Record<string, unknown>;

  constructor(code: KastorErrorCode, message: string, options: KastorErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.hint = options.hint ?? '';
    this.meta = options.meta ?? {};
    if (options.cause !== undefined && !('cause' in this)) {
      Object.defineProperty(this, 'cause', { value: options.cause, enumerable: false, configurable: true, writable: true });
    }
  }

  /** `message` plus the hint, the way the CLI prints it. */
  override toString(): string {
    return this.hint ? `${this.name} [${this.code}]: ${this.message}\nHint: ${this.hint}` : `${this.name} [${this.code}]: ${this.message}`;
  }

  toJSON(): Record<string, unknown> {
    return { name: this.name, code: this.code, message: this.message, hint: this.hint, meta: this.meta };
  }
}

export function isKastorError(value: unknown, code?: KastorErrorCode): value is KastorError {
  if (!(value instanceof Error) || (value as { name?: string }).name !== 'KastorError') return false;
  return code === undefined || (value as KastorError).code === code;
}

const list = (items: readonly string[]): string => items.map((i) => `"${i}"`).join(', ');

/** Closest name by edit distance, for "did you mean" hints. */
export function closest(name: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestScore = Infinity;
  const a = name.toLowerCase();
  for (const candidate of candidates) {
    const b = candidate.toLowerCase();
    const score = editDistance(a, b);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best !== undefined && bestScore <= Math.max(2, Math.floor(name.length / 3)) ? best : undefined;
}

function editDistance(a: string, b: string): number {
  const prev = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]!;
      prev[j] = a[i - 1] === b[j - 1] ? diag : 1 + Math.min(diag, up, prev[j - 1]!);
      diag = up;
    }
  }
  return prev[b.length]!;
}

function didYouMean(name: string, candidates: readonly string[]): string {
  const guess = closest(name, candidates);
  return guess ? `Did you mean "${guess}"? ` : '';
}

/** Factories so the same situation always produces the same message and hint. */
export const errors = {
  notFound(model: string, method: string, where?: unknown): KastorError {
    return new KastorError('NOT_FOUND', `No ${model} record matched the ${method} condition.`, {
      hint: `Check the where clause, or use ${method === 'update' || method === 'delete' ? `${method}Many` : method.replace('OrThrow', '')} if a missing record is fine.`,
      meta: { model, method, where },
    });
  },

  unknownField(model: string, field: string, fields: readonly string[], where = 'query'): KastorError {
    return new KastorError('UNKNOWN_FIELD', `"${field}" is not a field of ${model} (used in ${where}).`, {
      hint: `${didYouMean(field, fields)}Fields of ${model}: ${list(fields)}.`,
      meta: { model, field },
    });
  },

  unknownRelation(model: string, relation: string, relations: readonly string[]): KastorError {
    return new KastorError('UNKNOWN_RELATION', `"${relation}" is not a relation of ${model}.`, {
      hint: relations.length
        ? `${didYouMean(relation, relations)}Relations of ${model}: ${list(relations)}.`
        : `${model} has no relations. Declare them in the "relations" option of kastor().`,
      meta: { model, relation },
    });
  },

  unknownModel(model: string, models: readonly string[]): KastorError {
    return new KastorError('UNKNOWN_MODEL', `"${model}" is not a table in the schema.`, {
      hint: `${didYouMean(model, models)}Tables: ${list(models)}.`,
      meta: { model },
    });
  },

  invalidArgument(message: string, hint: string, meta: Record<string, unknown> = {}): KastorError {
    return new KastorError('INVALID_ARGUMENT', message, { hint, meta });
  },

  validation(model: string, field: string, problem: string, hint: string): KastorError {
    return new KastorError('VALIDATION_FAILED', `Invalid value for ${model}.${field}: ${problem}.`, {
      hint,
      meta: { model, field },
    });
  },

  missingUnique(model: string, method: string, uniques: readonly string[][]): KastorError {
    const options = uniques.map((u) => (u.length === 1 ? u[0]! : `(${u.join(', ')})`));
    return new KastorError('MISSING_UNIQUE_FIELD', `${model}.${method} needs a where clause on a unique field.`, {
      hint: `Filter on one of: ${options.join(', ')}. To match several rows use ${method === 'findUnique' ? 'findFirst or findMany' : `${method}Many`}.`,
      meta: { model, method },
    });
  },

  unsupported(feature: string, dialect: string, hint: string): KastorError {
    return new KastorError('UNSUPPORTED', `${feature} is not supported on ${dialect}.`, { hint, meta: { feature, dialect } });
  },

  schema(message: string, hint: string, meta: Record<string, unknown> = {}): KastorError {
    return new KastorError('SCHEMA_INVALID', message, { hint, meta });
  },

  uniqueViolation(target: readonly string[] | string | undefined, cause: unknown, meta: Record<string, unknown> = {}): KastorError {
    const fields = Array.isArray(target) ? target.join(', ') : target;
    return new KastorError(
      'UNIQUE_VIOLATION',
      fields ? `A record with the same ${fields} already exists.` : 'A record with the same unique value already exists.',
      {
        hint: 'Use a different value, update the existing record, or use upsert to create or update in one call.',
        meta: { target: fields, ...meta },
        cause,
      },
    );
  },

  foreignKeyViolation(constraint: string | undefined, cause: unknown, meta: Record<string, unknown> = {}): KastorError {
    return new KastorError(
      'FOREIGN_KEY_VIOLATION',
      constraint
        ? `The operation breaks the foreign key "${constraint}": a referenced record is missing or other records still point to this one.`
        : 'The operation breaks a foreign key: a referenced record is missing or other records still point to this one.',
      {
        hint: 'Create the referenced record first, connect an existing one, or delete the dependent records (or set onDelete: "cascade") before deleting.',
        meta: { constraint, ...meta },
        cause,
      },
    );
  },

  notNullViolation(column: string | undefined, cause: unknown, meta: Record<string, unknown> = {}): KastorError {
    return new KastorError('NOT_NULL_VIOLATION', column ? `"${column}" cannot be null.` : 'A required column received null.', {
      hint: 'Pass a value for the column, give it a default with .default(...), or make it optional with .nullable().',
      meta: { column, ...meta },
      cause,
    });
  },

  checkViolation(constraint: string | undefined, cause: unknown, meta: Record<string, unknown> = {}): KastorError {
    return new KastorError('CHECK_VIOLATION', constraint ? `The check constraint "${constraint}" failed.` : 'A check constraint failed.', {
      hint: 'Change the value so it satisfies the constraint.',
      meta: { constraint, ...meta },
      cause,
    });
  },

  serialization(cause: unknown, meta: Record<string, unknown> = {}): KastorError {
    return new KastorError('SERIALIZATION_FAILURE', 'The transaction conflicted with a concurrent transaction and was rolled back.', {
      hint: 'Retry the transaction. Conflicts are expected under serializable isolation.',
      meta,
      cause,
    });
  },

  deadlock(cause: unknown, meta: Record<string, unknown> = {}): KastorError {
    return new KastorError('DEADLOCK', 'The database detected a deadlock and cancelled this statement.', {
      hint: 'Retry the transaction, and touch rows in the same order in every transaction to avoid it.',
      meta,
      cause,
    });
  },

  connection(cause: unknown, meta: Record<string, unknown> = {}): KastorError {
    return new KastorError('CONNECTION_FAILED', 'Could not reach the database.', {
      hint: 'Check that the database is running and that the connection string (host, port, user, password, database) is right.',
      meta,
      cause,
    });
  },

  timeout(cause: unknown, meta: Record<string, unknown> = {}): KastorError {
    return new KastorError('TIMEOUT', 'The database did not answer in time.', {
      hint: 'Check for long running locks or slow queries, add an index, or raise the driver timeout.',
      meta,
      cause,
    });
  },

  queryFailed(cause: unknown, sql?: string): KastorError {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return new KastorError('QUERY_FAILED', `The database rejected the query: ${detail}`, {
      hint: 'Run `npx kastor doctor` to compare the schema with the database, or `npx kastor migrate dev` if the schema changed.',
      meta: sql === undefined ? {} : { sql },
      cause,
    });
  },
};
