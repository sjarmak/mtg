import { spawnSync } from 'node:child_process';

const MAX_GIT_OUTPUT_BYTES = 256 * 1024 * 1024;

export function git(args: readonly string[], cwd?: string): string {
  const result = spawnSync('git', [...args], {
    encoding: 'utf8',
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    ...(cwd === undefined ? {} : { cwd }),
  });
  if (result.error !== undefined) {
    throw new Error(`git ${args.join(' ')} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}
