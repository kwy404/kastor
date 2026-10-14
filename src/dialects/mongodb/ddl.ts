/**
 * Migrations and introspection for MongoDB.
 *
 * A table is a collection with a `$jsonSchema` validator built from its
 * columns; indexes (and a composite primary key, as a unique index) are
 * regular indexes. Each migration statement is one database command written
 * as JSON, so a migration.sql file for MongoDB reads like:
 *
 *   {"create": "users", "validator": {"$jsonSchema": {...}}}
 *   {"createIndexes": "users", "indexes": [{"name": "users_email_key", "key": {"email": 1}, "unique": true}]}
 *
 * Foreign keys and named enums do not exist on the server, so their ops
 * produce no statements; kastor reads foreign keys from the schema at runtime
 * to emulate `onDelete`.
 */
import { BSON, type Document } from 'mongodb';
import type { AppliedMigration, ColumnIR, IndexIR, MigrationOpLike, MigrationTable, NeutralType, SchemaIR, TableIR } from '../../core/ir';
import { mongoError } from './errors';
import type { MongoExecutor } from './executor';
import { COUNTERS, encodeValue, getModel, MIGRATIONS, type IdMode, type Model } from './model';

type Doc = Record<string, unknown>;

/* ------------------------------------------------------------------------ */
/* Validators                                                                 */
/* ------------------------------------------------------------------------ */

const bsonTypes: Record<NeutralType, string | string[] | null> = {
  string: 'string',
  text: 'string',
  int: ['int', 'long'],
  bigint: ['long', 'int'],
  float: ['double', 'int', 'long', 'decimal'],
  decimal: 'decimal',
  boolean: 'bool',
  datetime: 'date',
  date: 'date',
  time: 'string',
  json: null,
  bytes: 'binData',
  uuid: 'string',
  enum: 'string',
};

/** Types that share a BSON type with another one keep their neutral type in the description. */
const tagged = new Set<NeutralType>(['text', 'date', 'time', 'uuid', 'json', 'bigint', 'float']);

function propertySchema(model: Model, table: string, column: ColumnIR): Doc {
  const info = model.tables.get(table)?.columns.get(column.name);
  const prop: Doc = {};
  let types: string[] | null;
  if (info?.objectId) types = ['objectId'];
  else if (info?.uuidRef) types = ['string'];
  else {
    const t = bsonTypes[column.type];
    types = t === null ? null : Array.isArray(t) ? [...t] : [t];
  }
  if (types) {
    if (column.nullable) types.push('null');
    prop.bsonType = types.length === 1 ? types[0] : types;
  }
  if (column.type === 'string' && column.length !== undefined) prop.maxLength = column.length;
  if (column.type === 'enum' && column.enumValues) prop.enum = column.nullable ? [...column.enumValues, null] : [...column.enumValues];
  const meta: string[] = [];
  if (info?.field === '_id' && column.name !== '_id') meta.push(`column=${column.name}`);
  if (tagged.has(column.type) || info?.objectId || info?.field === '_id') meta.push(`type=${column.type}`);
  if (column.precision !== undefined) meta.push(`precision=${column.precision}`);
  if (column.scale !== undefined) meta.push(`scale=${column.scale}`);
  if (column.default) {
    const d = column.default;
    meta.push(d.kind === 'value' || d.kind === 'sql' ? `default=${d.kind}:${JSON.stringify(d.value)}` : `default=${d.kind}`);
  }
  if (column.nativeType) meta.push(`native=${column.nativeType}`);
  if (meta.length > 0) prop.description = `kastor ${meta.join(';')}`;
  return prop;
}

/** The `$jsonSchema` validator for a table. Required: every column that is not nullable. */
export function jsonSchema(model: Model, table: TableIR): Doc {
  const info = model.tables.get(table.name);
  const properties: Doc = {};
  const required: string[] = [];
  for (const column of table.columns) {
    const field = info?.columns.get(column.name)?.field ?? column.name;
    properties[field] = propertySchema(model, table.name, column);
    if (!column.nullable) required.push(field);
  }
  const schema: Doc = { bsonType: 'object', properties };
  if (required.length > 0) schema.required = required;
  if (table.primaryKey.length > 1) schema.description = `kastor primaryKey=${table.primaryKey.join(',')}`;
  return { $jsonSchema: schema };
}

/* ------------------------------------------------------------------------ */
/* DDL                                                                        */
/* ------------------------------------------------------------------------ */

const json = (cmd: Doc): string => BSON.EJSON.stringify(cmd, { relaxed: true });

function indexSpec(model: Model, table: string, index: IndexIR): Doc {
  const info = model.tables.get(table);
  const key: Doc = {};
  for (const c of index.columns) key[info?.columns.get(c)?.field ?? c] = 1;
  const spec: Doc = { name: index.name, key };
  if (index.unique) spec.unique = true;
  return spec;
}

/** Name of the unique index that stands for a composite primary key. */
export const pkIndexName = (table: string): string => `${table}_pkey`;

function tableIndexes(model: Model, table: TableIR): Doc[] {
  const specs: Doc[] = [];
  if (table.primaryKey.length > 1) specs.push(indexSpec(model, table.name, { name: pkIndexName(table.name), columns: table.primaryKey, unique: true }));
  for (const idx of table.indexes) specs.push(indexSpec(model, table.name, idx));
  return specs;
}

function collMod(model: Model, table: TableIR): string {
  return json({ collMod: table.name, validator: jsonSchema(model, table), validationLevel: 'strict', validationAction: 'error' });
}

function findTable(schema: SchemaIR, name: string): TableIR | undefined {
  return schema.tables.find((t) => t.name === name);
}

/** Statements (JSON commands) for one migration op. `schema` is the state after the op. */
export function mongoDdl(op: MigrationOpLike, schema: SchemaIR, ids: IdMode): string[] {
  const model = getModel(schema, ids);
  const o = op as Doc & { kind: string };
  switch (o.kind) {
    case 'createTable': {
      const table = o.table as TableIR;
      const m = findTable(schema, table.name) ? model : getModel({ tables: [...schema.tables, table] }, ids);
      const out = [json({ create: table.name, validator: jsonSchema(m, table), validationLevel: 'strict', validationAction: 'error' })];
      const indexes = tableIndexes(m, table);
      if (indexes.length > 0) out.push(json({ createIndexes: table.name, indexes }));
      return out;
    }
    case 'dropTable':
      return [json({ drop: o.table as string })];
    case 'renameTable':
      return [json({ renameCollection: o.from as string, to: o.to as string })];
    case 'addColumn': {
      const table = findTable(schema, o.table as string);
      const column = o.column as ColumnIR;
      const out: string[] = [];
      // Existing documents get the default (or null) first so the stricter validator accepts them.
      const info = model.tables.get(o.table as string)?.columns.get(column.name);
      const field = info?.field ?? column.name;
      const fill = column.default?.kind === 'value' ? encodeValue(column.default.value, info) : null;
      if (column.default?.kind === 'now') {
        out.push(json({ update: o.table, updates: [{ q: { [field]: { $exists: false } }, u: [{ $set: { [field]: '$$NOW' } }], multi: true }] }));
      } else {
        out.push(json({ update: o.table, updates: [{ q: { [field]: { $exists: false } }, u: { $set: { [field]: fill } }, multi: true }] }));
      }
      if (table) out.push(collMod(model, table));
      return out;
    }
    case 'dropColumn': {
      const table = findTable(schema, o.table as string);
      const prev = model.tables.get(o.table as string);
      const field = prev?.columns.get(o.column as string)?.field ?? (o.column as string);
      const out: string[] = [];
      if (table) out.push(collMod(model, table));
      out.push(json({ update: o.table, updates: [{ q: { [field]: { $exists: true } }, u: { $unset: { [field]: '' } }, multi: true }] }));
      return out;
    }
    case 'renameColumn': {
      const table = findTable(schema, o.table as string);
      const out: string[] = [];
      const field = model.tables.get(o.table as string)?.columns.get(o.to as string)?.field ?? (o.to as string);
      if (field !== '_id') {
        // Loosen the validator first, rename, then apply the new one.
        out.push(json({ collMod: o.table, validator: {}, validationLevel: 'off' }));
        out.push(json({ update: o.table, updates: [{ q: { [o.from as string]: { $exists: true } }, u: { $rename: { [o.from as string]: field } }, multi: true }] }));
      }
      if (table) out.push(collMod(model, table));
      return out;
    }
    case 'alterColumn': {
      const table = findTable(schema, o.table as string);
      return table ? [collMod(model, table)] : [];
    }
    case 'createIndex':
      return [json({ createIndexes: o.table, indexes: [indexSpec(model, o.table as string, o.index as IndexIR)] })];
    case 'dropIndex':
      return [json({ dropIndexes: o.table, index: (o.index as IndexIR).name })];
    case 'addForeignKey':
    case 'dropForeignKey':
    case 'createEnum':
    case 'dropEnum':
      return [];
    case 'alterEnum': {
      const out: string[] = [];
      const tables = new Set(((o.columns as Array<{ table: string }>) ?? []).map((c) => c.table));
      for (const name of tables) {
        const table = findTable(schema, name);
        if (table) out.push(collMod(model, table));
      }
      return out;
    }
    case 'raw': {
      const sql = o.sql as string | Record<string, string>;
      const text = typeof sql === 'string' ? sql : sql.mongodb;
      return text ? [text] : [];
    }
    default:
      throw mongoError('UNSUPPORTED', `Unknown migration op "${o.kind}".`, 'Update kastor/mongodb to the same version as kastor.');
  }
}

/**
 * Splits a migration file into commands: top level JSON objects, one after
 * another. Text outside objects (blank lines, `--` or `//` comments,
 * semicolons) is ignored.
 */
export function splitCommands(script: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  for (let i = 0; i < script.length; i++) {
    const ch = script[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (depth === 0 && ch !== '{') {
      if ((ch === '-' && script[i + 1] === '-') || (ch === '/' && script[i + 1] === '/')) {
        const nl = script.indexOf('\n', i);
        i = nl === -1 ? script.length : nl;
      }
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) out.push(script.slice(start, i + 1));
    }
  }
  if (depth !== 0) throw mongoError('MIGRATION_FAILED', 'The migration script has an unterminated JSON command.', 'Check the braces of the last command in migration.sql.');
  return out;
}

/* ------------------------------------------------------------------------ */
/* Introspection                                                              */
/* ------------------------------------------------------------------------ */

function parseMeta(description: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof description !== 'string' || !description.startsWith('kastor ')) return out;
  for (const part of description.slice(7).split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return out;
}

function typeFromBson(types: string[], prop: Doc): NeutralType {
  if (prop.enum) return 'enum';
  const t = types.filter((x) => x !== 'null');
  if (t.includes('decimal') && t.length === 1) return 'decimal';
  if (t.includes('double')) return 'float';
  if (t.includes('long') && !t.includes('int')) return 'bigint';
  if (t.includes('int') || t.includes('long') || t.includes('number')) return 'int';
  if (t.includes('bool')) return 'boolean';
  if (t.includes('date')) return 'datetime';
  if (t.includes('binData')) return 'bytes';
  if (t.includes('objectId')) return 'string';
  if (t.includes('string')) return 'string';
  return 'json';
}

function columnFromProperty(field: string, prop: Doc, required: boolean): ColumnIR {
  const meta = parseMeta(prop.description);
  const raw = prop.bsonType;
  const types = raw === undefined ? [] : Array.isArray(raw) ? (raw as string[]) : [raw as string];
  const type = (meta.type as NeutralType | undefined) ?? typeFromBson(types, prop);
  const column: ColumnIR = {
    name: meta.column ?? (field === '_id' ? 'id' : field),
    type,
    nullable: types.length === 0 ? !required : types.includes('null') || !required,
  };
  if (field === '_id') column.nullable = false;
  if (typeof prop.maxLength === 'number') column.length = prop.maxLength;
  if (Array.isArray(prop.enum)) column.enumValues = (prop.enum as unknown[]).filter((v): v is string => typeof v === 'string');
  if (meta.precision) column.precision = Number(meta.precision);
  if (meta.scale) column.scale = Number(meta.scale);
  if (meta.native) column.nativeType = meta.native;
  else if (types.includes('objectId') && field !== '_id') column.nativeType = 'objectId';
  if (meta.default) {
    const [kind, ...rest] = meta.default.split(':');
    const value = rest.join(':');
    if (kind === 'value' || kind === 'sql') column.default = { kind, value: value ? JSON.parse(value) : undefined };
    else if (kind === 'now' || kind === 'random' || kind === 'autoincrement') column.default = { kind };
  } else if (field === '_id' && types.includes('objectId')) {
    column.default = { kind: 'autoincrement' };
  }
  return column;
}

function bsonTypeOf(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'double';
  if (typeof value === 'bigint') return 'long';
  if (value instanceof Date) return 'date';
  if (Array.isArray(value)) return 'array';
  const bt = (value as { _bsontype?: string })._bsontype;
  switch (bt) {
    case 'ObjectId':
      return 'objectId';
    case 'Decimal128':
      return 'decimal';
    case 'Long':
      return 'long';
    case 'Int32':
      return 'int';
    case 'Double':
      return 'double';
    case 'Binary':
      return 'binData';
    default:
      return 'object';
  }
}

/** Infers columns from sampled documents when a collection has no validator. */
export function inferColumns(docs: Doc[]): ColumnIR[] {
  const seen = new Map<string, { types: Set<string>; count: number }>();
  for (const doc of docs) {
    for (const [k, v] of Object.entries(doc)) {
      let s = seen.get(k);
      if (!s) {
        s = { types: new Set(), count: 0 };
        seen.set(k, s);
      }
      s.types.add(bsonTypeOf(v));
      s.count++;
    }
  }
  const columns: ColumnIR[] = [];
  for (const [field, s] of seen) {
    const types = [...s.types];
    const nonNull = types.filter((t) => t !== 'null');
    let type: NeutralType;
    if (nonNull.length === 0) type = 'string';
    else if (nonNull.some((t) => t === 'object' || t === 'array')) type = 'json';
    else if (nonNull.length > 1 && !nonNull.every((t) => ['int', 'long', 'double', 'decimal'].includes(t))) type = 'json';
    else type = typeFromBson(nonNull, {});
    const column: ColumnIR = { name: field === '_id' ? 'id' : field, type, nullable: field !== '_id' && (types.includes('null') || s.count < docs.length) };
    if (nonNull.includes('objectId')) {
      if (field === '_id') column.default = { kind: 'autoincrement' };
      else column.nativeType = 'objectId';
    }
    columns.push(column);
  }
  columns.sort((a, b) => (a.name === 'id' ? -1 : b.name === 'id' ? 1 : 0));
  return columns;
}

const internal = (name: string): boolean => name.startsWith('system.') || name === MIGRATIONS || name === COUNTERS;

export async function introspectDb(exec: MongoExecutor, sampleSize = 100): Promise<SchemaIR> {
  const collections = await exec.db.listCollections({}, { nameOnly: false }).toArray();
  const tables: TableIR[] = [];
  for (const c of collections as Array<{ name: string; type?: string; options?: Doc }>) {
    if (c.type === 'view' || internal(c.name)) continue;
    const coll = exec.db.collection(c.name);
    const validator = (c.options?.validator as Doc | undefined)?.$jsonSchema as Doc | undefined;
    let columns: ColumnIR[];
    let primaryKey: string[] = [];
    const fieldToColumn = new Map<string, string>();
    if (validator && validator.properties && typeof validator.properties === 'object') {
      const required = new Set(Array.isArray(validator.required) ? (validator.required as string[]) : []);
      columns = Object.entries(validator.properties as Record<string, Doc>).map(([field, prop]) => {
        const col = columnFromProperty(field, prop, required.has(field));
        fieldToColumn.set(field, col.name);
        return col;
      });
      const pkMeta = parseMeta(validator.description).primaryKey;
      if (pkMeta) primaryKey = pkMeta.split(',');
      else if (validator.properties && '_id' in (validator.properties as Doc)) primaryKey = [fieldToColumn.get('_id') ?? 'id'];
    } else {
      const docs = (await coll.aggregate([{ $sample: { size: sampleSize } }]).toArray()) as Doc[];
      columns = docs.length > 0 ? inferColumns(docs) : [{ name: 'id', type: 'string', nullable: false, nativeType: 'objectId', default: { kind: 'autoincrement' } }];
      for (const col of columns) fieldToColumn.set(col.name === 'id' && !columns.some((x) => x.name === '_id') ? '_id' : col.name, col.name);
      primaryKey = ['id'];
    }
    const indexes: IndexIR[] = [];
    for (const idx of (await coll.listIndexes().toArray()) as Array<{ name: string; key: Doc; unique?: boolean }>) {
      if (idx.name === '_id_') continue;
      const cols = Object.keys(idx.key).map((f) => fieldToColumn.get(f) ?? f);
      if (idx.name === pkIndexName(c.name) && idx.unique) {
        if (primaryKey.length <= 1) primaryKey = cols;
        continue;
      }
      indexes.push({ name: idx.name, columns: cols, unique: Boolean(idx.unique) });
    }
    tables.push({ name: c.name, columns, primaryKey, indexes, foreignKeys: [] });
  }
  tables.sort((a, b) => a.name.localeCompare(b.name));
  return { tables };
}

/* ------------------------------------------------------------------------ */
/* Migration bookkeeping                                                      */
/* ------------------------------------------------------------------------ */

export const mongoMigrationTable: MigrationTable<MongoExecutor> = {
  async ensure(exec) {
    const existing = await exec.db.listCollections({ name: MIGRATIONS }, { nameOnly: true }).toArray();
    if (existing.length === 0) await exec.db.createCollection(MIGRATIONS);
  },
  async list(exec) {
    const docs = await exec.db
      .collection<{ _id: string; checksum: string; appliedAt: Date }>(MIGRATIONS)
      .find({}, exec.session ? { session: exec.session } : {})
      .sort({ _id: 1 })
      .toArray();
    return docs.map((d): AppliedMigration => ({ id: d._id, checksum: d.checksum, appliedAt: d.appliedAt }));
  },
  async record(exec, migration) {
    await exec.db
      .collection<Document>(MIGRATIONS)
      .replaceOne({ _id: migration.id } as Document, { checksum: migration.checksum, appliedAt: migration.appliedAt }, { upsert: true, ...(exec.session ? { session: exec.session } : {}) });
  },
  async remove(exec, id) {
    await exec.db.collection<Document>(MIGRATIONS).deleteOne({ _id: id } as Document, exec.session ? { session: exec.session } : {});
  },
};
