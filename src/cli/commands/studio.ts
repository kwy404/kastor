import { spawn } from 'node:child_process';
import { startStudio } from '../../studio/server';
import { header, openProject, opt, type CliContext } from '../context';

/** Opens a URL with the platform's default browser, without a shell. */
export function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    /* the URL is printed anyway */
  }
}

export async function studio(ctx: CliContext): Promise<number> {
  const project = await openProject(ctx);
  header(ctx, 'studio', project);
  const { ui } = ctx;
  let server;
  try {
    server = await ui.task('Reading the database', () =>
      startStudio({
        adapter: project.adapter,
        port: opt.num(ctx, 'port') ?? project.loaded.config.studio?.port,
        version: ctx.version,
        readOnly: opt.bool(ctx, 'read-only'),
      }),
      (s) => `Studio ready with ${s.state.schema.tables.length} table${s.state.schema.tables.length === 1 ? '' : 's'}`,
    );
  } catch (error) {
    await project.close().catch(() => undefined);
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      ui.error(`Port ${opt.num(ctx, 'port')} is taken.`, 'Pick another one with --port, or leave --port out to use the next free port.');
      return 1;
    }
    throw error;
  }
  ui.line();
  ui.box([`${ui.c.bold('kastor studio')} is running on ${ui.c.cyan(server.url)}`, '', 'Open this private link (it carries the session token):', ui.c.cyan(server.openUrl), '', ui.c.gray('Press Ctrl+C to stop.')]);
  ui.line();
  if (ctx.options.open !== false && ctx.openUrl) ctx.openUrl(server.openUrl);
  const stop = async (): Promise<void> => {
    await server.close();
    await project.close().catch(() => undefined);
  };
  ctx.onStudio?.({ url: server.openUrl, close: stop });
  if (ctx.onStudio) return 0;
  await new Promise<void>((resolve) => {
    const done = (): void => {
      process.off('SIGINT', done);
      process.off('SIGTERM', done);
      ui.line();
      ui.info('Stopping the studio.');
      void stop().then(resolve);
    };
    process.on('SIGINT', done);
    process.on('SIGTERM', done);
  });
  return 0;
}
