/**
 * `kastor import prisma`: turns a Prisma schema into a kastor TypeScript
 * schema that describes the SAME database Prisma Migrate created, so an
 * existing database keeps working without a single change:
 *
 * - table, column, index and constraint names follow Prisma's naming
 *   conventions (`User_email_key`, `Post_authorId_fkey`, `_CategoryToPost`);
 * - column types follow the native types Prisma picks per provider
 *   (`TIMESTAMP(3)` on PostgreSQL, `VARCHAR(191)` on MySQL, ...);
 * - implicit many-to-many relations get their `_AToB` join table with the
 *   `A` and `B` columns, exactly as Prisma names them.
 *
 * `prismaToKastor` is pure: it takes the schema text and returns the code, the
 * SchemaIR that code declares and a list of warnings for everything that
 * could not be mapped exactly.
 */
import type { ColumnIR, ForeignKeyIR, IndexIR, ReferentialAction, SchemaIR, TableIR } from '../../core/ir';
import { constraintName, sortByDependencies } from '../../core/schema-ir';
import { camelCase } from '../codegen';
import {
  argument,
  fieldList,
  findAttribute,
  parsePrismaSchema,
  stringValue,
  valueText,
  type PrismaArg,
  type PrismaAttribute,
  type PrismaEnum,
  type PrismaField,
  type PrismaModel,
  type PrismaSchema,
  type PrismaValue,
} from './prisma-parser';

export { parsePrismaSchema, PrismaParseError, type PrismaSchema } from './prisma-parser';

/** kastor database ids, the same as `kastor init --db`. */
export type ImportDatabase = 'postgres' | 'cockroach' | 'mysql' | 'sqlite' | 'mssql' | 'mongodb';

export interface PrismaImportWarning {
  /** `warn`: the result differs from the Prisma schema in a way that matters. `info`: worth knowing. */
  level: 'warn' | 'info';
  /** `Model.field`, `Model`, `enum Role` or `datasource`. */
  where: string;
  message: string;
  hint?: string;
}

export interface PrismaImportOptions {
  /** Import path of kastor in the generated file. Default `kastor`. */
  importFrom?: string;
  /** Where the schema came from, for the header comment. */
  source?: string;
  date?: Date;
  /** Override the datasource provider (`postgresql`, `mysql`, `sqlite`, `sqlserver`, `cockroachdb`, `mongodb`). */
  provider?: string;
}

export interface PrismaImportResult {
  /** The TypeScript schema file. */
  code: string;
  warnings: PrismaImportWarning[];
  /** What the code declares, in the shape migrations use. */
  schemaIR: SchemaIR;
  /** Datasource provider as written in the schema (or the override). */
  provider: string;
  /** The kastor adapter to use. */
  database: ImportDatabase;
  /** Name of the environment variable in `url = env("...")`, when there is one. */
  urlEnv?: string;
  /** The literal `url = "..."`, when the schema has one. */
  url?: string;
  relationMode: 'foreignKeys' | 'prisma';
  stats: { models: number; enums: number; joinTables: number; relations: number };
}

/* ------------------------------------------------------------------------ */
/* Internal model                                                            */
/* ------------------------------------------------------------------------ */

type Flavor = ImportDatabase;

interface ColumnSpec {
  key: string;
  ir: ColumnIR;
  /** Single column primary key declared on the column. */
  primaryKey: boolean;
  /** `.default(<literal>)` source text. */
  defaultExpr?: string;
  /** `.default(() => <expr>)` source text, for defaults Prisma Client generates. */
  jsDefault?: string;
  /** `t.json<T>()` or `.$type<T>()`. */
  tsType?: string;
  /** Identifier of the enum values constant, for `t.enum(Role, 'Role')`. */
  enumConst?: string;
  unique?: true | string;
  ref?: { table: TableSpec; columnKey: string; onDelete: ReferentialAction; onUpdate: ReferentialAction; name?: string };
  doc?: string;
}

interface IndexSpec {
  keys: string[];
  unique: boolean;
  name?: string;
}

interface RelationSpec {
  name: string;
  expr: string;
  /** Written as a comment because kastor cannot resolve it yet. */
  commented?: string;
  doc?: string;
}

interface TableSpec {
  name: string;
  ident: string;
  columns: ColumnSpec[];
  compositePk?: string[];
  indexes: IndexSpec[];
  relations: RelationSpec[];
  doc?: string;
  /** Prisma model name; undefined for implicit join tables. */
  model?: string;
}

interface EnumSpec {
  name: string;
  dbName: string;
  ident: string;
  values: Array<{ name: string; dbName: string }>;
  doc?: string;
}

const RESERVED = new Set(
  'break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await schema relations table t one many index uniqueIndex AnyColumn randomUUID randomBytes cuid nanoid ulid uuidv7 Date Object String Number Boolean'.split(' '),
);

const q = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;

const ACTIONS: Record<string, ReferentialAction> = {
  Cascade: 'cascade',
  Restrict: 'restrict',
  NoAction: 'no action',
  SetNull: 'set null',
  SetDefault: 'set default',
};

const SCALARS = new Set(['String', 'Boolean', 'Int', 'BigInt', 'Float', 'Decimal', 'DateTime', 'Json', 'Bytes', 'Unsupported']);

const PROVIDERS: Record<string, Flavor> = {
  postgresql: 'postgres',
  postgres: 'postgres',
  cockroachdb: 'cockroach',
  mysql: 'mysql',
  sqlite: 'sqlite',
  sqlserver: 'mssql',
  mongodb: 'mongodb',
};

/* ------------------------------------------------------------------------ */
/* Entry point                                                               */
/* ------------------------------------------------------------------------ */

/** Converts a Prisma schema to a kastor schema file. Throws a `KastorError` on syntax errors. */
export function prismaToKastor(source: string, options: PrismaImportOptions = {}): PrismaImportResult {
  const parsed = parsePrismaSchema(source, options.source);
  return new Importer(parsed, options).run();
}

class Importer {
  private readonly warnings: PrismaImportWarning[] = [];
  private readonly flavor: Flavor;
  private readonly provider: string;
  private readonly relationMode: 'foreignKeys' | 'prisma';
  private readonly urlEnv?: string;
  private readonly url?: string;
  private readonly taken = new Set<string>();
  private readonly enums = new Map<string, EnumSpec>();
  private readonly types = new Map<string, PrismaModel>();
  private readonly models = new Map<string, PrismaModel>();
  private readonly tables = new Map<string, TableSpec>();
  private readonly joinTables = new Map<string, TableSpec>();
  private readonly helpers = new Set<'randomUUID' | 'cuid' | 'nanoid' | 'ulid' | 'uuidv7'>();
  private relationCount = 0;

  constructor(
    private readonly schema: PrismaSchema,
    private readonly options: PrismaImportOptions,
  ) {
    const ds = schema.datasources[0];
    if (schema.datasources.length > 1) this.warn('info', 'datasource', `The schema has ${schema.datasources.length} datasource blocks; only "${ds!.name}" was used.`);
    const providerValue = ds?.properties.provider;
    let provider = options.provider ?? (providerValue?.kind === 'string' ? providerValue.value : undefined);
    if (!provider) {
      provider = 'postgresql';
      this.warn('warn', 'datasource', 'The schema has no datasource provider, so PostgreSQL was assumed.', 'Add a datasource block, or pass the provider explicitly.');
    }
    this.provider = provider;
    const flavor = PROVIDERS[provider];
    if (!flavor) {
      this.warn('warn', 'datasource', `Unknown datasource provider "${provider}", so PostgreSQL was assumed.`, 'Use postgresql, mysql, sqlite, sqlserver, cockroachdb or mongodb.');
    }
    this.flavor = flavor ?? 'postgres';
    const mode = ds?.properties.relationMode ?? ds?.properties.referentialIntegrity;
    this.relationMode = mode?.kind === 'string' && mode.value === 'prisma' ? 'prisma' : 'foreignKeys';
    const url = ds?.properties.url;
    if (url?.kind === 'call' && url.name === 'env') this.urlEnv = stringValue(url.args[0]?.value);
    else if (url?.kind === 'string') {
      this.url = url.value;
      this.warn('info', 'datasource', 'The connection URL is written in the schema.', 'Move it to an environment variable; kastor.config.ts reads DATABASE_URL.');
    }
    if (ds?.properties.extensions) {
      this.warn('info', 'datasource', `The datasource lists PostgreSQL extensions (${valueText(ds.properties.extensions)}).`, 'kastor migrations do not create extensions; they already exist in this database. Add CREATE EXTENSION to a migration for new databases.');
    }
    if (ds?.properties.schemas) {
      this.warn('warn', 'datasource', `The datasource uses several database schemas (${valueText(ds.properties.schemas)}).`, 'kastor reads and writes the default schema of the connection. Models in other schemas need a search_path on the connection.');
    }
    if (this.relationMode === 'prisma' && this.flavor !== 'mongodb') {
      this.warn('warn', 'datasource', 'relationMode = "prisma": the database has no foreign keys, so the kastor schema declares none either.', 'Relations still work for queries and nested writes. Referential actions (onDelete) are not emulated on SQL databases; add real foreign keys with .references() when you can.');
    }
  }

  private warn(level: PrismaImportWarning['level'], where: string, message: string, hint?: string): void {
    this.warnings.push({ level, where, message, ...(hint ? { hint } : {}) });
  }

  private ident(name: string, fallback: string): string {
    let base = camelCase(name);
    if (!/^[A-Za-z_$]/.test(base)) base = `_${base}`;
    if (RESERVED.has(base)) base = `${base}${fallback}`;
    let out = base;
    for (let i = 2; this.taken.has(out); i++) out = `${base}${i}`;
    this.taken.add(out);
    return out;
  }

  private typeIdent(name: string): string {
    let out = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) && !RESERVED.has(name) ? name : `${camelCase(name).replace(/^./, (c) => c.toUpperCase())}Values`;
    const base = out;
    for (let i = 2; this.taken.has(out); i++) out = `${base}${i}`;
    this.taken.add(out);
    return out;
  }

  run(): PrismaImportResult {
    for (const g of this.schema.generators) {
      const features = g.properties.previewFeatures;
      if (features?.kind === 'array' && features.items.some((i) => i.kind === 'string' && i.value === 'multiSchema')) {
        this.warn('info', `generator ${g.name}`, 'The multiSchema preview feature is on.', 'kastor uses the default schema of the connection for every table.');
      }
    }
    for (const e of this.schema.enums) this.addEnum(e);
    for (const m of this.schema.models) {
      if (m.kind === 'type') this.types.set(m.name, m);
      else if (m.kind === 'view') {
        this.warn('warn', m.name, `View ${m.name} was skipped: kastor schemas declare tables only.`, 'Query the view with db.$sql, or keep it in a raw migration.');
      } else this.models.set(m.name, m);
    }
    for (const m of this.models.values()) this.addTable(m);
    for (const m of this.models.values()) this.addColumns(m);
    for (const m of this.models.values()) this.addRelations(m, true);
    for (const m of this.models.values()) this.addRelations(m, false);
    for (const m of this.models.values()) this.addIndexes(m);

    const specs = [...this.tables.values(), ...this.joinTables.values()];
    const irs = specs.map((s) => this.tableIR(s));
    const order = sortByDependencies(irs).map((ir) => specs.find((s) => s.name === ir.name)!);
    const schemaIR = this.schemaIR(order.map((s) => irs.find((ir) => ir.name === s.name)!));
    const code = this.render(order);
    return {
      code,
      warnings: this.warnings,
      schemaIR,
      provider: this.provider,
      database: this.flavor,
      ...(this.urlEnv ? { urlEnv: this.urlEnv } : {}),
      ...(this.url ? { url: this.url } : {}),
      relationMode: this.relationMode,
      stats: { models: this.tables.size, enums: this.enums.size, joinTables: this.joinTables.size, relations: this.relationCount },
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Enums                                                                  */
  /* ---------------------------------------------------------------------- */

  private addEnum(e: PrismaEnum): void {
    const dbName = stringValue(argument(findAttribute(e.attributes, 'map'), 'name', 0)) ?? e.name;
    const values = e.values.map((v) => ({ name: v.name, dbName: stringValue(argument(findAttribute(v.attributes, 'map'), 'name', 0)) ?? v.name }));
    const mapped = values.filter((v) => v.name !== v.dbName);
    if (mapped.length) {
      this.warn(
        'info',
        `enum ${e.name}`,
        `Enum values with @map (${mapped.map((v) => `${v.name} is stored as "${v.dbName}"`).join(', ')}) use the stored text in kastor.`,
        `Write '${mapped[0]!.dbName}' instead of ${e.name}.${mapped[0]!.name} in queries.`,
      );
    }
    if (this.flavor === 'sqlite' || this.flavor === 'mssql') {
      this.noteOnce('textEnums', 'info', `enum ${e.name}`, `${this.flavor === 'sqlite' ? 'SQLite' : 'SQL Server'} has no enum type, so Prisma stores enums as text; kastor keeps the text column and types it with the enum values.`);
    }
    this.enums.set(e.name, { name: e.name, dbName, ident: this.typeIdent(e.name), values, ...(e.doc ? { doc: e.doc } : {}) });
  }

  /* ---------------------------------------------------------------------- */
  /* Tables and columns                                                     */
  /* ---------------------------------------------------------------------- */

  private isModel(type: string): boolean {
    return this.models.has(type);
  }

  private addTable(m: PrismaModel): void {
    const name = stringValue(argument(findAttribute(m.attributes, 'map'), 'name', 0)) ?? m.name;
    if (findAttribute(m.attributes, 'ignore')) {
      this.warn('info', m.name, `${m.name} has @@ignore. Its table is kept in the kastor schema so migrations leave it alone.`, 'Delete the table from the schema file if you want kastor to drop it.');
    }
    if (findAttribute(m.attributes, 'schema')) {
      this.warn('warn', m.name, `${m.name} lives in the database schema "${stringValue(argument(findAttribute(m.attributes, 'schema'), 'name', 0)) ?? '?'}".`, 'kastor uses the default schema of the connection; set search_path on the connection to reach it.');
    }
    this.tables.set(m.name, { name, ident: this.ident(m.name, 'Table'), columns: [], indexes: [], relations: [], ...(m.doc ? { doc: m.doc } : {}), model: m.name });
  }

  private addColumns(m: PrismaModel): void {
    const spec = this.tables.get(m.name)!;
    const idAttr = findAttribute(m.attributes, 'id');
    const compositeId = idAttr ? fieldList(argument(idAttr, 'fields', 0)).map((f) => f.name) : undefined;
    for (const f of m.fields) {
      if (this.isModel(f.type)) continue;
      const col = this.column(m, spec, f, compositeId);
      if (col) spec.columns.push(col);
    }
    if (compositeId?.length) {
      const missing = compositeId.filter((k) => !spec.columns.some((c) => c.key === k));
      if (missing.length) this.warn('warn', m.name, `@@id names fields that are not columns: ${missing.join(', ')}.`);
      spec.compositePk = compositeId.filter((k) => spec.columns.some((c) => c.key === k));
      for (const c of spec.columns) if (spec.compositePk.includes(c.key)) c.ir.nullable = false;
    }
    if (!compositeId?.length && !spec.columns.some((c) => c.primaryKey) && !findAttribute(m.attributes, 'unique') && !m.fields.some((f) => findAttribute(f.attributes, 'unique'))) {
      this.warn('info', m.name, `${m.name} has no primary key or unique field.`, 'findUnique, update and delete need a unique field; add one when you can.');
    }
  }

  private column(m: PrismaModel, table: TableSpec, f: PrismaField, compositeId: string[] | undefined): ColumnSpec | undefined {
    const where = `${m.name}.${f.name}`;
    const mapName = stringValue(argument(findAttribute(f.attributes, 'map'), 'name', 0));
    const isId = !!findAttribute(f.attributes, 'id');
    let dbName = mapName ?? f.name;
    if (this.flavor === 'mongodb' && isId && dbName === '_id') dbName = f.name;
    else if (this.flavor === 'mongodb' && dbName === '_id') this.warn('warn', where, '@map("_id") on a field that is not the @id.', 'kastor stores the primary key as _id; make this field the @id or rename it.');

    const ir: ColumnIR = { name: dbName, type: 'text', nullable: f.optional };
    const col: ColumnSpec = { key: f.name, ir, primaryKey: isId && !compositeId?.length, ...(f.doc ? { doc: f.doc } : {}) };
    if (findAttribute(f.attributes, 'ignore')) {
      this.warn('info', where, `${where} has @ignore. The column stays in the kastor schema so migrations keep it.`);
    }

    const enumSpec = this.enums.get(f.type);
    const composite = this.types.get(f.type);
    if (f.list && (SCALARS.has(f.type) || enumSpec)) {
      this.listColumn(where, f, col, enumSpec);
    } else if (composite) {
      ir.type = 'json';
      col.tsType = `${this.compositeTsName(composite.name)}${f.list ? '[]' : ''}`;
      this.warn('info', where, `Composite type ${composite.name} is stored as an embedded document (t.json).`, 'The TypeScript shape is generated from the type; kastor does not filter inside embedded documents.');
    } else if (enumSpec) {
      if (this.flavor === 'sqlite' || this.flavor === 'mssql') {
        ir.type = 'text';
        if (this.flavor === 'mssql') {
          ir.type = 'string';
          ir.length = 1000;
        }
        col.tsType = enumSpec.ident;
      } else {
        ir.type = 'enum';
        ir.enumValues = enumSpec.values.map((v) => v.dbName);
        ir.enumName = enumSpec.dbName;
        col.enumConst = enumSpec.ident;
      }
    } else if (SCALARS.has(f.type)) {
      this.scalarColumn(where, f, col);
    } else {
      this.warn('warn', where, `Unknown type ${f.type}; the column was left out.`, 'Declare it as a model, enum or type, or fix the spelling.');
      return undefined;
    }

    this.defaults(m, where, f, col);
    if (findAttribute(f.attributes, 'updatedAt')) {
      if (!col.jsDefault && !ir.default) col.jsDefault = 'new Date()';
      this.noteOnce('updatedAt', 'info', where, '@updatedAt is set by Prisma Client; kastor fills it on create only.', 'Pass the field (for example updatedAt: new Date()) in update calls.');
    }
    const unique = findAttribute(f.attributes, 'unique');
    if (unique && !col.primaryKey) {
      const map = stringValue(argument(unique, 'map'));
      col.unique = map && map !== constraintName(table.name, dbName, 'key') ? map : true;
      this.indexArgsNote(where, unique.args.filter((a) => a.name === 'sort' || a.name === 'length'));
    }
    if (col.primaryKey) ir.nullable = false;
    return col;
  }

  /** Scalar lists (PostgreSQL arrays, MongoDB arrays). */
  private listColumn(where: string, f: PrismaField, col: ColumnSpec, enumSpec: EnumSpec | undefined): void {
    const ir = col.ir;
    const elementTs = enumSpec ? enumSpec.ident : tsTypeOf(f.type);
    ir.type = 'json';
    col.tsType = `${elementTs}[]`;
    if (this.flavor === 'postgres' || this.flavor === 'cockroach') {
      const nativeAttr = f.attributes.find((a) => a.name.startsWith('db.'));
      const element = enumSpec ? enumSpec.dbName : pgArrayElement(f.type, nativeAttr?.name.slice(3));
      ir.nativeType = `${element}[]`;
      // Prisma creates array columns without NOT NULL.
      ir.nullable = true;
      this.warn('warn', where, `${where} is a ${f.type}[] array column; kastor has no array type, so it is declared as t.json with the native type ${element}[].`, 'Reads return arrays. Writes and list filters (has, hasSome) need db.$sql for now.');
    } else if (this.flavor !== 'mongodb') {
      this.warn('warn', where, `Scalar lists are not supported by Prisma on ${this.provider}; ${where} was declared as t.json.`);
    }
  }

  private scalarColumn(where: string, f: PrismaField, col: ColumnSpec): void {
    const ir = col.ir;
    const base = defaultScalar(this.flavor, f.type);
    Object.assign(ir, base);
    if (f.type === 'Unsupported') {
      ir.type = this.flavor === 'mysql' ? 'string' : this.flavor === 'sqlite' ? sqliteAffinity(f.unsupported ?? '') : 'text';
      ir.nativeType = f.unsupported ?? 'text';
      this.warn('warn', where, `${where} has the unsupported database type ${f.unsupported ?? '?'}; it is declared with that native type.`, 'kastor reads whatever the driver returns for it. Prisma Client hid this field; kastor shows it.');
      return;
    }
    if (f.type === 'Decimal') this.noteOnce('decimal', 'info', where, 'Decimal fields read as strings in kastor (Prisma returns Decimal objects), so no digit is lost.', 'Wrap them with your decimal library where you do arithmetic.');
    if (f.type === 'Bytes') this.noteOnce('bytes', 'info', where, 'Bytes fields read as Uint8Array in kastor (Prisma returns Uint8Array or Buffer).');
    if (f.type === 'DateTime' && this.flavor === 'sqlite') {
      this.noteOnce(
        'sqliteDates',
        'warn',
        where,
        'Prisma Client stores DateTime values in SQLite as Unix milliseconds, kastor writes ISO 8601 text. Both read back as Date, but where and orderBy compare numbers and text apart.',
        `Convert the old rows once per column: UPDATE "Table" SET "col" = strftime('%Y-%m-%dT%H:%M:%fZ', "col" / 1000.0, 'unixepoch') WHERE typeof("col") = 'integer'.`,
      );
    }
    const nativeAttr = f.attributes.find((a) => a.name.startsWith('db.'));
    if (!nativeAttr) return;
    const native = nativeAttr.name.slice(3);
    const args = nativeAttr.args.map((a) => (a.value.kind === 'number' ? a.value.value : a.value.kind === 'name' ? a.value.value : valueText(a.value)));
    const result = nativeType(this.flavor, f.type, native, args);
    if (!result) {
      this.warn('warn', where, `The native type @db.${native}${args.length ? `(${args.join(', ')})` : ''} has no kastor mapping; ${where} uses the default type for ${f.type}.`, 'Add .nativeType(...) by hand if migrations should keep it.');
      return;
    }
    if (result.note) this.warn('info', where, result.note);
    delete ir.length;
    delete ir.precision;
    delete ir.scale;
    delete ir.nativeType;
    Object.assign(ir, result.column);
  }

  private readonly grouped = new Map<string, { warning: PrismaImportWarning; wheres: string[] }>();

  /** One warning for many places: `where` lists them all. */
  private noteOnce(key: string, level: PrismaImportWarning['level'], where: string, message: string, hint?: string): void {
    const found = this.grouped.get(key);
    if (found) {
      if (!found.wheres.includes(where)) found.wheres.push(where);
      found.warning.where = found.wheres.join(', ');
      return;
    }
    const warning: PrismaImportWarning = { level, where, message, ...(hint ? { hint } : {}) };
    this.grouped.set(key, { warning, wheres: [where] });
    this.warnings.push(warning);
  }

  private compositeTsName(name: string): string {
    return name;
  }

  /* ---------------------------------------------------------------------- */
  /* Defaults                                                               */
  /* ---------------------------------------------------------------------- */

  private defaults(m: PrismaModel, where: string, f: PrismaField, col: ColumnSpec): void {
    const attr = findAttribute(f.attributes, 'default');
    const ir = col.ir;
    const isObjectIdKey = this.flavor === 'mongodb' && col.primaryKey && (f.attributes.some((a) => a.name === 'db.ObjectId') || ir.nativeType === 'objectId');
    if (isObjectIdKey) {
      // t.id() on MongoDB: a generated ObjectId stored as _id.
      ir.type = 'int';
      delete ir.nativeType;
      delete ir.length;
      ir.default = { kind: 'autoincrement' };
      const value = argument(attr, 'value', 0);
      if (attr && !(value?.kind === 'call' && value.name === 'auto')) this.warn('info', where, `${where} is an ObjectId key with @default(${value ? valueText(value) : ''}); kastor generates ObjectIds itself.`);
      return;
    }
    if (!attr) return;
    const value = argument(attr, 'value', 0);
    if (!value) return;
    if (value.kind === 'call') {
      switch (value.name) {
        case 'autoincrement':
        case 'sequence': {
          if (value.name === 'sequence') this.warn('info', where, 'sequence() is read as an auto increment column.');
          if (col.primaryKey && (ir.type === 'int' || ir.type === 'bigint')) {
            ir.default = { kind: 'autoincrement' };
            delete ir.nativeType;
          } else if (this.flavor === 'postgres') {
            ir.default = { kind: 'sql', value: `nextval('${pgQuote(`${this.tables.get(m.name)!.name}_${ir.name}_seq`)}'::regclass)` };
            this.warn('info', where, `${where} auto increments but is not the primary key; it keeps the sequence Prisma created as a SQL default.`);
          } else {
            this.warn('warn', where, `${where} auto increments but is not a single column primary key, which kastor cannot declare on ${this.provider}; the default was left out.`, 'migrate dev will propose to change this column; edit that migration to keep it.');
          }
          return;
        }
        case 'now':
          if (ir.type === 'datetime' || ir.type === 'date' || ir.type === 'time') ir.default = { kind: 'now' };
          else this.warn('warn', where, `now() on a ${f.type} column has no kastor equivalent; the default was left out.`);
          return;
        case 'uuid': {
          const version = value.args[0]?.value.kind === 'number' ? value.args[0].value.value : '4';
          if (version === '7') {
            this.helpers.add('uuidv7');
            col.jsDefault = 'uuidv7()';
          } else {
            this.helpers.add('randomUUID');
            col.jsDefault = 'randomUUID()';
          }
          this.noteOnce('clientDefault', 'info', where, 'Ids from uuid(), cuid(), nanoid() and ulid() are made by Prisma Client, not the database; kastor makes them in JS with the same format.', 'The helpers are at the top of the schema file; swap in your own library if you prefer.');
          return;
        }
        case 'cuid': {
          this.helpers.add('cuid');
          const version = value.args[0]?.value.kind === 'number' ? value.args[0].value.value : '1';
          col.jsDefault = version === '2' ? 'cuid(24)' : 'cuid()';
          this.noteOnce('clientDefault', 'info', where, 'Ids from uuid(), cuid(), nanoid() and ulid() are made by Prisma Client, not the database; kastor makes them in JS with the same format.', 'The helpers are at the top of the schema file; swap in your own library if you prefer.');
          return;
        }
        case 'nanoid': {
          this.helpers.add('nanoid');
          const size = value.args[0]?.value.kind === 'number' ? value.args[0].value.value : undefined;
          col.jsDefault = size ? `nanoid(${size})` : 'nanoid()';
          this.noteOnce('clientDefault', 'info', where, 'Ids from uuid(), cuid(), nanoid() and ulid() are made by Prisma Client, not the database; kastor makes them in JS with the same format.', 'The helpers are at the top of the schema file; swap in your own library if you prefer.');
          return;
        }
        case 'ulid':
          this.helpers.add('ulid');
          col.jsDefault = 'ulid()';
          this.noteOnce('clientDefault', 'info', where, 'Ids from uuid(), cuid(), nanoid() and ulid() are made by Prisma Client, not the database; kastor makes them in JS with the same format.', 'The helpers are at the top of the schema file; swap in your own library if you prefer.');
          return;
        case 'auto':
          this.warn('info', where, `auto() on ${where} has no kastor equivalent outside an ObjectId key; the default was left out.`);
          return;
        case 'dbgenerated': {
          const expr = stringValue(value.args[0]?.value);
          if (!expr) {
            this.warn('info', where, `${where} has dbgenerated() without an expression: the database fills it in a way the schema does not describe.`, 'Add .defaultSql(...) if migrations should write the default.');
            return;
          }
          if (ir.type === 'uuid' && /^(gen_random_uuid|uuid_generate_v4)\(\)$/i.test(expr.trim())) ir.default = { kind: 'random' };
          else ir.default = { kind: 'sql', value: expr };
          return;
        }
        default:
          this.warn('warn', where, `@default(${valueText(value)}) has no kastor equivalent; the default was left out.`);
          return;
      }
    }
    this.literalDefault(where, f, col, value);
  }

  private literalDefault(where: string, f: PrismaField, col: ColumnSpec, value: PrismaValue): void {
    const ir = col.ir;
    if (value.kind === 'array') {
      if (ir.nativeType?.endsWith('[]') && (this.flavor === 'postgres' || this.flavor === 'cockroach')) {
        const items = value.items.map((i) => (i.kind === 'string' ? `'${i.value.replace(/'/g, "''")}'` : i.kind === 'name' ? `'${this.enumDbValue(f.type, i.value).replace(/'/g, "''")}'` : valueText(i)));
        ir.default = { kind: 'sql', value: `ARRAY[${items.join(', ')}]::${ir.nativeType}` };
      } else if (ir.type === 'json') {
        const items = value.items.map((i) => (i.kind === 'string' ? i.value : i.kind === 'number' ? Number(i.value) : i.kind === 'boolean' ? i.value : i.kind === 'name' ? this.enumDbValue(f.type, i.value) : valueText(i)));
        ir.default = { kind: 'value', value: items };
        col.defaultExpr = JSON.stringify(items);
      } else this.warn('warn', where, `The list default ${valueText(value)} was left out.`);
      return;
    }
    const raw = value.kind === 'name' ? this.enumDbValue(f.type, value.value) : value.kind === 'string' || value.kind === 'number' ? value.value : value.kind === 'boolean' ? value.value : undefined;
    if (raw === undefined) {
      this.warn('warn', where, `@default(${valueText(value)}) has no kastor equivalent; the default was left out.`);
      return;
    }
    switch (ir.type) {
      case 'int':
      case 'float': {
        const n = Number(raw);
        if (!Number.isFinite(n)) return this.warn('warn', where, `The default ${String(raw)} is not a number; it was left out.`);
        ir.default = { kind: 'value', value: n };
        col.defaultExpr = String(n);
        return;
      }
      case 'bigint':
        ir.default = { kind: 'value', value: String(raw) };
        col.defaultExpr = `${String(raw)}n`;
        return;
      case 'decimal':
        ir.default = { kind: 'value', value: String(raw) };
        col.defaultExpr = q(String(raw));
        return;
      case 'boolean':
        ir.default = { kind: 'value', value: raw === true || raw === 'true' };
        col.defaultExpr = String(raw === true || raw === 'true');
        return;
      case 'datetime': {
        const d = new Date(String(raw));
        if (Number.isNaN(d.getTime())) return this.warn('warn', where, `The default ${String(raw)} is not a date; it was left out.`);
        ir.default = { kind: 'value', value: d.toISOString() };
        col.defaultExpr = `new Date(${q(d.toISOString())})`;
        return;
      }
      case 'json': {
        if (ir.nativeType?.endsWith('[]')) return this.warn('warn', where, `The default ${String(raw)} of an array column was left out.`);
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(raw));
        } catch {
          parsed = raw;
        }
        ir.default = { kind: 'value', value: parsed };
        col.defaultExpr = JSON.stringify(parsed);
        return;
      }
      case 'bytes':
        this.warn('warn', where, 'Defaults on Bytes columns are not supported by kastor; it was left out.');
        return;
      default:
        ir.default = { kind: 'value', value: String(raw) };
        col.defaultExpr = q(String(raw));
    }
  }

  private enumDbValue(type: string, name: string): string {
    const e = this.enums.get(type);
    return e?.values.find((v) => v.name === name)?.dbName ?? name;
  }

  /* ---------------------------------------------------------------------- */
  /* Relations                                                              */
  /* ---------------------------------------------------------------------- */

  private relationInfo(f: PrismaField): { name?: string; fields: string[]; references: string[]; attr?: PrismaAttribute } {
    const attr = findAttribute(f.attributes, 'relation');
    return {
      name: stringValue(argument(attr, 'name', 0)),
      fields: fieldList(argument(attr, 'fields')).map((x) => x.name),
      references: fieldList(argument(attr, 'references')).map((x) => x.name),
      ...(attr ? { attr } : {}),
    };
  }

  private opposite(m: PrismaModel, f: PrismaField): PrismaField | undefined {
    const target = this.models.get(f.type)!;
    const name = this.relationInfo(f).name;
    const candidates = target.fields.filter((x) => x.type === m.name && x !== f && this.relationInfo(x).name === name);
    if (candidates.length > 1) this.warn('warn', `${m.name}.${f.name}`, `Several fields of ${target.name} could be the other side of ${m.name}.${f.name}.`, 'Name the relation on both sides: @relation("Name").');
    return candidates[0];
  }

  /** First pass (`keysOnly`): foreign keys of the owning sides. Second pass: every relation, in field order. */
  private addRelations(m: PrismaModel, keysOnly: boolean): void {
    const spec = this.tables.get(m.name)!;
    for (const f of m.fields) {
      if (!this.isModel(f.type)) continue;
      const where = `${m.name}.${f.name}`;
      const target = this.tables.get(f.type)!;
      const info = this.relationInfo(f);
      const doc = f.doc;
      if (keysOnly) {
        if (info.fields.length) this.foreignKey(m, f, spec, target, info, where);
        continue;
      }
      this.relationCount++;
      if (info.fields.length) {
        if (info.fields.length === info.references.length) {
          spec.relations.push({ name: f.name, expr: `one(${target.ident}, { fields: [${info.fields.map(q).join(', ')}], references: [${info.references.map(q).join(', ')}] })`, ...(doc ? { doc } : {}) });
        }
        continue;
      }
      const other = this.opposite(m, f);
      if (!other) {
        this.warn('warn', where, `${where} has no matching relation field on ${f.type}, so it was left out.`, 'Prisma needs both sides of a relation; run npx prisma validate.');
        continue;
      }
      const otherInfo = this.relationInfo(other);
      if (f.list && other.list) {
        this.manyToMany(m, f, other, info.name, spec, target, where);
        continue;
      }
      if (!otherInfo.fields.length) {
        this.warn('warn', where, `Neither ${where} nor ${f.type}.${other.name} says which fields hold the foreign key, so the relation was left out.`, 'Add @relation(fields: [...], references: [...]) on one side.');
        continue;
      }
      const fieldKeys = otherInfo.references;
      const refKeys = otherInfo.fields;
      if (f.list) {
        spec.relations.push({ name: f.name, expr: `many(${target.ident}, { fields: [${fieldKeys.map(q).join(', ')}], references: [${refKeys.map(q).join(', ')}] })`, ...(doc ? { doc } : {}) });
        continue;
      }
      // The side of a one-to-one relation without the foreign key.
      const expr = `one(${target.ident})`;
      if (this.resolvableBackSide(m.name, f.type)) spec.relations.push({ name: f.name, expr, ...(doc ? { doc } : {}) });
      else {
        spec.relations.push({ name: f.name, expr, commented: 'kastor cannot tell this relation apart yet', ...(doc ? { doc } : {}) });
        this.warn(
          'warn',
          where,
          `${where} is the side of a one-to-one relation without the foreign key, and ${m.name === f.type ? 'it is a self relation' : `${m.name} and ${f.type} are linked more than once`}${this.relationMode === 'prisma' && this.flavor !== 'mongodb' ? ' (or the schema has no foreign keys)' : ''}; it is written as a comment.`,
          `Read it from the other side (${f.type}.${other.name}) for now.`,
        );
      }
    }
  }

  /** `one(target)` without fields works when exactly one foreign key links the two tables, from the target. */
  private resolvableBackSide(source: string, target: string): boolean {
    if (source === target) return false;
    const s = this.tables.get(source)!;
    const tt = this.tables.get(target)!;
    const own = s.columns.filter((c) => c.ref?.table === tt).length;
    const back = tt.columns.filter((c) => c.ref?.table === s).length;
    return own === 0 && back === 1;
  }

  private foreignKey(m: PrismaModel, f: PrismaField, spec: TableSpec, target: TableSpec, info: ReturnType<Importer['relationInfo']>, where: string): void {
    const { fields, references } = info;
    if (fields.length !== references.length) {
      this.warn('warn', where, `@relation on ${where} has ${fields.length} fields and ${references.length} references; the relation was left out.`);
      return;
    }
    const attr = info.attr;
    const optional = f.optional;
    const onDeleteName = argument(attr, 'onDelete');
    const onUpdateName = argument(attr, 'onUpdate');
    const onDelete = onDeleteName?.kind === 'name' ? ACTIONS[onDeleteName.value] : undefined;
    const onUpdate = onUpdateName?.kind === 'name' ? ACTIONS[onUpdateName.value] : undefined;
    if (onDeleteName && !onDelete) this.warn('warn', where, `Unknown onDelete action ${valueText(onDeleteName)}.`);
    if (onUpdateName && !onUpdate) this.warn('warn', where, `Unknown onUpdate action ${valueText(onUpdateName)}.`);
    if (this.relationMode === 'prisma' && this.flavor !== 'mongodb') return;
    if (fields.length > 1) {
      this.warn(
        'warn',
        where,
        `${where} uses a composite foreign key (${fields.join(', ')}). The relation works, but .references() covers one column, so the schema does not declare the constraint.`,
        'Until composite foreign keys land, migrate dev proposes to drop that constraint: run kastor migrate dev --create-only and delete the DROP statement before applying.',
      );
      return;
    }
    const column = spec.columns.find((c) => c.key === fields[0]);
    const refColumn = target.columns.find((c) => c.key === references[0]);
    if (!column || !refColumn) {
      this.warn('warn', where, `@relation on ${where} names a field that is not a column (${!column ? fields[0] : references[0]}); the foreign key was left out.`);
      return;
    }
    if (column.ref) {
      this.warn('warn', where, `${m.name}.${column.key} is the foreign key of two relations; kastor declares one constraint per column, so only the first is kept.`);
      return;
    }
    const map = stringValue(argument(attr, 'map'));
    const defaultName = constraintName(spec.name, column.ir.name, 'fkey');
    column.ref = {
      table: target,
      columnKey: refColumn.key,
      onDelete: onDelete ?? (optional ? 'set null' : 'restrict'),
      onUpdate: onUpdate ?? 'cascade',
      ...(map && map !== defaultName ? { name: map } : {}),
    };
  }

  private manyToMany(m: PrismaModel, f: PrismaField, other: PrismaField, relationName: string | undefined, spec: TableSpec, target: TableSpec, where: string): void {
    // Prisma's convention: model A is the model whose name sorts first; in a
    // self relation, the field whose name sorts first is the A side.
    const [modelA, modelB] = [m.name, f.type].sort();
    const joinName = `_${relationName ?? `${modelA}To${modelB}`}`;
    let fIsA: boolean;
    if (m.name === f.type) fIsA = f.name < other.name;
    else fIsA = m.name === modelA;
    let join = this.joinTables.get(joinName);
    if (!join) {
      join = this.joinTable(joinName, this.tables.get(modelA!)!, this.tables.get(modelB!)!, where);
      if (!join) return;
      this.joinTables.set(joinName, join);
    }
    const [sourceCol, targetCol] = fIsA ? ['A', 'B'] : ['B', 'A'];
    spec.relations.push({
      name: f.name,
      expr: `many(${target.ident}, { through: { table: ${join.ident}, fields: [${q(sourceCol)}], references: [${q(targetCol)}] } })`,
      ...(f.doc ? { doc: f.doc } : {}),
    });
  }

  private joinTable(name: string, a: TableSpec, b: TableSpec, where: string): TableSpec | undefined {
    const idOf = (t: TableSpec): ColumnSpec | undefined => {
      const pk = t.compositePk?.length ? undefined : t.columns.find((c) => c.primaryKey);
      return pk;
    };
    const pa = idOf(a);
    const pb = idOf(b);
    if (!pa || !pb) {
      this.warn('warn', where, `The implicit many-to-many relation ${name} needs a single field @id on both models; it was left out.`);
      return undefined;
    }
    const keyColumn = (key: 'A' | 'B', ref: ColumnSpec, table: TableSpec): ColumnSpec => {
      const ir: ColumnIR = { name: key, type: ref.ir.type, nullable: false };
      for (const prop of ['length', 'precision', 'scale', 'nativeType', 'enumValues', 'enumName'] as const) {
        if (ref.ir[prop] !== undefined) (ir as unknown as Record<string, unknown>)[prop] = ref.ir[prop];
      }
      const col: ColumnSpec = {
        key,
        ir,
        primaryKey: false,
        ref: { table, columnKey: ref.key, onDelete: 'cascade', onUpdate: 'cascade' },
      };
      if (ref.enumConst) col.enumConst = ref.enumConst;
      if (ref.tsType && ir.type !== 'json') col.tsType = ref.tsType;
      if (this.flavor === 'mongodb' && ir.type === 'int' && ref.ir.default?.kind === 'autoincrement') {
        ir.type = 'string';
        ir.nativeType = 'objectId';
      }
      if (this.relationMode === 'prisma' && this.flavor !== 'mongodb') delete col.ref;
      return col;
    };
    const spec: TableSpec = {
      name,
      ident: this.ident(name.replace(/^_+/, ''), 'Join'),
      columns: [keyColumn('A', pa, a), keyColumn('B', pb, b)],
      indexes: [],
      relations: [],
      doc: `Join table of the implicit many-to-many relation between ${a.model} and ${b.model}, named the way Prisma names it.`,
    };
    if (this.flavor === 'postgres' || this.flavor === 'cockroach') {
      spec.compositePk = ['A', 'B'];
      this.noteOnce(
        'joinPk',
        'info',
        name,
        `Implicit many-to-many tables get a primary key on (A, B), as Prisma 6 creates them on ${this.provider}.`,
        'Databases created with Prisma 5 or older have a unique index _AB_unique instead; replace primaryKey with uniqueIndex(c.A, c.B).name(...) in those tables if migrate dev proposes a change.',
      );
    } else spec.indexes.push({ keys: ['A', 'B'], unique: true, name: `${name}_AB_unique` });
    spec.indexes.push({ keys: ['B'], unique: false, name: `${name}_B_index` });
    return spec;
  }

  /* ---------------------------------------------------------------------- */
  /* Indexes                                                                */
  /* ---------------------------------------------------------------------- */

  private addIndexes(m: PrismaModel): void {
    const spec = this.tables.get(m.name)!;
    for (const attr of m.attributes) {
      if (attr.name !== 'unique' && attr.name !== 'index' && attr.name !== 'fulltext') continue;
      const where = `${m.name}`;
      const items = fieldList(argument(attr, 'fields', 0));
      const keys = items.map((i) => i.name);
      const missing = keys.filter((k) => !spec.columns.some((c) => c.key === k));
      if (!keys.length || missing.length) {
        this.warn('warn', where, `@@${attr.name}(${keys.join(', ')}) names fields that are not columns${missing.length ? ` (${missing.join(', ')})` : ''}; it was left out.`);
        continue;
      }
      if (attr.name === 'fulltext') {
        this.warn('info', where, `@@fulltext(${keys.join(', ')}) is declared as a plain index; kastor does not create full text indexes.`, 'Search with db.$sql (MATCH ... AGAINST) as before.');
      }
      const unique = attr.name === 'unique';
      const map = stringValue(argument(attr, 'map')) ?? (unique ? undefined : stringValue(argument(attr, 'name')));
      const dbCols = keys.map((k) => spec.columns.find((c) => c.key === k)!.ir.name);
      const defaultName = constraintName(spec.name, ...dbCols, unique ? 'key' : 'idx');
      const type = argument(attr, 'type');
      if (type) this.warn('info', where, `@@${attr.name}(${keys.join(', ')}, type: ${valueText(type)}): kastor indexes do not carry an index method; it is compared as a plain index.`);
      const extra = items.flatMap((i) => i.args);
      this.indexArgsNote(where, extra.concat(attr.args.filter((a) => a.name === 'sort' || a.name === 'length' || a.name === 'ops' || a.name === 'clustered')));
      spec.indexes.push({ keys, unique, ...(map && map !== defaultName ? { name: map } : {}) });
    }
  }

  private indexArgsNote(where: string, args: PrismaArg[]): void {
    if (!args.length) return;
    this.warn('info', where, `Index options (${args.map((a) => `${a.name ?? ''}: ${valueText(a.value)}`).join(', ')}) are not part of kastor indexes; the index is compared by its columns only.`);
  }

  /* ---------------------------------------------------------------------- */
  /* IR                                                                     */
  /* ---------------------------------------------------------------------- */

  private tableIR(spec: TableSpec): TableIR {
    const columns = spec.columns.map((c) => {
      const ir: ColumnIR = { ...c.ir };
      if (ir.type === 'enum' && !ir.enumName) ir.enumName = `${spec.name}_${ir.name}`;
      return ir;
    });
    const primaryKey = spec.compositePk?.length
      ? spec.compositePk.map((k) => spec.columns.find((c) => c.key === k)!.ir.name)
      : spec.columns.filter((c) => c.primaryKey).map((c) => c.ir.name);
    const indexes: IndexIR[] = [];
    for (const c of spec.columns) {
      if (c.unique && !c.primaryKey) indexes.push({ name: typeof c.unique === 'string' ? c.unique : constraintName(spec.name, c.ir.name, 'key'), columns: [c.ir.name], unique: true });
    }
    for (const i of spec.indexes) {
      const cols = i.keys.map((k) => spec.columns.find((c) => c.key === k)!.ir.name);
      indexes.push({ name: i.name ?? constraintName(spec.name, ...cols, i.unique ? 'key' : 'idx'), columns: cols, unique: i.unique });
    }
    const foreignKeys: ForeignKeyIR[] = [];
    for (const c of spec.columns) {
      if (!c.ref) continue;
      foreignKeys.push({
        name: c.ref.name ?? constraintName(spec.name, c.ir.name, 'fkey'),
        columns: [c.ir.name],
        refTable: c.ref.table.name,
        refColumns: [c.ref.table.columns.find((x) => x.key === c.ref!.columnKey)!.ir.name],
        onDelete: c.ref.onDelete,
        onUpdate: c.ref.onUpdate,
      });
    }
    return { name: spec.name, columns, primaryKey, indexes, foreignKeys };
  }

  private schemaIR(tables: TableIR[]): SchemaIR {
    const enums = new Map<string, { name: string; values: string[] }>();
    for (const t of tables) {
      for (const c of t.columns) {
        if (c.type !== 'enum' || !c.enumName || !c.enumValues) continue;
        enums.set(c.enumName, { name: c.enumName, values: [...c.enumValues] });
      }
    }
    return { tables, enums: [...enums.values()] };
  }

  /* ---------------------------------------------------------------------- */
  /* Code                                                                   */
  /* ---------------------------------------------------------------------- */

  private render(order: TableSpec[]): string {
    const from = this.options.importFrom ?? 'kastor';
    const imports = new Set<string>(['table', 't']);
    const position = new Map(order.map((s, i) => [s.name, i]));
    let anyColumn = false;
    const blocks: string[] = [];

    for (const spec of order) {
      const lines: string[] = [];
      for (const c of spec.columns) {
        if (c.doc) lines.push(...jsDoc(c.doc, '  '));
        let expr = this.columnExpr(c);
        if (c.ref) {
          const target = c.ref.table;
          const later = (position.get(target.name) ?? 0) >= (position.get(spec.name) ?? 0);
          if (later) anyColumn = true;
          const opts: string[] = [];
          if (c.ref.onDelete !== 'no action') opts.push(`onDelete: ${q(c.ref.onDelete)}`);
          if (c.ref.onUpdate !== 'no action') opts.push(`onUpdate: ${q(c.ref.onUpdate)}`);
          if (c.ref.name) opts.push(`name: ${q(c.ref.name)}`);
          expr += `.references(${later ? '(): AnyColumn' : '()'} => ${target.ident}.${c.ref.columnKey}${opts.length ? `, { ${opts.join(', ')} }` : ''})`;
        }
        if (c.ir.name !== c.key) expr += `.map(${q(c.ir.name)})`;
        lines.push(`  ${c.key}: ${expr},`);
      }
      const tableOpts: string[] = [];
      if (spec.compositePk?.length) tableOpts.push(`primaryKey: (c) => [${spec.compositePk.map((k) => `c.${k}`).join(', ')}]`);
      if (spec.indexes.length) {
        const items = spec.indexes.map((i) => {
          const fn = i.unique ? 'uniqueIndex' : 'index';
          imports.add(fn);
          return `${fn}(${i.keys.map((k) => `c.${k}`).join(', ')})${i.name ? `.name(${q(i.name)})` : ''}`;
        });
        tableOpts.push(`indexes: (c) => [${items.join(', ')}]`);
      }
      const doc = spec.doc ? `${jsDoc(spec.doc, '').join('\n')}\n` : '';
      const head = `${doc}export const ${spec.ident} = table(${q(spec.name)}, {\n${lines.join('\n')}\n}`;
      blocks.push(tableOpts.length ? `${head}, {\n  ${tableOpts.join(',\n  ')},\n});` : `${head});`);
    }

    const withRelations = order.filter((s) => s.relations.length);
    const used = new Set<string>();
    const relationBlocks: string[] = [];
    for (const spec of withRelations) {
      const lines: string[] = [];
      for (const r of spec.relations) {
        if (r.doc) lines.push(...jsDoc(r.doc, '    '));
        if (r.commented) {
          lines.push(`    // ${r.name}: ${r.expr}, (${r.commented})`);
          continue;
        }
        for (const m of r.expr.matchAll(/\b(one|many)\(/g)) imports.add(m[1]!);
        for (const s of order) if (new RegExp(`\\b${s.ident}\\b`).test(r.expr)) used.add(s.ident);
        lines.push(`    ${r.name}: ${r.expr},`);
      }
      relationBlocks.push(`  ${spec.ident}: {\n${lines.join('\n')}\n  },`);
    }

    const date = (this.options.date ?? new Date()).toISOString().slice(0, 10);
    const out: string[] = [
      `// Schema imported from ${this.options.source ?? 'schema.prisma'} by kastor import prisma on ${date}.`,
      `// Prisma provider: ${this.provider}. Table, column and constraint names match the database Prisma created.`,
      '// This file is now the source of truth: edit it, then run kastor migrate dev.',
    ];
    const cryptoImports = [...(this.helpers.has('randomUUID') ? ['randomUUID'] : []), ...(['cuid', 'nanoid', 'ulid', 'uuidv7'].some((h) => this.helpers.has(h as never)) ? ['randomBytes'] : [])];
    if (cryptoImports.length) out.push(`import { ${cryptoImports.join(', ')} } from 'node:crypto';`);
    const order2 = ['table', 't', 'index', 'uniqueIndex', 'one', 'many'];
    out.push(`import { ${[...imports].sort((a, b) => order2.indexOf(a) - order2.indexOf(b)).join(', ')} } from ${q(from)};`);
    if (anyColumn) out.push(`import type { AnyColumn } from ${q(from)};`);
    out.push('');
    const helperCode = this.helperCode();
    if (helperCode) out.push(helperCode, '');
    for (const e of this.enums.values()) {
      if (e.doc) out.push(...jsDoc(e.doc, ''));
      out.push(`export const ${e.ident} = [${e.values.map((v) => q(v.dbName)).join(', ')}] as const;`);
      out.push(`export type ${e.ident} = (typeof ${e.ident})[number];`, '');
    }
    for (const type of this.types.values()) out.push(this.compositeInterface(type), '');
    out.push(blocks.join('\n\n'), '');
    out.push(`export const schema = { ${order.map((s) => s.ident).join(', ')} };`);
    if (relationBlocks.length) {
      const params = order.filter((s) => used.has(s.ident)).map((s) => s.ident);
      out.push('', `export const relations = (${params.length ? `{ ${params.join(', ')} }` : '_'}: typeof schema) => ({`, ...relationBlocks, '});');
    }
    return `${out.join('\n')}\n`;
  }

  private columnExpr(c: ColumnSpec): string {
    const ir = c.ir;
    const auto = ir.default?.kind === 'autoincrement' && c.primaryKey;
    let expr: string;
    switch (ir.type) {
      case 'int':
        expr = auto ? 't.id()' : 't.int()';
        break;
      case 'bigint':
        expr = auto ? 't.bigId()' : 't.bigint()';
        break;
      case 'string':
        expr = ir.length !== undefined ? `t.string(${ir.length})` : 't.string()';
        break;
      case 'decimal':
        expr = (ir.precision ?? 10) === 10 && (ir.scale ?? 2) === 2 ? 't.decimal()' : `t.decimal(${ir.precision ?? 10}, ${ir.scale ?? 0})`;
        break;
      case 'enum':
        expr = `t.enum(${c.enumConst}, ${q(ir.enumName!)})`;
        break;
      case 'json':
        expr = c.tsType ? `t.json<${c.tsType}>()` : 't.json()';
        break;
      default:
        expr = `t.${ir.type}()`;
    }
    if (ir.nativeType) expr += `.nativeType(${q(ir.nativeType)})`;
    if (c.tsType && ir.type !== 'json') expr += `.$type<${c.tsType}>()`;
    if (ir.nullable) expr += '.nullable()';
    if (c.primaryKey && !auto) expr += '.primaryKey()';
    if (!auto && !ir.default && c.jsDefault) expr += `.default(() => ${c.jsDefault})`;
    if (!auto && ir.default) {
      switch (ir.default.kind) {
        case 'now':
          expr += '.defaultNow()';
          break;
        case 'random':
          expr += '.defaultRandom()';
          break;
        case 'sql':
          expr += `.defaultSql(${q(String(ir.default.value))})`;
          break;
        case 'value':
          expr += `.default(${c.defaultExpr})`;
          break;
        default:
          break;
      }
    }
    if (c.unique) expr += c.unique === true ? '.unique()' : `.unique(${q(c.unique)})`;
    return expr;
  }

  private compositeInterface(type: PrismaModel): string {
    const lines: string[] = [];
    if (type.doc) lines.push(...jsDoc(type.doc, ''));
    lines.push(`export interface ${this.compositeTsName(type.name)} {`);
    for (const f of type.fields) {
      if (f.doc) lines.push(...jsDoc(f.doc, '  '));
      const name = (stringValue(argument(findAttribute(f.attributes, 'map'), 'name', 0)) ?? f.name);
      const ts = this.enums.get(f.type)?.ident ?? (this.types.has(f.type) ? this.compositeTsName(f.type) : tsTypeOf(f.type));
      const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : q(name);
      lines.push(`  ${key}${f.optional ? '?' : ''}: ${ts}${f.list ? '[]' : ''}${f.optional ? ' | null' : ''};`);
    }
    lines.push('}');
    return lines.join('\n');
  }

  private helperCode(): string {
    const parts: string[] = [];
    if (this.helpers.has('cuid')) {
      parts.push(`/** Collision resistant id in the cuid format (Prisma @default(cuid())): 'c', a time part and random base 36 characters. */
function cuid(length = 25): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  const time = Date.now().toString(36).padStart(8, '0');
  const random = Array.from(randomBytes(length), (b) => alphabet[b % 36]).join('');
  return \`c\${time}\${random}\`.slice(0, length);
}`);
    }
    if (this.helpers.has('nanoid')) {
      parts.push(`/** URL friendly random id (Prisma @default(nanoid())). */
function nanoid(size = 21): string {
  const alphabet = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';
  return Array.from(randomBytes(size), (b) => alphabet[b & 63]).join('');
}`);
    }
    if (this.helpers.has('ulid')) {
      parts.push(`/** Sortable random id (Prisma @default(ulid())): 10 time characters and 16 random ones, Crockford base 32. */
function ulid(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let time = Date.now();
  let head = '';
  for (let i = 0; i < 10; i++) {
    head = alphabet[time % 32] + head;
    time = Math.floor(time / 32);
  }
  return head + Array.from(randomBytes(16), (b) => alphabet[b & 31]).join('');
}`);
    }
    if (this.helpers.has('uuidv7')) {
      parts.push(`/** Time ordered UUID, version 7 (Prisma @default(uuid(7))). */
function uuidv7(): string {
  const bytes = randomBytes(16);
  const time = BigInt(Date.now());
  for (let i = 0; i < 6; i++) bytes[i] = Number((time >> BigInt(8 * (5 - i))) & 255n);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return \`\${hex.slice(0, 8)}-\${hex.slice(8, 12)}-\${hex.slice(12, 16)}-\${hex.slice(16, 20)}-\${hex.slice(20)}\`;
}`);
    }
    return parts.join('\n\n');
  }
}

/* ------------------------------------------------------------------------ */
/* Type tables                                                               */
/* ------------------------------------------------------------------------ */

type ColumnShape = Partial<Pick<ColumnIR, 'type' | 'length' | 'precision' | 'scale' | 'nativeType'>> & { type: ColumnIR['type'] };

/** The column Prisma Migrate creates for a scalar type without a native type attribute. */
function defaultScalar(flavor: Flavor, type: string): ColumnShape {
  switch (type) {
    case 'String':
      if (flavor === 'mysql') return { type: 'string', length: 191 };
      if (flavor === 'mssql') return { type: 'string', length: 1000 };
      if (flavor === 'mongodb') return { type: 'string' };
      return { type: 'text' };
    case 'Boolean':
      return { type: 'boolean' };
    case 'Int':
      return { type: 'int' };
    case 'BigInt':
      return { type: 'bigint' };
    case 'Float':
      return { type: 'float' };
    case 'Decimal':
      if (flavor === 'sqlite') return { type: 'decimal', precision: 10, scale: 2, nativeType: 'DECIMAL' };
      if (flavor === 'mssql') return { type: 'decimal', precision: 32, scale: 16 };
      if (flavor === 'mongodb') return { type: 'decimal', precision: 10, scale: 2 };
      return { type: 'decimal', precision: 65, scale: 30 };
    case 'DateTime':
      if (flavor === 'postgres' || flavor === 'cockroach') return { type: 'datetime', nativeType: 'timestamp(3)' };
      if (flavor === 'mssql') return { type: 'datetime', nativeType: 'datetime2(7)' };
      return { type: 'datetime' };
    case 'Json':
      if (flavor === 'sqlite') return { type: 'json', nativeType: 'JSONB' };
      return { type: 'json' };
    case 'Bytes':
      if (flavor === 'mssql') return { type: 'bytes', nativeType: 'varbinary(max)' };
      return { type: 'bytes' };
    default:
      return { type: 'text' };
  }
}

interface NativeResult {
  column: ColumnShape;
  note?: string;
}

const n = (value: string | undefined): number | undefined => (value === undefined || !/^\d+$/.test(value) ? undefined : Number(value));

/**
 * Maps `@db.X(args)` to a kastor column. Native type strings are spelled the
 * way each dialect's introspection reports them, so `migrate dev` sees the
 * imported schema and the live database as equal.
 */
function nativeType(flavor: Flavor, scalar: string, native: string, args: string[]): NativeResult | undefined {
  const a0 = n(args[0]);
  const a1 = n(args[1]);
  if (flavor === 'postgres' || flavor === 'cockroach') {
    switch (native) {
      case 'Text':
      case 'String':
        return { column: { type: 'text' } };
      case 'VarChar':
        return { column: a0 !== undefined ? { type: 'string', length: a0 } : { type: 'string' } };
      case 'Char':
        return { column: { type: 'string', length: a0 ?? 1, nativeType: `char(${a0 ?? 1})` } };
      case 'Uuid':
        return { column: { type: 'uuid' } };
      case 'Xml':
      case 'Inet':
      case 'Citext':
        return { column: { type: 'text', nativeType: native.toLowerCase() } };
      case 'Bit':
        return { column: { type: 'text', nativeType: 'bit' }, ...(a0 && a0 !== 1 ? { note: `bit(${a0}) is compared as bit; the length is kept in the database.` } : {}) };
      case 'VarBit':
        return { column: { type: 'text', nativeType: 'bit varying' } };
      case 'SmallInt':
      case 'Int2':
        return { column: { type: 'int', nativeType: 'smallint' } };
      case 'Integer':
      case 'Int4':
        return { column: { type: 'int' } };
      case 'Oid':
        return { column: { type: 'int', nativeType: 'oid' } };
      case 'BigInt':
      case 'Int8':
        return { column: { type: 'bigint' } };
      case 'Real':
      case 'Float4':
        return { column: { type: 'float', nativeType: 'real' } };
      case 'DoublePrecision':
      case 'Float8':
        return { column: { type: 'float' } };
      case 'Decimal':
        return { column: a0 !== undefined ? { type: 'decimal', precision: a0, scale: a1 ?? 0 } : { type: 'decimal', precision: 65, scale: 30, nativeType: 'numeric' } };
      case 'Money':
        return { column: { type: 'decimal', precision: 19, scale: 2, nativeType: 'money' } };
      case 'Timestamp':
        return { column: { type: 'datetime', nativeType: `timestamp(${a0 ?? 6})` } };
      case 'Timestamptz':
        return { column: (a0 ?? 6) === 3 ? { type: 'datetime' } : { type: 'datetime', nativeType: `timestamptz(${a0 ?? 6})` } };
      case 'Date':
        return { column: { type: 'date' } };
      case 'Time':
        return { column: (a0 ?? 6) === 6 ? { type: 'time' } : { type: 'time', nativeType: `time(${a0})` } };
      case 'Timetz':
        return { column: { type: 'time', nativeType: 'time with time zone' } };
      case 'Json':
        return { column: { type: 'json', nativeType: 'json' } };
      case 'JsonB':
        return { column: { type: 'json' } };
      case 'ByteA':
      case 'Bytes':
        return { column: { type: 'bytes' } };
      case 'Boolean':
      case 'Bool':
        return { column: { type: 'boolean' } };
      default:
        return undefined;
    }
  }
  if (flavor === 'mysql') {
    switch (native) {
      case 'VarChar':
        return { column: { type: 'string', length: a0 ?? 191 } };
      case 'Char':
        return { column: { type: 'string', length: a0 ?? 1, nativeType: `CHAR(${a0 ?? 1})` } };
      case 'TinyText':
      case 'Text':
      case 'MediumText':
        return { column: { type: 'text', nativeType: native.toUpperCase() } };
      case 'LongText':
        return { column: { type: 'text' } };
      case 'Int':
        return { column: { type: 'int' } };
      case 'UnsignedInt':
      case 'UnsignedSmallInt':
      case 'UnsignedMediumInt':
      case 'UnsignedTinyInt':
      case 'UnsignedBigInt':
        return {
          column: native === 'UnsignedBigInt' ? { type: 'bigint' } : native === 'UnsignedInt' ? { type: 'int' } : { type: 'int', nativeType: native.replace('Unsigned', '').toUpperCase() },
          note: `@db.${native}: kastor compares it as the signed type; the database keeps UNSIGNED.`,
        };
      case 'SmallInt':
      case 'MediumInt':
        return { column: { type: 'int', nativeType: native.toUpperCase() } };
      case 'TinyInt':
        if (scalar === 'Boolean') return { column: { type: 'boolean' } };
        return { column: { type: 'int', nativeType: 'TINYINT' } };
      case 'BigInt':
        return { column: { type: 'bigint' } };
      case 'Float':
        return { column: { type: 'float', nativeType: 'FLOAT' } };
      case 'Double':
        return { column: { type: 'float' } };
      case 'Decimal':
        return { column: { type: 'decimal', precision: a0 ?? 10, scale: a1 ?? 0 } };
      case 'DateTime':
        return { column: { type: 'datetime' }, ...((a0 ?? 3) !== 3 ? { note: `DATETIME(${a0}) is compared as DATETIME(3); the database keeps its precision.` } : {}) };
      case 'Timestamp':
        return { column: { type: 'datetime', nativeType: a0 ? `TIMESTAMP(${a0})` : 'TIMESTAMP' } };
      case 'Date':
        return { column: { type: 'date' } };
      case 'Time':
        return { column: { type: 'time' } };
      case 'Year':
        return { column: { type: 'int', nativeType: 'YEAR' } };
      case 'Bit':
        if (scalar === 'Boolean' || (a0 ?? 1) === 1) return { column: { type: 'boolean', nativeType: 'BIT(1)' } };
        return { column: { type: 'bytes', nativeType: `BIT(${a0})` } };
      case 'Binary':
      case 'VarBinary':
        return { column: { type: 'bytes', nativeType: `${native.toUpperCase()}(${a0 ?? 1})` } };
      case 'TinyBlob':
      case 'Blob':
      case 'MediumBlob':
        return { column: { type: 'bytes', nativeType: native.toUpperCase() } };
      case 'LongBlob':
        return { column: { type: 'bytes' } };
      case 'Json':
        return { column: { type: 'json' } };
      default:
        return undefined;
    }
  }
  if (flavor === 'mssql') {
    const max = args[0] === 'Max' || args[0] === 'max';
    switch (native) {
      case 'VarChar':
      case 'NVarChar':
        if (max) return { column: { type: 'text', nativeType: `${native.toLowerCase()}(max)` } };
        return { column: { type: 'string', length: a0 ?? 1, nativeType: `${native.toLowerCase()}(${a0 ?? 1})` } };
      case 'Char':
      case 'NChar':
        return { column: { type: 'string', length: a0 ?? 1, nativeType: `${native.toLowerCase()}(${a0 ?? 1})` } };
      case 'Text':
      case 'NText':
      case 'Xml':
        return { column: { type: 'text', nativeType: native.toLowerCase() } };
      case 'Int':
        return { column: { type: 'int' } };
      case 'SmallInt':
      case 'TinyInt':
        return { column: { type: 'int', nativeType: native.toLowerCase() } };
      case 'BigInt':
        return { column: { type: 'bigint' } };
      case 'Bit':
        return { column: { type: 'boolean' } };
      case 'Float':
        return { column: { type: 'float' } };
      case 'Real':
        return { column: { type: 'float', nativeType: 'real' } };
      case 'Decimal':
        return { column: { type: 'decimal', precision: a0 ?? 18, scale: a1 ?? 0 } };
      case 'Money':
      case 'SmallMoney':
        return { column: { type: 'decimal', precision: 19, scale: 4, nativeType: native.toLowerCase() } };
      case 'DateTime':
      case 'SmallDateTime':
      case 'DateTimeOffset':
        return { column: { type: 'datetime', nativeType: native.toLowerCase() } };
      case 'DateTime2':
        return { column: (a0 ?? 7) === 3 ? { type: 'datetime' } : { type: 'datetime', nativeType: `datetime2(${a0 ?? 7})` } };
      case 'Date':
        return { column: { type: 'date' } };
      case 'Time':
        return { column: { type: 'time' } };
      case 'Binary':
      case 'VarBinary':
        return { column: { type: 'bytes', nativeType: `${native.toLowerCase()}(${max ? 'max' : (a0 ?? 1)})` } };
      case 'Image':
        return { column: { type: 'bytes', nativeType: 'image' } };
      case 'UniqueIdentifier':
        return { column: { type: 'uuid' } };
      default:
        return undefined;
    }
  }
  if (flavor === 'mongodb') {
    switch (native) {
      case 'ObjectId':
        return { column: { type: 'string', nativeType: 'objectId' } };
      case 'String':
        return { column: { type: 'string' } };
      case 'Int':
        return { column: { type: 'int' } };
      case 'Long':
        return { column: { type: 'bigint' } };
      case 'Double':
        return { column: { type: 'float' } };
      case 'Bool':
        return { column: { type: 'boolean' } };
      case 'Date':
        return { column: { type: scalar === 'DateTime' ? 'datetime' : 'date' } };
      case 'Timestamp':
        return { column: { type: 'datetime' } };
      case 'BinData':
        return { column: { type: 'bytes' } };
      default:
        return undefined;
    }
  }
  return undefined;
}

/** Element type name PostgreSQL introspection reports for an array column. */
function pgArrayElement(scalar: string, native: string | undefined): string {
  switch (native) {
    case 'VarChar':
      return 'varchar';
    case 'Uuid':
      return 'uuid';
    case 'SmallInt':
      return 'int2';
    case 'Real':
      return 'float4';
    case 'Timestamptz':
      return 'timestamptz';
    case 'Date':
      return 'date';
    case 'Citext':
      return 'citext';
    case 'Json':
      return 'json';
    default:
      break;
  }
  switch (scalar) {
    case 'Int':
      return 'int4';
    case 'BigInt':
      return 'int8';
    case 'Float':
      return 'float8';
    case 'Decimal':
      return 'numeric';
    case 'Boolean':
      return 'bool';
    case 'DateTime':
      return 'timestamp';
    case 'Json':
      return 'jsonb';
    case 'Bytes':
      return 'bytea';
    default:
      return 'text';
  }
}

function tsTypeOf(scalar: string): string {
  switch (scalar) {
    case 'String':
      return 'string';
    case 'Int':
    case 'Float':
      return 'number';
    case 'BigInt':
      return 'bigint';
    case 'Decimal':
      return 'string';
    case 'Boolean':
      return 'boolean';
    case 'DateTime':
      return 'Date';
    case 'Bytes':
      return 'Uint8Array';
    default:
      return 'unknown';
  }
}

function sqliteAffinity(declared: string): ColumnIR['type'] {
  const upper = declared.toUpperCase();
  if (upper === '') return 'bytes';
  if (upper.includes('INT')) return upper.includes('BIG') ? 'bigint' : 'int';
  if (/CHAR|CLOB|TEXT/.test(upper)) return 'text';
  if (upper.includes('BLOB')) return 'bytes';
  if (/REAL|FLOA|DOUB/.test(upper)) return 'float';
  if (/BOOL/.test(upper)) return 'boolean';
  if (/TIMESTAMP|DATETIME/.test(upper)) return 'datetime';
  return 'decimal';
}

function pgQuote(name: string): string {
  return /^[a-z_][a-z0-9_]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`;
}

function jsDoc(text: string, indent: string): string[] {
  const lines = text.split('\n').map((l) => l.replace(/\*\//g, '* /'));
  if (lines.length === 1) return [`${indent}/** ${lines[0]} */`];
  return [`${indent}/**`, ...lines.map((l) => `${indent} * ${l}`.trimEnd()), `${indent} */`];
}
