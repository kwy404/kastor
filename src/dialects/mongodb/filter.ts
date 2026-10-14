/**
 * WhereIR to MongoDB filters.
 *
 * Plain conditions become query documents (`{ email: { $eq: ... } }`) so the
 * server can use indexes. Relation filters (`some`, `every`, `none`, `is`,
 * `isNot`) need the related rows first: each one adds a `$lookup` stage that
 * loads at most one matching related document into a temporary field, and the
 * filter then tests whether that field is empty.
 *
 * NOT is pushed down to the leaves with SQL three valued logic, so a negated
 * comparison never matches null or missing fields, exactly like SQL where
 * `NOT (x = 1)` is unknown (and filtered out) when x is null.
 */
import { BSONRegExp } from 'mongodb';
import type { AggregateFn, RelationIR, WhereIR } from '../../core/ir';
import { mongoError } from './errors';
import { columnOf, encodeValue, fieldOf, type ColumnInfo, type Model } from './model';

export type Doc = Record<string, unknown>;

/** Shared state while compiling one query: unique names for temporary fields. */
export interface Counter {
  n: number;
}

export interface FilterScope {
  model: Model;
  table: string;
  counter: Counter;
  /** Resolves a column (and optional aggregate, for `having`) to a field path. */
  field?: (column: string, aggregate?: AggregateFn) => string;
  /** Column info used to encode compared values (defaults to the scope table). */
  info?: (column: string, aggregate?: AggregateFn) => ColumnInfo | undefined;
}

export interface CompiledFilter {
  /** Stages that must run before `match` (relation lookups). */
  stages: Doc[];
  match: Doc;
}

const NEVER: Doc = { $expr: { $literal: false } };

/** Escapes every regular expression metacharacter so the text matches literally. */
export function escapeRegex(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&');
}

/** Builds the regular expression for `contains`, `startsWith`, `endsWith` and insensitive equality. */
export function textRegex(mode: 'contains' | 'startsWith' | 'endsWith' | 'equals', value: string, insensitive: boolean): BSONRegExp {
  const body = escapeRegex(value);
  const pattern = mode === 'startsWith' ? `^${body}` : mode === 'endsWith' ? `${body}\\z` : mode === 'equals' ? `^${body}\\z` : body;
  return new BSONRegExp(pattern, insensitive ? 'i' : '');
}

export function compileWhere(where: WhereIR | undefined | null, scope: FilterScope): CompiledFilter {
  const stages: Doc[] = [];
  if (!where) return { stages, match: {} };
  const match = node(where, false, scope, stages);
  return { stages, match };
}

/** True when the tree has a relation filter (and so needs an aggregation). */
export function hasRelationFilter(where: WhereIR | undefined | null): boolean {
  if (!where) return false;
  switch (where.kind) {
    case 'and':
    case 'or':
      return where.items.some(hasRelationFilter);
    case 'not':
      return hasRelationFilter(where.item);
    case 'relation':
      return true;
    default:
      return false;
  }
}

function and(items: Doc[]): Doc {
  const kept = items.filter((d) => Object.keys(d).length > 0);
  if (kept.some((d) => d === NEVER)) return NEVER;
  if (kept.length === 0) return {};
  if (kept.length === 1) return kept[0] as Doc;
  return { $and: kept };
}

function or(items: Doc[]): Doc {
  if (items.some((d) => Object.keys(d).length === 0)) return {};
  const kept = items.filter((d) => d !== NEVER);
  if (kept.length === 0) return NEVER;
  if (kept.length === 1) return kept[0] as Doc;
  return { $or: kept };
}

function resolveField(scope: FilterScope, column: string, aggregate?: AggregateFn): string {
  return scope.field ? scope.field(column, aggregate) : fieldOf(scope.model, scope.table, column);
}

function resolveInfo(scope: FilterScope, column: string, aggregate?: AggregateFn): ColumnInfo | undefined {
  if (scope.info) return scope.info(column, aggregate);
  return columnOf(scope.model, scope.table, column);
}

const flipped: Record<string, string> = { eq: 'ne', ne: 'eq', lt: 'gte', lte: 'gt', gt: 'lte', gte: 'lt' };

function node(where: WhereIR, neg: boolean, scope: FilterScope, stages: Doc[]): Doc {
  switch (where.kind) {
    case 'and': {
      const items = where.items.map((w) => node(w, neg, scope, stages));
      return neg ? or(items) : and(items);
    }
    case 'or': {
      const items = where.items.map((w) => node(w, neg, scope, stages));
      return neg ? and(items) : or(items);
    }
    case 'not':
      return node(where.item, !neg, scope, stages);
    case 'const':
      return where.value !== neg ? {} : NEVER;
    case 'null': {
      const f = resolveField(scope, where.column);
      const isNull = where.negate === neg;
      return isNull ? { [f]: null } : { [f]: { $ne: null } };
    }
    case 'compare': {
      const f = resolveField(scope, where.column, where.aggregate);
      const info = resolveInfo(scope, where.column, where.aggregate);
      const op = neg ? (flipped[where.op] as typeof where.op) : where.op;
      if (where.value === null || where.value === undefined) {
        if (op === 'eq') return { [f]: null };
        if (op === 'ne') return { [f]: { $ne: null } };
        return NEVER;
      }
      if (where.insensitive && typeof where.value === 'string') return insensitiveCompare(f, op, where.value);
      const v = encodeValue(where.value, info);
      switch (op) {
        case 'eq':
          return { [f]: { $eq: v } };
        case 'ne':
          return { [f]: { $nin: [v, null] } };
        default:
          return { [f]: { [`$${op}`]: v } };
      }
    }
    case 'in': {
      const f = resolveField(scope, where.column, where.aggregate);
      const info = resolveInfo(scope, where.column, where.aggregate);
      const values = where.values.filter((v) => v !== null && v !== undefined);
      const negated = where.negate !== neg;
      const encoded = where.insensitive
        ? values.map((v) => (typeof v === 'string' ? textRegex('equals', v, true) : encodeValue(v, info)))
        : values.map((v) => encodeValue(v, info));
      if (!negated) return encoded.length === 0 ? NEVER : { [f]: { $in: encoded } };
      return { [f]: { $nin: [...encoded, null] } };
    }
    case 'like': {
      const f = resolveField(scope, where.column);
      const re = textRegex(where.mode, where.value, where.insensitive);
      const negated = where.negate !== neg;
      return negated ? { [f]: { $type: 'string', $not: re } } : { [f]: re };
    }
    case 'relation':
      return relationFilter(where.relation, where.op, where.where, neg, scope, stages);
    case 'raw':
      throw mongoError(
        'UNSUPPORTED',
        'Raw SQL fragments cannot be used in a MongoDB filter.',
        'Express the condition with the where operators (equals, in, contains, AND, OR, NOT, relation filters) instead of sql`...`.',
      );
    default:
      throw mongoError('UNSUPPORTED', `Unknown filter node "${(where as { kind: string }).kind}".`, 'Update kastor/mongodb to the same version as kastor.');
  }
}

function insensitiveCompare(field: string, op: string, value: string): Doc {
  if (op === 'eq') return { [field]: textRegex('equals', value, true) };
  if (op === 'ne') return { [field]: { $type: 'string', $not: textRegex('equals', value, true) } };
  const cmp = { [`$${op}`]: [{ $toLower: `$${field}` }, value.toLowerCase()] };
  return { $expr: { $and: [{ $eq: [{ $type: `$${field}` }, 'string'] }, cmp] } };
}

/**
 * EXISTS / NOT EXISTS over related rows. `every: w` is `none: NOT w`, `is: w`
 * is `some: w`, `isNot: w` is `none: w`; `is: null` means no related row.
 */
function relationFilter(
  relation: RelationIR,
  op: 'some' | 'every' | 'none' | 'is' | 'isNot',
  where: WhereIR | null,
  neg: boolean,
  scope: FilterScope,
  stages: Doc[],
): Doc {
  let exists: boolean;
  const inner: WhereIR | null = where;
  let innerNeg = false;
  switch (op) {
    case 'some':
    case 'is':
      exists = true;
      break;
    case 'none':
    case 'isNot':
      exists = false;
      break;
    case 'every':
      exists = false;
      innerNeg = true;
      if (!inner) return neg ? NEVER : {};
      break;
  }
  // `is: null` means "no related row", `isNot: null` means "has a related row".
  if (where === null && op === 'is') exists = false;
  if (where === null && op === 'isNot') exists = true;
  if (neg) exists = !exists;

  const innerScope: FilterScope = { model: scope.model, table: relation.to, counter: scope.counter };
  const innerStages: Doc[] = [];
  if (inner) {
    const innerMatch = node(inner, innerNeg, innerScope, innerStages);
    if (innerMatch === NEVER) return exists ? NEVER : {};
    if (Object.keys(innerMatch).length > 0) innerStages.push({ $match: innerMatch });
  }
  innerStages.push({ $limit: 1 }, { $project: { _id: 1 } });
  const as = `__rf${scope.counter.n++}`;
  stages.push(lookupStage(scope.model, relation, as, innerStages, ''));
  return exists ? { [as]: { $ne: [] } } : { [as]: { $eq: [] } };
}

/**
 * A `$lookup` that loads the rows related to the current document through
 * `relation` into `as`, then runs `pipeline` on them. `prefix` is the path of
 * the source document inside the current one (`''` for the root, `__o0.` for
 * a document loaded by an earlier lookup).
 *
 * Direct relations match `to.toColumns = $$from.fromColumns`. Relations
 * through a join table read the join rows first, load the target of each with
 * an inner lookup and promote it to the root, so `pipeline` always sees target
 * documents. Rows of soft delete tables with the marker set are skipped.
 */
export function lookupStage(model: Model, relation: RelationIR, as: string, pipeline: Doc[], prefix: string): Doc {
  const softDelete: Doc[] = relation.softDeleteColumn ? [{ $match: { [fieldOf(model, relation.to, relation.softDeleteColumn)]: null } }] : [];
  const letVars: Doc = {};
  if (!relation.through) {
    const conds: Doc[] = [];
    relation.fromColumns.forEach((col, i) => {
      const v = `k${i}`;
      letVars[v] = `$${prefix}${fieldOf(model, relation.from, col)}`;
      const to = relation.toColumns[i] ?? col;
      conds.push({ $eq: [`$${fieldOf(model, relation.to, to)}`, `$$${v}`] });
    });
    conds.push(...relation.fromColumns.map((_, i) => ({ $ne: [`$$k${i}`, null] })));
    return {
      $lookup: {
        from: relation.to,
        let: letVars,
        pipeline: [{ $match: { $expr: conds.length === 1 ? conds[0] : { $and: conds } } }, ...softDelete, ...pipeline],
        as,
      },
    };
  }
  const through = relation.through;
  const outer: Doc[] = [];
  relation.fromColumns.forEach((col, i) => {
    const v = `k${i}`;
    letVars[v] = `$${prefix}${fieldOf(model, relation.from, col)}`;
    const src = through.sourceColumns[i] ?? col;
    outer.push({ $eq: [`$${fieldOf(model, through.table, src)}`, `$$${v}`] });
  });
  outer.push(...relation.fromColumns.map((_, i) => ({ $ne: [`$$k${i}`, null] })));
  const targetLet: Doc = {};
  const targetConds: Doc[] = [];
  through.targetColumns.forEach((col, j) => {
    const v = `t${j}`;
    targetLet[v] = `$${fieldOf(model, through.table, col)}`;
    const to = relation.toColumns[j] ?? col;
    targetConds.push({ $eq: [`$${fieldOf(model, relation.to, to)}`, `$$${v}`] });
  });
  return {
    $lookup: {
      from: through.table,
      let: letVars,
      pipeline: [
        { $match: { $expr: outer.length === 1 ? outer[0] : { $and: outer } } },
        {
          $lookup: {
            from: relation.to,
            let: targetLet,
            pipeline: [{ $match: { $expr: targetConds.length === 1 ? targetConds[0] : { $and: targetConds } } }, ...softDelete, { $limit: 1 }],
            as: '__t',
          },
        },
        { $unwind: '$__t' },
        { $replaceRoot: { newRoot: '$__t' } },
        ...pipeline,
      ],
      as,
    },
  };
}
