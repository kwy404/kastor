// Keeps the README, the API reference and the art in sync with the code:
// documented exports, adapters, client methods and CLI commands must exist,
// and every README link and image must be absolute and point at a real file.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f: string) => readFileSync(join(root, f), 'utf8');
const site = async (f: string) => import(pathToFileURL(join(root, 'scripts', 'site', f)).href);

const { DATABASES } = (await site('art/icons.mjs')) as { DATABASES: { id: string; entry: string; name: string }[] };
const { DB_INFO } = (await site('content/databases.mjs')) as { DB_INFO: Record<string, { adapter: string; driver: string }> };

/** Names exported by a TypeScript entry file (export { a, b } and export function/const). */
function exportsOf(file: string): Set<string> {
  const src = read(file);
  const names = new Set<string>();
  for (const m of src.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const part of (m[1] as string).split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()!.replace(/^type\s+/, '').trim();
      if (name) names.add(name);
    }
  }
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|class|interface|type)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1] as string);
  return names;
}

describe('documented API', () => {
  const core = exportsOf('src/index.ts');

  it('exports every name the docs use from kastor', () => {
    for (const name of ['kastor', 'table', 't', 'one', 'many', 'index', 'uniqueIndex', 'sql', 'KastorError', 'isKastorError', 'toSchemaIR', 'defineConfig', 'defineSeed', 'factory', 'InferSelect', 'InferInsert', 'KastorClient']) {
      expect(core.has(name), name).toBe(true);
    }
  });

  it('has an entry point and an adapter for every database on the site', () => {
    const pkg = JSON.parse(read('package.json'));
    for (const db of DATABASES) {
      const sub = db.entry.replace('kastor/', '');
      expect(pkg.exports[`./${sub}`], db.entry).toBeTruthy();
      expect(exportsOf(`src/${sub}.ts`).has(DB_INFO[db.id]!.adapter), `${db.entry} exports ${DB_INFO[db.id]!.adapter}`).toBe(true);
    }
  });

  it('documents client methods that exist', () => {
    const client = read('src/core/client.ts');
    const methods = ['findMany', 'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow', 'findPage', 'create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany', 'count', 'aggregate', 'groupBy', 'restore', 'hardDelete', 'hardDeleteMany', '$transaction', '$sql', '$execute', '$schema', '$dialect', '$disconnect', 'toSQL'];
    for (const m of methods) expect([`${m}(`, `${m}<`, `${m}:`, `readonly ${m}`].some((s) => client.includes(s)), m).toBe(true);
  });

  it('documents CLI commands that exist', () => {
    const cli = read('src/cli/index.ts');
    for (const c of ['init', 'migrate dev', 'migrate deploy', 'migrate status', 'migrate reset', 'db push', 'db pull', 'db seed', 'studio', 'doctor']) {
      expect(cli.includes(c.includes(' ') ? `'${c}'` : `  ${c},`), c).toBe(true);
    }
  });

  it('documents error codes that exist', () => {
    const errors = read('src/core/errors.ts');
    for (const code of ['UNIQUE_VIOLATION', 'FOREIGN_KEY_VIOLATION', 'NOT_NULL_VIOLATION', 'CHECK_VIOLATION', 'SERIALIZATION_FAILURE', 'DEADLOCK', 'CONNECTION_FAILED', 'TIMEOUT', 'NOT_FOUND']) {
      expect(errors, code).toContain(`'${code}'`);
    }
  });
});

describe('README', () => {
  for (const file of ['README.md', 'i18n/README.pt-BR.md']) {
    const md = read(file);
    it(`${file}: uses absolute image URLs on jsDelivr that point at files in the repo`, () => {
      const images = [...md.matchAll(/(?:src|srcset)="([^"]+)"/g)].map((m) => m[1] as string).filter((u) => !u.includes('shields.io') && !u.includes('packagephobia') && !u.includes('/npm/'));
      expect(images.length).toBeGreaterThan(10);
      for (const url of images) {
        expect(url.startsWith('https://cdn.jsdelivr.net/gh/kwy404/kastor@main/'), url).toBe(true);
        expect(existsSync(join(root, url.replace('https://cdn.jsdelivr.net/gh/kwy404/kastor@main/', ''))), url).toBe(true);
      }
    });
    it(`${file}: uses absolute links, and repo links point at files that exist`, () => {
      const links = [...md.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1] as string).filter((l) => !l.startsWith('#'));
      for (const link of links) {
        expect(/^https:\/\//.test(link), link).toBe(true);
        const blob = /^https:\/\/github\.com\/kwy404\/kastor\/blob\/main\/(.+)$/.exec(link);
        if (blob) expect(existsSync(join(root, blob[1] as string)), link).toBe(true);
      }
    });
    it(`${file}: links the other language and lists the projects from kwy404`, () => {
      expect(md).toMatch(file === 'README.md' ? /i18n\/README\.pt-BR\.md/ : /blob\/main\/README\.md/);
      for (const p of ['monsoon', 'Voodoo.js', 'breakhound', 'vueleap', 'graphemely', 'numberparrot', 'edgegoat', 'cookieowl', 'installkite', 'a11ymedic', 'fontsketch']) {
        expect(md, p).toContain(`https://kwy404.github.io/${p}/`);
      }
    });
  }
});

describe('art', () => {
  it('has the mascot, banners, favicon and icons in light and dark', () => {
    for (const f of ['mascot.svg', 'mascot-dark.svg', 'mascot-head.svg', 'mascot-head-dark.svg', 'favicon.svg', 'banner.svg', 'banner-dark.svg', 'social-preview.png']) {
      expect(existsSync(join(root, 'assets', f)), f).toBe(true);
    }
    for (const mode of ['light', 'dark']) {
      for (const db of DATABASES) expect(existsSync(join(root, 'assets', 'icons', mode, `db-${db.id}.svg`)), `${mode} ${db.id}`).toBe(true);
    }
  });

  it('renders the social images at the sizes the platforms expect', () => {
    const size = (f: string) => {
      const b = readFileSync(join(root, f));
      return [b.readUInt32BE(16), b.readUInt32BE(20)];
    };
    expect(size('assets/social-preview.png')).toEqual([1280, 640]);
    expect(size('docs/og.png')).toEqual([1200, 630]);
  });
});
