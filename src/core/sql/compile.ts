/**
 * Compiles QueryIR to SQL text and parameters through dialect hooks.
 *
 * Aliases: the root table of a SELECT is `t0`, every joined or correlated
 * table gets the next `tN`. UPDATE and DELETE qualify the root with the
 * table name itself because not every database accepts an alias there.
 */
import { errors, KastorError } from '../errors';
import type {
  AggregateFn,
  AggregateIR,
  ColumnIR,
  IncludeIR,
  OrderByIR,
  ReadIR,
  RelationCountIR,
  RelationIR,
  SchemaIR,
  SelectColumnIR,
  TableIR,
  UpdateValueIR,
  WhereIR,
} from '../ir';
import { isIdentParam } from '../raw';
import { empty, join, p, q, text, type Sql } from './frag';
import { escapeLike, type SqlHooks } from './hooks';
import type { JsonEntry } from './json';

export interface Scope {
  table: TableIR;
  /** Quoted qualifier: an alias or the quoted table name. */
  qual: string;
}

/** How one level of a read (root or include) comes back. */
export interface LevelPlan {
  read: ReadIR;
  table: TableIR;
  /** Includes embedded as JSON in this level's rows. */
  json: { inc: IncludeIR; plan: LevelPlan }[];
  /** Includes loaded afterwards with IN lists. */
  fallback: { inc: IncludeIR; plan: LevelPlan }[];
  /** Hidden key aliases (`__key__<column>`) added for fallback loading. */
  hidden: string[];
}

export const HIDDEN_KEY = '__key__';
export const COUNT_PREFIX = '__count__';
export const LINK_PREFIX = '__link__';
export const RN = '__rn';

const SAFE_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export class SqlCompiler {
  readonly hooks: SqlHooks;
  readonly schema: SchemaIR;
  private readonly tables: Map<string, TableIR>;
  private aliasCount = 0;

  constructor(hooks: SqlHooks, schema: SchemaIR) {
    this.hooks = hooks;
    this.schema = schema;
    this.tables = new Map(schema.tables.map((tbl) => [tbl.name, tbl]));
  }

  /* ---------------------------------------------------------------------- */
  /* Basics                                                                  */
  /* ---------------------------------------------------------------------- */

  resetAliases(): void {
    this.aliasCount = 0;
  }

  newAlias(): string {
    return this.hooks.quoteIdent(`t${this.aliasCount++}`);
  }

  qi(name: string): string {
    return this.hooks.quoteIdent(name);
  }

  table(name: string): TableIR {
    const tbl = this.tables.get(name);
    if (!tbl) {
      throw new KastorError('SCHEMA_INVALID', `Table "${name}" is not part of the schema given to the dialect.`, {
        hint: 'Pass the same schema to the client and to the dialect.',
        meta: { table: name },
      });
    }
    return tbl;
  }

  column(tbl: TableIR, name: string): ColumnIR {
    const c = tbl.columns.find((col) => col.name === name);
    if (!c) {
      throw new KastorError('SCHEMA_INVALID', `Column "${name}" is not part of table "${tbl.name}".`, {
        hint: 'Check the column name, or run the migrations so the schema matches.',
        meta: { table: tbl.name, column: name },
      });
    }
    return c;
  }

  ref(scope: Scope, column: string): Sql {
    this.column(scope.table, column);
    return text(`${scope.qual}.${this.qi(column)}`);
  }

  param(value: unknown, column?: ColumnIR): Sql {
    return q`${p(this.hooks.encode(value, column))}`;
  }

  rootScope(tableName: string, alias = true): Scope {
    const tbl = this.table(tableName);
    return { table: tbl, qual: alias ? this.newAlias() : this.qi(tbl.name) };
  }

  from(scope: Scope): Sql {
    const name = this.qi(scope.table.name);
    return text(scope.qual === name ? name : `${name} ${scope.qual}`);
  }

  /* ---------------------------------------------------------------------- */
  /* Where                                                                   */
  /* ---------------------------------------------------------------------- */

  where(w: WhereIR | undefined, scope: Scope): Sql | null {
    if (!w) return null;
    const out = this.cond(w, scope);
    return out;
  }

  cond(w: WhereIR, scope: Scope): Sql {
    switch (w.kind) {
      case 'and': {
        const items = w.items.flatMap((i) => (i.kind === 'and' ? i.items : [i])).filter((i) => !(i.kind === 'const' && i.value));
        if (items.some((i) => i.kind === 'const' && !i.value)) return text('1=0');
        if (items.length === 0) return text('1=1');
        if (items.length === 1) return this.cond(items[0]!, scope);
        return join(items.map((i) => q`(${this.cond(i, scope)})`), ' AND ');
      }
      case 'or': {
        const items = w.items.flatMap((i) => (i.kind === 'or' ? i.items : [i])).filter((i) => !(i.kind === 'const' && !i.value));
        if (items.some((i) => i.kind === 'const' && i.value)) return text('1=1');
        if (items.length === 0) return text('1=0');
        if (items.length === 1) return this.cond(items[0]!, scope);
        return join(items.map((i) => q`(${this.cond(i, scope)})`), ' OR ');
      }
      case 'not':
        if (w.item.kind === 'const') return text(w.item.value ? '1=0' : '1=1');
        return q`NOT (${this.cond(w.item, scope)})`;
      case 'const':
        return text(w.value ? '1=1' : '1=0');
      case 'compare':
        return this.compare(w, scope);
      case 'in':
        return this.inList(w, scope);
      case 'null': {
        const col = this.ref(scope, w.column);
        return q`${col} IS ${w.negate ? 'NOT ' : ''}NULL`;
      }
      case 'like':
        return this.like(w, scope);
      case 'relation':
        return this.relationFilter(w, scope);
      case 'raw':
        return this.raw(w.sql.strings, w.sql.params);
      default:
        throw errors.invalidArgument(`Unknown filter node ${(w as { kind: string }).kind}.`, 'This is a bug in kastor, please report it.');
    }
  }

  raw(strings: readonly string[], params: readonly unknown[]): Sql {
    const parts: Sql[] = [text(strings[0] ?? '')];
    params.forEach((value, i) => {
      parts.push(isIdentParam(value) ? text(value.$ident.map((n) => this.qi(n)).join('.')) : this.param(value));
      parts.push(text(strings[i + 1] ?? ''));
    });
    return join(parts, '');
  }

  aggregateExpr(fn: AggregateFn, column: string | null, scope: Scope): Sql {
    if (column === null) return text('COUNT(*)');
    const col = this.ref(scope, column);
    return q`${fn.toUpperCase()}(${col})`;
  }

  private target(w: { column: string; aggregate?: AggregateFn }, scope: Scope): { expr: Sql; column: ColumnIR | undefined } {
    if (w.aggregate) {
      const column = w.column ? this.column(scope.table, w.column) : undefined;
      const expr = this.aggregateExpr(w.aggregate, w.column || null, scope);
      // count is always a number; sum and min/max keep the column type
      return { expr, column: w.aggregate === 'count' || w.aggregate === 'avg' ? undefined : column };
    }
    return { expr: this.cmpColumn(scope, w.column), column: this.column(scope.table, w.column) };
  }

  private compare(w: Extract<WhereIR, { kind: 'compare' }>, scope: Scope): Sql {
    const { expr, column } = this.target(w, scope);
    if (w.value === null) {
      if (w.op === 'eq') return q`${expr} IS NULL`;
      if (w.op === 'ne') return q`${expr} IS NOT NULL`;
      return text('1=0');
    }
    const ops: Record<typeof w.op, string> = { eq: '=', ne: '<>', lt: '<', lte: '<=', gt: '>', gte: '>=' };
    if (w.insensitive && typeof w.value === 'string') {
      return q`LOWER(${expr}) ${ops[w.op]} LOWER(${this.param(w.value, column)})`;
    }
    return q`${expr} ${ops[w.op]} ${this.param(w.value, column)}`;
  }

  private inList(w: Extract<WhereIR, { kind: 'in' }>, scope: Scope): Sql {
    const { expr, column } = this.target(w, scope);
    const hasNull = w.values.some((v) => v === null || v === undefined);
    const values = w.values.filter((v) => v !== null && v !== undefined);
    const parts: Sql[] = [];
    const lower = w.insensitive === true;
    for (let i = 0; i < values.length; i += this.hooks.maxInList) {
      const chunk = values.slice(i, i + this.hooks.maxInList);
      const list = join(
        chunk.map((v) => (lower && typeof v === 'string' ? q`LOWER(${this.param(v, column)})` : this.param(v, column))),
        ', ',
      );
      parts.push(q`${lower ? q`LOWER(${expr})` : expr} IN (${list})`);
    }
    if (hasNull) parts.push(q`${expr} IS NULL`);
    let positive: Sql;
    if (parts.length === 0) positive = text('1=0');
    else if (parts.length === 1) positive = parts[0]!;
    else positive = join(parts.map((s) => q`(${s})`), ' OR ');
    if (!w.negate) return positive;
    if (parts.length === 0) return text('1=1');
    // NOT IN keeps SQL semantics for NULL columns: they never match either way.
    return q`NOT (${positive})`;
  }

  private like(w: Extract<WhereIR, { kind: 'like' }>, scope: Scope): Sql {
    const col = this.ref(scope, w.column);
    const columnIR = this.column(scope.table, w.column);
    let out: Sql | null = null;
    if (this.hooks.textMatch) {
      out = this.hooks.textMatch(col, w.mode, this.param(w.value, columnIR), w.insensitive, w.value);
    }
    if (!out) {
      const escaped = escapeLike(w.value, this.hooks);
      const pattern = w.mode === 'contains' ? `%${escaped}%` : w.mode === 'startsWith' ? `${escaped}%` : `%${escaped}`;
      const esc = ` ESCAPE '${this.hooks.likeEscape.replace(/'/g, "''")}'`;
      if (w.insensitive && this.hooks.caseInsensitive === 'ilike') out = q`${col} ILIKE ${p(pattern)}${esc}`;
      else if (w.insensitive) out = q`LOWER(${col}) LIKE LOWER(${p(pattern)})${esc}`;
      else out = q`${col} LIKE ${p(pattern)}${esc}`;
    }
    return w.negate ? q`NOT (${out})` : out;
  }

  /** FROM body and correlation condition for a related table. */
  relationSource(rel: RelationIR, outer: Scope): { from: Sql; cond: Sql; scope: Scope; linkScope: Scope; linkColumns: string[] } {
    const target = this.table(rel.to);
    const scope: Scope = { table: target, qual: this.newAlias() };
    const conds: Sql[] = [];
    let from: Sql;
    let linkScope: Scope;
    let linkColumns: string[];
    if (!rel.through) {
      from = this.from(scope);
      rel.toColumns.forEach((c, i) => conds.push(q`${this.ref(scope, c)} = ${this.ref(outer, rel.fromColumns[i]!)}`));
      linkScope = scope;
      linkColumns = rel.toColumns;
    } else {
      const jt = this.table(rel.through.table);
      const js: Scope = { table: jt, qual: this.newAlias() };
      const on = join(
        rel.through.targetColumns.map((c, i) => q`${this.ref(js, c)} = ${this.ref(scope, rel.toColumns[i]!)}`),
        ' AND ',
      );
      from = q`${this.from(scope)} INNER JOIN ${this.from(js)} ON ${on}`;
      rel.through.sourceColumns.forEach((c, i) => conds.push(q`${this.ref(js, c)} = ${this.ref(outer, rel.fromColumns[i]!)}`));
      linkScope = js;
      linkColumns = rel.through.sourceColumns;
    }
    if (rel.softDeleteColumn) conds.push(q`${this.ref(scope, rel.softDeleteColumn)} IS NULL`);
    return { from, cond: join(conds, ' AND '), scope, linkScope, linkColumns };
  }

  private relationFilter(w: Extract<WhereIR, { kind: 'relation' }>, outer: Scope): Sql {
    const { from, cond, scope } = this.relationSource(w.relation, outer);
    const exists = (extra: Sql | null, negate: boolean): Sql =>
      q`${negate ? 'NOT ' : ''}EXISTS (SELECT 1 FROM ${from} WHERE ${cond}${extra ? q` AND (${extra})` : ''})`;
    const inner = w.where ? this.cond(w.where, scope) : null;
    switch (w.op) {
      case 'some':
        return exists(inner, false);
      case 'none':
        return exists(inner, true);
      case 'every':
        // NULL safe: a row whose condition is unknown does not satisfy it.
        return inner ? exists(q`CASE WHEN ${inner} THEN 1 ELSE 0 END = 0`, true) : text('1=1');
      case 'is':
        return inner ? exists(inner, false) : exists(null, true);
      case 'isNot':
        return inner ? exists(inner, true) : exists(null, false);
      default:
        throw errors.invalidArgument(`Unknown relation filter ${String(w.op)}.`, 'Use some, every, none, is or isNot.');
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Order                                                                   */
  /* ---------------------------------------------------------------------- */

  orderItems(orderBy: readonly OrderByIR[], scope: Scope): Sql[] {
    const out: Sql[] = [];
    for (const o of orderBy) {
      const dir = o.direction === 'desc' ? 'DESC' : 'ASC';
      let expr: Sql;
      let nulls: 'first' | 'last' | undefined;
      switch (o.kind) {
        case 'column':
          expr = this.cmpColumn(scope, o.column);
          nulls = o.nulls;
          break;
        case 'relationCount':
          expr = this.countSubquery({ relation: o.relation, as: '' }, scope);
          break;
        case 'relationColumn':
          expr = this.relationColumnSubquery(o.path, o.column, scope);
          nulls = o.nulls;
          break;
        case 'aggregate':
          expr = this.aggregateExpr(o.fn, o.column, scope);
          break;
      }
      if (nulls && !this.hooks.nullsOrder) {
        out.push(q`CASE WHEN ${expr} IS NULL THEN ${nulls === 'first' ? '0' : '1'} ELSE ${nulls === 'first' ? '1' : '0'} END`);
        out.push(q`${expr} ${dir}`);
      } else {
        out.push(q`${expr} ${dir}${nulls ? ` NULLS ${nulls.toUpperCase()}` : ''}`);
      }
    }
    return out;
  }

  orderBy(orderBy: readonly OrderByIR[] | undefined, scope: Scope): Sql | null {
    if (!orderBy || orderBy.length === 0) return null;
    return join(this.orderItems(orderBy, scope), ', ');
  }

  private relationColumnSubquery(path: readonly RelationIR[], column: string, outer: Scope): Sql {
    if (path.length === 0) return this.ref(outer, column);
    const [first, ...rest] = path;
    const { from, cond, scope } = this.relationSource(first!, outer);
    const value = this.relationColumnSubquery(rest, column, scope);
    const page = this.hooks.paginate(1, undefined);
    return q`(SELECT ${page.prefix ? `${page.prefix} ` : ''}${value} FROM ${from} WHERE ${cond}${page.suffix && !page.requiresOrder ? ` ${page.suffix}` : ''})`;
  }

  countSubquery(c: RelationCountIR, outer: Scope): Sql {
    const { from, cond, scope } = this.relationSource(c.relation, outer);
    const extra = c.where ? q` AND (${this.cond(c.where, scope)})` : empty;
    return q`(SELECT COUNT(*) FROM ${from} WHERE ${cond}${extra})`;
  }

  /* ---------------------------------------------------------------------- */
  /* Reads                                                                   */
  /* ---------------------------------------------------------------------- */

  private useJson(inc: IncludeIR): boolean {
    const flavor = this.hooks.json;
    if (!flavor) return false;
    const paged = inc.read.take !== undefined || !!inc.read.skip;
    return !paged || flavor.pagingInDerivedTables;
  }

  private checkKey(key: string): string {
    if (!SAFE_KEY.test(key)) {
      throw errors.invalidArgument(`"${key}" cannot be used as an output name.`, 'Use letters, digits, _ and $ in field and relation names.');
    }
    return key;
  }

  private defaultOrder(tbl: TableIR): OrderByIR[] {
    return tbl.primaryKey.map((column) => ({ kind: 'column' as const, column, direction: 'asc' as const }));
  }

  /** Builds the plan tree for an include, used by both JSON and IN-list loading. */
  private jsonInclude(inc: IncludeIR, outer: Scope): { expr: Sql; plan: LevelPlan } {
    const flavor = this.hooks.json!;
    const read = inc.read;
    const { from, cond, scope } = this.relationSource(inc.relation, outer);
    const plan: LevelPlan = { read, table: scope.table, json: [], fallback: [], hidden: [] };
    const entries: JsonEntry[] = read.select.map((s) => ({
      key: this.checkKey(s.as),
      expr: flavor.field(this.ref(scope, s.column), this.column(scope.table, s.column)),
      json: false,
    }));
    this.addIncludes(read, scope, plan, (key, expr, json) => entries.push({ key, expr, json }));
    if (read.counts.length > 0) {
      const counts = read.counts.map((c) => ({ key: this.checkKey(c.as), expr: this.countSubquery(c, scope), json: false }));
      entries.push({ key: '_count', expr: flavor.object(counts), json: true });
    }
    const filters: Sql[] = [cond];
    const userWhere = this.where(read.where, scope);
    if (userWhere) filters.push(q`(${userWhere})`);
    const paged = read.take !== undefined || !!read.skip;
    const order = read.orderBy.length ? read.orderBy : paged ? this.defaultOrder(scope.table) : [];
    const child = {
      entries,
      from,
      where: join(filters, ' AND '),
      orderBy: this.orderBy(order, scope),
      ...(read.take !== undefined ? { take: read.take } : {}),
      ...(read.skip ? { skip: read.skip } : {}),
    };
    const expr = inc.relation.cardinality === 'many' ? flavor.many(child, this.hooks) : flavor.one(child, this.hooks);
    return { expr, plan };
  }

  /** Adds JSON includes as entries and registers fallback includes with hidden keys. */
  private addIncludes(read: ReadIR, scope: Scope, plan: LevelPlan, add: (key: string, expr: Sql, json: boolean) => void): void {
    for (const inc of read.include) {
      this.checkKey(inc.relation.name);
      if (this.useJson(inc)) {
        const { expr, plan: child } = this.jsonInclude(inc, scope);
        plan.json.push({ inc, plan: child });
        add(inc.relation.name, expr, true);
      } else {
        const child: LevelPlan = { read: inc.read, table: this.table(inc.relation.to), json: [], fallback: [], hidden: [] };
        plan.fallback.push({ inc, plan: child });
        for (const column of inc.relation.fromColumns) {
          const alias = HIDDEN_KEY + column;
          if (!plan.hidden.includes(alias)) {
            plan.hidden.push(alias);
            const columnIR = this.column(scope.table, column);
            const expr = this.ref(scope, column);
            add(alias, this.hooks.json ? this.hooks.json.field(expr, columnIR) : expr, false);
          }
        }
      }
    }
  }

  /** SELECT list for a row level read (root or IN-list child). */
  private selectList(read: ReadIR, scope: Scope, plan: LevelPlan): Sql[] {
    const items: Sql[] = read.select.map((s) => q`${this.readColumn(scope, s.column)} AS ${this.qi(this.checkKey(s.as))}`);
    for (const c of read.counts) items.push(q`${this.countSubquery(c, scope)} AS ${this.qi(COUNT_PREFIX + this.checkKey(c.as))}`);
    this.addIncludes(read, scope, plan, (key, expr, json) => {
      // hidden keys at row level are plain columns, JSON includes are subqueries
      items.push(json ? q`${expr} AS ${this.qi(key)}` : q`${expr} AS ${this.qi(key)}`);
    });
    if (items.length === 0) items.push(text('1 AS "__none"'));
    return items;
  }

  /** Filter that keeps the first row of each `distinct` group (window function based). */
  private distinctFilter(read: ReadIR, scope: Scope): Sql | null {
    if (!read.distinct || read.distinct.length === 0) return null;
    const tbl = scope.table;
    if (tbl.primaryKey.length === 0) {
      throw errors.unsupported('distinct on a table without a primary key', 'this dialect', 'Add a primary key to the table, or group with groupBy instead.');
    }
    const inner: Scope = { table: tbl, qual: this.newAlias() };
    const x = this.newAlias();
    const partition = join(read.distinct.map((c) => this.ref(inner, c)), ', ');
    const order = this.orderBy(read.orderBy.length ? read.orderBy : this.defaultOrder(tbl), inner);
    const keys = join(tbl.primaryKey.map((c) => q`${this.ref(inner, c)} AS ${this.qi(c)}`), ', ');
    const where = this.where(read.where, inner);
    const sub = q`SELECT ${keys}, ROW_NUMBER() OVER (PARTITION BY ${partition} ORDER BY ${order ?? text(this.hooks.orderFallback)}) AS ${this.qi(RN)} FROM ${this.from(inner)}${where ? q` WHERE ${where}` : ''}`;
    const match = join(tbl.primaryKey.map((c) => q`${x}.${this.qi(c)} = ${this.ref(scope, c)}`), ' AND ');
    return q`EXISTS (SELECT 1 FROM (${sub}) ${x} WHERE ${x}.${this.qi(RN)} = 1 AND ${match})`;
  }

  /** Root SELECT for find queries. */
  compileRead(read: ReadIR): { sql: Sql; plan: LevelPlan } {
    this.resetAliases();
    const scope = this.rootScope(read.table);
    const plan: LevelPlan = { read, table: scope.table, json: [], fallback: [], hidden: [] };
    const list = this.selectList(read, scope, plan);
    const filters: Sql[] = [];
    const w = this.where(read.where, scope);
    if (w) filters.push(w);
    const d = this.distinctFilter(read, scope);
    if (d) filters.push(d);
    const sql = this.selectStatement(list, scope, filters, read.orderBy, read.take, read.skip);
    return { sql, plan };
  }

  selectStatement(list: Sql[], scope: Scope, filters: Sql[], orderBy: readonly OrderByIR[] | undefined, take?: number, skip?: number, groupBy?: Sql, having?: Sql | null, from?: Sql): Sql {
    const page = this.hooks.paginate(take, skip);
    let order = this.orderBy(orderBy, scope);
    if (!order && page.requiresOrder) order = text(this.hooks.orderFallback);
    const where = filters.length === 0 ? empty : filters.length === 1 ? q` WHERE ${filters[0]!}` : q` WHERE ${join(filters.map((f) => q`(${f})`), ' AND ')}`;
    return q`SELECT ${page.prefix ? `${page.prefix} ` : ''}${join(list, ', ')} FROM ${from ?? this.from(scope)}${where}${groupBy ? q` GROUP BY ${groupBy}` : ''}${having ? q` HAVING ${having}` : ''}${order ? q` ORDER BY ${order}` : ''}${page.suffix ? ` ${page.suffix}` : ''}`;
  }

  /**
   * IN-list loader query for an include: the related rows of many parents at
   * once, each tagged with the parent key under `__link__<i>`.
   */
  compileFallback(inc: IncludeIR, keys: unknown[][], plan: LevelPlan, parentTable: TableIR): Sql {
    this.resetAliases();
    const outerDummy: Scope = { table: parentTable, qual: this.qi('__parent') };
    const { from, scope, linkScope, linkColumns } = this.relationSource(inc.relation, outerDummy);
    const read = inc.read;
    const list = this.selectList(read, scope, plan);
    linkColumns.forEach((c, i) => list.push(q`${this.ref(linkScope, c)} AS ${this.qi(LINK_PREFIX + i)}`));

    const filters: Sql[] = [];
    const linkTypes = linkColumns.map((c) => this.column(linkScope.table, c));
    if (linkColumns.length === 1) {
      filters.push(this.inList({ kind: 'in', column: linkColumns[0]!, values: keys.map((k) => k[0]), negate: false }, linkScope));
    } else {
      filters.push(
        join(
          keys.map((k) => q`(${join(linkColumns.map((c, i) => q`${this.ref(linkScope, c)} = ${this.param(k[i], linkTypes[i])}`), ' AND ')})`),
          ' OR ',
        ),
      );
    }
    if (inc.relation.softDeleteColumn) filters.push(q`${this.ref(scope, inc.relation.softDeleteColumn)} IS NULL`);
    const w = this.where(read.where, scope);
    if (w) filters.push(w);

    const paged = read.take !== undefined || !!read.skip;
    const order = read.orderBy.length ? read.orderBy : paged ? this.defaultOrder(scope.table) : [];
    if (!paged) {
      return this.selectStatement(list, scope, filters, order, undefined, undefined, undefined, undefined, from);
    }
    const partition = join(linkColumns.map((c) => this.ref(linkScope, c)), ', ');
    const orderSql = this.orderBy(order, scope) ?? text(this.hooks.orderFallback);
    list.push(q`ROW_NUMBER() OVER (PARTITION BY ${partition} ORDER BY ${orderSql}) AS ${this.qi(RN)}`);
    const inner = this.selectStatement(list, scope, filters, undefined, undefined, undefined, undefined, undefined, from);
    const s = this.qi('s');
    const lo = read.skip ?? 0;
    const bounds = read.take === undefined ? q`${s}.${this.qi(RN)} > ${lo}` : q`${s}.${this.qi(RN)} > ${lo} AND ${s}.${this.qi(RN)} <= ${lo + read.take}`;
    return q`SELECT * FROM (${inner}) ${s} WHERE ${bounds} ORDER BY ${s}.${this.qi(RN)}`;
  }

  /* ---------------------------------------------------------------------- */
  /* Count, aggregate, groupBy                                               */
  /* ---------------------------------------------------------------------- */

  compileCount(table: string, where: WhereIR | undefined, orderBy: OrderByIR[] | undefined, take: number | undefined, skip: number | undefined, distinct: string[] | undefined): Sql {
    this.resetAliases();
    const scope = this.rootScope(table);
    const filters: Sql[] = [];
    const w = this.where(where, scope);
    if (w) filters.push(w);
    const read: ReadIR = { table, select: [], include: [], counts: [], orderBy: orderBy ?? [], ...(where ? { where } : {}), ...(distinct ? { distinct } : {}) };
    const d = this.distinctFilter(read, scope);
    if (d) filters.push(d);
    if (take === undefined && !skip) {
      return this.selectStatement([q`COUNT(*) AS ${this.qi('count')}`], scope, filters, undefined);
    }
    const inner = this.selectStatement([text(`1 AS ${this.qi('x')}`)], scope, filters, orderBy, take, skip);
    return q`SELECT COUNT(*) AS ${this.qi('count')} FROM (${inner}) ${this.qi('s')}`;
  }

  compileAggregate(table: string, aggregates: AggregateIR[], where?: WhereIR, orderBy?: OrderByIR[], take?: number, skip?: number): Sql {
    this.resetAliases();
    const scope = this.rootScope(table);
    const filters: Sql[] = [];
    const w = this.where(where, scope);
    if (w) filters.push(w);
    if (aggregates.length === 0) {
      throw errors.invalidArgument('aggregate needs at least one of _count, _sum, _avg, _min, _max.', 'Example: aggregate({ _count: true, _avg: { price: true } }).');
    }
    if (take === undefined && !skip) {
      const list = aggregates.map((a) => q`${this.aggregateExpr(a.fn, a.column, scope)} AS ${this.qi(a.as)}`);
      return this.selectStatement(list, scope, filters, undefined);
    }
    const cols = [...new Set(aggregates.map((a) => a.column).filter((c): c is string => c !== null))];
    const innerList = cols.length ? cols.map((c) => q`${this.ref(scope, c)} AS ${this.qi(c)}`) : [text(`1 AS ${this.qi('x')}`)];
    const inner = this.selectStatement(innerList, scope, filters, orderBy, take, skip);
    const s: Scope = { table: scope.table, qual: this.qi('s') };
    const list = aggregates.map((a) => q`${this.aggregateExpr(a.fn, a.column, s)} AS ${this.qi(a.as)}`);
    return q`SELECT ${join(list, ', ')} FROM (${inner}) ${s.qual}`;
  }

  compileGroupBy(table: string, by: SelectColumnIR[], aggregates: AggregateIR[], where?: WhereIR, having?: WhereIR, orderBy: OrderByIR[] = [], take?: number, skip?: number): Sql {
    this.resetAliases();
    const scope = this.rootScope(table);
    if (by.length === 0) throw errors.invalidArgument('groupBy needs at least one field in by.', "Example: groupBy({ by: ['role'], _count: true }).");
    const list = [
      ...by.map((b) => q`${this.readColumn(scope, b.column)} AS ${this.qi(this.checkKey(b.as))}`),
      ...aggregates.map((a) => q`${this.aggregateExpr(a.fn, a.column, scope)} AS ${this.qi(a.as)}`),
    ];
    const filters: Sql[] = [];
    const w = this.where(where, scope);
    if (w) filters.push(w);
    const group = join(by.map((b) => this.ref(scope, b.column)), ', ');
    const h = having ? this.cond(having, scope) : null;
    return this.selectStatement(list, scope, filters, orderBy, take, skip, group, h);
  }

  /* ---------------------------------------------------------------------- */
  /* Writes                                                                  */
  /* ---------------------------------------------------------------------- */

  /** Column read into a row, through the `selectColumn` hook. */
  readColumn(scope: Scope, column: string): Sql {
    const ref = this.ref(scope, column);
    return this.hooks.selectColumn ? this.hooks.selectColumn(ref, this.column(scope.table, column)) : ref;
  }

  /** Column used in a comparison or ORDER BY, through the `compareColumn` hook. */
  cmpColumn(scope: Scope, column: string): Sql {
    const ref = this.ref(scope, column);
    return this.hooks.compareColumn ? this.hooks.compareColumn(ref, this.column(scope.table, column)) : ref;
  }

  returningList(tbl: TableIR, returning: SelectColumnIR[], qual: string): Sql {
    return join(
      returning.map((r) => {
        const expr = text(`${qual}${this.qi(r.column)}`);
        const read = this.hooks.selectColumn ? this.hooks.selectColumn(expr, this.column(tbl, r.column)) : expr;
        return q`${read} AS ${this.qi(this.checkKey(r.as))}`;
      }),
      ', ',
    );
  }

  /** OUTPUT clause (before VALUES / WHERE) and RETURNING tail for a write. */
  private returningParts(tbl: TableIR, returning: SelectColumnIR[] | null | undefined, outputPrefix: 'INSERTED.' | 'DELETED.'): { output: Sql; tail: Sql } {
    if (!returning || returning.length === 0) return { output: empty, tail: empty };
    switch (this.hooks.returning) {
      case 'returning':
        return { output: empty, tail: q` RETURNING ${this.returningList(tbl, returning, '')}` };
      case 'output':
        return { output: q` OUTPUT ${this.returningList(tbl, returning, outputPrefix)}`, tail: empty };
      case 'into': {
        const outParam = this.hooks.outParam;
        if (!outParam) throw errors.schema('returning: "into" needs the outParam hook.', 'Add outParam(column, as) to the dialect hooks.');
        const cols = returning.map((r) => this.qi(r.column)).join(', ');
        const outs = join(
          returning.map((r) => q`${p(outParam(this.column(tbl, r.column), r.as))}`),
          ', ',
        );
        return { output: empty, tail: q` RETURNING ${cols} INTO ${outs}` };
      }
      default:
        return { output: empty, tail: empty };
    }
  }

  /** INSERT of one or more rows sharing the same column set. */
  compileInsert(table: string, columns: string[], rows: Record<string, unknown>[], options: { returning?: SelectColumnIR[]; ignoreDuplicates?: 'onConflict' | 'ignore' } = {}): Sql {
    const tbl = this.table(table);
    const qt = this.qi(tbl.name);
    const { output, tail } = this.returningParts(tbl, options.returning, 'INSERTED.');
    if (columns.length === 0) {
      if (rows.length !== 1) throw errors.invalidArgument('Cannot insert several rows without columns in one statement.', 'Insert them one by one.');
      if (this.hooks.returning === 'output' && !output.isEmpty) return q`INSERT INTO ${qt}${output} DEFAULT VALUES`;
      return q`${this.hooks.insertDefaults(qt, tbl)}${tail}`;
    }
    const colIRs = columns.map((c) => this.column(tbl, c));
    const values = rows.map((row) => q`(${join(columns.map((c, i) => this.param(row[c], colIRs[i])), ', ')})`);
    const ignore = options.ignoreDuplicates === 'ignore' ? 'IGNORE ' : '';
    const conflict = options.ignoreDuplicates === 'onConflict' ? ' ON CONFLICT DO NOTHING' : '';
    return q`INSERT ${ignore}INTO ${qt} (${columns.map((c) => this.qi(c)).join(', ')})${output} VALUES ${join(values, ', ')}${conflict}${tail}`;
  }

  setList(tbl: TableIR, data: Record<string, UpdateValueIR>, qual: string): Sql {
    const entries = Object.entries(data);
    return join(
      entries.map(([column, v]) => {
        const colIR = this.column(tbl, column);
        const target = this.qi(column);
        const current = text(`${qual}${this.qi(column)}`);
        switch (v.op) {
          case 'set':
            return q`${target} = ${this.param(v.value, colIR)}`;
          case 'increment':
            return q`${target} = ${current} + ${this.param(v.value, colIR)}`;
          case 'decrement':
            return q`${target} = ${current} - ${this.param(v.value, colIR)}`;
          case 'multiply':
            return q`${target} = ${current} * ${this.param(v.value, colIR)}`;
          case 'divide':
            return q`${target} = ${current} / ${this.param(v.value, colIR)}`;
          default:
            throw errors.invalidArgument(`Unknown update operation ${(v as { op: string }).op}.`, 'Use set, increment, decrement, multiply or divide.');
        }
      }),
      ', ',
    );
  }

  compileUpdate(table: string, data: Record<string, UpdateValueIR>, where: WhereIR | undefined, returning?: SelectColumnIR[]): Sql {
    this.resetAliases();
    const scope = this.rootScope(table, false);
    const set = this.setList(scope.table, data, `${scope.qual}.`);
    const w = this.where(where, scope);
    const { output, tail } = this.returningParts(scope.table, returning, 'INSERTED.');
    return q`UPDATE ${this.from(scope)} SET ${set}${output}${w ? q` WHERE ${w}` : ''}${tail}`;
  }

  compileDelete(table: string, where: WhereIR | undefined, returning?: SelectColumnIR[]): Sql {
    this.resetAliases();
    const scope = this.rootScope(table, false);
    const w = this.where(where, scope);
    const { output, tail } = this.returningParts(scope.table, returning, 'DELETED.');
    return q`DELETE FROM ${this.from(scope)}${output}${w ? q` WHERE ${w}` : ''}${tail}`;
  }

  /** Plain SELECT of some columns by a where tree, used for re-selects and key lookups. */
  compileSelectWhere(table: string, columns: SelectColumnIR[], where: WhereIR | undefined, take?: number): Sql {
    this.resetAliases();
    const scope = this.rootScope(table);
    const list = columns.map((c) => q`${this.readColumn(scope, c.column)} AS ${this.qi(c.as)}`);
    const w = this.where(where, scope);
    return this.selectStatement(list.length ? list : [text(`1 AS ${this.qi('x')}`)], scope, w ? [w] : [], undefined, take);
  }

  /** Native upsert statement. `returning` only applies to RETURNING / OUTPUT styles. */
  compileUpsert(table: string, conflict: Record<string, unknown>, create: Record<string, unknown>, update: Record<string, UpdateValueIR>, returning: SelectColumnIR[]): Sql {
    const tbl = this.table(table);
    const qt = this.qi(tbl.name);
    const conflictCols = Object.keys(conflict);
    const insertCols = Object.keys(create);
    const style = this.hooks.upsert;
    if (style === 'onConflict') {
      const set = Object.keys(update).length ? this.setList(tbl, update, `${qt}.`) : text(`${this.qi(conflictCols[0]!)} = ${qt}.${this.qi(conflictCols[0]!)}`);
      const insert = this.compileInsert(table, insertCols, [create]);
      const ret = this.hooks.returning === 'returning' && returning.length ? q` RETURNING ${this.returningList(tbl, returning, '')}` : empty;
      return q`${insert} ON CONFLICT (${conflictCols.map((c) => this.qi(c)).join(', ')}) DO UPDATE SET ${set}${ret}`;
    }
    if (style === 'onDuplicateKey') {
      const insert = this.compileInsert(table, insertCols, [create]);
      const set = Object.keys(update).length ? this.setList(tbl, update, '') : text(`${this.qi(conflictCols[0]!)} = ${this.qi(conflictCols[0]!)}`);
      return q`${insert} ON DUPLICATE KEY UPDATE ${set}`;
    }
    if (style === 'merge') {
      const src = this.qi('src');
      const tgt = this.qi('tgt');
      const allCols = [...new Set([...insertCols, ...conflictCols])];
      const values: Record<string, unknown> = { ...create, ...conflict };
      const srcList = join(allCols.map((c) => q`${this.param(values[c], this.column(tbl, c))} AS ${this.qi(c)}`), ', ');
      const on = join(conflictCols.map((c) => text(`${tgt}.${this.qi(c)} = ${src}.${this.qi(c)}`)), ' AND ');
      const updEntries = Object.fromEntries(Object.entries(update).filter(([c]) => !conflictCols.includes(c)));
      const matched = Object.keys(updEntries).length
        ? q` WHEN MATCHED THEN UPDATE SET ${this.setList(tbl, updEntries, `${tgt}.`)}`
        : empty;
      const insert = q` WHEN NOT MATCHED THEN INSERT (${insertCols.map((c) => this.qi(c)).join(', ')}) VALUES (${insertCols.map((c) => `${src}.${this.qi(c)}`).join(', ')})`;
      const out = this.hooks.returning === 'output' && returning.length ? q` OUTPUT ${this.returningList(tbl, returning, 'INSERTED.')}` : empty;
      return q`MERGE INTO ${qt}${this.hooks.mergeHint ? ` ${this.hooks.mergeHint}` : ''} ${tgt} USING (SELECT ${srcList}${this.hooks.fromDual}) ${src} ON (${on})${matched}${insertCols.length ? insert : empty}${out}${this.hooks.mergeTerminator}`;
    }
    throw errors.unsupported('Native upsert', 'this dialect', 'kastor falls back to select then insert or update.');
  }
}
