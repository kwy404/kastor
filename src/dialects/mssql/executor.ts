import type { ExecResult, Executor, TransactionOptions } from '../../core/ir';

/** The parts of an `mssql` Request kastor uses. */
export interface MssqlRequestLike {
  input(name: string, value: unknown): unknown;
  query(sql: string): Promise<{ recordset?: Record<string, unknown>[]; recordsets?: unknown; rowsAffected?: number[] }>;
}

/** The parts of an `mssql` Transaction kastor uses. */
export interface MssqlTransactionLike {
  begin(isolationLevel?: number): Promise<unknown>;
  commit(): Promise<unknown>;
  rollback(): Promise<unknown>;
  request(): MssqlRequestLike;
}

/** The parts of an `mssql` ConnectionPool kastor uses (`new sql.ConnectionPool(config)`). */
export interface MssqlPoolLike {
  connect?(): Promise<unknown>;
  request(): MssqlRequestLike;
  transaction(): MssqlTransactionLike;
  close?(): Promise<unknown>;
}

/**
 * A parameter that needs an explicit SQL type. The driver infers the type of
 * a bare value, and a NULL sent as nvarchar cannot go into a varbinary
 * column, so the executor wraps the placeholder in a CAST.
 */
export class MssqlTypedParam {
  constructor(
    readonly value: unknown,
    readonly sqlType: string,
  ) {}
}

/** mssql (tedious) isolation level numbers. */
const isolationLevels: Record<NonNullable<TransactionOptions['isolationLevel']>, number> = {
  'read uncommitted': 1,
  'read committed': 2,
  'repeatable read': 3,
  serializable: 4,
};

/** Binds `@p1..@pN` and applies the CASTs typed parameters ask for. */
export function bindParams(request: MssqlRequestLike, sql: string, params: unknown[]): string {
  let text = sql;
  params.forEach((param, i) => {
    const name = `p${i + 1}`;
    if (param instanceof MssqlTypedParam) {
      request.input(name, param.value);
      text = text.replace(new RegExp(`@${name}(?![0-9A-Za-z_])`, 'g'), `CAST(@${name} AS ${param.sqlType})`);
    } else {
      request.input(name, param);
    }
  });
  return text;
}

function toResult(raw: Awaited<ReturnType<MssqlRequestLike['query']>>): ExecResult {
  const rows = raw.recordset ?? [];
  const affected = raw.rowsAffected ?? [];
  return { rows: rows.map((row) => ({ ...row })), rowsAffected: affected.reduce((a, b) => a + b, 0) };
}

function serial(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}

/**
 * Wraps an `mssql` ConnectionPool in a kastor Executor. The pool connects on
 * first use when it is not connected yet. Transactions use the driver's
 * Transaction object, so every statement goes over the same connection.
 */
export function mssqlExecutor(pool: MssqlPoolLike): Executor {
  let ready: Promise<unknown> | undefined;
  const connect = () => (ready ??= Promise.resolve(pool.connect?.()).catch((error) => {
    ready = undefined;
    throw error;
  }));
  const run = async (makeRequest: () => MssqlRequestLike, sql: string, params: unknown[]) => {
    const request = makeRequest();
    const text = bindParams(request, sql, params);
    return toResult(await request.query(text));
  };

  return {
    async query(sql, params) {
      await connect();
      return run(() => pool.request(), sql, params);
    },
    async transaction(fn, options) {
      await connect();
      const transaction = pool.transaction();
      await transaction.begin(options?.isolationLevel ? isolationLevels[options.isolationLevel] : undefined);
      // A transaction runs on one connection, which takes one request at a time.
      const lock = serial();
      const tx: Executor = {
        inTransaction: true,
        query: (sql, params) => lock(() => run(() => transaction.request(), sql, params)),
        transaction: (inner) => inner(tx),
      };
      try {
        const result = await fn(tx);
        await lock(() => transaction.commit());
        return result;
      } catch (error) {
        try {
          await lock(() => transaction.rollback());
        } catch {
          // SQL Server may already have aborted the transaction
        }
        throw error;
      }
    },
    async close() {
      await pool.close?.();
    },
  };
}
