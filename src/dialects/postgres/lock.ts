/**
 * A tiny async mutex. Single connection drivers (a pg `Client`, every SQLite
 * driver) run a transaction as BEGIN ... COMMIT on the shared connection, so
 * statements from outside the transaction must wait until it finishes or they
 * would silently become part of it.
 */
export class Lock {
  private tail: Promise<void> = Promise.resolve();

  /** Runs `fn` once every earlier holder has released the lock. */
  run<T>(fn: () => Promise<T> | T): Promise<T> {
    const result = this.tail.then(() => fn());
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export type IsolationLevel = 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable';

const isolationLevels = new Set<string>(['read uncommitted', 'read committed', 'repeatable read', 'serializable']);

/** `BEGIN` with an optional isolation level, validated so it never carries user text into SQL. */
export function beginStatement(isolationLevel?: string): string {
  if (!isolationLevel) return 'BEGIN';
  const level = isolationLevel.toLowerCase();
  if (!isolationLevels.has(level)) throw new TypeError(`Unknown isolation level "${isolationLevel}"`);
  return `BEGIN ISOLATION LEVEL ${level.toUpperCase()}`;
}

let savepointCounter = 0;

/** A fresh savepoint name for nested transactions. */
export function nextSavepoint(): string {
  savepointCounter = (savepointCounter + 1) % 1_000_000;
  return `kastor_sp_${savepointCounter}`;
}
