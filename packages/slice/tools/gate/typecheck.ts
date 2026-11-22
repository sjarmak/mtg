/**
 * Runs the typechecker and keeps what it printed.
 *
 * `spawnSync` with inherited stdio, which the gate used before, reports the exit
 * status and nothing of the output, and it folds a signal death into
 * `status: null` that the caller then read as 1. `verdict.ts`'s `judgeTypecheck`
 * needs both to tell the checker refusing the tree from the run being ended, so
 * this reads the two streams while still forwarding every chunk to the terminal
 * as it arrives: a lane's log looks exactly as it did.
 *
 * It only runs and reports. Deciding what the run means is `judgeTypecheck`.
 */
import { spawn } from 'node:child_process';
import type { TypecheckRun } from './verdict';

/** Where the two streams are forwarded. The terminal, except in a test that wants to read them. */
export interface TypecheckSinks {
  readonly stdout: NodeJS.WritableStream;
  readonly stderr: NodeJS.WritableStream;
}

export function runTypecheck(
  command: readonly string[],
  env: NodeJS.ProcessEnv,
  sinks: TypecheckSinks = { stdout: process.stdout, stderr: process.stderr },
): Promise<TypecheckRun> {
  const [bin, ...args] = command;
  if (bin === undefined) throw new Error('empty command');
  return new Promise((resolve) => {
    const chunks: string[] = [];
    let settled = false;
    const settle = (run: Omit<TypecheckRun, 'output'>): void => {
      if (settled) return;
      settled = true;
      resolve({ ...run, output: chunks.join('') });
    };
    const child = spawn(bin, args, { stdio: ['inherit', 'pipe', 'pipe'], env });
    child.stdout.on('data', (chunk: Buffer) => {
      sinks.stdout.write(chunk);
      chunks.push(chunk.toString('utf8'));
    });
    child.stderr.on('data', (chunk: Buffer) => {
      sinks.stderr.write(chunk);
      chunks.push(chunk.toString('utf8'));
    });
    child.on('error', (error) => {
      sinks.stderr.write(`gate: could not run ${bin}: ${error.message}\n`);
      settle({ status: null, signal: null });
    });
    child.on('close', (status, signal) => settle({ status, signal }));
  });
}
