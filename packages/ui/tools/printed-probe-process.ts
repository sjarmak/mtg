/** Own the entire POSIX test process group, including Forge grandchildren. */
import { spawn } from 'node:child_process';

const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
export function runProbeProcess(
  command: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly timeoutMs: number;
  },
): Promise<{
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error: string | null;
}> {
  return new Promise((resolveResult) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let error: string | null = null;
    const stop = (): void => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'ESRCH')
          error = `Probe cleanup failed: ${String(cause)}`;
      }
    };
    const timer = setTimeout(() => {
      error = `Probe process exceeded ${String(options.timeoutMs)}ms`;
      stop();
    }, options.timeoutMs);
    const collect = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) + chunk.length > MAX_OUTPUT_BYTES) {
        error = 'Probe process output exceeded limit';
        stop();
      } else if (stream === 'stdout') stdout += chunk.toString('utf8');
      else stderr += chunk.toString('utf8');
    };
    child.stdout.on('data', (chunk: Buffer) => collect('stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => collect('stderr', chunk));
    child.on('error', (cause) => {
      error = cause.message;
    });
    child.on('exit', stop);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveResult({ code, stdout, stderr, error });
    });
  });
}
