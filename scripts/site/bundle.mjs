// Bundles the playground runtime from src/ for the browser with esbuild, and
// packs what the in-browser TypeScript checker needs: the kastor source and
// the standard library declarations.
//   docs/assets/pg-kastor.js   kastor core, every dialect and the DDL planner (ESM)
//   docs/assets/pg-types.json  src/index.ts and src/core/** as virtual files
//   docs/assets/pg-lib.json    lib.es2022 declarations from the local TypeScript
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (f.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Libraries the checker needs, resolved through lib.es2022.d.ts references. */
function collectLibs(libDir, name, seen = new Map()) {
  if (seen.has(name)) return seen;
  const file = join(libDir, `lib.${name}.d.ts`);
  if (!existsSync(file)) return seen;
  const text = readFileSync(file, 'utf8');
  seen.set(name, text);
  for (const m of text.matchAll(/\/\/\/\s*<reference lib="([^"]+)"\s*\/>/g)) collectLibs(libDir, m[1], seen);
  return seen;
}

/**
 * Node built-ins become empty modules (the playground never touches files),
 * and the MongoDB dialect gets its BSON types from the browser friendly bson
 * package instead of the full driver.
 */
function browserShims(root) {
  return {
    name: 'kastor-browser-shims',
    setup(build) {
      build.onResolve({ filter: /^(node:.*|oracledb|mssql|tedious|pg|postgres|mysql2(\/.*)?|mariadb|better-sqlite3|@libsql\/client|bun:sqlite)$/ }, (a) => ({ path: a.path, namespace: 'empty' }));
      build.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: 'module.exports = {}', loader: 'js' }));
      build.onResolve({ filter: /^mongodb$/ }, () => ({ path: 'mongodb', namespace: 'bson-shim' }));
      build.onLoad({ filter: /.*/, namespace: 'bson-shim' }, () => ({
        contents: "export { BSON, BSONRegExp, Binary, Decimal128, Long, ObjectId } from 'bson'",
        loader: 'js',
        resolveDir: root,
      }));
    },
  };
}

/** JSON with every non ASCII character escaped, so the files pass the house rules. */
const asciiJson = (value) => JSON.stringify(value).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

export async function bundlePlayground(root) {
  const require = createRequire(join(root, 'package.json'));
  let esbuild;
  try {
    esbuild = await import(pathToFileURL(require.resolve('esbuild')).href);
  } catch {
    return { error: 'esbuild is not installed (npm install)' };
  }
  const entry = join(root, 'scripts', 'site', 'playground', 'entry.ts');
  try {
    await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2020',
      minify: true,
      legalComments: 'none',
      outfile: join(root, 'docs', 'assets', 'pg-kastor.js'),
      logLevel: 'silent',
      plugins: [browserShims(root)],
    });
  } catch (e) {
    return { error: String(e.message || e).split('\n').slice(0, 6).join(' ') };
  }

  // Virtual files for the in-browser TypeScript checker.
  const files = {};
  for (const f of [join(root, 'src', 'index.ts'), ...walk(join(root, 'src', 'core')), ...walk(join(root, 'src', 'migrate'))]) {
    files[relative(root, f).replace(/\\/g, '/')] = readFileSync(f, 'utf8');
  }
  writeFileSync(join(root, 'docs', 'assets', 'pg-types.json'), asciiJson(files));
  const tsDir = join(require.resolve('typescript/package.json'), '..');
  const libs = collectLibs(join(tsDir, 'lib'), 'es2022');
  writeFileSync(join(root, 'docs', 'assets', 'pg-lib.json'), asciiJson(Object.fromEntries([...libs].map(([k, v]) => [`lib.${k}.d.ts`, v]))));
  const tsVersion = JSON.parse(readFileSync(join(tsDir, 'package.json'), 'utf8')).version;
  writeFileSync(join(root, 'docs', 'assets', 'pg-meta.json'), JSON.stringify({ typescript: tsVersion }));

  // Dialect features for the support matrix, read from the real dialects.
  let features = {};
  try {
    const mod = await import(`${pathToFileURL(join(root, 'docs', 'assets', 'pg-kastor.js')).href}?t=${Date.now()}`);
    features = mod.dialectFeatures ? mod.dialectFeatures() : {};
  } catch (e) {
    return { features, error: `could not read dialect features: ${e.message}` };
  }
  return { features };
}
