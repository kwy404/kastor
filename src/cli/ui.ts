/**
 * Terminal output: colors that respect NO_COLOR and FORCE_COLOR, spinners only
 * on a TTY, boxes, tables and readable errors with hints.
 */
export interface OutStream {
  write(chunk: string): unknown
  isTTY?: boolean
  columns?: number
}

export interface UiOptions {
  stdout?: OutStream
  stderr?: OutStream
  env?: Record<string, string | undefined>
  /** Force colors on or off. Default: detect from the stream and env. */
  color?: boolean
  /** Force TTY behavior (spinners, prompts). Default: stdout.isTTY. */
  tty?: boolean
}

type Paint = (s: string) => string

export interface Colors {
  enabled: boolean
  bold: Paint
  dim: Paint
  italic: Paint
  underline: Paint
  red: Paint
  green: Paint
  yellow: Paint
  blue: Paint
  magenta: Paint
  cyan: Paint
  gray: Paint
}

export function detectColor(stream: OutStream | undefined, env: Record<string, string | undefined>): boolean {
  if ('NO_COLOR' in env && env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (env.FORCE_COLOR !== undefined) return env.FORCE_COLOR !== '0' && env.FORCE_COLOR !== 'false';
  if (env.TERM === 'dumb') return false;
  if (env.CI) return true;
  return Boolean(stream?.isTTY);
}

export function makeColors(enabled: boolean): Colors {
  const wrap = (open: number, close: number): Paint =>
    enabled ? (s) => `\u001b[${open}m${s}\u001b[${close}m` : (s) => s;
  return {
    enabled,
    bold: wrap(1, 22),
    dim: wrap(2, 22),
    italic: wrap(3, 23),
    underline: wrap(4, 24),
    red: wrap(31, 39),
    green: wrap(32, 39),
    yellow: wrap(33, 39),
    blue: wrap(34, 39),
    magenta: wrap(35, 39),
    cyan: wrap(36, 39),
    gray: wrap(90, 39),
  };
}

 
const ANSI = /\u001b\[[0-9;]*m/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI, '');
}

export function visibleWidth(s: string): number {
  return [...stripAnsi(s)].length;
}

export function padEnd(s: string, width: number): string {
  return s + ' '.repeat(Math.max(0, width - visibleWidth(s)));
}

export interface Spinner {
  update(text: string): void
  succeed(text?: string): void
  fail(text?: string): void
  warn(text?: string): void
  stop(): void
}

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class Ui {
  readonly stdout: OutStream;
  readonly stderr: OutStream;
  readonly c: Colors;
  readonly tty: boolean;
  readonly env: Record<string, string | undefined>;
  private activeSpinner: { stop(): void } | null = null;

  constructor(options: UiOptions = {}) {
    this.stdout = options.stdout ?? process.stdout;
    this.stderr = options.stderr ?? process.stderr;
    this.env = options.env ?? process.env;
    this.tty = options.tty ?? Boolean(this.stdout.isTTY);
    this.c = makeColors(options.color ?? detectColor(this.stdout, this.env));
  }

  /** Symbols are plain characters so every terminal and log file shows them. */
  get sym(): { ok: string; fail: string; warn: string; info: string; arrow: string; bullet: string } {
    const { c } = this;
    return {
      ok: c.green('ok'),
      fail: c.red('error'),
      warn: c.yellow('warn'),
      info: c.cyan('info'),
      arrow: c.gray('->'),
      bullet: c.gray('*'),
    };
  }

  write(s: string): void {
    this.stdout.write(s);
  }

  line(s = ''): void {
    this.stdout.write(`${s}\n`);
  }

  info(s: string): void {
    this.line(`${this.sym.info}  ${s}`);
  }

  success(s: string): void {
    this.line(`${this.sym.ok}    ${s}`);
  }

  warn(s: string): void {
    this.line(`${this.sym.warn}  ${s}`);
  }

  title(s: string): void {
    this.line();
    this.line(`${this.c.bold(this.c.cyan('kastor'))} ${this.c.gray('/')} ${this.c.bold(s)}`);
    this.line();
  }

  /** A readable error: what went wrong, why, and the fix. */
  error(message: string, hint?: string, detail?: string): void {
    const { c } = this;
    const out = [`${c.red(c.bold('error'))} ${message}`];
    if (detail) out.push(...detail.split('\n').map((l) => `      ${c.gray(l)}`));
    if (hint) out.push(`${c.cyan('hint')}  ${hint}`);
    this.stderr.write(`${out.join('\n')}\n`);
  }

  /** A key/value list aligned on the keys. */
  keyValues(rows: Array<[string, string]>): void {
    const width = Math.max(0, ...rows.map(([k]) => visibleWidth(k)));
    for (const [k, v] of rows) this.line(`  ${this.c.gray(padEnd(k, width))}  ${v}`);
  }

  /** A simple table with a header row. */
  table(head: string[], rows: string[][]): void {
    const widths = head.map((h, i) => Math.max(visibleWidth(h), ...rows.map((r) => visibleWidth(r[i] ?? ''))));
    this.line(`  ${head.map((h, i) => this.c.bold(padEnd(h, widths[i]!))).join('   ')}`);
    this.line(`  ${widths.map((w) => this.c.gray('-'.repeat(w))).join('   ')}`);
    for (const r of rows) this.line(`  ${r.map((cell, i) => padEnd(cell, widths[i]!)).join('   ')}`);
  }

  /** A box around a few lines, used for summaries and next steps. */
  box(lines: string[], tone: 'cyan' | 'yellow' | 'red' | 'green' = 'cyan'): void {
    const paint = this.c[tone];
    const width = Math.max(...lines.map(visibleWidth));
    this.line(paint(`  +${'-'.repeat(width + 2)}+`));
    for (const l of lines) this.line(`  ${paint('|')} ${padEnd(l, width)} ${paint('|')}`);
    this.line(paint(`  +${'-'.repeat(width + 2)}+`));
  }

  /** A spinner on a TTY; a plain line per state change otherwise. */
  spinner(text: string): Spinner {
    this.activeSpinner?.stop();
    const { c } = this;
    let label = text;
    let frame = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    const render = (): void => {
      this.stdout.write(`\r\u001b[2K${c.cyan(FRAMES[frame % FRAMES.length]!)} ${label}`);
      frame++;
    };
    if (this.tty) {
      render();
      timer = setInterval(render, 80);
      timer.unref?.();
    }
    const done = (symbol: string, final: string): void => {
      if (timer) {
        clearInterval(timer);
        timer = null;
        this.stdout.write('\r\u001b[2K');
      }
      this.activeSpinner = null;
      this.line(`${symbol} ${final}`);
    };
    const spinner: Spinner = {
      update: (t) => {
        label = t;
      },
      succeed: (t) => done(padEnd(this.sym.ok, 5), t ?? label),
      fail: (t) => done(padEnd(this.sym.fail, 5), t ?? label),
      warn: (t) => done(padEnd(this.sym.warn, 5), t ?? label),
      stop: () => {
        if (timer) {
          clearInterval(timer);
          timer = null;
          this.stdout.write('\r\u001b[2K');
        }
        this.activeSpinner = null;
      },
    };
    this.activeSpinner = spinner;
    return spinner;
  }

  /** Runs `fn` under a spinner, succeeding or failing it on the way out. */
  async task<T>(text: string, fn: (s: Spinner) => Promise<T>, doneText?: (value: T) => string): Promise<T> {
    const s = this.spinner(text);
    try {
      const value = await fn(s);
      s.succeed(doneText ? doneText(value) : undefined);
      return value;
    } catch (err) {
      s.fail();
      throw err;
    }
  }
}

/** Collects output in memory, for tests and for the studio. */
export class MemoryStream implements OutStream {
  chunks: string[] = [];
  isTTY = false;
  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }
  get text(): string {
    return this.chunks.join('');
  }
}
