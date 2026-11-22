/**
 * `live-journey.ts`'s command-line parsing, split out so a test can import
 * `readArgs` without triggering the script's own `main()` — `live-journey.ts`
 * runs it at module load, the way every tool under `tools/` does.
 */
import { isAbsolute, resolve } from 'node:path';

const REPO_ROOT = resolve(new URL('../../../', import.meta.url).pathname);

export interface Args {
  readonly url: string;
  readonly artifacts: string;
  readonly only: readonly string[] | null;
  readonly skipCube: boolean;
  /**
   * Arms the Stagehand prototype path (`mtg-onjme`). No default and no
   * environment-variable fallback on purpose: the only way to spend is to
   * pass this flag, the same rule `--backend fal` and `npm run deckbench
   * --max-usd` already follow. `null` (the flag omitted) must run the CDP
   * journeys exactly as before, with no Stagehand import loaded and no key
   * read.
   */
  readonly maxUsd: number | null;
  /**
   * Where the armed path reads `TYPESAFE_API_KEY` when the environment does not
   * carry it, resolved against the working directory. No default and no
   * search: `null` means the environment is the only place looked. Meaningless
   * without `--max-usd`, so passing it alone is refused rather than ignored,
   * and the no-flag path never opens a file.
   */
  readonly envFile: string | null;
}

export function usage(message?: string): string {
  const command =
    'usage: npm run verify:live -- --url http://127.0.0.1:5310 [--artifacts <directory>] [--only <id,id>] [--skip-cube] [--max-usd <dollars> [--env-file <path>]]';
  return message === undefined ? command : `${message}\n${command}`;
}

export function readArgs(argv: readonly string[]): Args | string {
  let url: string | null = null;
  let artifacts: string | null = null;
  let only: readonly string[] | null = null;
  let skipCube = false;
  let maxUsd: number | null = null;
  let envFile: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--url') {
      if (value === undefined) return usage('--url needs a value');
      url = value.replace(/\/+$/u, '');
      index += 1;
    } else if (flag === '--artifacts') {
      if (value === undefined) return usage('--artifacts needs a value');
      artifacts = isAbsolute(value) ? value : resolve(process.cwd(), value);
      index += 1;
    } else if (flag === '--only') {
      if (value === undefined) return usage('--only needs a value');
      only = value.split(',').filter((entry) => entry.length > 0);
      index += 1;
    } else if (flag === '--skip-cube') {
      skipCube = true;
    } else if (flag === '--max-usd') {
      if (value === undefined) return usage('--max-usd needs a value');
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0)
        return usage('--max-usd must be a positive number of dollars');
      maxUsd = parsed;
      index += 1;
    } else if (flag === '--env-file') {
      if (value === undefined) return usage('--env-file needs a value');
      envFile = isAbsolute(value) ? value : resolve(process.cwd(), value);
      index += 1;
    } else {
      return usage(`unknown argument: ${String(flag)}`);
    }
  }
  if (envFile !== null && maxUsd === null) {
    return usage('--env-file only feeds the Stagehand path; pass it with --max-usd');
  }
  if (url === null) return usage('--url is required: the launcher to prove, e.g. http://127.0.0.1:5310');
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
  return {
    url,
    artifacts: artifacts ?? resolve(REPO_ROOT, 'out', 'live-journey', stamp),
    only,
    skipCube,
    maxUsd,
    envFile,
  };
}
