import type { ExecResult, Executor, TransactionOptions } from '../../core/ir';

/** `oracledb.OUT_FORMAT_OBJECT`: rows as objects keyed by column name. */
const OUT_FORMAT_OBJECT = 4002;

/** The parts of an `oracledb` Connection kastor uses. */
export interface OracleConnectionLike {
  execute(sql: string, binds: unknown[], options: Record<string, unknown>): Promise<{ rows?: unknown[]; rowsAffected?: number }>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  close(): Promise<void>;
}

/** The parts of an `oracledb` Pool kastor uses (`await oracledb.createPool(...)`). */
export interface OraclePoolLike {
  getConnection(): Promise<OracleConnectionLike>;
  close?(drainTime?: number): Promise<void>;
}

/** A large object (CLOB, BLOB) handle from oracledb. */
interface LobLike {
  getData(): Promise<string | Buffer | null>;
}

const isLob = (value: unknown): value is LobLike =>
  typeof value === 'object' && value !== null && typeof (value as LobLike).getData === 'function' && !(value instanceof Uint8Array);

/**
 * Optional fetch handler that reads NUMBER columns as text, so bigint and
 * decimal values keep every digit. It needs the driver's type constants, so
 * kastor loads them from the `oracledb` package the user already installed.
 */
type FetchTypeHandler = (meta: { dbType?: unknown; precision?: number; scale?: number }) => { type: unknown } | undefined;
let numberAsString: Promise<FetchTypeHandler | undefined> | undefined;

function loadNumberAsString(): Promise<FetchTypeHandler | undefined> {
  numberAsString ??= import('oracledb')
    .then((mod: Record<string, unknown>) => {
      const driver = ((mod as { default?: Record<string, unknown> }).default ?? mod) as Record<string, unknown>;
      const NUMBER = driver.DB_TYPE_NUMBER;
      const STRING = driver.STRING;
      if (!NUMBER || !STRING) return undefined;
      // Only wide integers and fixed point numbers: NUMBER(10) and count(*) stay JS numbers.
      const handler: FetchTypeHandler = (meta) =>
        meta.dbType === NUMBER && ((meta.precision ?? 0) > 15 || ((meta.precision ?? 0) > 0 && (meta.scale ?? 0) > 0)) ? { type: STRING } : undefined;
      return handler;
    })
    .catch(() => undefined);
  return numberAsString;
}

/** Reads LOB handles into strings and Buffers so rows are plain data. */
export async function materialize(rows: unknown[]): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (const row of rows as Record<string, unknown>[]) {
    const copy: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) copy[key] = isLob(value) ? await value.getData() : value;
    out.push(copy);
  }
  return out;
}

const isolationSql: Record<NonNullable<TransactionOptions['isolationLevel']>, string> = {
  // Oracle offers READ COMMITTED and SERIALIZABLE; the others map to the closest stronger level.
  'read uncommitted': 'READ COMMITTED',
  'read committed': 'READ COMMITTED',
  'repeatable read': 'SERIALIZABLE',
  serializable: 'SERIALIZABLE',
};

function serial(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}

/**
 * Wraps an `oracledb` pool (thin mode works, no Instant Client needed) or a
 * single connection in a kastor Executor. Outside transactions every
 * statement commits on its own.
 */
export function oracleExecutor(target: OraclePoolLike | OracleConnectionLike): Executor {
  const isPool = typeof (target as OraclePoolLike).getConnection === 'function';
  const lock = serial();

  const run = async (conn: OracleConnectionLike, sql: string, params: unknown[], autoCommit: boolean): Promise<ExecResult> => {
    const fetchTypeHandler = await loadNumberAsString();
    const options: Record<string, unknown> = { outFormat: OUT_FORMAT_OBJECT, autoCommit };
    if (fetchTypeHandler) options.fetchTypeHandler = fetchTypeHandler;
    const result = await conn.execute(sql, params, options);
    const rows = result.rows ? await materialize(result.rows) : [];
    return result.rowsAffected === undefined ? { rows } : { rows, rowsAffected: result.rowsAffected };
  };

  const withConnection = async <T>(fn: (conn: OracleConnectionLike) => Promise<T>): Promise<T> => {
    if (!isPool) return lock(() => fn(target as OracleConnectionLike));
    const conn = await (target as OraclePoolLike).getConnection();
    try {
      return await fn(conn);
    } finally {
      await conn.close();
    }
  };

  const executor: Executor = {
    query(sql, params) {
      return withConnection((conn) => run(conn, sql, params, true));
    },
    transaction(fn, options) {
      return withConnection(async (conn) => {
        const txLock = serial();
        const tx: Executor = {
          inTransaction: true,
          query: (sql, params) => txLock(() => run(conn, sql, params, false)),
          transaction: (inner) => inner(tx),
        };
        try {
          if (options?.isolationLevel) await tx.query(`SET TRANSACTION ISOLATION LEVEL ${isolationSql[options.isolationLevel]}`, []);
          const result = await fn(tx);
          await txLock(() => conn.commit());
          return result;
        } catch (error) {
          try {
            await txLock(() => conn.rollback());
          } catch {
            // keep the original error
          }
          throw error;
        }
      });
    },
    async close() {
      if (isPool) await (target as OraclePoolLike).close?.(0);
      else await (target as OracleConnectionLike).close();
    },
  };
  return executor;
}
