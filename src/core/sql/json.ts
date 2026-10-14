/**
 * JSON aggregation flavors: how an include becomes one correlated scalar
 * subquery that returns JSON, so a whole include tree loads in one query.
 */
import type { ColumnIR } from '../ir';
import { join, q, text, type Sql } from './frag';
import type { SqlHooks } from './hooks';

/** Key used to carry row order through flavors whose aggregate cannot order. */
export const ORDER_KEY = '__kastor_rn';

export interface JsonEntry {
  /** Output key (validated identifier, safe as a string literal). */
  key: string;
  expr: Sql;
  /** The expression already yields JSON (nested include or object). */
  json: boolean;
}

export interface JsonChild {
  entries: JsonEntry[];
  /** `FROM` body: the related table and an optional join table. */
  from: Sql;
  /** Correlation and filters, never empty. */
  where: Sql;
  /** ORDER BY expressions (without the keyword), null when unordered. */
  orderBy: Sql | null;
  take?: number;
  skip?: number;
}

export interface JsonFlavor {
  readonly name: string;
  /** JSON object constructor. */
  object(entries: JsonEntry[]): Sql;
  /** Converts a column for embedding (bigint and decimal as text, bytes as hex). */
  field(expr: Sql, column: ColumnIR): Sql;
  /** Correlated subquery returning a JSON array (or NULL / '[]' when empty). */
  many(child: JsonChild, hooks: SqlHooks): Sql;
  /** Correlated subquery returning a JSON object or NULL. */
  one(child: JsonChild, hooks: SqlHooks): Sql;
  /**
   * Paged includes (take/skip) need a derived table that references the outer
   * row. False sends those includes to the IN-list loader instead.
   */
  readonly pagingInDerivedTables: boolean;
}

const lit = (key: string): string => `'${key.replace(/'/g, "''")}'`;
const isPaged = (c: JsonChild): boolean => c.take !== undefined || !!c.skip;

/** `SELECT [TOP n] <list> FROM <from> WHERE <where> [ORDER BY ...] [LIMIT ...]` */
export function pagedSelect(list: Sql, child: JsonChild, hooks: SqlHooks, extraSuffix = ''): Sql {
  const page = hooks.paginate(child.take, child.skip);
  const order = child.orderBy ?? (page.requiresOrder ? text(hooks.orderFallback) : null);
  return q`SELECT ${page.prefix ? `${page.prefix} ` : ''}${list} FROM ${child.from} WHERE ${child.where}${order ? q` ORDER BY ${order}` : ''}${page.suffix ? ` ${page.suffix}` : ''}${extraSuffix}`;
}

/* ------------------------------------------------------------------------ */
/* PostgreSQL and CockroachDB                                                 */
/* ------------------------------------------------------------------------ */

function pgObject(entries: JsonEntry[]): Sql {
  if (entries.length === 0) return text("'{}'::json");
  // json_build_object takes at most 100 arguments: merge chunks as jsonb.
  const chunks: JsonEntry[][] = [];
  for (let i = 0; i < entries.length; i += 50) chunks.push(entries.slice(i, i + 50));
  const build = (fn: string, list: JsonEntry[]): Sql => q`${fn}(${join(list.map((e) => q`${lit(e.key)}, ${e.expr}`), ', ')})`;
  if (chunks.length === 1) return build('json_build_object', chunks[0]!);
  return q`(${join(chunks.map((c) => build('jsonb_build_object', c)), ' || ')})::json`;
}

export const jsonPostgres: JsonFlavor = {
  name: 'postgres',
  object: pgObject,
  field(expr, column) {
    switch (column.type) {
      case 'bigint':
      case 'decimal':
        return q`(${expr})::text`;
      case 'bytes':
        return q`encode(${expr}, 'hex')`;
      default:
        return expr;
    }
  },
  many(child, hooks) {
    const obj = pgObject(child.entries);
    if (!isPaged(child)) {
      const order = child.orderBy ? q` ORDER BY ${child.orderBy}` : '';
      return q`(SELECT COALESCE(json_agg(${obj}${order}), '[]'::json) FROM ${child.from} WHERE ${child.where})`;
    }
    const rn = child.orderBy ? q`ROW_NUMBER() OVER (ORDER BY ${child.orderBy})` : text('ROW_NUMBER() OVER ()');
    const inner = pagedSelect(q`${obj} AS "j", ${rn} AS "rn"`, child, hooks);
    return q`(SELECT COALESCE(json_agg("s"."j" ORDER BY "s"."rn"), '[]'::json) FROM (${inner}) "s")`;
  },
  one(child, hooks) {
    return q`(${pagedSelect(pgObject(child.entries), { ...child, take: 1, skip: 0 }, hooks)})`;
  },
  pagingInDerivedTables: true,
};

/* ------------------------------------------------------------------------ */
/* MySQL and MariaDB                                                          */
/* ------------------------------------------------------------------------ */

function mysqlFlavor(name: string, nest: (expr: Sql) => Sql, pagingInDerivedTables: boolean): JsonFlavor {
  const object = (entries: JsonEntry[]): Sql =>
    q`JSON_OBJECT(${join(
      entries.map((e) => q`${lit(e.key)}, ${e.json ? nest(e.expr) : e.expr}`),
      ', ',
    )})`;
  return {
    name,
    object,
    field(expr, column) {
      switch (column.type) {
        case 'bigint':
        case 'decimal':
          return q`CAST(${expr} AS CHAR)`;
        case 'bytes':
          return q`HEX(${expr})`;
        case 'json':
          return nest(expr);
        default:
          return expr;
      }
    },
    many(child, hooks) {
      if (!child.orderBy && !isPaged(child)) {
        return q`(SELECT COALESCE(JSON_ARRAYAGG(${object(child.entries)}), JSON_ARRAY()) FROM ${child.from} WHERE ${child.where})`;
      }
      // JSON_ARRAYAGG has no ORDER BY: carry the row number, kastor sorts after parsing.
      const rn = child.orderBy ? q`ROW_NUMBER() OVER (ORDER BY ${child.orderBy})` : text('ROW_NUMBER() OVER ()');
      const entries = [...child.entries, { key: ORDER_KEY, expr: rn, json: false }];
      const inner = pagedSelect(q`${object(entries)} AS ${hooks.quoteIdent('j')}`, child, hooks);
      return q`(SELECT COALESCE(JSON_ARRAYAGG(${nest(q`${hooks.quoteIdent('s')}.${hooks.quoteIdent('j')}`)}), JSON_ARRAY()) FROM (${inner}) ${hooks.quoteIdent('s')})`;
    },
    one(child, hooks) {
      return q`(${pagedSelect(object(child.entries), { ...child, take: 1, skip: 0 }, hooks)})`;
    },
    pagingInDerivedTables,
  };
}

/** MySQL 8.0.14+: correlated derived tables work, JSON values nest with CAST AS JSON. */
export const jsonMysql: JsonFlavor = mysqlFlavor('mysql', (e) => q`CAST(${e} AS JSON)`, true);

/** MariaDB: JSON is text, nested values go through JSON_EXTRACT; no outer references in derived tables. */
export const jsonMariadb: JsonFlavor = mysqlFlavor('mariadb', (e) => q`JSON_EXTRACT(${e}, '$')`, false);

/* ------------------------------------------------------------------------ */
/* SQLite                                                                     */
/* ------------------------------------------------------------------------ */

function sqliteObject(entries: JsonEntry[]): Sql {
  return q`json_object(${join(
    entries.map((e) => q`${lit(e.key)}, ${e.json ? q`json(${e.expr})` : e.expr}`),
    ', ',
  )})`;
}

export const jsonSqlite: JsonFlavor = {
  name: 'sqlite',
  object: sqliteObject,
  field(expr, column) {
    switch (column.type) {
      case 'bigint':
      case 'decimal':
        return q`CAST(${expr} AS TEXT)`;
      case 'bytes':
        return q`hex(${expr})`;
      case 'json':
        return q`json(${expr})`;
      default:
        return expr;
    }
  },
  many(child, hooks) {
    if (!child.orderBy && !isPaged(child)) {
      return q`(SELECT json_group_array(${sqliteObject(child.entries)}) FROM ${child.from} WHERE ${child.where})`;
    }
    const rn = child.orderBy ? q`ROW_NUMBER() OVER (ORDER BY ${child.orderBy})` : text('ROW_NUMBER() OVER ()');
    const entries = [...child.entries, { key: ORDER_KEY, expr: rn, json: false }];
    const inner = pagedSelect(q`${sqliteObject(entries)} AS "j"`, child, hooks);
    return q`(SELECT json_group_array(json("s"."j")) FROM (${inner}) "s")`;
  },
  one(child, hooks) {
    return q`(${pagedSelect(sqliteObject(child.entries), { ...child, take: 1, skip: 0 }, hooks)})`;
  },
  pagingInDerivedTables: true,
};

/* ------------------------------------------------------------------------ */
/* SQL Server                                                                 */
/* ------------------------------------------------------------------------ */

function mssqlList(entries: JsonEntry[], hooks: SqlHooks): Sql {
  return join(
    entries.map((e) => q`${e.json ? q`JSON_QUERY(${e.expr})` : e.expr} AS ${hooks.quoteIdent(e.key)}`),
    ', ',
  );
}

export const jsonMssql: JsonFlavor = {
  name: 'mssql',
  object(entries) {
    if (entries.length === 0) return text("'{}'");
    const list = join(
      entries.map((e) => q`${e.json ? q`JSON_QUERY(${e.expr})` : e.expr} AS [${e.key}]`),
      ', ',
    );
    return q`(SELECT ${list} FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES)`;
  },
  field(expr, column) {
    switch (column.type) {
      case 'bigint':
        return q`CAST(${expr} AS NVARCHAR(20))`;
      case 'decimal':
        return q`CAST(${expr} AS NVARCHAR(60))`;
      case 'bytes':
        return q`CONVERT(VARCHAR(MAX), ${expr}, 2)`;
      case 'json':
        return q`JSON_QUERY(${expr})`;
      default:
        return expr;
    }
  },
  many(child, hooks) {
    return q`COALESCE((${pagedSelect(mssqlList(child.entries, hooks), child, hooks, ' FOR JSON PATH, INCLUDE_NULL_VALUES')}), '[]')`;
  },
  one(child, hooks) {
    return q`(${pagedSelect(mssqlList(child.entries, hooks), { ...child, take: 1, skip: 0 }, hooks, ' FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES')})`;
  },
  pagingInDerivedTables: true,
};

/* ------------------------------------------------------------------------ */
/* Oracle                                                                     */
/* ------------------------------------------------------------------------ */

function oracleObject(entries: JsonEntry[]): Sql {
  if (entries.length === 0) return text("'{}'");
  return q`JSON_OBJECT(${join(
    entries.map((e) => q`${lit(e.key)} VALUE ${e.expr}${e.json ? ' FORMAT JSON' : ''}`),
    ', ',
  )} NULL ON NULL RETURNING CLOB)`;
}

export const jsonOracle: JsonFlavor = {
  name: 'oracle',
  object: oracleObject,
  field(expr, column) {
    switch (column.type) {
      case 'bigint':
      case 'decimal':
        return q`TO_CHAR(${expr})`;
      case 'bytes':
        return q`RAWTOHEX(${expr})`;
      default:
        return expr;
    }
  },
  many(child, hooks) {
    const obj = oracleObject(child.entries);
    if (!isPaged(child)) {
      const order = child.orderBy ? q` ORDER BY ${child.orderBy}` : '';
      return q`(SELECT JSON_ARRAYAGG(${obj} FORMAT JSON${order} RETURNING CLOB) FROM ${child.from} WHERE ${child.where})`;
    }
    const rn = child.orderBy ? q`ROW_NUMBER() OVER (ORDER BY ${child.orderBy})` : text('ROWNUM');
    const inner = pagedSelect(q`${obj} AS "j", ${rn} AS "rn"`, child, hooks);
    return q`(SELECT JSON_ARRAYAGG("s"."j" FORMAT JSON ORDER BY "s"."rn" RETURNING CLOB) FROM (${inner}) "s")`;
  },
  one(child, hooks) {
    return q`(${pagedSelect(oracleObject(child.entries), { ...child, take: 1, skip: 0 }, hooks)})`;
  },
  pagingInDerivedTables: true,
};
