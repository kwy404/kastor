/**
 * Converts the TypeScript schema (an object of `table()` values) into the
 * plain SchemaIR used by migrations, introspection diffs and dialects.
 */
import { errors } from './errors';
import type { ColumnIR, EnumIR, ForeignKeyIR, IndexIR, SchemaIR, TableIR } from './ir';
import { ForeignKeyBuilder, isColumn, isTable, type AnyColumn, type AnyTable } from './schema';

/** Postgres limits identifiers to 63 bytes; long generated names get a short hash suffix. */
export function constraintName(...parts: string[]): string {
  const name = parts.join('_');
  if (name.length <= 63) return name;
  return `${name.slice(0, 54)}_${fnv1a(name)}`;
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Collects the tables of a schema object or module namespace, ignoring anything else. */
export function tablesOf(schema: Record<string, unknown> | readonly AnyTable[]): [string, AnyTable][] {
  const entries: [string, unknown][] = Array.isArray(schema)
    ? (schema as readonly AnyTable[]).map((tbl) => [tbl.$table.name, tbl])
    : Object.entries(schema as Record<string, unknown>);
  return entries.filter((e): e is [string, AnyTable] => isTable(e[1]));
}

export function columnToIR(table: string, column: AnyColumn): ColumnIR {
  const c = column.config;
  const ir: ColumnIR = { name: column.name, type: c.type, nullable: c.nullable };
  if (c.default !== undefined) ir.default = { ...c.default };
  if (c.length !== undefined) ir.length = c.length;
  if (c.precision !== undefined) ir.precision = c.precision;
  if (c.scale !== undefined) ir.scale = c.scale;
  if (c.enumValues !== undefined) {
    ir.enumValues = [...c.enumValues];
    ir.enumName = c.enumName ?? `${table}_${column.name}`;
  }
  if (c.nativeType !== undefined) ir.nativeType = c.nativeType;
  return ir;
}

export function tableToIR(tbl: AnyTable): TableIR {
  const meta = tbl.$table;
  const columns = Object.values(meta.columns);
  const columnIRs = columns.map((c) => columnToIR(meta.name, c));

  const inlinePk = columns.filter((c) => c.config.primaryKey);
  let primaryKey: string[] = inlinePk.map((c) => c.name);
  if (meta.options.primaryKey) {
    if (inlinePk.length > 0) {
      throw errors.schema(
        `Table "${meta.name}" declares a primary key twice (on ${inlinePk.map((c) => c.key).join(', ')} and in the primaryKey option).`,
        'Keep one: .primaryKey() on a single column, or the primaryKey table option for a composite key.',
      );
    }
    const pkCols = meta.options.primaryKey(meta.columns);
    for (const c of pkCols) checkOwnColumn(meta.name, c, 'primaryKey');
    primaryKey = pkCols.map((c) => c.name);
    for (const ir of columnIRs) if (primaryKey.includes(ir.name)) ir.nullable = false;
  }
  if (inlinePk.length > 1) {
    throw errors.schema(
      `Table "${meta.name}" marks several columns with .primaryKey().`,
      'For a composite key use the table option: primaryKey: (c) => [c.a, c.b].',
    );
  }

  const indexes: IndexIR[] = [];
  for (const c of columns) {
    if (c.config.unique && !c.config.primaryKey) {
      indexes.push({
        name: typeof c.config.unique === 'string' ? c.config.unique : constraintName(meta.name, c.name, 'key'),
        columns: [c.name],
        unique: true,
      });
    }
  }
  for (const idx of meta.options.indexes?.(meta.columns) ?? []) {
    for (const c of idx.columns) checkOwnColumn(meta.name, c, 'indexes');
    const cols = idx.columns.map((c) => c.name);
    indexes.push({
      name: idx.indexName ?? constraintName(meta.name, ...cols, idx.isUnique ? 'key' : 'idx'),
      columns: cols,
      unique: idx.isUnique,
    });
  }
  const names = new Set<string>();
  for (const idx of indexes) {
    if (names.has(idx.name)) {
      throw errors.schema(`Table "${meta.name}" has two indexes named "${idx.name}".`, 'Give one of them another name with .name().');
    }
    names.add(idx.name);
  }

  const foreignKeys: ForeignKeyIR[] = [];
  for (const c of columns) {
    const ref = c.config.references;
    if (!ref) continue;
    const target = ref.target();
    if (!isColumn(target) || target.tableName === undefined) {
      throw errors.schema(
        `The reference of ${meta.name}.${c.key} does not point at a table column.`,
        'Return a column of another table: .references(() => users.id).',
      );
    }
    foreignKeys.push({
      name: ref.options.name ?? constraintName(meta.name, c.name, 'fkey'),
      columns: [c.name],
      refTable: target.tableName,
      refColumns: [target.name],
      onDelete: ref.options.onDelete ?? 'no action',
      onUpdate: ref.options.onUpdate ?? 'no action',
    });
  }

  for (const fk of meta.options.foreignKeys?.(meta.columns) ?? []) {
    if (!(fk instanceof ForeignKeyBuilder)) {
      throw errors.schema(`The foreignKeys option of table "${meta.name}" must return foreignKey(...) entries.`, 'Example: foreignKeys: (c) => [foreignKey([c.a, c.b], () => [other.x, other.y])].');
    }
    for (const c of fk.columns) checkOwnColumn(meta.name, c, 'foreignKeys');
    const targets = fk.targets();
    const refTable = targets[0]?.tableName;
    if (!Array.isArray(targets) || targets.length !== fk.columns.length || targets.some((c) => !isColumn(c) || c.tableName === undefined || c.tableName !== refTable)) {
      throw errors.schema(
        `A foreign key of table "${meta.name}" on (${fk.columns.map((c) => c.key).join(', ')}) must point at as many columns of one other table.`,
        'Return the referenced columns in the same order: () => [other.a, other.b].',
      );
    }
    const cols = fk.columns.map((c) => c.name);
    foreignKeys.push({
      name: fk.options.name ?? constraintName(meta.name, ...cols, 'fkey'),
      columns: cols,
      refTable: refTable!,
      refColumns: targets.map((c) => c.name),
      onDelete: fk.options.onDelete ?? 'no action',
      onUpdate: fk.options.onUpdate ?? 'no action',
    });
  }
  const fkNames = new Set<string>();
  for (const fk of foreignKeys) {
    if (fkNames.has(fk.name)) throw errors.schema(`Table "${meta.name}" has two foreign keys named "${fk.name}".`, 'Give one of them another name with { name }.');
    fkNames.add(fk.name);
  }

  return { name: meta.name, columns: columnIRs, primaryKey, indexes, foreignKeys };
}

function checkOwnColumn(table: string, column: AnyColumn, where: string): void {
  if (!isColumn(column) || column.tableName !== table) {
    throw errors.schema(`The ${where} option of table "${table}" uses a column of another table.`, `Use the columns passed to the ${where} callback.`);
  }
}

/**
 * Converts a schema object (`{ users, posts }`, a module namespace, or an
 * array of tables) to SchemaIR. Tables come out in dependency order: a table
 * appears after the tables its foreign keys point at (cycles keep their
 * declaration order).
 */
export function toSchemaIR(schema: Record<string, unknown> | readonly AnyTable[]): SchemaIR {
  const tables = tablesOf(schema).map(([, tbl]) => tableToIR(tbl));
  const byName = new Map<string, TableIR>();
  for (const tbl of tables) {
    if (byName.has(tbl.name)) {
      throw errors.schema(`Two tables are named "${tbl.name}".`, 'Table names must be unique in a schema.');
    }
    byName.set(tbl.name, tbl);
  }
  for (const tbl of tables) {
    for (const fk of tbl.foreignKeys) {
      const target = byName.get(fk.refTable);
      if (!target) {
        throw errors.schema(
          `${tbl.name}.${fk.columns.join(', ')} references table "${fk.refTable}", which is not in the schema.`,
          `Add the "${fk.refTable}" table to the schema object.`,
        );
      }
    }
  }

  const enums = new Map<string, EnumIR>();
  for (const tbl of tables) {
    for (const c of tbl.columns) {
      if (c.type !== 'enum' || !c.enumName || !c.enumValues) continue;
      const existing = enums.get(c.enumName);
      if (existing && existing.values.join('\u0000') !== c.enumValues.join('\u0000')) {
        throw errors.schema(
          `Enum "${c.enumName}" is declared with different values in two columns.`,
          'Use the same values in the same order, or give the enums different names.',
        );
      }
      enums.set(c.enumName, { name: c.enumName, values: [...c.enumValues] });
    }
  }

  return { tables: sortByDependencies(tables), enums: [...enums.values()] };
}

/** Topological order: referenced tables first. Self references and cycles are tolerated. */
export function sortByDependencies(tables: TableIR[]): TableIR[] {
  const byName = new Map(tables.map((tbl) => [tbl.name, tbl]));
  const done = new Set<string>();
  const visiting = new Set<string>();
  const out: TableIR[] = [];
  const visit = (tbl: TableIR): void => {
    if (done.has(tbl.name) || visiting.has(tbl.name)) return;
    visiting.add(tbl.name);
    for (const fk of tbl.foreignKeys) {
      const dep = byName.get(fk.refTable);
      if (dep && dep !== tbl) visit(dep);
    }
    visiting.delete(tbl.name);
    done.add(tbl.name);
    out.push(tbl);
  };
  for (const tbl of tables) visit(tbl);
  return out;
}
