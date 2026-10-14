// Type checks the TypeScript samples of the migration and framework guides
// and of the frameworks page against the real kastor sources. Each guide is
// a small virtual project: every ts or tsx block becomes a file named after
// its title, `kastor-orm` resolves to src/, drivers with types in node_modules
// keep their real types, and other packages (frameworks, the ORM being
// replaced) are typed as any. A block marked data-check="skip" is left out.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..').replace(/\\/g, '/');
const guidesDir = join(root, 'scripts', 'site', 'guides');
const virtualRoot = `${root}/.samples`;

const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

interface Sample {
  title: string;
  lang: string;
  code: string;
}
interface Project {
  name: string;
  samples: Sample[];
}

function readGuide(file: string): { meta: Record<string, unknown>; body: string } {
  const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const m = /^<!--meta\n([\s\S]*?)\n-->\n([\s\S]*)$/.exec(src)!;
  return { meta: JSON.parse(m[1]!), body: m[2]! };
}

function samplesOf(body: string): Sample[] {
  const out: Sample[] = [];
  for (const m of body.matchAll(/<pre data-kind="(\w+)"([^>]*)>\n([\s\S]*?)\n<\/pre>/g)) {
    const attrs = m[2]!;
    const attr = (name: string) => (new RegExp(`data-${name}="([^"]*)"`).exec(attrs) || [])[1];
    const lang = attr('lang') || 'text';
    if (!['ts', 'tsx'].includes(lang) || attr('check') === 'skip') continue;
    out.push({ title: attr('title') || 'snippet', lang, code: unescape(m[3]!) });
  }
  return out;
}

const guideFiles = [...readdirSync(guidesDir).map((f) => join(guidesDir, f)), ...readdirSync(join(guidesDir, 'pt-br')).map((f) => join(guidesDir, 'pt-br', f))].filter((f) => f.endsWith('.html'));
const projects: Project[] = [];
for (const file of guideFiles) {
  const { meta, body } = readGuide(file);
  if (meta.section !== 'migrate' && meta.section !== 'frameworks') continue;
  projects.push({ name: `${meta.lang}-${meta.slug}`, samples: samplesOf(body) });
}
const { FRAMEWORKS } = (await import(pathToFileURL(join(root, 'scripts', 'site', 'content', 'frameworks.mjs')).href)) as { FRAMEWORKS: { id: string; files: [string, string, string][] }[] };
for (const f of FRAMEWORKS) {
  projects.push({ name: `frameworks-${f.id}`, samples: f.files.filter(([, lang]) => lang === 'ts' || lang === 'tsx').map(([title, lang, code]) => ({ title, lang, code })) });
}
const { SCHEMA } = (await import(pathToFileURL(join(root, 'scripts', 'site', 'playground', 'presets.mjs')).href)) as { SCHEMA: string };

const DEFAULT_DB = `import pg from 'pg'
import { kastor } from 'kastor-orm'
import { postgres } from 'kastor-orm/postgres'
import { schema, relations } from './schema'

export const db = kastor({ adapter: postgres(new pg.Pool({ connectionString: process.env.DATABASE_URL })), schema, relations })
`;

// Globals of the runtimes and frameworks the guides use, loosely typed.
const AMBIENT = `declare module '*';
declare const Bun: any;
declare const Deno: any;
type D1Database = import('${root}/src/d1').D1DatabaseLike;
type Hyperdrive = { connectionString: string };
type ExecutionContext = { waitUntil(promise: Promise<unknown>): void };
declare const defineNuxtConfig: any, defineEventHandler: any, defineNitroPlugin: any, getQuery: any, getRouterParam: any, readBody: any, createError: any, useRuntimeConfig: any, setResponseStatus: any;
interface ImportMeta { env: Record<string, string | undefined> }
// Deno and recent browsers have URLPattern; Electron adds process.resourcesPath.
declare class URLPattern { constructor(init: { pathname?: string }); exec(input: string | URL): { pathname: { groups: Record<string, string | undefined> } } | null }
declare namespace NodeJS { interface Process { resourcesPath: string } }
declare namespace JSX { interface IntrinsicElements { [name: string]: any } type Element = any }
`;

const PATHLIKE = /^[\w@$.\-/[\]()+]+\.(ts|tsx|mts)$/;

/** Virtual files of one project, keyed by absolute path. */
function filesOf(p: Project): Map<string, string> {
  const base = `${virtualRoot}/${p.name}`;
  const files = new Map<string, string>();
  p.samples.forEach((s, i) => {
    let rel = PATHLIKE.test(s.title) ? s.title : `snippet-${i + 1}.${s.lang}`;
    while (files.has(`${base}/${rel}`)) rel = rel.replace(/(\.\w+)$/, `.${i + 1}$1`);
    // Every sample is a module, so names never clash across files.
    files.set(`${base}/${rel}`, `${s.code}\nexport {}\n`);
  });
  if (![...files.keys()].some((f) => f === `${base}/src/db/schema.ts`)) files.set(`${base}/src/db/schema.ts`, SCHEMA);
  if (![...files.keys()].some((f) => f === `${base}/src/db/index.ts`)) files.set(`${base}/src/db/index.ts`, DEFAULT_DB);
  return files;
}

const files = new Map<string, string>();
for (const p of projects) for (const [k, v] of filesOf(p)) files.set(k, v);

/**
 * Packages without types here (frameworks, the ORM being replaced) get a
 * declaration where every imported name is any, both as a value and as a
 * generic type, so `implements OnModuleDestroy` or `req: NextRequest` work.
 */
function stubs(): string {
  const mods = new Map<string, { names: Set<string>; def: boolean }>();
  const implemented = new Set<string>();
  // Interfaces a sample augments (declare module 'fastify' { interface FastifyInstance ... }).
  const augmented = new Map<string, Set<string>>();
  for (const [file, code] of files) {
    for (const m of code.matchAll(/\bimplements\s+([\w\s,<>]+?)\s*\{/g)) for (const n of m[1]!.split(',')) implemented.add(n.trim().replace(/<.*$/, ''));
    for (const m of code.matchAll(/declare module '([^']+)' \{([\s\S]*?)\n\}/g)) {
      const set = augmented.get(m[1]!) ?? new Set<string>();
      for (const i of m[2]!.matchAll(/interface (\w+)/g)) set.add(i[1]!);
      augmented.set(m[1]!, set);
      if (!mods.has(m[1]!)) mods.set(m[1]!, { names: new Set<string>(), def: false });
    }
    for (const m of code.matchAll(/^import\s+(?:type\s+)?([\s\S]*?)\s+from\s+'([^']+)'/gm)) {
      const [clause, spec] = [m[1]!, m[2]!];
      // Node built-ins have their real types from @types/node.
      if (resolveSpecifier(spec, file) || spec.startsWith('.') || spec.startsWith('node:') || builtinModules.includes(spec)) continue;
      const real = ts.resolveModuleName(spec.replace(/^npm:/, ''), file, options, ts.sys).resolvedModule;
      if (real && real.extension !== ts.Extension.Js) continue;
      const entry = mods.get(spec) ?? { names: new Set<string>(), def: false };
      const named = /\{([\s\S]*)\}/.exec(clause)?.[1];
      if (named) for (const part of named.split(',')) {
        const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]!.trim();
        if (name) entry.names.add(name);
      }
      if (/^\s*[\w$]+\s*(,|$)/.test(clause)) entry.def = true;
      mods.set(spec, entry);
    }
  }
  return [...mods]
    .map(([spec, { names, def }]) => {
      const aug = augmented.get(spec) ?? new Set<string>();
      const decls = [...names].filter((n) => !aug.has(n)).map((n) => `  export const ${n}: any\n  export ${implemented.has(n) ? `interface ${n}<A = any, B = any> {}` : `type ${n}<A = any, B = any, C = any, D = any> = any`}`);
      // Augmented interfaces stay open: the sample adds typed members, everything else is any.
      for (const n of aug) decls.push(`  export const ${n}: any\n  export interface ${n} { [key: string]: any }`);
      if (def) decls.push('  const _default: any\n  export default _default');
      return `declare module '${spec}' {\n${decls.join('\n')}\n}`;
    })
    .join('\n');
}

const options: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  strict: true,
  strictPropertyInitialization: false,
  // Framework packages are typed as any here, so their callback parameters are too.
  noImplicitAny: false,
  experimentalDecorators: true,
  esModuleInterop: true,
  allowImportingTsExtensions: true,
  jsx: ts.JsxEmit.Preserve,
  skipLibCheck: true,
  noEmit: true,
  types: ['node'],
};

const exts = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];
function findVirtual(path: string): string | undefined {
  const clean = path.replace(/\.(js|mjs)$/, '');
  for (const e of exts) if (files.has(clean + e)) return clean + e;
  return undefined;
}

function resolveSpecifier(spec: string, from: string): string | undefined {
  const project = /^(.*\/\.samples\/[^/]+)\//.exec(from)?.[1];
  const s = spec.replace(/^npm:/, '');
  if (s === 'kastor-orm') return `${root}/src/index.ts`;
  const sub = /^kastor-orm\/(\w+)$/.exec(s);
  if (sub) return existsSync(`${root}/src/${sub[1]}.ts`) ? `${root}/src/${sub[1]}.ts` : `${root}/src/${sub[1]}/index.ts`;
  if (!project) return undefined;
  const candidates: string[] = [];
  if (s.startsWith('.')) candidates.push(posix.join(posix.dirname(from), s));
  else if (s.startsWith('@/')) candidates.push(`${project}/src/${s.slice(2)}`, `${project}/${s.slice(2)}`);
  else if (s.startsWith('~/')) candidates.push(`${project}/app/${s.slice(2)}`, `${project}/${s.slice(2)}`, `${project}/src/${s.slice(2)}`);
  else if (s.startsWith('$lib/')) candidates.push(`${project}/src/lib/${s.slice(5)}`);
  else if (/^#\w+\//.test(s)) {
    // Subpath imports such as AdonisJS #services/db or #start/env.
    const [name, ...rest] = s.slice(1).split('/');
    candidates.push(`${project}/app/${name}/${rest.join('/')}`, `${project}/${name}/${rest.join('/')}`);
  }
  else return undefined;
  for (const c of candidates) {
    const hit = findVirtual(c);
    if (hit) return hit;
  }
  // A relative import of the shared schema or client falls back to the defaults.
  const last = s.split('/').pop()!.replace(/\.ts$/, '');
  if (last === 'schema') return `${project}/src/db/schema.ts`;
  if (last === 'db' || last === 'index') return `${project}/src/db/index.ts`;
  return undefined;
}

function check(): Map<string, string[]> {
  files.set(`${virtualRoot}/ambient.d.ts`, `${AMBIENT}\n${stubs()}\n`);
  const host = ts.createCompilerHost(options, true);
  const realFileExists = host.fileExists.bind(host);
  const realReadFile = host.readFile.bind(host);
  const realGetSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (f) => files.has(f.replace(/\\/g, '/')) || realFileExists(f);
  host.readFile = (f) => files.get(f.replace(/\\/g, '/')) ?? realReadFile(f);
  host.getSourceFile = (f, lang, onError, create) => {
    const text = files.get(f.replace(/\\/g, '/'));
    if (text !== undefined) return ts.createSourceFile(f, text, lang, true, f.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    return realGetSourceFile(f, lang, onError, create);
  };
  host.resolveModuleNameLiterals = (literals, containing, _redirect, opts) =>
    literals.map((lit) => {
      const spec = lit.text;
      const from = containing.replace(/\\/g, '/');
      const own = resolveSpecifier(spec, from);
      if (own) return { resolvedModule: { resolvedFileName: own, extension: own.endsWith('.tsx') ? ts.Extension.Tsx : ts.Extension.Ts, isExternalLibraryImport: false } };
      const real = ts.resolveModuleName(spec.replace(/^npm:/, ''), containing, opts, host);
      // Packages without types in node_modules fall back to the ambient any module.
      if (real.resolvedModule && real.resolvedModule.extension !== ts.Extension.Js) return { resolvedModule: real.resolvedModule };
      return { resolvedModule: undefined };
    });
  const program = ts.createProgram([...files.keys()], options, host);
  const byProject = new Map<string, string[]>();
  // 2347: type arguments on a call into an untyped framework package.
  for (const d of ts.getPreEmitDiagnostics(program).filter((x) => x.code !== 2347)) {
    const file = d.file?.fileName.replace(/\\/g, '/') ?? '';
    const name = /\/\.samples\/([^/]+)\//.exec(file)?.[1] ?? 'kastor';
    const where = d.file && d.start !== undefined ? `${file.replace(`${virtualRoot}/${name}/`, '')}:${d.file.getLineAndCharacterOfPosition(d.start).line + 1}` : '';
    const list = byProject.get(name) ?? [];
    list.push(`${where} ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
    byProject.set(name, list);
  }
  return byProject;
}

describe('guide code samples', () => {
  it('finds the migration and framework guides and the frameworks page samples', () => {
    expect(projects.filter((p) => p.name.startsWith('frameworks-')).length).toBeGreaterThanOrEqual(10);
    expect(existsSync(join(root, 'src', 'index.ts'))).toBe(true);
  });

  const diagnostics = check();
  it('compiles the kastor sources the samples import', () => {
    expect(diagnostics.get('kastor') ?? []).toEqual([]);
  });
  for (const p of projects) {
    it(`type checks ${p.name}`, () => {
      expect(p.samples.length, `${p.name} has no TypeScript sample`).toBeGreaterThan(0);
      const list = diagnostics.get(p.name) ?? [];
      if (list.length) throw new Error(`${p.name}:\n${list.join('\n')}`);
    });
  }
}, 180000);
