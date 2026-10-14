import { describe, expect, it } from 'vitest';
import { isKastorError, kastor, type Adapter } from '../src/index';
import { buildModels, isIdLike } from '../src/core/model';
import { fixture } from './helpers/fixture';
import { memorySqlite } from './helpers/sqlite-memory';

function withIdType(adapter: Adapter, idType: 'number' | 'string'): Adapter<any, any> {
  return { ...adapter, dialect: { ...adapter.dialect, features: { ...adapter.dialect.features, idType } } };
}

describe('dialect id type', () => {
  it('marks generated keys and integer foreign keys as id like', () => {
    const models = buildModels(fixture.schema, fixture.relations, { idType: 'string' });
    const users = models.model('users');
    const posts = models.model('posts');
    expect(users.fields.get('id')!.stringId).toBe(true);
    expect(users.fields.get('age')!.stringId).toBe(false);
    expect(posts.fields.get('authorId')!.stringId).toBe(true);
    expect(posts.fields.get('id')!.stringId).toBe(false);
    expect(isIdLike(posts.fields.get('views')!.config)).toBe(false);
    const numeric = buildModels(fixture.schema, fixture.relations);
    expect(numeric.model('users').fields.get('id')!.stringId).toBe(false);
    expect(numeric.model('users').fields.get('id')!.idLike).toBe(true);
  });

  it('accepts string ids when the dialect declares idType string', async () => {
    const mem = memorySqlite();
    await mem.reset(fixture.schemaIR);
    const db = kastor({ adapter: withIdType(mem.adapter, 'string') as Adapter<any, 'string'>, schema: fixture.schema, relations: fixture.relations });
    const created = await db.users.create({ data: { email: 'ids@acme.com' } });
    const id = String(created.id);
    const found = await db.users.findUnique({ where: { id } });
    expect(found?.email).toBe('ids@acme.com');
    const post = await db.posts.create({ data: { title: 'string fk', authorId: id } });
    expect(String(post.authorId)).toBe(id);
    await expect(db.users.findUnique({ where: { id: '' } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await mem.close();
  });

  it('keeps rejecting strings for numeric ids on SQL dialects', async () => {
    const mem = memorySqlite();
    await mem.reset(fixture.schemaIR);
    const db = kastor({ adapter: mem.adapter, schema: fixture.schema, relations: fixture.relations });
    const error = await db.users.findUnique({ where: { id: '1' as never } }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(isKastorError(error, 'VALIDATION_FAILED')).toBe(true);
    await mem.close();
  });
});
