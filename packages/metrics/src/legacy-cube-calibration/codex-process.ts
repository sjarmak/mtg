/** Bounded POSIX execution; process failures remain distinct from model responses. */
import { spawn } from 'node:child_process';

export interface CodexCommand {
  readonly binary: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly input: string;
  readonly timeoutMs: number;
  readonly outputLimit: number;
}
export interface CodexProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly error: string | null;
}

export async function runCodexProcess(command: CodexCommand): Promise<CodexProcessResult> {
  if (process.platform === 'win32') throw new Error('Codex review requires POSIX process groups');
  if (![command.timeoutMs, command.outputLimit].every((n) => Number.isSafeInteger(n) && n > 0))
    throw new Error('Codex process limits must be positive safe integers');
  return new Promise((done) => {
    let failure: string | null = null;
    let stdout: readonly Buffer[] = [];
    let stderr: readonly Buffer[] = [];
    let bytes = 0;
    const child = spawn(command.binary, [...command.args], {
      cwd: command.cwd,
      env: { ...command.env },
      shell: false,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const cleanup = () => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH')
          failure = `${failure ?? ''} Process-group cleanup failed: ${String(error)}`;
      }
    };
    const fail = (message: string) => {
      failure ??= message;
      cleanup();
    };
    const timer = setTimeout(() => fail(`Codex exceeded ${command.timeoutMs}ms timeout`), command.timeoutMs);
    const capture = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
      const retained = Buffer.from(chunk.subarray(0, Math.max(0, command.outputLimit - bytes)));
      if (stream === 'stdout') stdout = [...stdout, retained];
      else stderr = [...stderr, retained];
      bytes += chunk.length;
      if (bytes > command.outputLimit) fail(`Codex exceeded ${command.outputLimit} byte output limit`);
    };
    child.stdout.on('data', (chunk: Buffer) => capture('stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => capture('stderr', chunk));
    child.stdin.once('error', (error) => fail(`Codex input failed: ${error.message}`));
    child.once('error', (error) => fail(`Codex spawn failed: ${error.message}`));
    child.once('exit', cleanup);
    child.once('close', (exitCode, signal) => {
      clearTimeout(timer);
      done({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        exitCode,
        signal,
        error: failure,
      });
    });
    child.stdin.end(command.input);
  });
}
