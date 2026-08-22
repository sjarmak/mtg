/**
 * Driving Forge as a subprocess.
 *
 * Forge's headless entry point is `java -jar <desktop jar> sim …`, documented
 * in the distribution's own `docs/AI.md`. Everything crossing this boundary is
 * treated as untrusted: exit codes are reported, output is captured whole, and
 * a run that exceeds its wall clock is killed and reported as `timedOut`
 * rather than left to hang a CI job.
 */
import { spawn } from 'node:child_process';

export interface ForgeRunOptions {
  readonly jar: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  /** JVM heap flag; Forge's own launcher uses `-Xmx4096m`. */
  readonly heap?: string;
  /**
   * Environment for the JVM. Forge's desktop entry point builds a Swing GUI
   * object even in `sim` mode, so `DISPLAY` must point at an X server (Xvfb
   * is enough) or the process dies before the first game.
   */
  readonly env?: NodeJS.ProcessEnv;
}

export interface ForgeRunResult {
  /** The exact command line, so memos and failures can be reproduced verbatim. */
  readonly command: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
}

const DEFAULT_HEAP = '-Xmx4096m';

/** Builds the `java` argv for a Forge run. */
export function forgeCommandArgs(options: ForgeRunOptions): string[] {
  return [
    options.heap ?? DEFAULT_HEAP,
    '-Dio.netty.tryReflectionSetAccessible=true',
    '-Dfile.encoding=UTF-8',
    '-jar',
    options.jar,
    ...options.args,
  ];
}

/** Runs Forge to completion (or to its timeout) and captures everything. */
export function runForge(options: ForgeRunOptions): Promise<ForgeRunResult> {
  const args = forgeCommandArgs(options);
  const command = ['java', ...args].map(quoteArg).join(' ');
  const started = Date.now();

  return new Promise<ForgeRunResult>((resolvePromise) => {
    const child = spawn('java', args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env ?? process.env,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      clearTimeout(timer);
      resolvePromise({
        command,
        exitCode,
        signal,
        stdout,
        stderr,
        durationMs: Date.now() - started,
        timedOut,
      });
    };

    child.on('error', (error: Error) => {
      stderr += `\nfailed to spawn java: ${error.message}`;
      finish(null, null);
    });
    child.on('close', finish);
  });
}

function quoteArg(arg: string): string {
  return /[\s"']/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}
