/**
 * Interactive questions on a TTY: confirm, select with arrow keys and text.
 * Commands talk to the `Prompter` interface so tests can script the answers.
 */
import { emitKeypressEvents } from 'node:readline';
import type { Ui } from './ui';

export interface Choice<T> {
  label: string;
  value: T;
  hint?: string;
}

export interface Prompter {
  confirm(message: string, initial?: boolean): Promise<boolean>;
  select<T>(message: string, choices: Choice<T>[], initial?: number): Promise<T>;
  text(message: string, initial?: string): Promise<string>;
}

export class PromptCancelled extends Error {
  override name = 'PromptCancelled';
  constructor() {
    super('Cancelled.');
  }
}

interface KeyInput {
  isTTY?: boolean;
  setRawMode?(mode: boolean): unknown;
  on(event: 'keypress', fn: (str: string | undefined, key: Key) => void): unknown;
  off(event: 'keypress', fn: (str: string | undefined, key: Key) => void): unknown;
  resume(): unknown;
  pause(): unknown;
}

interface Key {
  name?: string;
  ctrl?: boolean;
  sequence?: string;
}

/** Prompts drawn on the terminal, answered with the keyboard. */
export class TerminalPrompter implements Prompter {
  constructor(
    private readonly ui: Ui,
    private readonly input: KeyInput = process.stdin as unknown as KeyInput,
  ) {
    emitKeypressEvents(this.input as never);
  }

  private read(onKey: (str: string | undefined, key: Key, done: (err?: Error) => void) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const wasRaw = Boolean((this.input as { isRaw?: boolean }).isRaw);
      this.input.setRawMode?.(true);
      this.input.resume();
      const finish = (err?: Error): void => {
        this.input.off('keypress', handler);
        this.input.setRawMode?.(wasRaw);
        this.input.pause();
        if (err) reject(err);
        else resolve();
      };
      const handler = (str: string | undefined, key: Key): void => {
        if (key?.ctrl && key.name === 'c') {
          this.ui.write('\n');
          finish(new PromptCancelled());
          return;
        }
        onKey(str, key ?? {}, finish);
      };
      this.input.on('keypress', handler);
    });
  }

  async confirm(message: string, initial = false): Promise<boolean> {
    const { c } = this.ui;
    this.ui.write(`${c.cyan('?')} ${c.bold(message)} ${c.gray(initial ? '(Y/n)' : '(y/N)')} `);
    let answer = initial;
    await this.read((str, key, done) => {
      if (key.name === 'return' || key.name === 'enter') return done();
      if (key.name === 'escape') return done(new PromptCancelled());
      if (str && /^y$/i.test(str)) {
        answer = true;
        done();
      } else if (str && /^n$/i.test(str)) {
        answer = false;
        done();
      }
    });
    this.ui.line(c.cyan(answer ? 'yes' : 'no'));
    return answer;
  }

  async select<T>(message: string, choices: Choice<T>[], initial = 0): Promise<T> {
    const { c } = this.ui;
    let index = Math.min(Math.max(initial, 0), choices.length - 1);
    const draw = (first: boolean): void => {
      if (!first) this.ui.write(`\u001b[${choices.length}A`);
      for (let i = 0; i < choices.length; i++) {
        const ch = choices[i]!;
        const active = i === index;
        const label = active ? c.cyan(c.bold(ch.label)) : ch.label;
        this.ui.write(`\r\u001b[2K  ${active ? c.cyan('>') : ' '} ${label}${ch.hint ? `  ${c.gray(ch.hint)}` : ''}\n`);
      }
    };
    this.ui.line(`${c.cyan('?')} ${c.bold(message)} ${c.gray('(arrow keys, enter)')}`);
    draw(true);
    await this.read((str, key, done) => {
      if (key.name === 'up' || key.name === 'k') index = (index - 1 + choices.length) % choices.length;
      else if (key.name === 'down' || key.name === 'j' || key.name === 'tab') index = (index + 1) % choices.length;
      else if (key.name === 'return' || key.name === 'enter') return done();
      else if (key.name === 'escape') return done(new PromptCancelled());
      else if (str && /^[1-9]$/.test(str) && Number(str) <= choices.length) index = Number(str) - 1;
      else return;
      draw(false);
    });
    this.ui.write(`\u001b[${choices.length}A`);
    for (let i = 0; i < choices.length; i++) this.ui.write('\r\u001b[2K\n');
    this.ui.write(`\u001b[${choices.length}A`);
    this.ui.line(`  ${c.gray('->')} ${c.cyan(choices[index]!.label)}`);
    return choices[index]!.value;
  }

  async text(message: string, initial = ''): Promise<string> {
    const { c } = this.ui;
    let value = '';
    const prefix = `${c.cyan('?')} ${c.bold(message)} ${initial ? c.gray(`(${initial}) `) : ''}`;
    this.ui.write(prefix);
    await this.read((str, key, done) => {
      if (key.name === 'return' || key.name === 'enter') return done();
      if (key.name === 'escape') return done(new PromptCancelled());
      if (key.name === 'backspace') {
        if (value) {
          value = value.slice(0, -1);
          this.ui.write('\b \b');
        }
        return;
      }
      if (str && !key.ctrl && str >= ' ' && str.length === 1) {
        value += str;
        this.ui.write(str);
      }
    });
    this.ui.write('\n');
    return value.trim() || initial;
  }
}

/** Answers from a list, for tests and scripted runs. Throws when it runs out. */
export class ScriptedPrompter implements Prompter {
  readonly asked: string[] = [];
  constructor(private readonly answers: unknown[]) {}

  private next(message: string): unknown {
    this.asked.push(message);
    if (!this.answers.length) throw new Error(`No scripted answer for: ${message}`);
    return this.answers.shift();
  }

  async confirm(message: string): Promise<boolean> {
    return Boolean(this.next(message));
  }

  async select<T>(message: string, choices: Choice<T>[]): Promise<T> {
    const answer = this.next(message);
    if (typeof answer === 'number') return choices[answer]!.value;
    const found = choices.find((c) => c.value === answer || c.label === answer);
    if (!found) throw new Error(`Scripted answer ${String(answer)} is not a choice of: ${message}`);
    return found.value;
  }

  async text(message: string, initial = ''): Promise<string> {
    const answer = this.next(message);
    return typeof answer === 'string' && answer ? answer : initial;
  }
}
