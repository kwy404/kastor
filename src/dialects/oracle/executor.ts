import type { ColumnIR, ExecResult, Executor, TransactionOptions } from '../../core/ir';

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
 * Out parameter for `RETURNING ... INTO`: the executor binds it as an out
 * bind and returns the values as rows keyed by `as`.
 */
export class OracleOutBind {
  constructor(
    readonly column: ColumnIR,
    readonly as: string,
  ) {}
}

/** `oracledb.BIND_OUT` */
const BIND_OUT = 3003;

type FetchTypeHandler = (meta: { dbType?: unknown; precision?: number; scale?: number }) => { type: unknown } | undefined;

interface DriverTypes {
  /** Reads NUMBER columns wider than a double as text, so bigint and decimal keep every digit. */
  fetchTypeHandler: FetchTypeHandler;
  /** Out bind type for a column. */
  outType(column: ColumnIR): Record<string, unknown>;
}

let driverTypes: Promise<DriverTypes | undefined> | undefined;

/**
 * The driver's type constants are objects, not numbers, so kastor loads them
 * from the `oracledb` package the user already installed. Without them,
 * numbers keep about 15 significant digits and RETURNING INTO is unavailable.
 */
export function loadDriverTypes(): Promise<DriverTypes | undefined> {
  driverTypes ??= import('oracledb')
    .then((mod: Record<string, unknown>) => {
      const d = ((mod as { default?: Record<string, unknown> }).default ?? mod) as Record<string, unknown>;
      const NUMBER = d.DB_TYPE_NUMBER;
      const STRING = d.STRING;
      if (!NUMBER || !STRING) return undefined;
      const types: DriverTypes = {
        // NUMBER(10) and count(*) stay JS numbers.
        fetchTypeHandler: (meta) =>
          meta.dbType === NUMBER && ((meta.precision ?? 0) > 15 || ((meta.precision ?? 0) > 0 && (meta.scale ?? 0) > 0)) ? { type: STRING } : undefined,
        outType(column) {
          const native = (column.nativeType ?? '').toLowerCase();
          switch (column.type) {
            case 'int':
            case 'float':
            case 'boolean':
              return { type: NUMBER };
            case 'datetime':
              return { type: native.startsWith('timestamp') && !native.includes('time zone') ? d.DB_TYPE_TIMESTAMP : d.DB_TYPE_TIMESTAMP_TZ };
            case 'date':
              return { type: d.DB_TYPE_DATE };
            case 'time':
              return { type: d.DB_TYPE_INTERVAL_DS };
            case 'text':
            case 'json':
              return { type: d.DB_TYPE_CLOB };
            case 'bytes':
              return { type: native.startsWith('raw') ? d.DB_TYPE_RAW : d.DB_TYPE_BLOB, maxSize: 32767 };
            default:
              return { type: STRING, maxSize: 32767 };
          }
        },
      };
      return types;
    })
    .catch(() => undefined);
  return driverTypes;
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

/** Turns positional out binds (one array of values per bind) into rows keyed by `as`. */
export async function outRows(outs: OracleOutBind[], outBinds: unknown[]): Promise<Record<string, unknown>[]> {
  const columns = outs.map((o, i) => {
    const value = outBinds[i];
    return Array.isArray(value) ? value : value === undefined ? [] : [value];
  });
  const count = Math.max(0, ...columns.map((c) => c.length));
  const rows: Record<string, unknown>[] = [];
  for (let r = 0; r < count; r++) {
    const row: Record<string, unknown> = {};
    outs.forEach((o, i) => (row[o.as] = columns[i]![r]));
    rows.push(row);
  }
  return materialize(rows);
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
    const types = await loadDriverTypes();
    const options: Record<string, unknown> = { outFormat: OUT_FORMAT_OBJECT, autoCommit };
    if (types) options.fetchTypeHandler = types.fetchTypeHandler;
    const outs = params.filter((v): v is OracleOutBind => v instanceof OracleOutBind);
    let binds = params;
    if (outs.length) {
      if (!types) throw new Error('kastor: RETURNING INTO needs the oracledb package to be importable.');
      binds = params.map((v) => (v instanceof OracleOutBind ? { dir: BIND_OUT, ...types.outType(v.column) } : v));
    }
    const result = await conn.execute(sql, binds, options);
    let rows = result.rows ? await materialize(result.rows) : [];
    if (outs.length) rows = await outRows(outs, (result as { outBinds?: unknown[] }).outBinds ?? []);
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
