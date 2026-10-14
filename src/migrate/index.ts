/**
 * `kastor/migrate`: the migration engine as a library, for scripts and tests
 * that want what the CLI does without spawning it.
 */
export * from './ops';
export {
  applyRenames,
  compareColumns,
  DEFAULT_STRING_LENGTH,
  diffSchemas,
  enumNameOf,
  findColumnRenameCandidates,
  findTableRenameCandidates,
  normalizeDefault,
  orderTables,
  RenameError,
  schemasMatch,
  storesForeignKeys,
  type DiffOptions,
  type DiffResult,
  type DiffWarning,
  type Rename,
  type RenameCandidate,
} from './diff';
export {
  applyMigration,
  deploy,
  dev,
  drift,
  dropEverything,
  introspect,
  MIGRATIONS_TABLE,
  planStatements,
  push,
  reset,
  resolveRenames,
  status,
  statementsOf,
  type ChangeOptions,
  type DevOptions,
  type DevResult,
  type MigrationHooks,
  type MigrationStatus,
  type PlannedStep,
  type PushResult,
  type RenameResolution,
} from './engine';
export {
  checksum,
  LOCK_FILE,
  MIGRATION_FILE,
  nextId,
  readLock,
  readMigrations,
  renderMigration,
  sanitizeName,
  suggestName,
  timestamp,
  writeLock,
  writeMigration,
  type LocalMigration,
  type RenderInput,
} from './files';
export { BLOCK_MARKER, formatStatement, splitStatements } from './sql-split';
export { generateSchema, type CodegenOptions, type CodegenResult } from './codegen';
export {
  CONFIG_FILES,
  createAdapter,
  defineConfig,
  findConfig,
  loadConfig,
  loadSchema,
  loadSchemaObject,
  type KastorConfig,
  type LoadedConfig,
} from './config';
