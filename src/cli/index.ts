/**
 * The kastor command line. `main` takes the arguments and the streams and
 * returns an exit code, so tests run it in process; `run` is what the bin
 * script calls.
 */
import pkg from '../../package.json';
import { ArgsError, parseArgs, renderHelp, resolveCommand } from './args';
import { dbPull, dbPush, dbSeed } from './commands/db';
import { doctor } from './commands/doctor';
import { init } from './commands/init';
import { importPrisma } from './commands/import';
import { migrateBaseline, migrateDeploy, migrateDev, migrateReset, migrateStatus } from './commands/migrate';
import { openBrowser, studio } from './commands/studio';
import type { CliContext } from './context';
import { TerminalPrompter, type Prompter } from './prompt';
import { printError } from './render';
import { Ui, type OutStream } from './ui';

export const VERSION: string = (pkg as { version: string }).version;

const HANDLERS: Record<string, (ctx: CliContext) => Promise<number>> = {
  init,
  'migrate dev': migrateDev,
  'migrate deploy': migrateDeploy,
  'migrate status': migrateStatus,
  'migrate reset': migrateReset,
  'migrate baseline': migrateBaseline,
  'import prisma': importPrisma,
  'db push': dbPush,
  'db pull': dbPull,
  'db seed': dbSeed,
  studio,
  doctor,
};

export interface MainOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdout?: OutStream;
  stderr?: OutStream;
  /** Prompter to use; default: a terminal prompter when stdin and stdout are TTYs, none otherwise. */
  prompt?: Prompter | null;
  /** Force colors on or off. */
  color?: boolean;
  openUrl?: (url: string) => void;
  onStudio?: CliContext['onStudio'];
}

export async function main(argv: string[], options: MainOptions = {}): Promise<number> {
  const env = options.env ?? process.env;
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    const ui = new Ui({ stdout: options.stdout, stderr: options.stderr, env, color: options.color });
    return printError(ui, error);
  }
  const colorFlag = typeof parsed.options.color === 'boolean' ? parsed.options.color : undefined;
  const ui = new Ui({ stdout: options.stdout, stderr: options.stderr, env, color: colorFlag ?? options.color });
  try {
    if (parsed.options.version) {
      ui.line(VERSION);
      return 0;
    }
    if (!parsed.command && !parsed.words.length) {
      ui.line(renderHelp(null, ui.c, VERSION));
      return parsed.options.help ? 0 : 1;
    }
    const command = resolveCommand(parsed);
    if (!command) throw new ArgsError('No command given.', 'Run kastor --help.');
    if (parsed.options.help) {
      ui.line(renderHelp(command, ui.c, VERSION));
      return 0;
    }
    const interactive = Boolean(process.stdin.isTTY && ui.stdout.isTTY) && !env.CI;
    const prompt = options.prompt !== undefined ? options.prompt : interactive ? new TerminalPrompter(ui) : null;
    const ctx: CliContext = {
      ui,
      prompt,
      cwd: options.cwd ?? process.cwd(),
      env,
      version: VERSION,
      options: parsed.options,
      openUrl: options.openUrl ?? openBrowser,
      onStudio: options.onStudio,
    };
    return await HANDLERS[command.name]!(ctx);
  } catch (error) {
    return printError(ui, error);
  }
}

/** Entry for bin/kastor.mjs. */
export async function run(argv = process.argv.slice(2)): Promise<void> {
  const code = await main(argv);
  process.exitCode = code;
}
