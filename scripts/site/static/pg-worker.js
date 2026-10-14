// Type checker for the playground: runs the TypeScript compiler in a Web
// Worker over the real kastor source (pg-types.json, the same files as
// src/index.ts and src/core) plus the visitor's schema.ts and query.ts, and
// prints the inferred type of the query result.
/* global ts, importScripts, postMessage, performance, self */

let service = null;
let files = {};
const versions = {};
let tsVersion = '';

const OPTIONS = {
  target: 9, // ES2022
  module: 99, // ESNext
  moduleResolution: 100, // Bundler
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  noLib: true,
  allowJs: false,
  baseUrl: '/',
  paths: { kastor: ['src/index.ts'] },
  types: [],
};

async function init() {
  const meta = await (await fetch('pg-meta.json')).json();
  tsVersion = meta.typescript;
  postMessage({ kind: 'loading', text: `Loading the TypeScript ${tsVersion} compiler` });
  importScripts(`https://cdn.jsdelivr.net/npm/typescript@${tsVersion}/lib/typescript.js`);
  const [src, lib] = await Promise.all([fetch('pg-types.json').then((r) => r.json()), fetch('pg-lib.json').then((r) => r.json())]);
  files = {};
  for (const [k, v] of Object.entries(src)) files[`/${k}`] = v;
  for (const [k, v] of Object.entries(lib)) files[`/lib/${k}`] = v;
  const libFiles = Object.keys(lib).map((k) => `/lib/${k}`);
  const host = {
    getScriptFileNames: () => ['/schema.ts', '/query.ts', ...libFiles],
    getScriptVersion: (f) => String(versions[f] || 0),
    getScriptSnapshot: (f) => (files[f] === undefined ? undefined : ts.ScriptSnapshot.fromString(files[f])),
    getCurrentDirectory: () => '/',
    getCompilationSettings: () => OPTIONS,
    getDefaultLibFileName: () => '/lib/lib.es2022.d.ts',
    fileExists: (f) => files[f] !== undefined,
    readFile: (f) => files[f],
    directoryExists: (d) => Object.keys(files).some((f) => f.startsWith(d.endsWith('/') ? d : `${d}/`)),
    getDirectories: () => [],
    useCaseSensitiveFileNames: () => true,
  };
  service = ts.createLanguageService(host, ts.createDocumentRegistry());
  postMessage({ kind: 'ready', version: tsVersion });
}

const PRIMITIVE_NAMES = new Set(['Date', 'Uint8Array', 'Promise', 'Map', 'Set', 'RegExp', 'Buffer', 'ArrayBuffer']);

function printer(checker, at) {
  const flags = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseSingleQuotesForStringLiteralType;
  function print(type, indent, depth) {
    if (depth > 8) return checker.typeToString(type, at, flags);
    if (type.isUnion()) {
      const parts = [];
      let hasTrue = false;
      let hasFalse = false;
      for (const t of type.types) {
        if (t.flags & ts.TypeFlags.BooleanLiteral) {
          if (checker.typeToString(t) === 'true') hasTrue = true;
          else hasFalse = true;
          continue;
        }
        parts.push(print(t, indent, depth + 1));
      }
      if (hasTrue && hasFalse) parts.unshift('boolean');
      else if (hasTrue) parts.unshift('true');
      else if (hasFalse) parts.unshift('false');
      const nul = parts.filter((p) => p === 'null' || p === 'undefined');
      const rest = parts.filter((p) => p !== 'null' && p !== 'undefined');
      return [...rest, ...nul].join(' | ');
    }
    if (checker.isArrayType(type)) {
      const el = print(checker.getTypeArguments(type)[0], indent, depth + 1);
      return /[|&]/.test(el) && !el.trim().startsWith('{') ? `(${el})[]` : `${el}[]`;
    }
    const sym = type.getSymbol() || type.aliasSymbol;
    if (type.flags & ts.TypeFlags.Object && !(sym && PRIMITIVE_NAMES.has(sym.getName())) && !type.getCallSignatures().length) {
      const props = checker.getPropertiesOfType(type);
      if (!props.length) return '{}';
      const pad = '  '.repeat(indent + 1);
      const lines = props.map((p) => {
        const optional = p.flags & ts.SymbolFlags.Optional ? '?' : '';
        const t = checker.getTypeOfSymbolAtLocation(p, at);
        const name = /^[A-Za-z_$][\w$]*$/.test(p.getName()) ? p.getName() : JSON.stringify(p.getName());
        return `${pad}${name}${optional}: ${print(optional ? checker.getNonNullableType(t) : t, indent + 1, depth + 1)}`;
      });
      return `{\n${lines.join('\n')}\n${'  '.repeat(indent)}}`;
    }
    return checker.typeToString(type, at, flags);
  }
  return (type) => print(type, 0, 0);
}

function check(msg) {
  const started = performance.now();
  const models = msg.models.map((m) => `${m}: s.${m}`).join(', ');
  const prefix = `import { kastor } from 'kastor'\nimport * as s from './schema'\ndeclare const adapter: any\nconst db = kastor({ adapter, schema: { ${models} }${msg.relations ? ', relations: s.relations' : ''} })\nexport const __result = await (\n`;
  const body = msg.query.trim().replace(/^await\s+/, '').replace(/;\s*$/, '');
  files['/schema.ts'] = msg.schema;
  files['/query.ts'] = `${prefix}${body}\n)\n`;
  versions['/schema.ts'] = (versions['/schema.ts'] || 0) + 1;
  versions['/query.ts'] = (versions['/query.ts'] || 0) + 1;
  const program = service.getProgram();
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile('/query.ts');
  let decl = null;
  sf.forEachChild(function visit(n) {
    if (ts.isVariableDeclaration(n) && n.name.getText(sf) === '__result') decl = n;
    else n.forEachChild(visit);
  });
  const type = decl ? printer(checker, decl)(checker.getTypeAtLocation(decl.name)) : 'unknown';
  // Map positions back to what the visitor typed.
  const bodyAt = msg.query.indexOf(body.slice(0, 40));
  const files2 = [
    ['/schema.ts', 'schema', msg.schema, 0],
    ['/query.ts', 'query', msg.query, prefix.length - Math.max(bodyAt, 0)],
  ];
  const short = (text) => text.replace(/'([^']{60,})'/g, (m, t) => `'${t.slice(0, 44)}...'`);
  const diags = [];
  for (const [file, editor, text, shift] of files2) {
    const ds = [...service.getSyntacticDiagnostics(file), ...service.getSemanticDiagnostics(file)];
    for (const d of ds) {
      if (d.code === 6133 || d.code === 7006) continue;
      const start = Math.max(0, Math.min(text.length, (d.start ?? 0) - shift));
      const length = Math.max(1, Math.min(d.length ?? 1, text.length - start));
      const before = text.slice(0, start);
      const line = before.split('\n').length;
      const col = start - before.lastIndexOf('\n');
      diags.push({ file: `${editor}.ts`, editor, start, length, line, col, text: short(ts.flattenDiagnosticMessageText(d.messageText, '\n').split('\n').slice(0, 2).join(' ')) });
    }
  }
  postMessage({ kind: 'result', id: msg.id, type, diags: diags.slice(0, 8), ms: Math.round(performance.now() - started) });
}

let ready = null;
self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.kind === 'init') {
      ready = ready || init();
      await ready;
    } else if (msg.kind === 'check') {
      await ready;
      check(msg);
    }
  } catch (err) {
    postMessage({ kind: 'result', id: msg.id, error: String((err && err.message) || err) });
  }
};
