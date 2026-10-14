// Unit tests for the MongoDB dialect: pipelines, filters, DDL and value codecs. No server needed.
import { Binary, BSONRegExp, Decimal128, Long, ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import type { QueryIR, WhereIR } from '../src/core/ir';
import { isKastorError } from '../src/core/errors';
import { mongoDdl, inferColumns, jsonSchema, splitCommands } from '../src/dialects/mongodb/ddl';
import { mapMongoError } from '../src/dialects/mongodb/errors';
import { bindParams, parseCommand } from '../src/dialects/mongodb/executor';
import { compileWhere, escapeRegex, lookupStage, textRegex } from '../src/dialects/mongodb/filter';
import { decodeValue, encodeValue, fixScale, getModel } from '../src/dialects/mongodb/model';
import { aggregatePipeline, countPipeline, findPipeline, groupByPipeline, sortStages } from '../src/dialects/mongodb/read';
import { buildDocs, buildUpdate } from '../src/dialects/mongodb/write';
import { createMongoDialect, mongoDialect } from '../src/mongodb';
import { read, rel, schema, sel } from './mongo-fixture';

const model = getModel(schema, 'objectId');
const where = (w: WhereIR, table = 'users') => compileWhere(w, { model, table, counter: { n: 0 } });
const info = (table: string, column: string) => model.tables.get(table)!.columns.get(column);

describe('mongodb filters', () => {
  it('escapes every regular expression metacharacter', () => {
    expect(escapeRegex('a.b*c+d?e^f$g(h)i[j]k{l}m|n\\o/p-q')).toBe('a\\.b\\*c\\+d\\?e\\^f\\$g\\(h\\)i\\[j\\]k\\{l\\}m\\|n\\\\o\\/p\\-q');
    expect(new RegExp(escapeRegex('1+1=(2)')).test('1+1=(2)')).toBe(true);
  });

  it('anchors contains, startsWith, endsWith and insensitive equality', () => {
    expect(textRegex('contains', 'a.b', false)).toEqual(new BSONRegExp('a\\.b', ''));
    expect(textRegex('startsWith', 'Ab', true)).toEqual(new BSONRegExp('^Ab', 'i'));
    expect(textRegex('endsWith', '@x.com', false)).toEqual(new BSONRegExp('@x\\.com\\z', ''));
    expect(textRegex('equals', 'Ada', true)).toEqual(new BSONRegExp('^Ada\\z', 'i'));
  });

  it('maps the primary key to _id and encodes ObjectId strings', () => {
    const id = new ObjectId().toHexString();
    expect(where({ kind: 'compare', column: 'id', op: 'eq', value: id }).match).toEqual({ _id: { $eq: new ObjectId(id) } });
    // foreign keys to an ObjectId primary key hold ObjectIds too
    expect(where({ kind: 'in', column: 'authorId', values: [id], negate: false }, 'posts').match).toEqual({ authorId: { $in: [new ObjectId(id)] } });
  });

  it('keeps SQL null semantics for not equal, not in and NOT', () => {
    expect(where({ kind: 'compare', column: 'name', op: 'ne', value: 'x' }).match).toEqual({ name: { $nin: ['x', null] } });
    expect(where({ kind: 'in', column: 'name', values: ['a', null], negate: true }).match).toEqual({ name: { $nin: ['a', null] } });
    expect(where({ kind: 'not', item: { kind: 'compare', column: 'name', op: 'eq', value: 'x' } }).match).toEqual({ name: { $nin: ['x', null] } });
    expect(where({ kind: 'not', item: { kind: 'compare', column: 'name', op: 'lt', value: 'm' } }).match).toEqual({ name: { $gte: 'm' } });
    expect(where({ kind: 'not', item: { kind: 'null', column: 'name', negate: false } }).match).toEqual({ name: { $ne: null } });
    expect(where({ kind: 'in', column: 'name', values: [], negate: false }).match).toEqual({ $expr: { $literal: false } });
  });

  it('pushes NOT through AND and OR with De Morgan', () => {
    const w: WhereIR = {
      kind: 'not',
      item: {
        kind: 'and',
        items: [
          { kind: 'compare', column: 'email', op: 'eq', value: 'a' },
          { kind: 'like', column: 'name', mode: 'startsWith', value: 'A', insensitive: true, negate: false },
        ],
      },
    };
    expect(where(w).match).toEqual({ $or: [{ email: { $nin: ['a', null] } }, { name: { $type: 'string', $not: new BSONRegExp('^A', 'i') } }] });
  });

  it('compares insensitively with regular expressions and $toLower', () => {
    expect(where({ kind: 'compare', column: 'email', op: 'eq', value: 'A.B', insensitive: true }).match).toEqual({ email: new BSONRegExp('^A\\.B\\z', 'i') });
    expect(where({ kind: 'in', column: 'email', values: ['X'], negate: false, insensitive: true }).match).toEqual({ email: { $in: [new BSONRegExp('^X\\z', 'i')] } });
    expect(where({ kind: 'compare', column: 'email', op: 'gt', value: 'M', insensitive: true }).match).toEqual({
      $expr: { $and: [{ $eq: [{ $type: '$email' }, 'string'] }, { $gt: [{ $toLower: '$email' }, 'm'] }] },
    });
  });

  it('turns relation filters into $lookup stages', () => {
    const published: WhereIR = { kind: 'compare', column: 'published', op: 'eq', value: true };
    const some = where({ kind: 'relation', relation: rel.userPosts, op: 'some', where: published });
    expect(some.match).toEqual({ __rf0: { $ne: [] } });
    expect(some.stages).toEqual([
      {
        $lookup: {
          from: 'posts',
          let: { k0: '$_id' },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ['$authorId', '$$k0'] }, { $ne: ['$$k0', null] }] } } },
            { $match: { published: { $eq: true } } },
            { $limit: 1 },
            { $project: { _id: 1 } },
          ],
          as: '__rf0',
        },
      },
    ]);
    const every = where({ kind: 'relation', relation: rel.userPosts, op: 'every', where: published });
    expect(every.match).toEqual({ __rf0: { $eq: [] } });
    expect((every.stages[0] as { $lookup: { pipeline: unknown[] } }).$lookup.pipeline[1]).toEqual({ $match: { $nor: [{ published: { $eq: true } }] } });
    expect(where({ kind: 'relation', relation: rel.postAuthor, op: 'is', where: null }, 'posts').match).toEqual({ __rf0: { $eq: [] } });
    expect(where({ kind: 'relation', relation: rel.postAuthor, op: 'isNot', where: null }, 'posts').match).toEqual({ __rf0: { $ne: [] } });
    expect(where({ kind: 'not', item: { kind: 'relation', relation: rel.userPosts, op: 'none', where: null } }).match).toEqual({ __rf0: { $ne: [] } });
  });

  it('reads many to many relations through the join table', () => {
    const stage = lookupStage(model, rel.postTags, 'x', [{ $limit: 2 }], '') as { $lookup: { from: string; pipeline: Array<Record<string, unknown>> } };
    expect(stage.$lookup.from).toBe('post_tags');
    expect(stage.$lookup.pipeline).toEqual([
      { $match: { $expr: { $and: [{ $eq: ['$postId', '$$k0'] }, { $ne: ['$$k0', null] }] } } },
      { $lookup: { from: 'tags', let: { t0: '$tagId' }, pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$t0'] } } }, { $limit: 1 }], as: '__t' } },
      { $unwind: '$__t' },
      { $replaceRoot: { newRoot: '$__t' } },
      { $limit: 2 },
    ]);
  });

  it('skips soft deleted related rows', () => {
    const stage = lookupStage(model, { ...rel.userPosts, softDeleteColumn: 'title' }, 'x', [], '') as { $lookup: { pipeline: unknown[] } };
    expect(stage.$lookup.pipeline[1]).toEqual({ $match: { title: null } });
  });

  it('rejects raw SQL fragments with a hint', () => {
    try {
      where({ kind: 'raw', sql: { strings: ['1 = 1'], params: [] } });
      expect.unreachable();
    } catch (e) {
      expect(isKastorError(e, 'UNSUPPORTED')).toBe(true);
    }
  });
});

describe('mongodb read pipelines', () => {
  it('builds one aggregate with includes, counts and projection', () => {
    const p = findPipeline(
      model,
      read('users', ['id', 'email'], {
        where: { kind: 'compare', column: 'role', op: 'eq', value: 'admin' },
        orderBy: [{ kind: 'column', column: 'email', direction: 'desc' }],
        skip: 1,
        take: 2,
        include: [{ relation: rel.userProfile, read: read('profiles', ['bio']) }],
        counts: [{ relation: rel.userPosts, as: 'posts' }],
      }),
    );
    expect(p.collection).toBe('users');
    expect(p.pipeline).toEqual([
      { $match: { role: { $eq: 'admin' } } },
      { $sort: { email: -1, _id: 1 } },
      { $skip: 1 },
      { $limit: 2 },
      {
        $lookup: {
          from: 'profiles',
          let: { k0: '$_id' },
          pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$userId', '$$k0'] }, { $ne: ['$$k0', null] }] } } }, { $project: { _id: 0, bio: '$bio' } }],
          as: '__i0',
        },
      },
      {
        $lookup: {
          from: 'posts',
          let: { k0: '$_id' },
          pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$authorId', '$$k0'] }, { $ne: ['$$k0', null] }] } } }, { $count: 'n' }],
          as: '__c1',
        },
      },
      {
        $project: {
          _id: 0,
          id: '$_id',
          email: '$email',
          profile: { $ifNull: [{ $arrayElemAt: ['$__i0', 0] }, null] },
          _count: { posts: { $ifNull: [{ $arrayElemAt: ['$__c1.n', 0] }, 0] } },
        },
      },
    ]);
  });

  it('keeps the first row of each distinct group, then sorts again', () => {
    const p = findPipeline(model, read('posts', ['title'], { distinct: ['title'], orderBy: [{ kind: 'column', column: 'views', direction: 'desc' }] }));
    expect(p.pipeline).toEqual([
      { $sort: { views: -1, _id: 1 } },
      { $group: { _id: { d0: { $ifNull: ['$title', null] } }, doc: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$doc' } },
      { $sort: { views: -1, _id: 1 } },
      { $project: { _id: 0, title: '$title' } },
    ]);
  });

  it('orders by null placement, relation counts and related columns', () => {
    const { stages, sort } = sortStages(
      model,
      'posts',
      [
        { kind: 'column', column: 'title', direction: 'asc', nulls: 'last' },
        { kind: 'relationColumn', path: [rel.postAuthor], column: 'email', direction: 'desc' },
        { kind: 'relationCount', relation: rel.postTags, direction: 'desc' },
      ],
      { n: 0 },
    );
    expect(sort).toEqual({ __nl0: 1, title: 1, '__or1.email': -1, __oc2: -1, _id: 1 });
    expect(stages[0]).toEqual({ $set: { __nl0: { $cond: [{ $eq: [{ $ifNull: ['$title', null] }, null] }, 1, 0] } } });
    expect(stages[2]).toEqual({ $set: { __or1: { $arrayElemAt: ['$__or1', 0] } } });
    expect(stages[4]).toEqual({ $set: { __oc2: { $ifNull: [{ $arrayElemAt: ['$__oc2.n', 0] }, 0] } } });
  });

  it('counts with $count and aggregates with SQL like sums', () => {
    expect(countPipeline(model, { kind: 'count', table: 'posts', take: 5 }).pipeline).toEqual([{ $limit: 5 }, { $count: 'n' }]);
    const agg = aggregatePipeline(model, {
      kind: 'aggregate',
      table: 'posts',
      aggregates: [
        { fn: 'count', column: 'title', as: 'a0' },
        { fn: 'sum', column: 'views', as: 'a1' },
      ],
    });
    expect(agg.pipeline).toEqual([
      {
        $group: {
          _id: null,
          a0: { $sum: { $cond: [{ $eq: [{ $ifNull: ['$title', null] }, null] }, 0, 1] } },
          a1: { $sum: '$views' },
          __nn0: { $sum: { $cond: [{ $eq: [{ $ifNull: ['$views', null] }, null] }, 0, 1] } },
        },
      },
      { $project: { _id: 0, a0: '$a0', a1: { $cond: [{ $eq: ['$__nn0', 0] }, null, '$a1'] } } },
    ]);
  });

  it('groups with having and orders by aggregates', () => {
    const p = groupByPipeline(model, {
      kind: 'groupBy',
      table: 'posts',
      by: sel('authorId'),
      aggregates: [{ fn: 'count', column: null, as: 'n' }],
      having: { kind: 'compare', column: 'views', op: 'gte', value: 10, aggregate: 'max' },
      orderBy: [{ kind: 'aggregate', fn: 'count', column: null, direction: 'desc' }],
      take: 3,
    });
    expect(p.pipeline).toEqual([
      { $group: { _id: { g0: { $ifNull: ['$authorId', null] } }, __ag0: { $sum: 1 }, __ag1: { $max: '$views' } } },
      { $match: { __ag1: { $gte: 10 } } },
      { $sort: { __ag0: -1, _id: 1 } },
      { $limit: 3 },
      { $project: { _id: 0, authorId: '$_id.g0', n: '$__ag0' } },
    ]);
  });

  it('treats an empty having column as count(*)', () => {
    const p = groupByPipeline(model, {
      kind: 'groupBy',
      table: 'posts',
      by: sel('authorId'),
      aggregates: [],
      having: { kind: 'compare', column: '', op: 'gt', value: 1, aggregate: 'count' },
      orderBy: [],
    });
    expect(p.pipeline[0]).toEqual({ $group: { _id: { g0: { $ifNull: ['$authorId', null] } }, __ag0: { $sum: 1 } } });
    expect(p.pipeline[1]).toEqual({ $match: { __ag0: { $gt: 1 } } });
  });
});

describe('mongodb writes', () => {
  it('builds pipeline updates that keep null arithmetic null and literal values literal', () => {
    expect(buildUpdate(model, 'posts', { title: { op: 'set', value: '$x' }, views: { op: 'increment', value: 1 } })).toEqual([
      { $set: { title: { $literal: '$x' }, views: { $cond: [{ $eq: [{ $ifNull: ['$views', null] }, null] }, null, { $add: ['$views', 1] }] } } },
    ]);
    expect(buildUpdate(model, 'posts', { views: { op: 'divide', value: 2 } })[0]).toEqual({
      $set: { views: { $cond: [{ $eq: [{ $ifNull: ['$views', null] }, null] }, null, { $toInt: { $trunc: [{ $divide: ['$views', 2] }, 0] } }] } },
    });
    expect(() => buildUpdate(model, 'posts', { id: { op: 'set', value: 'x' } })).toThrow(/_id/);
  });

  it('fills defaults, nulls and generated ids when building documents', async () => {
    const [doc] = await buildDocs(model, model.tables.get('users')!, [{ email: 'a@x.com', score: 1.005 }], null);
    expect(doc!._id).toBeInstanceOf(ObjectId);
    expect(doc).toMatchObject({ email: 'a@x.com', name: null, role: 'user', big: null });
    expect(String(doc!.score)).toBe('1.01');
    expect(doc!.createdAt).toBeInstanceOf(Date);
    await expect(buildDocs(model, model.tables.get('posts')!, [{ title: 'x' }], null)).rejects.toMatchObject({ code: 'NOT_NULL_VIOLATION' });
    const uuidModel = getModel(schema, 'uuid');
    const [u] = await buildDocs(uuidModel, uuidModel.tables.get('users')!, [{ email: 'a' }], null);
    expect(u!._id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('mongodb values', () => {
  it('rounds and pads decimals to their scale', () => {
    expect(fixScale('1.005', 2)).toBe('1.01');
    expect(fixScale('-2.5', 0)).toBe('-3');
    expect(fixScale('3', 2)).toBe('3.00');
    expect(fixScale('-0.001', 2)).toBe('0.00');
    expect(fixScale('99.999', 2)).toBe('100.00');
  });

  it('encodes and decodes every neutral type', () => {
    expect(encodeValue(5n, info('users', 'big'))).toEqual(Long.fromBigInt(5n));
    expect(decodeValue(Long.fromString('9007199254740993'), info('users', 'big'))).toBe(9007199254740993n);
    expect(decodeValue(Decimal128.fromString('2.5'), info('users', 'score'))).toBe('2.50');
    expect(decodeValue(Decimal128.fromString('1.5E+3'), info('users', 'score'))).toBe('1500.00');
    const bytes = info('profiles', 'avatar');
    const bin = encodeValue(new Uint8Array([7, 8]), bytes);
    expect(bin).toBeInstanceOf(Binary);
    expect(decodeValue(bin, bytes)).toEqual(new Uint8Array([7, 8]));
    const oid = new ObjectId();
    expect(decodeValue(oid, info('users', 'id'))).toBe(oid.toHexString());
    const dateCol = { column: { name: 'd', type: 'date' as const, nullable: true }, field: 'd', objectId: false };
    expect(encodeValue('2024-02-29', dateCol)).toEqual(new Date('2024-02-29T00:00:00.000Z'));
    expect(decodeValue(new Date('2024-02-29T00:00:00.000Z'), dateCol)).toBe('2024-02-29');
    const timeCol = { column: { name: 't', type: 'time' as const, nullable: true }, field: 't', objectId: false };
    expect(encodeValue(new Date('2024-01-01T09:05:03Z'), timeCol)).toBe('09:05:03');
    const jsonCol = { column: { name: 'j', type: 'json' as const, nullable: true }, field: 'j', objectId: false };
    expect(decodeValue({ a: [Long.fromNumber(3)], b: { c: 'x' } }, jsonCol)).toEqual({ a: [3], b: { c: 'x' } });
  });
});

describe('mongodb ddl and introspection', () => {
  it('creates collections with a $jsonSchema validator and indexes', () => {
    const users = schema.tables.find((t) => t.name === 'users')!;
    const [create, indexes] = mongoDdl({ kind: 'createTable', table: users }, schema, 'objectId').map((s) => JSON.parse(s));
    expect(create.create).toBe('users');
    expect(create.validator.$jsonSchema.required).toEqual(['_id', 'email', 'role', 'createdAt']);
    expect(create.validator.$jsonSchema.properties._id).toEqual({ bsonType: 'objectId', description: 'kastor column=id;type=int;default=autoincrement' });
    expect(create.validator.$jsonSchema.properties.email).toEqual({ bsonType: 'string', maxLength: 255 });
    expect(create.validator.$jsonSchema.properties.role).toEqual({ bsonType: 'string', enum: ['user', 'admin'], description: 'kastor default=value:"user"' });
    expect(create.validator.$jsonSchema.properties.name).toEqual({ bsonType: ['string', 'null'] });
    expect(indexes).toEqual({ createIndexes: 'users', indexes: [{ name: 'users_email_key', key: { email: 1 }, unique: true }] });
    const joins = schema.tables.find((t) => t.name === 'post_tags')!;
    const [, joinIdx] = mongoDdl({ kind: 'createTable', table: joins }, schema, 'objectId').map((s) => JSON.parse(s));
    expect(joinIdx.indexes[0]).toEqual({ name: 'post_tags_pkey', key: { postId: 1, tagId: 1 }, unique: true });
  });

  it('maps the other migration ops to commands', () => {
    const ddl = (op: Record<string, unknown>) => mongoDdl(op as never, schema, 'objectId').map((s) => JSON.parse(s));
    expect(ddl({ kind: 'dropTable', table: 'tags' })).toEqual([{ drop: 'tags' }]);
    expect(ddl({ kind: 'renameTable', from: 'a', to: 'b' })).toEqual([{ renameCollection: 'a', to: 'b' }]);
    expect(ddl({ kind: 'createIndex', table: 'posts', index: { name: 'p_t', columns: ['title'], unique: false } })).toEqual([
      { createIndexes: 'posts', indexes: [{ name: 'p_t', key: { title: 1 } }] },
    ]);
    expect(ddl({ kind: 'dropIndex', table: 'posts', index: { name: 'p_t', columns: ['title'], unique: false } })).toEqual([{ dropIndexes: 'posts', index: 'p_t' }]);
    expect(ddl({ kind: 'addForeignKey', table: 'posts', foreignKey: {} })).toEqual([]);
    const add = ddl({ kind: 'addColumn', table: 'posts', column: { name: 'views', type: 'int', nullable: false, default: { kind: 'value', value: 0 } } });
    expect(add[0]).toEqual({ update: 'posts', updates: [{ q: { views: { $exists: false } }, u: { $set: { views: 0 } }, multi: true }] });
    expect(add[1].collMod).toBe('posts');
    const rename = ddl({ kind: 'renameColumn', table: 'posts', from: 'headline', to: 'title' });
    expect(rename[1]).toEqual({ update: 'posts', updates: [{ q: { headline: { $exists: true } }, u: { $rename: { headline: 'title' } }, multi: true }] });
    expect(ddl({ kind: 'raw', sql: { mongodb: '{"ping": 1}', postgres: 'select 1' } })).toEqual([{ ping: 1 }]);
  });

  it('splits a migration file into commands', () => {
    const script = '-- Create table users\n{"create": "users", "x": "a } b"};\n\n// index\n{"createIndexes": "users", "indexes": [{"key": {"a": 1}}]}\n';
    expect(splitCommands(script)).toEqual(['{"create": "users", "x": "a } b"}', '{"createIndexes": "users", "indexes": [{"key": {"a": 1}}]}']);
    expect(() => splitCommands('{"a": 1')).toThrow(/unterminated/);
  });

  it('infers columns from sampled documents', () => {
    const cols = inferColumns([
      { _id: new ObjectId(), name: 'a', age: 3, ref: new ObjectId(), tags: ['x'] },
      { _id: new ObjectId(), name: null, age: 4.5, at: new Date() },
    ]);
    expect(cols).toEqual([
      { name: 'id', type: 'string', nullable: false, default: { kind: 'autoincrement' } },
      { name: 'name', type: 'string', nullable: true },
      { name: 'age', type: 'float', nullable: false },
      { name: 'ref', type: 'string', nullable: true, nativeType: 'objectId' },
      { name: 'tags', type: 'json', nullable: true },
      { name: 'at', type: 'datetime', nullable: true },
    ]);
  });

  it('reads its own validator metadata back', () => {
    const v = jsonSchema(model, schema.tables.find((t) => t.name === 'post_tags')!);
    expect((v.$jsonSchema as Record<string, unknown>).description).toBe('kastor primaryKey=postId,tagId');
  });
});

describe('mongodb executor and errors', () => {
  it('parses Extended JSON commands and binds parameters', () => {
    const cmd = parseCommand('{"find": "users", "filter": {"email": {"$param": 1}, "at": {"$date": "2024-01-01T00:00:00Z"}}}');
    expect(bindParams(cmd, ['a@x.com'])).toEqual({ find: 'users', filter: { email: 'a@x.com', at: new Date('2024-01-01T00:00:00Z') } });
    expect(() => bindParams(cmd, [])).toThrow(/parameter 1/);
    expect(() => parseCommand('select 1')).toThrow(/Not a MongoDB command/);
  });

  it('maps driver errors to kastor errors', () => {
    const dup = Object.assign(new Error('E11000'), { name: 'MongoServerError', code: 11000, keyPattern: { email: 1 } });
    expect(mapMongoError(dup)).toMatchObject({ code: 'UNIQUE_VIOLATION', meta: { target: 'email' } });
    const missing = Object.assign(new Error('Document failed validation'), {
      name: 'MongoServerError',
      code: 121,
      errInfo: { details: { schemaRulesNotSatisfied: [{ operatorName: 'required', missingProperties: ['email'] }] } },
    });
    expect(mapMongoError(missing)).toMatchObject({ code: 'NOT_NULL_VIOLATION' });
    expect(mapMongoError(Object.assign(new Error('x'), { name: 'MongoServerSelectionError' }))).toMatchObject({ code: 'CONNECTION_FAILED' });
    expect(mapMongoError(Object.assign(new Error('x'), { name: 'MongoServerError', code: 112 }))).toMatchObject({ code: 'SERIALIZATION_FAILURE' });
    expect(mapMongoError(new Error('plain'))).toBeNull();
  });

  it('compiles queries to readable commands', () => {
    const q: QueryIR = { kind: 'findMany', table: 'users', read: read('users', ['email'], { take: 1 }) };
    expect(JSON.parse(mongoDialect.compile!(q, schema)[0]!.sql)).toEqual({ aggregate: 'users', pipeline: [{ $limit: 1 }, { $project: { _id: 0, email: '$email' } }], cursor: {} });
    const del = mongoDialect.compile!({ kind: 'deleteMany', table: 'users', where: { kind: 'compare', column: 'email', op: 'eq', value: 'a' } }, schema);
    expect(JSON.parse(del[0]!.sql)).toEqual({ delete: 'users', deletes: [{ q: { email: { $eq: 'a' } }, limit: 0 }] });
    expect(createMongoDialect({ ids: 'int' }).name).toBe('mongodb');
    expect(mongoDialect.placeholder!(2)).toBe('{"$param": 2}');
  });
});
