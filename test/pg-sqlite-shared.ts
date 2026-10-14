/**
 * Shared fixtures for the Postgres, CockroachDB and SQLite schema tests: a
 * schema that uses every neutral type and modifier, helpers that create it
 * through `dialect.ddl` and a normalizer for comparing SchemaIR values.
 */
import type { Dialect, Executor, SchemaIR, TableIR } from '../src/core/ir';
import { index, t, table, uniqueIndex } from '../src/core/schema';
import { toSchemaIR } from '../src/core/schema-ir';
import { applyOp, type MigrationOp } from '../src/migrate/ops';

export const rtUsers = table('rt_users', {
  id: t.id(),
  email: t.string(255).unique(),
  name: t.string().nullable(),
  bio: t.text().nullable(),
  role: t.enum(['user', 'admin', "it's"]).default('user'),
  age: t.int().default(18),
  negative: t.int().default(-1),
  big: t.bigint().default(9007199254740993n),
  score: t.float().default(1.5),
  balance: t.decimal(12, 2).default('10.50'),
  ratio: t.decimal(6, 4).nullable(),
  active: t.boolean().default(true),
  archived: t.boolean().default(false),
  createdAt: t.datetime().defaultNow(),
  fixedAt: t.datetime().default(new Date('2024-01-02T03:04:05.678Z')),
  birthday: t.date().nullable(),
  day: t.date().default('2024-01-02'),
  wakeUp: t.time().nullable(),
  meta: t.json<{ a: number[] }>().default({ a: [1, 2] }),
  tags: t.json<string[]>().nullable(),
  avatar: t.bytes().nullable(),
  token: t.uuid().defaultRandom(),
  quote: t.string(40).default("O'Brien"),
});

export const rtPosts = table(
  'rt_posts',
  {
    id: t.uuid().primaryKey().defaultRandom(),
    title: t.string(200),
    slug: t.string(200),
    authorId: t.int().references(() => rtUsers.id, { onDelete: 'cascade', onUpdate: 'cascade' }).map('author_id'),
    editorId: t.int().nullable().references(() => rtUsers.id, { onDelete: 'set null' }),
    published: t.boolean().default(false),
  },
  { indexes: (p) => [index(p.authorId, p.published), uniqueIndex(p.slug, p.authorId)] },
);

export const rtTags = table('rt_tags', {
  id: t.bigId(),
  label: t.string(50).unique('rt_tags_label_unique'),
});

export const rtPostTags = table(
  'rt_post_tags',
  {
    postId: t.uuid().references(() => rtPosts.id, { onDelete: 'cascade' }),
    tagId: t.bigint().references(() => rtTags.id, { onDelete: 'restrict' }),
  },
  { primaryKey: (c) => [c.postId, c.tagId] },
);

export const rtComments = table('rt_comments', {
  id: t.id(),
  body: t.text(),
  parentId: t.int().nullable().references(() => rtComments.id, { onDelete: 'cascade' }),
});

export const roundTripSchema: SchemaIR = toSchemaIR({ rtUsers, rtPosts, rtTags, rtPostTags, rtComments });

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

/** Sorts everything whose order does not matter, so two SchemaIR values compare with toEqual. */
export function normalizeSchema(schema: SchemaIR, options: { enums?: boolean; only?: string[] } = {}): SchemaIR {
  const tables = schema.tables
    .filter((tbl) => (options.only ? options.only.includes(tbl.name) : true))
    .map(
      (tbl): TableIR => ({
        name: tbl.name,
        columns: tbl.columns.map((c) => JSON.parse(JSON.stringify(c))),
        primaryKey: [...tbl.primaryKey],
        indexes: [...tbl.indexes].sort(byName),
        foreignKeys: [...tbl.foreignKeys].sort(byName),
      }),
    )
    .sort(byName);
  const out: SchemaIR = { tables };
  if (options.enums) {
    const used = new Set(tables.flatMap((tbl) => tbl.columns.map((c) => c.enumName).filter(Boolean)));
    out.enums = (schema.enums ?? []).filter((e) => used.has(e.name)).sort(byName);
  }
  return out;
}

export async function runAll(exec: Executor, statements: string[]): Promise<void> {
  for (const statement of statements) await exec.query(statement, []);
}

/** Creates every table (and named enum) of `schema` through `dialect.ddl`. */
export async function createSchema(dialect: Dialect, exec: Executor, schema: SchemaIR): Promise<void> {
  if (dialect.features.namedEnums) {
    for (const e of schema.enums ?? []) await runAll(exec, dialect.ddl({ kind: 'createEnum', enum: e }, schema));
  }
  for (const tbl of schema.tables) await runAll(exec, dialect.ddl({ kind: 'createTable', table: tbl }, schema));
}

/** Drops the tables of `schema` (children first) and its enums, ignoring missing ones. */
export async function dropSchema(exec: Executor, schema: SchemaIR, flavor: 'postgres' | 'sqlite'): Promise<void> {
  for (const tbl of [...schema.tables].reverse()) {
    await exec.query(`DROP TABLE IF EXISTS "${tbl.name}"${flavor === 'postgres' ? ' CASCADE' : ''}`, []);
  }
  if (flavor === 'postgres') {
    for (const e of schema.enums ?? []) await exec.query(`DROP TYPE IF EXISTS "${e.name}"`, []);
  }
}

/** Applies one op: returns the target schema after running its DDL. */
export async function applyMigrationOp(dialect: Dialect, exec: Executor, schema: SchemaIR, op: MigrationOp): Promise<SchemaIR> {
  const next = applyOp(schema, op);
  await runAll(exec, dialect.ddl(op as never, next));
  return next;
}
