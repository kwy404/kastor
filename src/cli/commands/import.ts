import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { KastorError } from '../../core/errors';
import { prismaToKastor, type PrismaImportResult, type PrismaImportWarning } from '../../migrate/import/prisma';
import { opt, rel, type CliContext } from '../context';
import type { Ui } from '../ui';
import { DATABASES } from './init';

/** Finds the Prisma schema: the flag, package.json `prisma.schema`, then the usual places. */
export function findPrismaSchema(cwd: string, flag?: string): string {
  if (flag) {
    const path = resolve(cwd, flag);
    if (!existsSync(path)) throw new KastorError('INVALID_ARGUMENT', `The Prisma schema ${flag} does not exist.`, { hint: 'Pass the path of schema.prisma (or of the folder of a multi file schema) with --schema.' });
    return path;
  }
  const candidates: string[] = [];
  const pkgPath = join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { prisma?: { schema?: string } };
      if (typeof pkg.prisma?.schema === 'string') candidates.push(resolve(cwd, pkg.prisma.schema));
    } catch {
      // A broken package.json is not ours to report.
    }
  }
  candidates.push(join(cwd, 'prisma', 'schema.prisma'), join(cwd, 'schema.prisma'), join(cwd, 'prisma', 'schema'));
  const found = candidates.find((c) => existsSync(c));
  if (!found) {
    throw new KastorError('INVALID_ARGUMENT', 'No Prisma schema found (looked for prisma/schema.prisma, schema.prisma and prisma/schema/).', {
      hint: 'Pass its path with --schema path/to/schema.prisma.',
    });
  }
  return found;
}

/** Reads one schema file, or every `.prisma` file of a folder (multi file schemas). */
export function readPrismaSource(path: string): { source: string; files: string[] } {
  if (!statSync(path).isDirectory()) return { source: readFileSync(path, 'utf8'), files: [path] };
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) {
        if (entry !== 'migrations' && entry !== 'node_modules') walk(p);
      } else if (entry.endsWith('.prisma')) files.push(p);
    }
  };
  walk(path);
  if (!files.length) throw new KastorError('INVALID_ARGUMENT', `${path} has no .prisma files.`, { hint: 'Point --schema at schema.prisma or at the folder that holds the .prisma files.' });
  return { source: files.map((f) => readFileSync(f, 'utf8')).join('\n'), files };
}

/** kastor.config.ts for the datasource of an imported Prisma schema. */
export function importedConfig(result: PrismaImportResult, options: { schemaPath: string; prismaDir: string }): string {
  const db = DATABASES.find((d) => d.id === result.database) ?? DATABASES[0]!;
  const env = result.urlEnv ?? 'DATABASE_URL';
  const imports = [...db.imports];
  let adapter = db.adapter.replace(/DATABASE_URL/g, env);
  const lines: string[] = [];
  if (result.database === 'sqlite') {
    imports.unshift("import { resolve } from 'node:path';");
    lines.push('// Prisma reads file: URLs from the folder of schema.prisma; this resolves them the same way.');
    adapter = `adapter: () => sqlite(new Database(resolve(${JSON.stringify(options.prismaDir)}, (process.env.${env} ?? 'file:./dev.db').replace(/^file:/, '')))),`;
  }
  if (result.database === 'mssql') lines.push(`// The mssql driver takes "Server=...;Database=...;User Id=...;Password=..." strings, not Prisma's sqlserver:// URLs.`);
  if (result.database === 'postgres') lines.push(`// Prisma URLs may end in ?schema=name; pg ignores it, so set search_path on the database user if you used another schema than public.`);
  if (result.database === 'mysql') lines.push(`// MariaDB works too: use createPool from 'mariadb' and the mariadb adapter from 'kastor-orm/mariadb'.`);
  return `${imports.join('\n')}
import { defineConfig } from 'kastor-orm';

export default defineConfig({
  schema: '${options.schemaPath.replace(/\\/g, '/').replace(/'/g, "\\'")}',
${lines.map((l) => `  ${l}\n`).join('')}  ${adapter}
  migrations: './kastor/migrations',
});
`;
}

export async function importPrisma(ctx: CliContext): Promise<number> {
  const { ui } = ctx;
  const toStdout = opt.bool(ctx, 'print');
  const schemaPath = findPrismaSchema(ctx.cwd, opt.str(ctx, 'schema'));
  const { source } = readPrismaSource(schemaPath);
  const result = prismaToKastor(source, { source: rel(ctx, schemaPath) });
  if (toStdout) {
    ui.write(result.code);
    return 0;
  }
  ui.title('import prisma');
  ui.keyValues([
    ['Prisma schema', rel(ctx, schemaPath)],
    ['Provider', `${result.provider} (kastor-orm/${result.database})`],
  ]);
  ui.line();

  const out = resolve(ctx.cwd, opt.str(ctx, 'out') ?? 'src/db/schema.ts');
  const force = opt.bool(ctx, 'force');
  const configPath = join(ctx.cwd, 'kastor.config.ts');
  const writeConfig = opt.bool(ctx, 'config');
  for (const path of writeConfig ? [out, configPath] : [out]) {
    if (!existsSync(path) || force) continue;
    if (!ctx.prompt) throw new KastorError('INVALID_ARGUMENT', `${rel(ctx, path)} already exists.`, { hint: 'Pass --force to overwrite it, or --out to write the schema somewhere else.' });
    if (!(await ctx.prompt.confirm(`${rel(ctx, path)} exists. Overwrite it?`, false))) {
      ui.line('Nothing was written.');
      return 1;
    }
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, result.code, 'utf8');
  const s = result.stats;
  const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;
  ui.success(
    `Wrote ${ui.c.bold(rel(ctx, out))}: ${plural(s.models, 'model')}${s.joinTables ? `, ${plural(s.joinTables, 'join table')}` : ''}, ${plural(s.enums, 'enum')}, ${plural(s.relations, 'relation field')}.`,
  );
  if (writeConfig) {
    let schemaRef = relative(ctx.cwd, out).replace(/\\/g, '/');
    if (!schemaRef.startsWith('.')) schemaRef = `./${schemaRef}`;
    let prismaDir = relative(ctx.cwd, statSync(schemaPath).isDirectory() ? schemaPath : dirname(schemaPath)).replace(/\\/g, '/');
    if (!prismaDir) prismaDir = '.';
    writeFileSync(configPath, importedConfig(result, { schemaPath: schemaRef, prismaDir }), 'utf8');
    ui.success(`Wrote ${ui.c.bold(rel(ctx, configPath))} for ${result.database}${result.urlEnv ? `, reading ${result.urlEnv}` : ''}.`);
  }
  printImportReport(ui, result.warnings);
  const prismaFolder = statSync(schemaPath).isDirectory() ? schemaPath : dirname(schemaPath);
  const migrationsDir = [join(prismaFolder, 'migrations'), join(dirname(prismaFolder), 'migrations')].find((d) => existsSync(d));
  const migrations = migrationsDir ? rel(ctx, migrationsDir) : undefined;
  ui.line();
  ui.box([
    ui.c.bold('Next steps'),
    `1. Read ${rel(ctx, out)}${writeConfig ? '' : ' and point kastor.config.ts at it'}.`,
    `2. kastor migrate baseline${migrations ? ` --from-prisma ${migrations}` : ''}`,
    '   records the database as it is now, without changing it.',
    '3. kastor migrate dev should then say: Already in sync.',
  ]);
  return 0;
}

/** Warnings first, then notes, each with its hint. */
export function printImportReport(ui: Ui, warnings: PrismaImportWarning[]): void {
  const { c } = ui;
  const warn = warnings.filter((w) => w.level === 'warn');
  const info = warnings.filter((w) => w.level === 'info');
  if (!warn.length) ui.success('Every model, field and relation mapped exactly.');
  if (warn.length) {
    ui.line();
    ui.line(c.bold(`Not mapped exactly (${warn.length})`));
    for (const w of warn) {
      ui.line(`  ${c.yellow(ui.sym.warn)} ${c.bold(w.where)}: ${w.message}`);
      if (w.hint) ui.line(`    ${c.gray(w.hint)}`);
    }
  }
  if (info.length) {
    ui.line();
    ui.line(c.bold(`Good to know (${info.length})`));
    for (const w of info) {
      ui.line(`  ${c.cyan(ui.sym.info)} ${c.bold(w.where)}: ${w.message}`);
      if (w.hint) ui.line(`    ${c.gray(w.hint)}`);
    }
  }
}
