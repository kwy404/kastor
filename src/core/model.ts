/**
 * Runtime metadata: for every model, its fields (property name to column),
 * keys, unique sets and resolved relations. Built once per client.
 */
import { errors, KastorError } from './errors';
import type { ColumnIR, ForeignKeyIR, RelationIR, SchemaIR, TableIR } from './ir';
import { isRelation, type AnyColumn, type AnyRelation, type AnyTable, type ColumnConfig } from './schema';
import { tablesOf, toSchemaIR } from './schema-ir';

export interface FieldMeta {
  /** Property name. */
  key: string;
  /** Database column name. */
  column: string;
  config: Readonly<ColumnConfig>;
  ir: ColumnIR;
}

export interface RelationMeta {
  key: string;
  kind: 'one' | 'many';
  source: ModelMeta;
  /** Model key of the target. */
  targetKey: string;
  /** Field keys on the source side of the join. */
  fromFields: string[];
  /** Field keys on the target side of the join. */
  toFields: string[];
  /** Many-to-many join table. Field keys on the join model. */
  through?: { modelKey: string; sourceFields: string[]; targetFields: string[] };
  /** True when the source holds the foreign key (to-one relations only). */
  owner: boolean;
  /** To-one relation that can be missing. */
  nullable: boolean;
  ir: RelationIR;
}

export interface ModelMeta {
  key: string;
  table: string;
  source: AnyTable;
  tableIR: TableIR;
  fields: Map<string, FieldMeta>;
  byColumn: Map<string, FieldMeta>;
  fieldKeys: string[];
  /** Primary key field keys. */
  primaryKey: string[];
  /** Every unique field set (primary key first). */
  uniques: string[][];
  relations: Map<string, RelationMeta>;
  relationKeys: string[];
  softDelete?: FieldMeta;
}

export interface Models {
  byKey: Map<string, ModelMeta>;
  byTable: Map<string, ModelMeta>;
  schemaIR: SchemaIR;
  model(key: string): ModelMeta;
}

export type RelationsInput = Record<string, Record<string, AnyRelation> | undefined>;

export function buildModels(schema: Record<string, unknown>, relationsFn?: (tables: any) => RelationsInput): Models {
  const tables = tablesOf(schema);
  if (tables.length === 0) {
    throw errors.schema('The schema has no tables.', 'Pass your tables: kastor({ schema: { users, posts }, ... }).');
  }
  const schemaIR = toSchemaIR(Object.fromEntries(tables));
  const irByName = new Map(schemaIR.tables.map((tbl) => [tbl.name, tbl]));
  const byKey = new Map<string, ModelMeta>();
  const byTable = new Map<string, ModelMeta>();

  for (const [key, tbl] of tables) {
    if (key.startsWith('$')) {
      throw errors.schema(`Model name "${key}" starts with $, which is reserved for client methods.`, 'Rename the key in the schema object.');
    }
    const tableIR = irByName.get(tbl.$table.name)!;
    const fields = new Map<string, FieldMeta>();
    const byColumn = new Map<string, FieldMeta>();
    for (const [fieldKey, column] of Object.entries(tbl.$table.columns) as [string, AnyColumn][]) {
      const ir = tableIR.columns.find((c) => c.name === column.name)!;
      const f: FieldMeta = { key: fieldKey, column: column.name, config: column.config, ir };
      fields.set(fieldKey, f);
      byColumn.set(column.name, f);
    }
    const primaryKey = tableIR.primaryKey.map((c) => byColumn.get(c)!.key);
    const uniques: string[][] = [];
    if (primaryKey.length) uniques.push(primaryKey);
    for (const idx of tableIR.indexes) if (idx.unique) uniques.push(idx.columns.map((c) => byColumn.get(c)!.key));
    const softKey = tbl.$table.options.softDelete;
    const model: ModelMeta = {
      key,
      table: tbl.$table.name,
      source: tbl,
      tableIR,
      fields,
      byColumn,
      fieldKeys: [...fields.keys()],
      primaryKey,
      uniques,
      relations: new Map(),
      relationKeys: [],
      ...(softKey ? { softDelete: fields.get(softKey)! } : {}),
    };
    byKey.set(key, model);
    byTable.set(model.table, model);
  }

  const models: Models = {
    byKey,
    byTable,
    schemaIR,
    model(key: string): ModelMeta {
      const m = byKey.get(key);
      if (!m) throw errors.unknownModel(key, [...byKey.keys()]);
      return m;
    },
  };

  if (relationsFn) {
    const declared = relationsFn(Object.fromEntries(tables));
    if (typeof declared !== 'object' || declared === null) {
      throw errors.schema('The relations option must return an object.', 'Example: relations: ({ users, posts }) => ({ users: { posts: many(posts) } }).');
    }
    for (const [modelKey, rels] of Object.entries(declared)) {
      const model = byKey.get(modelKey);
      if (!model) throw errors.unknownModel(modelKey, [...byKey.keys()]);
      for (const [relKey, rel] of Object.entries(rels ?? {})) {
        if (!isRelation(rel)) {
          throw errors.schema(`relations.${modelKey}.${relKey} is not a relation.`, 'Use one(table, ...) or many(table, ...).');
        }
        if (model.fields.has(relKey)) {
          throw errors.schema(`Relation "${relKey}" of ${modelKey} has the same name as a column.`, 'Rename the relation, for example authorId (column) and author (relation).');
        }
        model.relations.set(relKey, resolveRelation(models, model, relKey, rel));
      }
      model.relationKeys = [...model.relations.keys()];
    }
  }
  return models;
}

function modelOfTable(models: Models, tbl: AnyTable, from: string): ModelMeta {
  const m = models.byTable.get(tbl.$table.name);
  if (!m || m.source !== tbl) {
    throw errors.schema(
      `Relation ${from} points at table "${tbl.$table.name}", which is not in the schema.`,
      `Add it to the schema object passed to kastor().`,
    );
  }
  return m;
}

function fieldKeys(model: ModelMeta, keys: readonly string[], where: string): string[] {
  return keys.map((k) => {
    if (!model.fields.has(k)) throw errors.unknownField(model.key, k, model.fieldKeys, where);
    return k;
  });
}

function fksBetween(from: ModelMeta, to: ModelMeta): ForeignKeyIR[] {
  return from.tableIR.foreignKeys.filter((fk) => fk.refTable === to.table);
}

function fkFields(from: ModelMeta, to: ModelMeta, fk: ForeignKeyIR): { fromFields: string[]; toFields: string[] } {
  return {
    fromFields: fk.columns.map((c) => from.byColumn.get(c)!.key),
    toFields: fk.refColumns.map((c) => to.byColumn.get(c)!.key),
  };
}

function ambiguous(where: string, detail: string, hint: string): KastorError {
  return new KastorError('RELATION_AMBIGUOUS', `Cannot work out the columns of relation ${where}: ${detail}.`, { hint, meta: { relation: where } });
}

function resolveRelation(models: Models, source: ModelMeta, key: string, rel: AnyRelation): RelationMeta {
  const where = `${source.key}.${key}`;
  const target = modelOfTable(models, rel.target, where);
  let fromFields: string[];
  let toFields: string[];
  let owner = false;
  let through: RelationMeta['through'];

  if (rel.kind === 'one') {
    if (rel.fields && rel.references) {
      fromFields = fieldKeys(source, rel.fields, `relation ${where}`);
      toFields = fieldKeys(target, rel.references, `relation ${where}`);
      owner = true;
    } else {
      const own = fksBetween(source, target);
      const back = source === target ? [] : fksBetween(target, source);
      if (own.length === 1 && back.length === 0) {
        ({ fromFields, toFields } = fkFields(source, target, own[0]!));
        owner = true;
      } else if (own.length === 0 && back.length === 1) {
        const f = fkFields(target, source, back[0]!);
        fromFields = f.toFields;
        toFields = f.fromFields;
      } else if (own.length === 0 && back.length === 0) {
        throw ambiguous(
          where,
          `no foreign key links ${source.table} and ${target.table}`,
          `Add .references() to the foreign key column, or spell it out: one(${target.key}, { fields: ['${target.key.replace(/s$/, '')}Id'], references: ['id'] }).`,
        );
      } else {
        throw ambiguous(where, `several foreign keys link ${source.table} and ${target.table}`, `Pass them explicitly: one(${target.key}, { fields: [...], references: [...] }).`);
      }
    }
  } else if (rel.through) {
    const spec = rel.through as AnyTable | { table: AnyTable; fields: readonly string[]; references: readonly string[] };
    const joinTable = 'table' in spec && !('$table' in spec) ? spec.table : (spec as AnyTable);
    const join = modelOfTable(models, joinTable, where);
    let sourceFields: string[];
    let targetFields: string[];
    if ('fields' in spec && 'references' in spec && !('$table' in spec)) {
      sourceFields = fieldKeys(join, spec.fields, `relation ${where}`);
      targetFields = fieldKeys(join, spec.references, `relation ${where}`);
      const toSource = fksBetween(join, source).find((fk) => sameSet(fk.columns, sourceFields.map((k) => join.fields.get(k)!.column)));
      const toTarget = fksBetween(join, target).find((fk) => sameSet(fk.columns, targetFields.map((k) => join.fields.get(k)!.column)));
      fromFields = toSource ? toSource.refColumns.map((c) => source.byColumn.get(c)!.key) : source.primaryKey;
      toFields = toTarget ? toTarget.refColumns.map((c) => target.byColumn.get(c)!.key) : target.primaryKey;
    } else {
      const toSource = fksBetween(join, source);
      const toTarget = fksBetween(join, target);
      if (source === target || toSource.length !== 1 || toTarget.length !== 1) {
        throw ambiguous(
          where,
          `the join table ${join.table} needs exactly one foreign key to ${source.table} and one to ${target.table}`,
          `Spell it out: many(${target.key}, { through: { table: ${join.key}, fields: ['...'], references: ['...'] } }).`,
        );
      }
      const s = fkFields(join, source, toSource[0]!);
      const tt = fkFields(join, target, toTarget[0]!);
      sourceFields = s.fromFields;
      fromFields = s.toFields;
      targetFields = tt.fromFields;
      toFields = tt.toFields;
    }
    if (sourceFields.length !== fromFields.length || targetFields.length !== toFields.length) {
      throw ambiguous(where, 'the join table columns do not match the keys they point at', 'Use as many join columns as the key has.');
    }
    through = { modelKey: join.key, sourceFields, targetFields };
  } else if (rel.fields && rel.references) {
    fromFields = fieldKeys(source, rel.fields, `relation ${where}`);
    toFields = fieldKeys(target, rel.references, `relation ${where}`);
  } else {
    const back = fksBetween(target, source);
    if (back.length !== 1) {
      throw ambiguous(
        where,
        back.length === 0 ? `${target.table} has no foreign key to ${source.table}` : `${target.table} has several foreign keys to ${source.table}`,
        `Spell it out: many(${target.key}, { fields: ['id'], references: ['<column of ${target.key} pointing at ${source.key}>'] }).`,
      );
    }
    const f = fkFields(target, source, back[0]!);
    fromFields = f.toFields;
    toFields = f.fromFields;
  }

  if (fromFields.length !== toFields.length || fromFields.length === 0) {
    throw ambiguous(where, 'fields and references differ in length', 'Pass as many references as fields.');
  }

  const nullable =
    rel.kind === 'one' && (!owner || fromFields.some((k) => source.fields.get(k)!.config.nullable));

  const ir: RelationIR = {
    name: key,
    cardinality: rel.kind,
    from: source.table,
    to: target.table,
    fromColumns: fromFields.map((k) => source.fields.get(k)!.column),
    toColumns: toFields.map((k) => target.fields.get(k)!.column),
  };
  if (through) {
    const join = models.model(through.modelKey);
    ir.through = {
      table: join.table,
      sourceColumns: through.sourceFields.map((k) => join.fields.get(k)!.column),
      targetColumns: through.targetFields.map((k) => join.fields.get(k)!.column),
    };
  }
  if (target.softDelete) ir.softDeleteColumn = target.softDelete.column;

  return { key, kind: rel.kind, source, targetKey: target.key, fromFields, toFields, ...(through ? { through } : {}), owner, nullable, ir };
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}
