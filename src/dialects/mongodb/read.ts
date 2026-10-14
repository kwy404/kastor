/**
 * Reads as aggregation pipelines.
 *
 * Every read is one `aggregate` call. Includes become `$lookup` stages with
 * their own pipeline (filter, order, skip, limit, nested includes), so a
 * `findMany` with includes several levels deep is still a single round trip.
 */
import type {
  AggregateFn,
  AggregateIR,
  AggregateQueryIR,
  CountQueryIR,
  GroupByQueryIR,
  OrderByIR,
  ReadIR,
  Row,
  WhereIR,
} from '../../core/ir';
import { mongoError } from './errors';
import { compileWhere, lookupStage, type Counter, type Doc } from './filter';
import { columnOf, decodeValue, fieldOf, type ColumnInfo, type Model } from './model';

export interface Pipeline {
  collection: string;
  pipeline: Doc[];
}

/** Stages for `where`: relation lookups, then `$match`. */
export function whereStages(model: Model, table: string, where: WhereIR | undefined, counter: Counter): Doc[] {
  if (!where) return [];
  const { stages, match } = compileWhere(where, { model, table, counter });
  return Object.keys(match).length > 0 ? [...stages, { $match: match }] : stages;
}

const nullFlag = (path: string): Doc => ({ $cond: [{ $eq: [{ $ifNull: [`$${path}`, null] }, null] }, 1, 0] });

/**
 * `$sort` spec for an orderBy list, plus the stages that compute helper fields
 * (relation counts, columns of related rows, null ordering flags). `_id` is
 * added as the last key so ties come back in a stable order.
 */
export function sortStages(model: Model, table: string, orderBy: OrderByIR[], counter: Counter): { stages: Doc[]; sort: Doc } {
  const stages: Doc[] = [];
  const sort: Doc = {};
  const add = (path: string, direction: 'asc' | 'desc', nulls?: 'first' | 'last') => {
    const dir = direction === 'asc' ? 1 : -1;
    // MongoDB sorts null and missing values as the smallest: first when
    // ascending, last when descending. Add a flag only to change that.
    if ((nulls === 'last' && dir === 1) || (nulls === 'first' && dir === -1)) {
      const flag = `__nl${counter.n++}`;
      stages.push({ $set: { [flag]: nullFlag(path) } });
      sort[flag] = nulls === 'last' ? 1 : -1;
    }
    if (!(path in sort)) sort[path] = dir;
  };
  for (const o of orderBy) {
    switch (o.kind) {
      case 'column':
        add(fieldOf(model, table, o.column), o.direction, o.nulls);
        break;
      case 'relationCount': {
        const as = `__oc${counter.n++}`;
        stages.push(lookupStage(model, o.relation, as, [{ $count: 'n' }], ''));
        stages.push({ $set: { [as]: { $ifNull: [{ $arrayElemAt: [`$${as}.n`, 0] }, 0] } } });
        add(as, o.direction);
        break;
      }
      case 'relationColumn': {
        let prefix = '';
        let current = table;
        for (const relation of o.path) {
          const as = `__or${counter.n++}`;
          stages.push(lookupStage(model, relation, as, [{ $limit: 1 }], prefix));
          stages.push({ $set: { [as]: { $arrayElemAt: [`$${as}`, 0] } } });
          prefix = `${as}.`;
          current = relation.to;
        }
        add(`${prefix}${fieldOf(model, current, o.column)}`, o.direction, o.nulls);
        break;
      }
      case 'aggregate':
        throw mongoError('INVALID_ARGUMENT', 'Ordering by an aggregate only works in groupBy.', 'Move the aggregate ordering into a groupBy call.');
    }
  }
  if (Object.keys(sort).length > 0 && !('_id' in sort)) sort._id = 1;
  return { stages, sort };
}

/** Filter, order, distinct, skip and limit: the part shared by find, count and aggregate. */
function selectionStages(
  model: Model,
  table: string,
  opts: { where?: WhereIR; orderBy?: OrderByIR[]; take?: number; skip?: number; distinct?: string[] },
  counter: Counter,
): Doc[] {
  const out = whereStages(model, table, opts.where, counter);
  const { stages, sort } = sortStages(model, table, opts.orderBy ?? [], counter);
  out.push(...stages);
  const hasSort = Object.keys(sort).length > 0;
  if (opts.distinct && opts.distinct.length > 0) {
    if (hasSort) out.push({ $sort: sort });
    const key: Doc = {};
    opts.distinct.forEach((col, i) => {
      key[`d${i}`] = { $ifNull: [`$${fieldOf(model, table, col)}`, null] };
    });
    out.push({ $group: { _id: key, doc: { $first: '$$ROOT' } } }, { $replaceRoot: { newRoot: '$doc' } });
    out.push({ $sort: hasSort ? sort : { _id: 1 } });
  } else if (hasSort) {
    out.push({ $sort: sort });
  }
  if (opts.skip !== undefined && opts.skip > 0) out.push({ $skip: opts.skip });
  if (opts.take !== undefined) out.push(opts.take > 0 ? { $limit: opts.take } : { $match: { $expr: { $literal: false } } });
  return out;
}

/** Stages for a full read: selection, includes, relation counts and the final projection. */
export function readStages(model: Model, read: ReadIR, counter: Counter): Doc[] {
  const out = selectionStages(model, read.table, read, counter);
  const project: Doc = { _id: 0 };
  let projected = 0;
  for (const sel of read.select) {
    project[sel.as] = `$${fieldOf(model, read.table, sel.column)}`;
    projected++;
  }
  for (const inc of read.include) {
    const as = `__i${counter.n++}`;
    out.push(lookupStage(model, inc.relation, as, readStages(model, inc.read, counter), ''));
    project[inc.relation.name] = inc.relation.cardinality === 'one' ? { $ifNull: [{ $arrayElemAt: [`$${as}`, 0] }, null] } : `$${as}`;
    projected++;
  }
  if (read.counts.length > 0) {
    const counts: Doc = {};
    for (const c of read.counts) {
      const as = `__c${counter.n++}`;
      out.push(lookupStage(model, c.relation, as, [...whereStages(model, c.relation.to, c.where, counter), { $count: 'n' }], ''));
      counts[c.as] = { $ifNull: [{ $arrayElemAt: [`$${as}.n`, 0] }, 0] };
    }
    project._count = counts;
    projected++;
  }
  if (projected === 0) project.__k = { $literal: 1 };
  out.push({ $project: project });
  return out;
}

export function findPipeline(model: Model, read: ReadIR): Pipeline {
  return { collection: read.table, pipeline: readStages(model, read, { n: 0 }) };
}

/** Decodes one projected document following the read tree. */
export function decodeRow(model: Model, read: ReadIR, doc: Doc): Row {
  const row: Row = {};
  for (const sel of read.select) row[sel.as] = decodeValue(doc[sel.as], columnOf(model, read.table, sel.column));
  for (const inc of read.include) {
    const value = doc[inc.relation.name];
    if (inc.relation.cardinality === 'one') {
      row[inc.relation.name] = value && typeof value === 'object' ? decodeRow(model, inc.read, value as Doc) : null;
    } else {
      row[inc.relation.name] = Array.isArray(value) ? value.map((v) => decodeRow(model, inc.read, v as Doc)) : [];
    }
  }
  if (read.counts.length > 0) {
    const counts = (doc._count ?? {}) as Doc;
    const out: Row = {};
    for (const c of read.counts) out[c.as] = Number(counts[c.as] ?? 0);
    row._count = out;
  }
  return row;
}

export function countPipeline(model: Model, q: CountQueryIR): Pipeline {
  const counter = { n: 0 };
  const pipeline = selectionStages(model, q.table, q, counter);
  pipeline.push({ $count: 'n' });
  return { collection: q.table, pipeline };
}

/** Accumulator for one aggregate. `count(col)` counts non null values like SQL. */
function accumulator(fn: AggregateFn, path: string | null): Doc {
  if (fn === 'count') return path === null ? { $sum: 1 } : { $sum: { $cond: [{ $eq: [{ $ifNull: [`$${path}`, null] }, null] }, 0, 1] } };
  if (path === null) throw mongoError('INVALID_ARGUMENT', `${fn} needs a column.`, `Pass a column to _${fn}.`);
  return { [`$${fn}`]: `$${path}` };
}

/**
 * `$sum` returns 0 when every value is null, SQL returns null. A hidden count
 * of non null values turns those sums back into null in the projection.
 */
function aggregateOutput(agg: AggregateIR, nonNull: string | undefined): unknown {
  if (agg.fn === 'sum' && nonNull) return { $cond: [{ $eq: [`$${nonNull}`, 0] }, null, `$${agg.as}`] };
  return `$${agg.as}`;
}

export function aggregatePipeline(model: Model, q: AggregateQueryIR): Pipeline {
  const counter = { n: 0 };
  const pipeline = selectionStages(model, q.table, q, counter);
  const group: Doc = { _id: null };
  const project: Doc = { _id: 0 };
  for (const agg of q.aggregates) {
    const path = agg.column === null ? null : fieldOf(model, q.table, agg.column);
    group[agg.as] = accumulator(agg.fn, path);
    let nonNull: string | undefined;
    if (agg.fn === 'sum') {
      nonNull = `__nn${counter.n++}`;
      group[nonNull] = accumulator('count', path);
    }
    project[agg.as] = aggregateOutput(agg, nonNull);
  }
  pipeline.push({ $group: group }, { $project: project });
  return { collection: q.table, pipeline };
}

/** Decodes an aggregate value: counts are numbers, avg is a number (a string for decimal columns), the rest follow the column type. */
export function decodeAggregate(fn: AggregateFn, info: ColumnInfo | undefined, value: unknown): unknown {
  if (fn === 'count') return value === null || value === undefined ? 0 : Number(value);
  if (value === null || value === undefined) return null;
  if (fn === 'avg') {
    if (info?.column.type === 'decimal') return decodeValue(value, { ...info, column: { ...info.column, scale: undefined } });
    return Number(typeof value === 'object' ? String(value) : value);
  }
  return decodeValue(value, info);
}

export function decodeAggregateRow(model: Model, table: string, aggregates: AggregateIR[], doc: Doc | undefined): Row {
  const row: Row = {};
  for (const agg of aggregates) {
    const info = agg.column === null ? undefined : columnOf(model, table, agg.column);
    row[agg.as] = decodeAggregate(agg.fn, info, doc ? doc[agg.as] : null);
  }
  return row;
}

/** Aggregates referenced by a having tree. */
function havingAggregates(where: WhereIR | undefined, out: Array<{ fn: AggregateFn; column: string | null }>): void {
  if (!where) return;
  switch (where.kind) {
    case 'and':
    case 'or':
      where.items.forEach((w) => havingAggregates(w, out));
      break;
    case 'not':
      havingAggregates(where.item, out);
      break;
    case 'compare':
    case 'in':
      if (where.aggregate) out.push({ fn: where.aggregate, column: where.column ?? null });
      break;
    default:
      break;
  }
}

export function groupByPipeline(model: Model, q: GroupByQueryIR): Pipeline {
  const counter = { n: 0 };
  const pipeline = whereStages(model, q.table, q.where, counter);
  const key: Doc = {};
  const byPath = new Map<string, string>();
  q.by.forEach((b, i) => {
    key[`g${i}`] = { $ifNull: [`$${fieldOf(model, q.table, b.column)}`, null] };
    byPath.set(b.column, `_id.g${i}`);
  });

  // Every aggregate the query needs (output, having, orderBy) gets one field.
  const group: Doc = { _id: key };
  const guards: Doc = {};
  const aggPath = new Map<string, string>();
  const ensure = (fn: AggregateFn, column: string | null): string => {
    const k = `${fn}:${column ?? '*'}`;
    let path = aggPath.get(k);
    if (path) return path;
    path = `__ag${counter.n++}`;
    const field = column === null ? null : fieldOf(model, q.table, column);
    group[path] = accumulator(fn, field);
    if (fn === 'sum') {
      const nn = `__nn${counter.n++}`;
      group[nn] = accumulator('count', field);
      guards[path] = { $cond: [{ $eq: [`$${nn}`, 0] }, null, `$${path}`] };
    }
    aggPath.set(k, path);
    return path;
  };
  const project: Doc = { _id: 0 };
  q.by.forEach((b, i) => {
    project[b.as] = `$_id.g${i}`;
  });
  for (const agg of q.aggregates) project[agg.as] = `$${ensure(agg.fn, agg.column)}`;
  const fromHaving: Array<{ fn: AggregateFn; column: string | null }> = [];
  havingAggregates(q.having, fromHaving);
  for (const h of fromHaving) ensure(h.fn, h.column);
  const sort: Doc = {};
  for (const o of q.orderBy) {
    const dir = o.direction === 'asc' ? 1 : -1;
    let path: string;
    if (o.kind === 'column') {
      const p = byPath.get(o.column);
      if (!p) throw mongoError('INVALID_ARGUMENT', `groupBy can only order by grouped columns, "${o.column}" is not in by.`, 'Add the column to by, or order by an aggregate.');
      path = p;
    } else if (o.kind === 'aggregate') {
      path = ensure(o.fn, o.column);
    } else {
      throw mongoError('INVALID_ARGUMENT', 'groupBy cannot order by relations.', 'Order by a grouped column or an aggregate.');
    }
    if (!(path in sort)) sort[path] = dir;
  }
  if (!('_id' in sort)) sort._id = 1;

  pipeline.push({ $group: group });
  if (Object.keys(guards).length > 0) pipeline.push({ $set: guards });
  if (q.having) {
    const { match } = compileWhere(q.having, {
      model,
      table: q.table,
      counter,
      field: (column, aggregate) => {
        if (aggregate) return ensure(aggregate, column ?? null);
        const p = byPath.get(column);
        if (!p) throw mongoError('INVALID_ARGUMENT', `having filters on "${column}", which is not in by.`, 'Add the column to by, or filter on an aggregate of it.');
        return p;
      },
      info: (column, aggregate) => (aggregate === 'count' || aggregate === 'avg' ? undefined : columnOf(model, q.table, column)),
    });
    if (Object.keys(match).length > 0) pipeline.push({ $match: match });
  }
  pipeline.push({ $sort: sort });
  if (q.skip !== undefined && q.skip > 0) pipeline.push({ $skip: q.skip });
  if (q.take !== undefined) pipeline.push(q.take > 0 ? { $limit: q.take } : { $match: { $expr: { $literal: false } } });
  pipeline.push({ $project: project });
  return { collection: q.table, pipeline };
}

export function decodeGroupRow(model: Model, q: GroupByQueryIR, doc: Doc): Row {
  const row: Row = {};
  for (const b of q.by) row[b.as] = decodeValue(doc[b.as], columnOf(model, q.table, b.column));
  for (const agg of q.aggregates) {
    const info = agg.column === null ? undefined : columnOf(model, q.table, agg.column);
    row[agg.as] = decodeAggregate(agg.fn, info, doc[agg.as]);
  }
  return row;
}
