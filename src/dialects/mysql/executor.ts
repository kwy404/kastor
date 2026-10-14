import type { ExecResult, Executor, TransactionOptions } from '../../core/ir';

/**
 * The parts of a mysql2 (promise API) or mariadb pool, pool connection or
 * single connection kastor uses. Both drivers fit: mysql2 resolves
 * `[rows, fields]`, mariadb resolves the rows (or an OK packet) directly.
 */
export interface MysqlQueryable {
  query(sql: unknown, values?: unknown): Promise<unknown>;
}

export interface MysqlConnectionLike extends MysqlQueryable {
  beginTransaction?(): Promise<unknown>;
  commit?(): Promise<unknown>;
  rollback?(): Promise<unknown>;
  release?(): unknown;
}

export interface MysqlPoolLike extends MysqlQueryable {
  getConnection?(): Promise<MysqlConnectionLike>;
  end?(): Promise<unknown> | unknown;
}

/** A mysql2 callback pool or connection: kastor switches to its `.promise()` API. */
export interface MysqlCallbackLike {
  promise(): MysqlPoolLike;
}

export type MysqlDriver = 'mysql2' | 'mariadb';

/**
 * Tells mysql2 apart from the mariadb package. The mariadb pool and
 * connections expose `batch`, mysql2 never does.
 */
export function detectDriver(target: object): MysqlDriver {
  return typeof (target as { batch?: unknown }).batch === 'function' ? 'mariadb' : 'mysql2';
}

/** Types the executor keeps as raw text so decoding never depends on the session time zone. */
const RAW_TEXT_TYPES = new Set(['DATETIME', 'TIMESTAMP', 'DATE', 'TIME', 'JSON', 'NEWDECIMAL', 'DECIMAL', 'LONGLONG']);

interface CastField {
  type: string;
  /** MariaDB marks JSON values (sent as LONGTEXT) through extended metadata. */
  extendedFormat?: string;
  string(encoding?: string): string | null;
}

function mysql2TypeCast(field: CastField, next: () => unknown): unknown {
  if (field.type === 'JSON' || field.extendedFormat === 'json') return field.string('utf8');
  return RAW_TEXT_TYPES.has(field.type) ? field.string() : next();
}

interface MariadbColumn {
  type: string;
  dataTypeFormat?: string;
  string(): string | null;
}

function mariadbTypeCast(column: MariadbColumn, next: () => unknown): unknown {
  return RAW_TEXT_TYPES.has(column.type) || column.dataTypeFormat === 'json' ? column.string() : next();
}

/** Per query options that make results independent of how the user configured the pool. */
export function queryOptions(driver: MysqlDriver, sql: string, values: unknown[]): unknown[] {
  if (driver === 'mysql2') {
    return [
      {
        sql,
        values,
        typeCast: mysql2TypeCast,
        supportBigNumbers: true,
        bigNumberStrings: true,
        dateStrings: true,
        rowsAsArray: false,
        nestTables: false,
      },
    ];
  }
  return [
    {
      sql,
      typeCast: mariadbTypeCast,
      dateStrings: true,
      autoJsonMap: false,
      bigIntAsNumber: false,
      decimalAsNumber: false,
      insertIdAsNumber: false,
      rowsAsArray: false,
      nestTables: false,
      namedPlaceholders: false,
    },
    values,
  ];
}

interface OkPacket {
  affectedRows?: number | bigint;
  insertId?: number | bigint | string;
}

/** Turns either driver's result into an ExecResult. */
export function normalizeResult(driver: MysqlDriver, raw: unknown): ExecResult {
  let payload: unknown = raw;
  if (driver === 'mysql2' && Array.isArray(raw)) payload = raw[0];
  if (Array.isArray(payload)) {
    // Multi statement results are arrays of arrays; keep the last result set.
    const rows = payload.length > 0 && Array.isArray(payload[0]) ? (payload[payload.length - 1] as unknown[]) : payload;
    return { rows: rows as Record<string, unknown>[] };
  }
  if (payload && typeof payload === 'object') {
    const ok = payload as OkPacket;
    const result: ExecResult = { rows: [] };
    if (ok.affectedRows !== undefined) result.rowsAffected = Number(ok.affectedRows);
    if (ok.insertId !== undefined && ok.insertId !== null && String(ok.insertId) !== '0') result.insertId = ok.insertId;
    return result;
  }
  return { rows: [] };
}

const isolationSql: Record<NonNullable<TransactionOptions['isolationLevel']>, string> = {
  'read uncommitted': 'READ UNCOMMITTED',
  'read committed': 'READ COMMITTED',
  'repeatable read': 'REPEATABLE READ',
  serializable: 'SERIALIZABLE',
};

/** Runs tasks one at a time: a single connection cannot run two statements at once. */
export function serial(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}

function resolveTarget(target: MysqlPoolLike | MysqlCallbackLike): MysqlPoolLike {
  const maybe = target as Partial<MysqlCallbackLike> & MysqlPoolLike;
  // mysql2 callback objects have `promise()` and a query method that returns
  // a Query object instead of a promise.
  if (typeof maybe.promise === 'function' && detectDriver(target) === 'mysql2' && !isPromisePool(target)) {
    return maybe.promise();
  }
  return target as MysqlPoolLike;
}

function isPromisePool(target: object): boolean {
  const name = target.constructor?.name ?? '';
  return name.startsWith('Promise');
}

/**
 * Wraps a mysql2 or mariadb pool (or a single connection) in a kastor Executor.
 * Transactions take a dedicated connection from the pool, or run on the
 * connection itself when a single connection was passed.
 */
export function mysqlExecutor(target: MysqlPoolLike | MysqlCallbackLike): Executor {
  const pool = resolveTarget(target);
  const driver = detectDriver(pool);
  const run = async (queryable: MysqlQueryable, sql: string, params: unknown[]): Promise<ExecResult> => {
    const args = queryOptions(driver, sql, params);
    const raw = await (queryable.query as (...a: unknown[]) => Promise<unknown>).apply(queryable, args);
    return normalizeResult(driver, raw);
  };
  const lock = serial();
  const isPool = typeof pool.getConnection === 'function';

  const executor: Executor = {
    query(sql, params) {
      return isPool ? run(pool, sql, params) : lock(() => run(pool, sql, params));
    },
    async transaction(fn, options) {
      const conn: MysqlConnectionLike = isPool ? await pool.getConnection!() : pool;
      const txLock = isPool ? serial() : lock;
      const exec = (sql: string, params: unknown[] = []) => (isPool ? txLock(() => run(conn, sql, params)) : run(conn, sql, params));
      const body = async () => {
        if (options?.isolationLevel) await exec(`SET TRANSACTION ISOLATION LEVEL ${isolationSql[options.isolationLevel]}`);
        await exec('START TRANSACTION');
        const tx: Executor = {
          inTransaction: true,
          query: (sql, params) => exec(sql, params),
          transaction: (inner) => inner(tx),
        };
        try {
          const result = await fn(tx);
          await exec('COMMIT');
          return result;
        } catch (error) {
          try {
            await exec('ROLLBACK');
          } catch {
            // the original error matters more than a failed rollback
          }
          throw error;
        }
      };
      try {
        // A single connection queues the whole transaction so outside queries wait for it.
        return isPool ? await body() : await lock(body);
      } finally {
        if (isPool) conn.release?.();
      }
    },
    async close() {
      await pool.end?.();
    },
  };
  return executor;
}
