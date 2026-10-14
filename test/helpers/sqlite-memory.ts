/**
 * A small in-memory SQLite adapter built only from the shared SQL base, so
 * core tests run the whole client against a real database without depending
 * on the dialect packages. Supports the DDL the conformance suite needs.
 */
import Database from 'better-sqlite3';
import { codec, createSqlDialect, defineHooks, jsonSqlite, limitOffset, quoteDouble, type SqlHooks } from '../../src/core/sql';
import { errors, KastorError } from '../../src/core/errors';
import type { Adapter, ColumnIR, ExecResult, Executor, SchemaIR, TableIR } from '../../src/core/ir';

const values = codec({ boolean: 'int', datetime: 'iso', json: 'string', bigint: 'bigint', bytes: (b) => Buffer.from(b.buffer, b.byteOffset, b.byteLength) });

export function sqliteHooks(overrides: Partial<SqlHooks> = {}): SqlHooks {
  return defineHooks({
    quoteIdent: quoteDouble,
    placeholder: () => '?',
    paginate: limitOffset('-1'),
    returning: 'returning',
    upsert: 'onConflict',
    json: jsonSqlite,
    caseInsensitive: 'lower',
    nullsOrder: true,
    encode: values.encode,
    decode: values.decode,
    maxParams: 32766,
    ...overrides,
  });
}

function columnType(c: ColumnIR): string {
  switch (c.type) {
    case 'int':
    case 'bigint':
    case 'boolean':
      return 'INTEGER';
    case 'float':
      return 'REAL';
    case 'decimal':
      return 'NUMERIC';
    case 'bytes':
      return 'BLOB';
    default:
      return 'TEXT';
  }
}

function literal(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${String(typeof value === 'object' ? JSON.stringify(value) : value).replace(/'/g, "''")}'`;
}

export function createTableSql(t: TableIR): string[] {
  const q = quoteDouble;
  const singleAuto = t.primaryKey.length === 1 && t.columns.find((c) => c.name === t.primaryKey[0])?.default?.kind === 'autoincrement';
  const cols = t.columns.map((c) => {
    if (singleAuto && c.name === t.primaryKey[0]) return `${q(c.name)} INTEGER PRIMARY KEY AUTOINCREMENT`;
    let def = '';
    if (c.default?.kind === 'value') def = ` DEFAULT ${literal(c.default.value)}`;
    else if (c.default?.kind === 'now') def = ' DEFAULT CURRENT_TIMESTAMP';
    else if (c.default?.kind === 'sql') def = ` DEFAULT (${String(c.default.value)})`;
    const check = c.enumValues ? ` CHECK (${q(c.name)} IN (${c.enumValues.map(literal).join(', ')}))` : '';
    return `${q(c.name)} ${columnType(c)}${c.nullable ? '' : ' NOT NULL'}${def}${check}`;
  });
  if (!singleAuto && t.primaryKey.length) cols.push(`PRIMARY KEY (${t.primaryKey.map(q).join(', ')})`);
  for (const fk of t.foreignKeys) {
    cols.push(
      `CONSTRAINT ${q(fk.name)} FOREIGN KEY (${fk.columns.map(q).join(', ')}) REFERENCES ${q(fk.refTable)} (${fk.refColumns.map(q).join(', ')}) ON DELETE ${fk.onDelete.toUpperCase()} ON UPDATE ${fk.onUpdate.toUpperCase()}`,
    );
  }
  const out = [`CREATE TABLE ${q(t.name)} (\n  ${cols.join(',\n  ')}\n)`];
  for (const idx of t.indexes) out.push(`CREATE ${idx.unique ? 'UNIQUE ' : ''}INDEX ${q(idx.name)} ON ${q(t.name)} (${idx.columns.map(q).join(', ')})`);
  return out;
}

function mapError(error: unknown): Error | null {
  const e = error as { code?: string; message?: string };
  if (typeof e?.code !== 'string' || !e.code.startsWith('SQLITE_')) return null;
  const msg = e.message ?? '';
  if (e.code === 'SQLITE_CONSTRAINT_UNIQUE' || e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
    const m = /UNIQUE constraint failed: (.+)$/.exec(msg);
    return errors.uniqueViolation(m ? m[1]!.split(', ').map((s) => s.split('.').pop()!) : undefined, error);
  }
  if (e.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return errors.foreignKeyViolation(undefined, error);
  if (e.code === 'SQLITE_CONSTRAINT_NOTNULL') return errors.notNullViolation(/NOT NULL constraint failed: (.+)$/.exec(msg)?.[1], error);
  if (e.code === 'SQLITE_CONSTRAINT_CHECK') return errors.checkViolation(undefined, error);
  return null;
}

export interface MemoryDb {
  adapter: Adapter;
  db: Database.Database;
  statements: string[];
  reset(schema: SchemaIR): Promise<void>;
  close(): Promise<void>;
}

/** In-memory SQLite adapter. `hooks` overrides let tests exercise other code paths (no RETURNING, no JSON). */
export function memorySqlite(hooks: Partial<SqlHooks> = {}): MemoryDb {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const statements: string[] = [];
  let depth = 0;

  const exec = (inTransaction: boolean): Executor => ({
    inTransaction,
    async query(sql: string, params: unknown[]): Promise<ExecResult> {
      statements.push(sql);
      const stmt = db.prepare(sql);
      if (stmt.reader) {
        stmt.safeIntegers(true);
        const rows = stmt.all(...params) as Record<string, unknown>[];
        return { rows, rowsAffected: rows.length };
      }
      const info = stmt.run(...params);
      return { rows: [], rowsAffected: info.changes, insertId: info.lastInsertRowid };
    },
    async transaction<T>(fn: (tx: Executor) => Promise<T>): Promise<T> {
      if (depth > 0) throw new KastorError('TRANSACTION_FAILED', 'Nested transaction on the memory adapter.', { hint: 'The client should reuse the open transaction.' });
      depth++;
      db.exec('BEGIN');
      try {
        const result = await fn(exec(true));
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      } finally {
        depth--;
      }
    },
    async close() {
      db.close();
    },
  });

  const finalHooks = sqliteHooks(hooks);
  const dialect = createSqlDialect({
    name: 'sqlite',
    hooks: finalHooks,
    features: { transactionalDdl: true },
    timestampType: 'TEXT',
    mapError,
    ddl(op) {
      if (op.kind === 'createTable') return createTableSql(op.table as TableIR);
      if (op.kind === 'dropTable') return [`DROP TABLE IF EXISTS ${quoteDouble(op.table as string)}`];
      return [];
    },
    async introspect() {
      return { tables: [] };
    },
  });
  const executor = exec(false);
  const adapter: Adapter = { dialect, executor };
  return {
    adapter,
    db,
    statements,
    async reset(schemaIR: SchemaIR) {
      db.pragma('foreign_keys = OFF');
      for (const t of [...schemaIR.tables].reverse()) db.exec(`DROP TABLE IF EXISTS ${quoteDouble(t.name)}`);
      for (const t of schemaIR.tables) for (const s of createTableSql(t)) db.exec(s);
      db.pragma('foreign_keys = ON');
    },
    async close() {
      db.close();
    },
  };
}
