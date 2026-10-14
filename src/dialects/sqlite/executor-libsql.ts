import type { ExecResult, Executor } from '../../core/ir';
import { nextSavepoint } from '../postgres/lock';
import { normalizeIntegers, smallInt, toSqliteParams } from './executor-sync';

/** The part of an `@libsql/client` result set kastor reads. */
export interface LibsqlResultLike {
  columns: string[];
  rows: ArrayLike<unknown>[];
  rowsAffected: number;
  lastInsertRowid?: bigint | number | undefined;
}

/** Values `@libsql/client` binds. */
export type LibsqlValue = null | string | number | bigint | boolean | ArrayBuffer | Uint8Array | Date;

export interface LibsqlStatementLike {
  sql: string;
  args: LibsqlValue[];
}

export interface LibsqlTransactionLike {
  execute(statement: LibsqlStatementLike): Promise<LibsqlResultLike>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  close(): void;
}

/** An `@libsql/client` Client (local file, embedded replica or Turso). */
export interface LibsqlClientLike {
  execute(statement: LibsqlStatementLike): Promise<LibsqlResultLike>;
  transaction(mode?: 'write' | 'read' | 'deferred'): Promise<LibsqlTransactionLike>;
  close(): void;
}

function toRows(result: LibsqlResultLike): Record<string, unknown>[] {
  const rows = result.rows.map((row) => {
    const out: Record<string, unknown> = {};
    // Rows are array like with named properties; read them by position so
    // duplicate or numeric looking column names cannot clash.
    result.columns.forEach((name, i) => {
      out[name] = toBytes(row[i]);
    });
    return out;
  });
  return normalizeIntegers(rows);
}

/** libSQL returns blobs as ArrayBuffer. */
function toBytes(value: unknown): unknown {
  return value instanceof ArrayBuffer ? new Uint8Array(value) : value;
}

async function run(
  conn: Pick<LibsqlClientLike, 'execute'>,
  sql: string,
  params: unknown[],
): Promise<ExecResult> {
  const result = await conn.execute({ sql, args: toSqliteParams(params, false) as LibsqlValue[] });
  return {
    rows: toRows(result),
    rowsAffected: result.rowsAffected,
    insertId: result.lastInsertRowid === undefined ? undefined : smallInt(result.lastInsertRowid),
  };
}

function txExecutor(tx: LibsqlTransactionLike): Executor {
  const self: Executor = {
    inTransaction: true,
    query: (sql, params) => run(tx, sql, params),
    async transaction(fn) {
      const name = nextSavepoint();
      await tx.execute({ sql: `SAVEPOINT ${name}`, args: [] });
      try {
        const value = await fn(self);
        await tx.execute({ sql: `RELEASE ${name}`, args: [] });
        return value;
      } catch (error) {
        await tx.execute({ sql: `ROLLBACK TO ${name}`, args: [] }).catch(() => undefined);
        throw error;
      }
    },
  };
  return self;
}

/**
 * Wraps an `@libsql/client` Client. Transactions use `client.transaction('write')`,
 * which runs on its own connection (or Hrana stream for Turso).
 */
export function libsqlExecutor(client: LibsqlClientLike): Executor {
  return {
    query: (sql, params) => run(client, sql, params),
    async transaction(fn) {
      const tx = await client.transaction('write');
      try {
        const value = await fn(txExecutor(tx));
        await tx.commit();
        return value;
      } catch (error) {
        await tx.rollback().catch(() => undefined);
        throw error;
      } finally {
        tx.close();
      }
    },
    async close() {
      client.close();
    },
  };
}
