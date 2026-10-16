// The Next.js starter in examples/nextjs: its committed migration matches its
// schema, and its seed and queries work against this checkout of kastor.
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pkg from '../package.json';
import { kastor } from '../src/core/client';
import { toSchemaIR } from '../src/core/schema-ir';
import { deploy, drift } from '../src/migrate/engine';
import { sqlite } from '../src/sqlite';

const root = resolve('.');
const example = join(root, 'examples', 'nextjs');
const posix = (p: string): string => p.replace(/\\/g, '/');

let dir: string;
let mods: { schema: any; posts: any; seed: any };

/** Copies a template module with its kastor-orm imports pointed at the sources here. */
function copy(file: string): void {
  const text = readFileSync(join(example, file), 'utf8')
    .replace(/from 'kastor-orm\/sqlite'/g, `from '${posix(join(root, 'src/sqlite'))}'`)
    .replace(/from 'kastor-orm'/g, `from '${posix(join(root, 'src/index'))}'`);
  mkdirSync(join(dir, file, '..'), { recursive: true });
  writeFileSync(join(dir, file), text);
}

function open() {
  const adapter = sqlite(new Database(':memory:'));
  const db: any = kastor({ adapter, schema: mods.schema.schema, relations: mods.schema.relations });
  return { adapter, db };
}

beforeAll(async () => {
  mkdirSync(join(root, '.kastor'), { recursive: true });
  dir = mkdtempSync(join(root, '.kastor', 'next-'));
  for (const f of ['src/db/schema.ts', 'src/db/posts.ts', 'src/db/seed.ts']) copy(f);
  mods = {
    schema: await import(/* @vite-ignore */ `${posix(join(dir, 'src/db/schema.ts'))}`),
    posts: await import(/* @vite-ignore */ `${posix(join(dir, 'src/db/posts.ts'))}`),
    seed: await import(/* @vite-ignore */ `${posix(join(dir, 'src/db/seed.ts'))}`),
  };
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('Next.js starter', () => {
  it('ships a migration that matches its schema', async () => {
    const { adapter } = open();
    const { applied } = await deploy(adapter, join(example, 'kastor', 'migrations'));
    expect(applied.map((m) => m.id)).toEqual([expect.stringMatching(/^\d{14}_init$/)]);
    const diff = await drift(adapter, toSchemaIR(mods.schema.schema));
    expect(diff.ops).toEqual([]);
  });

  it('seeds an empty database once', async () => {
    const { adapter, db } = open();
    await deploy(adapter, join(example, 'kastor', 'migrations'));
    await mods.seed.default(db);
    await mods.seed.default(db);
    expect(await db.authors.count()).toBe(2);
    expect(await db.posts.count()).toBe(2);
  });

  it('lists, adds and deletes posts with the queries the page uses', async () => {
    const { adapter, db } = open();
    await deploy(adapter, join(example, 'kastor', 'migrations'));
    await mods.seed.default(db);
    const { latestPosts, listAuthors, addPost, deletePost, MAX_TITLE } = mods.posts;
    const authors = await listAuthors(db);
    expect(authors.map((a: { name: string }) => a.name)).toEqual(['Ada', 'Grace']);
    const before = await latestPosts(db);
    expect(before).toHaveLength(2);
    expect(before[0].author.name).toBe('Grace');
    expect(before[0].createdAt).toBeInstanceOf(Date);

    await expect(addPost(db, { title: '   ', authorId: authors[0].id })).rejects.toThrow('Give the post a title.');
    await expect(addPost(db, { title: 'x'.repeat(MAX_TITLE + 1), authorId: authors[0].id })).rejects.toThrow(`under ${MAX_TITLE}`);
    await expect(addPost(db, { title: 'Hi', authorId: 999 })).rejects.toThrow('Pick an author.');
    const created = await addPost(db, { title: '  Third post  ', body: '  ', authorId: authors[1].id });
    expect(created).toMatchObject({ title: 'Third post', body: null });
    const after = await latestPosts(db);
    expect(after[0]).toMatchObject({ title: 'Third post', author: { name: 'Grace' } });

    await deletePost(db, created.id);
    await deletePost(db, created.id);
    expect(await latestPosts(db)).toHaveLength(2);
  });

  it('uses a kastor-orm range that this version satisfies and runs migrations before dev and build', () => {
    const tpl = JSON.parse(readFileSync(join(example, 'package.json'), 'utf8')) as { dependencies: Record<string, string>; scripts: Record<string, string> };
    const range = tpl.dependencies['kastor-orm']!;
    expect(range).toMatch(/^\^\d+\.\d+\.\d+$/);
    const [major, minor] = range.slice(1).split('.').map(Number);
    const [cMajor, cMinor] = (pkg as { version: string }).version.split('.').map(Number);
    expect(cMajor).toBe(major);
    if (major === 0) expect(cMinor).toBe(minor);
    expect(tpl.scripts.predev).toContain('kastor migrate deploy');
    expect(tpl.scripts.prebuild).toContain('kastor migrate deploy');
    expect(existsSync(join(example, '.env'))).toBe(false);
    expect(readFileSync(join(example, '.gitignore'), 'utf8')).toMatch(/^\*\.db$/m);
  });
});
