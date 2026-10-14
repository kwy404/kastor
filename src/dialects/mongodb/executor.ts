/**
 * Executor over a MongoDB `Db`.
 *
 * Dialect code talks to `exec.db` directly and passes `exec.session` to every
 * operation, so the same code runs inside and outside transactions.
 * `query(text, params)` runs a database command written as Extended JSON, which
 * is what migrations and `$sql` use:
 *
 *   {"createIndexes": "users", "indexes": [{"key": {"email": 1}, "name": "users_email_key", "unique": true}]}
 *
 * Parameters are referenced as `{"$param": 1}` (1 based).
 */
import { BSON, type ClientSession, type Db, type Document, type ReadConcernLike } from 'mongodb';
import type { ExecResult, Executor, TransactionOptions } from '../../core/ir';
import { mongoError } from './errors';

export interface MongoExecutor extends Executor {
  readonly db: Db;
  readonly session?: ClientSession;
  /** True when the server is a replica set member or mongos (multi document transactions work). */
  supportsTransactions(): Promise<boolean>;
}

/** Replaces `{"$param": n}` placeholders with `params[n - 1]`. */
export function bindParams(value: unknown, params: unknown[]): unknown {
  if (Array.isArray(value)) return value.map((v) => bindParams(v, params));
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 1 && keys[0] === '$param' && typeof obj.$param === 'number') {
      const i = obj.$param - 1;
      if (i < 0 || i >= params.length) {
        throw mongoError('INVALID_ARGUMENT', `The command uses parameter ${obj.$param} but only ${params.length} were passed.`, 'Check the {"$param": n} placeholders.');
      }
      return params[i];
    }
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = bindParams(obj[k], params);
    return out;
  }
  return value;
}

/** Parses one command written as Extended JSON. */
export function parseCommand(text: string): Document {
  try {
    const parsed = BSON.EJSON.parse(text, { relaxed: true }) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as Document;
  } catch (cause) {
    throw mongoError(
      'INVALID_ARGUMENT',
      `Not a MongoDB command: ${text.length > 120 ? `${text.slice(0, 120)}...` : text}`,
      'Raw queries on MongoDB are database commands written as JSON, for example {"find": "users", "filter": {"email": {"$param": 1}}}.',
      { cause: String(cause) },
    );
  }
}

const readConcernFor = (options?: TransactionOptions): ReadConcernLike => {
  switch (options?.isolationLevel) {
    case 'repeatable read':
    case 'serializable':
      return { level: 'snapshot' };
    default:
      return { level: 'majority' };
  }
};

class DbExecutor implements MongoExecutor {
  readonly inTransaction: boolean;
  private txSupport: Promise<boolean> | undefined;

  constructor(
    readonly db: Db,
    readonly session?: ClientSession,
    private readonly parent?: DbExecutor,
  ) {
    this.inTransaction = session !== undefined;
  }

  supportsTransactions(): Promise<boolean> {
    if (this.parent) return this.parent.supportsTransactions();
    this.txSupport ??= this.db
      .command({ hello: 1 })
      .then((hello) => Boolean(hello.setName) || hello.msg === 'isdbgrid')
      .catch(() => false);
    return this.txSupport;
  }

  async query(text: string, params: unknown[]): Promise<ExecResult> {
    const command = bindParams(parseCommand(text), params) as Document;
    let target = this.db;
    // renameCollection runs on admin with full namespaces.
    if (typeof command.renameCollection === 'string') {
      const name = this.db.databaseName;
      if (!command.renameCollection.includes('.')) command.renameCollection = `${name}.${command.renameCollection}`;
      if (typeof command.to === 'string' && !command.to.includes('.')) command.to = `${name}.${command.to}`;
      target = this.db.client.db('admin');
    }
    const result = await target.command(command, this.session ? { session: this.session } : {});
    const cursor = result.cursor as { firstBatch?: Document[]; id?: unknown; ns?: string } | undefined;
    if (cursor && Array.isArray(cursor.firstBatch)) {
      const rows = [...cursor.firstBatch];
      let id = cursor.id;
      const collection = String(cursor.ns ?? '').split('.').slice(1).join('.');
      while (id && String(id) !== '0') {
        const more = await this.db.command({ getMore: id, collection }, this.session ? { session: this.session } : {});
        const next = more.cursor as { nextBatch?: Document[]; id?: unknown };
        rows.push(...(next.nextBatch ?? []));
        id = next.id;
      }
      return { rows };
    }
    const rowsAffected = typeof result.n === 'number' ? result.n : undefined;
    return { rows: [result], rowsAffected };
  }

  async transaction<T>(fn: (tx: Executor) => Promise<T>, options?: TransactionOptions): Promise<T> {
    if (this.session) return fn(this);
    const session = this.db.client.startSession();
    try {
      session.startTransaction({ readConcern: readConcernFor(options), writeConcern: { w: 'majority' } });
      const tx = new DbExecutor(this.db, session, this);
      let result: T;
      try {
        result = await fn(tx);
      } catch (error) {
        if (session.inTransaction()) await session.abortTransaction().catch(() => undefined);
        throw error;
      }
      await session.commitTransaction();
      return result;
    } finally {
      await session.endSession().catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    if (this.parent) return;
    await this.db.client.close();
  }
}

export function mongoExecutor(db: Db): MongoExecutor {
  return new DbExecutor(db);
}

/** Runs `fn` in a transaction when the server supports one and none is open; otherwise directly. */
export async function atomically<T>(exec: MongoExecutor, fn: (exec: MongoExecutor) => Promise<T>): Promise<T> {
  if (exec.inTransaction || !(await exec.supportsTransactions())) return fn(exec);
  return exec.transaction((tx) => fn(tx as MongoExecutor));
}

/** `{ session }` when the executor runs inside a transaction. */
export function opts(exec: MongoExecutor): { session?: ClientSession } {
  return exec.session ? { session: exec.session } : {};
}
