import { errors } from '../../core/errors';

/** `users.email, users.name` to `['email', 'name']`. */
function columnsOf(list: string): string[] {
  return list.split(',').map((item) => {
    const name = item.trim();
    const dot = name.lastIndexOf('.');
    return dot >= 0 ? name.slice(dot + 1) : name;
  });
}

/**
 * Maps SQLite errors to KastorError. Every driver (better-sqlite3, node:sqlite,
 * bun:sqlite, libSQL, D1) puts SQLite's own text in the message, so the
 * message is the reliable part.
 */
export function mapSqliteError(error: unknown): Error | null {
  if (!error || typeof error !== 'object') return null;
  const message = String((error as { message?: unknown }).message ?? '');
  const code = String((error as { code?: unknown }).code ?? '');
  let m = /UNIQUE constraint failed: ([^:\n]+)/.exec(message);
  if (m) {
    const cols = columnsOf(m[1]!);
    return errors.uniqueViolation(cols, error, { sqliteCode: code || undefined });
  }
  if (/FOREIGN KEY constraint failed/.test(message)) return errors.foreignKeyViolation(undefined, error, { sqliteCode: code || undefined });
  m = /NOT NULL constraint failed: ([^:\n]+)/.exec(message);
  if (m) return errors.notNullViolation(columnsOf(m[1]!)[0], error, { sqliteCode: code || undefined });
  m = /CHECK constraint failed: ([^:\n]+)/.exec(message);
  if (m) return errors.checkViolation(m[1]!.trim(), error, { sqliteCode: code || undefined });
  if (/PRIMARY KEY must be unique|SQLITE_CONSTRAINT_PRIMARYKEY/.test(message)) return errors.uniqueViolation(undefined, error);
  if (/database is locked|SQLITE_BUSY|database table is locked/.test(message) || code.startsWith('SQLITE_BUSY')) {
    return errors.timeout(error, { sqliteCode: code || undefined });
  }
  if (/unable to open database file|SQLITE_CANTOPEN/.test(message) || code === 'SQLITE_CANTOPEN') return errors.connection(error);
  return null;
}
