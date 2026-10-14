import { describe, expect, it } from 'vitest';
import { ArgsError, COMMANDS, levenshtein, parseArgs, parseRenameFlags, renderHelp, resolveCommand, suggest } from '../src/cli/args';
import { PassThrough } from 'node:stream';
import { PromptCancelled, ScriptedPrompter, TerminalPrompter } from '../src/cli/prompt';
import { detectColor, makeColors, MemoryStream, padEnd, stripAnsi, Ui, visibleWidth } from '../src/cli/ui';

const plain = makeColors(false);

describe('parseArgs', () => {
  it('finds two word commands and their options', () => {
    const p = parseArgs(['migrate', 'dev', '--name', 'add posts', '--create-only', '-y']);
    expect(p.command?.name).toBe('migrate dev');
    expect(p.options).toEqual({ name: 'add posts', 'create-only': true, yes: true });
    expect(resolveCommand(p)?.name).toBe('migrate dev');
  });

  it('supports --flag=value, short values, numbers and negation', () => {
    const p = parseArgs(['studio', '--port=4000', '--no-open', '-c', 'cfg.ts']);
    expect(p.options).toEqual({ port: 4000, open: false, config: 'cfg.ts' });
    expect(parseArgs(['studio', '-p4001']).options.port).toBe(4001);
    expect(parseArgs(['studio', '--open=false']).options.open).toBe(false);
  });

  it('collects repeatable and comma separated lists', () => {
    const p = parseArgs(['db', 'push', '--rename', 'users:accounts', '--rename=users.name:fullName,posts.body:text']);
    expect(p.options.rename).toEqual(['users:accounts', 'users.name:fullName', 'posts.body:text']);
  });

  it('explains bad options', () => {
    expect(() => parseArgs(['migrate', 'dev', '--nmae', 'x'])).toThrow(/Unknown option --nmae/);
    try {
      parseArgs(['migrate', 'dev', '--nmae', 'x']);
    } catch (e) {
      expect((e as ArgsError).hint).toBe('Did you mean --name?');
    }
    expect(() => parseArgs(['-z'])).toThrow(/Unknown option -z/);
    expect(() => parseArgs(['migrate', 'dev', '--name'])).toThrow(/needs a value/);
    expect(() => parseArgs(['migrate', 'dev', '--name', '--yes'])).toThrow(/needs a value/);
    expect(() => parseArgs(['studio', '--port', 'abc'])).toThrow(/needs a number/);
    expect(() => parseArgs(['studio', '--open=maybe'])).toThrow(/switch/);
    expect(() => parseArgs(['migrate', 'dev', '--no-name'])).toThrow(/cannot be negated/);
  });

  it('rejects options and arguments that do not belong to the command', () => {
    expect(() => resolveCommand(parseArgs(['migrate', 'deploy', '--port', '1']))).toThrow(/does not apply/);
    expect(() => resolveCommand(parseArgs(['migrate', 'deploy', 'extra']))).toThrow(/Unexpected argument "extra"/);
  });

  it('suggests commands for typos and missing subcommands', () => {
    expect(() => resolveCommand(parseArgs(['migrate']))).toThrow(/needs a subcommand: dev, deploy, status, reset/);
    expect(() => resolveCommand(parseArgs(['migrate', 'deplyo']))).toThrow(ArgsError);
    try {
      resolveCommand(parseArgs(['studoi']));
    } catch (e) {
      expect((e as ArgsError).hint).toBe('Did you mean "kastor studio"?');
    }
    expect(resolveCommand(parseArgs([]))).toBeNull();
    expect(parseArgs(['--', 'migrate']).words).toEqual(['migrate']);
  });

  it('parses --rename values', () => {
    expect(parseRenameFlags(['users:accounts', 'users.name:fullName', 'users.a:users.b'])).toEqual([
      { kind: 'table', from: 'users', to: 'accounts' },
      { kind: 'column', table: 'users', from: 'name', to: 'fullName' },
      { kind: 'column', table: 'users', from: 'a', to: 'b' },
    ]);
    expect(() => parseRenameFlags(['nope'])).toThrow(/Invalid --rename/);
    expect(() => parseRenameFlags(['a.b:c.d'])).toThrow(/stays in its table/);
  });

  it('measures edit distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(suggest('dve', ['dev', 'deploy'])).toBe('dev');
    expect(suggest('zzzzzz', ['dev'])).toBeUndefined();
  });

  it('renders help for everything and for one command', () => {
    const all = renderHelp(null, plain, '0.1.0');
    for (const c of COMMANDS) expect(all).toContain(c.name);
    const one = renderHelp(COMMANDS.find((c) => c.name === 'migrate dev')!, plain, '0.1.0');
    expect(one).toContain('--rename <old:new>');
    expect(one).toContain('Examples');
  });
});

describe('terminal output', () => {
  it('respects NO_COLOR, FORCE_COLOR, TERM=dumb and the TTY', () => {
    expect(detectColor({ write: () => true, isTTY: true }, {})).toBe(true);
    expect(detectColor({ write: () => true, isTTY: true }, { NO_COLOR: '1' })).toBe(false);
    expect(detectColor({ write: () => true, isTTY: false }, { FORCE_COLOR: '1' })).toBe(true);
    expect(detectColor({ write: () => true, isTTY: true }, { FORCE_COLOR: '0' })).toBe(false);
    expect(detectColor({ write: () => true, isTTY: true }, { TERM: 'dumb' })).toBe(false);
    expect(detectColor({ write: () => true, isTTY: false }, {})).toBe(false);
  });

  it('measures text without escape codes', () => {
    const c = makeColors(true);
    expect(c.red('x')).toBe('\u001b[31mx\u001b[39m');
    expect(stripAnsi(c.bold(c.red('abc')))).toBe('abc');
    expect(visibleWidth(c.green('abc'))).toBe(3);
    expect(stripAnsi(padEnd(c.green('ab'), 4))).toBe('ab  ');
  });

  it('prints tables, boxes, key values and errors', () => {
    const out = new MemoryStream();
    const err = new MemoryStream();
    const ui = new Ui({ stdout: out, stderr: err, color: false, env: {} });
    ui.table(['A', 'Long header'], [['1', 'x'], ['22', 'yy']]);
    ui.box(['hello', 'kastor']);
    ui.keyValues([['Config', 'a.ts'], ['Database', 'sqlite']]);
    ui.error('Something broke.', 'Try again.', 'SELECT 1');
    expect(out.text).toMatchInlineSnapshot(`
      "  A    Long header
        --   -----------
        1    x
        22   yy
        +--------+
        | hello  |
        | kastor |
        +--------+
        Config    a.ts
        Database  sqlite
      "
    `);
    expect(err.text).toBe('error Something broke.\n      SELECT 1\nhint  Try again.\n');
  });

  it('only animates spinners on a TTY', async () => {
    const out = new MemoryStream();
    const ui = new Ui({ stdout: out, color: false, tty: false, env: {} });
    const value = await ui.task('Working', async (s) => {
      s.update('Still working');
      return 3;
    }, (v) => `Done with ${v}`);
    expect(value).toBe(3);
    expect(out.text).toBe('ok    Done with 3\n');
    await expect(ui.task('Failing', async () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');
    expect(out.text).toContain('error Failing');

    const tty = new MemoryStream();
    tty.isTTY = true;
    const tui = new Ui({ stdout: tty, color: false, env: {} });
    const s = tui.spinner('Spinning');
    s.warn('Careful');
    expect(tty.text).toContain('\r\u001b[2K');
    expect(tty.text).toContain('warn  Careful');
  });
});

describe('ScriptedPrompter', () => {
  it('answers in order and records the questions', async () => {
    const p = new ScriptedPrompter([true, 1, 'name', '', 'b']);
    expect(await p.confirm('Sure?')).toBe(true);
    expect(await p.select('Pick', [{ label: 'a', value: 'A' }, { label: 'b', value: 'B' }])).toBe('B');
    expect(await p.text('Name')).toBe('name');
    expect(await p.text('Other', 'fallback')).toBe('fallback');
    expect(await p.select('Pick', [{ label: 'a', value: 'A' }, { label: 'b', value: 'B' }])).toBe('B');
    expect(p.asked).toEqual(['Sure?', 'Pick', 'Name', 'Other', 'Pick']);
    await expect(p.confirm('More?')).rejects.toThrow(/No scripted answer/);
  });
});

describe('TerminalPrompter', () => {
  const setup = () => {
    const input = new PassThrough();
    const out = new MemoryStream();
    const ui = new Ui({ stdout: out, color: false, env: {} });
    return { input, out, prompter: new TerminalPrompter(ui, input as never) };
  };
  const later = (fn: () => void) => setTimeout(fn, 10);

  it('selects with the arrow keys and enter', async () => {
    const { input, out, prompter } = setup();
    later(() => input.write('\u001b[B\u001b[B\u001b[A\r'));
    const value = await prompter.select('Pick one', [
      { label: 'first', value: 1 },
      { label: 'second', value: 2, hint: 'the middle' },
      { label: 'third', value: 3 },
    ]);
    expect(value).toBe(2);
    expect(out.text).toContain('Pick one');
    expect(out.text).toContain('-> second');
  });

  it('confirms with y, n or the default', async () => {
    const a = setup();
    later(() => a.input.write('y'));
    expect(await a.prompter.confirm('Go?')).toBe(true);
    const b = setup();
    later(() => b.input.write('\r'));
    expect(await b.prompter.confirm('Go?', true)).toBe(true);
    const c = setup();
    later(() => c.input.write('n'));
    expect(await c.prompter.confirm('Go?', true)).toBe(false);
  });

  it('reads text with backspace and falls back to the default', async () => {
    const a = setup();
    later(() => a.input.write('abx\u007fc\r'));
    expect(await a.prompter.text('Name')).toBe('abc');
    const b = setup();
    later(() => b.input.write('\r'));
    expect(await b.prompter.text('Name', 'init')).toBe('init');
  });

  it('cancels on ctrl+c and escape', async () => {
    const a = setup();
    later(() => a.input.write('\u0003'));
    await expect(a.prompter.confirm('Go?')).rejects.toBeInstanceOf(PromptCancelled);
    const b = setup();
    later(() => b.input.write('\u001b'));
    await expect(b.prompter.select('Pick', [{ label: 'a', value: 1 }])).rejects.toBeInstanceOf(PromptCancelled);
  });
});
