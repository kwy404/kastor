/**
 * Command line parsing for the kastor CLI. No dependency: a small table of
 * commands and options, `--flag value`, `--flag=value`, `--no-flag`, short
 * aliases, repeatable options and suggestions for typos.
 */
export type OptionType = 'boolean' | 'string' | 'number' | 'list'

export interface OptionSpec {
  type: OptionType
  alias?: string
  description: string
  /** Placeholder shown in help, for options that take a value. */
  value?: string
}

export interface CommandSpec {
  /** Full name, for example `migrate dev`. */
  name: string
  summary: string
  usage?: string
  options: string[]
  examples?: string[]
}

export const OPTIONS: Record<string, OptionSpec> = {
  config: { type: 'string', alias: 'c', value: 'path', description: 'Path to kastor.config.ts (default: search the current folder)' },
  name: { type: 'string', alias: 'n', value: 'name', description: 'Name of the new migration, for example add_posts' },
  'create-only': { type: 'boolean', description: 'Write the migration file without applying it' },
  rename: { type: 'list', value: 'old:new', description: 'Treat a change as a rename: users:accounts or users.name:fullName (repeatable)' },
  'accept-data-loss': { type: 'boolean', description: 'Allow destructive changes without asking' },
  force: { type: 'boolean', alias: 'f', description: 'Skip the confirmation prompt' },
  yes: { type: 'boolean', alias: 'y', description: 'Answer yes to every prompt' },
  'skip-seed': { type: 'boolean', description: 'Do not run the seed script after a reset' },
  port: { type: 'number', alias: 'p', value: 'port', description: 'Port for the studio server (default: 5555)' },
  open: { type: 'boolean', description: 'Open the browser (use --no-open to skip)' },
  out: { type: 'string', alias: 'o', value: 'path', description: 'Output file for db pull (default: the schema path from the config)' },
  print: { type: 'boolean', description: 'Print to stdout instead of writing a file' },
  db: { type: 'string', value: 'database', description: 'Database for init: postgres, cockroach, mysql, mariadb, sqlite, libsql, d1, mssql, oracle, mongodb' },
  json: { type: 'boolean', description: 'Machine readable output' },
  color: { type: 'boolean', description: 'Force colors on or off (--no-color); NO_COLOR is respected' },
  help: { type: 'boolean', alias: 'h', description: 'Show help' },
  version: { type: 'boolean', alias: 'v', description: 'Show the version' },
};

const COMMON = ['config', 'color', 'help'];

export const COMMANDS: CommandSpec[] = [
  {
    name: 'init',
    summary: 'Scaffold kastor.config.ts and a starter schema',
    usage: 'kastor init [--db postgres]',
    options: ['db', 'force', 'yes', 'color', 'help'],
    examples: ['kastor init --db postgres', 'kastor init --db sqlite'],
  },
  {
    name: 'migrate dev',
    summary: 'Diff the schema against the database, write a migration and apply it',
    usage: 'kastor migrate dev [--name add_posts] [--create-only] [--rename old:new]',
    options: [...COMMON, 'name', 'create-only', 'rename', 'accept-data-loss', 'yes'],
    examples: ['kastor migrate dev --name add_posts', 'kastor migrate dev --rename users.name:fullName --name rename_name'],
  },
  {
    name: 'migrate deploy',
    summary: 'Apply pending migrations (for CI and production)',
    options: [...COMMON],
    examples: ['kastor migrate deploy'],
  },
  {
    name: 'migrate status',
    summary: 'Show applied, pending and modified migrations',
    options: [...COMMON, 'json'],
  },
  {
    name: 'migrate reset',
    summary: 'Drop everything, reapply every migration and run the seed',
    options: [...COMMON, 'force', 'yes', 'skip-seed'],
  },
  {
    name: 'db push',
    summary: 'Make the database match the schema without migration files (prototyping)',
    options: [...COMMON, 'rename', 'accept-data-loss', 'yes'],
  },
  {
    name: 'db pull',
    summary: 'Introspect the database and write a TypeScript schema file',
    options: [...COMMON, 'out', 'print', 'force'],
    examples: ['kastor db pull --out src/db/schema.ts', 'kastor db pull --print'],
  },
  {
    name: 'db seed',
    summary: 'Run the seed script from the config',
    options: [...COMMON],
  },
  {
    name: 'studio',
    summary: 'Browse and edit your data in a local web UI',
    options: [...COMMON, 'port', 'open'],
    examples: ['kastor studio', 'kastor studio --port 4000 --no-open'],
  },
  {
    name: 'doctor',
    summary: 'Check the config, the connection, drift and pending migrations',
    options: [...COMMON, 'json'],
  },
];

export interface ParsedArgs {
  command: CommandSpec | null
  /** Words that did not match a command, for error messages. */
  words: string[]
  positionals: string[]
  options: Record<string, string | number | boolean | string[]>
}

export class ArgsError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'ArgsError';
  }
}

export function parseArgs(argv: string[]): ParsedArgs {
  const options: ParsedArgs['options'] = {};
  const words: string[] = [];
  const aliases = new Map<string, string>();
  for (const [name, spec] of Object.entries(OPTIONS)) if (spec.alias) aliases.set(spec.alias, name);

  const setOption = (name: string, raw: string | undefined, negated: boolean, next: () => string | undefined): void => {
    const spec = OPTIONS[name];
    if (!spec) {
      const guess = suggest(name, Object.keys(OPTIONS));
      throw new ArgsError(`Unknown option --${name}.`, guess ? `Did you mean --${guess}?` : 'Run kastor --help to see every option.');
    }
    if (spec.type === 'boolean') {
      if (raw !== undefined) {
        if (!/^(true|false|1|0)$/i.test(raw)) throw new ArgsError(`Option --${name} is a switch and takes no value (got "${raw}").`);
        options[name] = /^(true|1)$/i.test(raw) !== negated;
      } else options[name] = !negated;
      return;
    }
    if (negated) throw new ArgsError(`Option --${name} takes a value and cannot be negated.`);
    const value = raw ?? next();
    if (value === undefined || (raw === undefined && value.startsWith('-') && value.length > 1 && !/^-\d/.test(value))) {
      throw new ArgsError(`Option --${name} needs a value.`, spec.value ? `Example: --${name} <${spec.value}>` : undefined);
    }
    if (spec.type === 'number') {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new ArgsError(`Option --${name} needs a number (got "${value}").`);
      options[name] = n;
    } else if (spec.type === 'list') {
      const list = (options[name] as string[] | undefined) ?? [];
      list.push(...value.split(',').map((v) => v.trim()).filter(Boolean));
      options[name] = list;
    } else options[name] = value;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = (): string | undefined => {
      const v = argv[i + 1];
      if (v === undefined) return undefined;
      i++;
      return v;
    };
    if (arg === '--') {
      words.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      let name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      const raw = eq === -1 ? undefined : arg.slice(eq + 1);
      let negated = false;
      if (name.startsWith('no-') && !OPTIONS[name]) {
        name = name.slice(3);
        negated = true;
      }
      setOption(name, raw, negated, next);
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !/^-\d/.test(arg)) {
      const letters = arg.slice(1);
      for (let k = 0; k < letters.length; k++) {
        const name = aliases.get(letters[k]!);
        if (!name) throw new ArgsError(`Unknown option -${letters[k]}.`, 'Run kastor --help to see every option.');
        const spec = OPTIONS[name]!;
        if (spec.type !== 'boolean') {
          const rest = letters.slice(k + 1);
          setOption(name, rest || undefined, false, next);
          break;
        }
        setOption(name, undefined, false, next);
      }
      continue;
    }
    words.push(arg);
  }

  let command: CommandSpec | null = null;
  let used = 0;
  for (const spec of COMMANDS) {
    const parts = spec.name.split(' ');
    if (parts.every((p, idx) => words[idx] === p) && parts.length > used) {
      command = spec;
      used = parts.length;
    }
  }
  const positionals = words.slice(used);
  return { command, words, positionals, options };
}

/** Resolves a parse into a command, with friendly errors for typos. */
export function resolveCommand(parsed: ParsedArgs): CommandSpec | null {
  const { command, words, options } = parsed;
  if (command) {
    for (const key of Object.keys(options)) {
      if (!command.options.includes(key) && key !== 'help' && key !== 'version' && key !== 'color') {
        throw new ArgsError(`Option --${key} does not apply to "kastor ${command.name}".`, `Run kastor ${command.name} --help to see its options.`);
      }
    }
    if (parsed.positionals.length) {
      throw new ArgsError(`Unexpected argument "${parsed.positionals[0]}" for "kastor ${command.name}".`, `Run kastor ${command.name} --help.`);
    }
    return command;
  }
  if (!words.length) return null;
  const group = COMMANDS.filter((c) => c.name.split(' ')[0] === words[0]);
  if (group.length > 1) {
    const sub = words[1];
    const names = group.map((c) => c.name.split(' ')[1]!);
    if (!sub) throw new ArgsError(`"kastor ${words[0]}" needs a subcommand: ${names.join(', ')}.`, `Example: kastor ${group[0]!.name}`);
    const guess = suggest(sub, names);
    throw new ArgsError(`Unknown command "kastor ${words[0]} ${sub}".`, guess ? `Did you mean "kastor ${words[0]} ${guess}"?` : `Available: ${names.join(', ')}.`);
  }
  const tops = [...new Set(COMMANDS.map((c) => c.name.split(' ')[0]!))];
  const guess = suggest(words[0]!, tops);
  throw new ArgsError(`Unknown command "${words.join(' ')}".`, guess ? `Did you mean "kastor ${guess}"?` : 'Run kastor --help to see every command.');
}

/** Parses `--rename` values: `old:new` for tables, `table.old:new` for columns. */
export interface RenameFlag {
  kind: 'table' | 'column'
  table?: string
  from: string
  to: string
}

export function parseRenameFlags(values: string[]): RenameFlag[] {
  return values.map((v) => {
    const m = /^([^:]+):([^:]+)$/.exec(v);
    if (!m) throw new ArgsError(`Invalid --rename "${v}".`, 'Use --rename users:accounts for a table or --rename users.name:fullName for a column.');
    const from = m[1]!.trim();
    let to = m[2]!.trim();
    if (from.includes('.')) {
      const [table, col] = from.split('.', 2) as [string, string];
      if (to.includes('.')) {
        const [t2, c2] = to.split('.', 2) as [string, string];
        if (t2 !== table) throw new ArgsError(`Invalid --rename "${v}": a column rename stays in its table.`);
        to = c2;
      }
      return { kind: 'column', table, from: col, to };
    }
    return { kind: 'table', from, to };
  });
}

export function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

export function suggest(input: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestScore = Infinity;
  for (const c of candidates) {
    const d = levenshtein(input.toLowerCase(), c.toLowerCase());
    if (d < bestScore) {
      best = c;
      bestScore = d;
    }
  }
  return bestScore <= Math.max(2, Math.floor(input.length / 3)) ? best : undefined;
}

export function renderHelp(command: CommandSpec | null, c: { bold(s: string): string; gray(s: string): string; cyan(s: string): string }, version: string): string {
  const lines: string[] = [];
  if (!command) {
    lines.push(`${c.bold('kastor')} ${c.gray(`v${version}`)}  TypeScript ORM for almost every database`, '');
    lines.push(c.bold('Usage'), '  kastor <command> [options]', '', c.bold('Commands'));
    const width = Math.max(...COMMANDS.map((x) => x.name.length));
    for (const cmd of COMMANDS) lines.push(`  ${c.cyan(cmd.name.padEnd(width))}  ${cmd.summary}`);
    lines.push('', c.bold('Global options'));
    for (const name of ['config', 'color', 'help', 'version']) lines.push(formatOption(name, c));
    lines.push('', `Run ${c.cyan('kastor <command> --help')} for the options of one command.`);
    return lines.join('\n');
  }
  lines.push(`${c.bold(`kastor ${command.name}`)}  ${command.summary}`, '');
  lines.push(c.bold('Usage'), `  ${command.usage ?? `kastor ${command.name} [options]`}`, '', c.bold('Options'));
  for (const name of command.options) lines.push(formatOption(name, c));
  if (command.examples?.length) {
    lines.push('', c.bold('Examples'));
    for (const e of command.examples) lines.push(`  ${c.gray('$')} ${e}`);
  }
  return lines.join('\n');
}

function formatOption(name: string, c: { cyan(s: string): string; gray(s: string): string }): string {
  const spec = OPTIONS[name]!;
  const flag = `${spec.alias ? `-${spec.alias}, ` : '    '}--${name}${spec.value ? ` <${spec.value}>` : ''}`;
  return `  ${c.cyan(flag.padEnd(30))}  ${spec.description}`;
}
