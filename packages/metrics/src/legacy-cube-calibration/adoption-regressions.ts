/** Fixed local commands, never a caller-supplied shell command or a self-reported green flag. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const COMMAND_TIMEOUT_MS = 30 * 60 * 1000;
const OUTPUT_LIMIT = 32 * 1024 * 1024;
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
type Command = { name: string; executable: string; args: string[]; cwd: string };

function commands(out: string): Command[] {
  return [
    ...['typecheck', 'lint', 'format', 'test'].map((name) => ({
      name,
      executable: 'npm',
      args: ['run', name],
      cwd: ROOT,
    })),
    {
      name: 'ui-build',
      executable: process.execPath,
      args: [join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', join(out, 'ui-dist')],
      cwd: join(ROOT, 'packages/ui'),
    },
  ];
}

function execute(command: Command) {
  return new Promise<{
    stdout: string;
    stderr: string;
    exitCode: number | null;
    signal: string | null;
    error: string | null;
  }>((done) => {
    let failure: string | null = null;
    let stdout: readonly Buffer[] = [];
    let stderr: readonly Buffer[] = [];
    let bytes = 0;
    const child = spawn(command.executable, command.args, {
      cwd: command.cwd,
      shell: false,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const cleanup = () => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH')
          failure = `Regression process-group cleanup failed: ${String(error)}`;
      }
    };
    const timer = setTimeout(() => {
      failure = `Regression exceeded ${COMMAND_TIMEOUT_MS}ms timeout`;
      cleanup();
    }, COMMAND_TIMEOUT_MS);
    const capture = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
      const retained = chunk.subarray(0, Math.max(0, OUTPUT_LIMIT - bytes));
      if (stream === 'stdout') stdout = [...stdout, retained];
      else stderr = [...stderr, retained];
      bytes += chunk.length;
      if (bytes > OUTPUT_LIMIT && failure === null) {
        failure = `Regression exceeded ${OUTPUT_LIMIT} byte output limit`;
        cleanup();
      }
    };
    child.stdout.on('data', (chunk: Buffer) => capture('stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => capture('stderr', chunk));
    child.once('error', (error) => {
      failure = error.message;
    });
    // npm may exit before its children. Stop the group to close inherited pipes too.
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
  });
}

export async function runAdoptionRegressions(directory: string) {
  if (process.platform === 'win32')
    throw new Error('Adoption regressions require POSIX process-group cleanup');
  const out = resolve(directory);
  await mkdir(out);
  let checks = [] as readonly {
    name: string;
    executable: string;
    args: string[];
    cwd: string;
    passed: boolean;
    exitCode: number | null;
    signal: string | null;
    error: string | null;
    stdoutSha256: string;
    stderrSha256: string;
  }[];
  for (const command of commands(out)) {
    process.stderr.write(`Calibration regression: ${command.name}\n`);
    const { stdout, stderr, ...result } = await execute(command);
    await writeFile(join(out, `${command.name}.stdout.txt`), stdout, { flag: 'wx' });
    await writeFile(join(out, `${command.name}.stderr.txt`), stderr, { flag: 'wx' });
    checks = [
      ...checks,
      {
        ...command,
        ...result,
        passed: result.exitCode === 0 && result.error === null,
        stdoutSha256: sha(stdout),
        stderrSha256: sha(stderr),
      },
    ];
  }
  const body = {
    version: 'legacy-cube-adoption-regressions/v1',
    passed: checks.every((c) => c.passed),
    checks,
  };
  const result = { ...body, sha256: sha(JSON.stringify(body)) };
  await writeFile(join(out, 'report.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  return result;
}
