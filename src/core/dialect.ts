// The dialect contract lives in ir.ts so every shared type sits in one file.
// This module re-exports it under the path the dialects expect.
export type {
  Adapter,
  AppliedMigration,
  CompiledQuery,
  Dialect,
  DialectFeatures,
  DialectName,
  ExecResult,
  Executor,
  MigrationOpLike,
  MigrationTable,
  TransactionOptions,
} from './ir';
