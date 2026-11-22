import { readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunningServer } from '@mtg/netplay';
import { readSetIndex } from '../src/lab/set-index';
import { gameplayDir, resolveDataDir } from './data-path';
import { setIdentitySources } from './gameplay-identity';
import { gameplayRecorder } from './gameplay-recorder';
import { readSetDocument } from './resolve-set';
import type { ResolvedSet } from './resolve-set';
import { printedCardIdsOf } from './set-surfaces';
import { choosePreconFile } from './stage-precons';
import type { PreconSearch } from './stage-precons';
import { startTableService } from './table-service';

export interface FrozenTableOptions {
  readonly root: string;
  readonly repoRoot: string;
  readonly webPort: number;
  readonly port: number;
}

export interface FrozenTablePlan {
  readonly set: ResolvedSet;
  readonly precons: PreconSearch;
}

function port(value: string, name: string): number {
  if (!/^\d+$/u.test(value)) throw new Error(`${name} port must be an integer from 1 to 65535`);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${name} port must be an integer from 1 to 65535`);
  }
  return parsed;
}

export function readFrozenTableOptions(args: readonly string[]): FrozenTableOptions {
  const [root, repoRoot, webPort, tablePort] = args;
  if (
    args.length !== 4 ||
    root === undefined ||
    repoRoot === undefined ||
    webPort === undefined ||
    tablePort === undefined
  ) {
    throw new Error('usage: frozen-table <artifact-root> <repo-root> <web-port> <table-port>');
  }
  return {
    root: resolve(root),
    repoRoot: resolve(repoRoot),
    webPort: port(webPort, 'web'),
    port: port(tablePort, 'table'),
  };
}

function asset(root: string, url: string): string {
  const path = resolve(root, url);
  const step = relative(root, path);
  if (step === '' || step.startsWith('..') || isAbsolute(step)) {
    throw new Error(`frozen asset leaves ${root}: ${url}`);
  }
  return path;
}

export function loadFrozenTablePlan(root: string): FrozenTablePlan {
  const resolvedRoot = resolve(root);
  const indexPath = join(resolvedRoot, 'sets', 'index.json');
  const checked = readSetIndex(JSON.parse(readFileSync(indexPath, 'utf8')) as unknown, indexPath);
  if (!checked.ok) throw new Error(checked.message);
  const row = checked.index.sets.find(({ stem }) => stem === checked.index.selected);
  if (row === undefined) throw new Error(`frozen set index does not contain ${checked.index.selected}`);
  const setPath = asset(resolvedRoot, row.setUrl);
  const set = readSetDocument(setPath, row.what);
  if (!set.ok) throw new Error(set.message);
  const candidates =
    row.preconUrl === undefined
      ? []
      : [{ path: asset(resolvedRoot, row.preconUrl), what: 'the frozen selected set decks' }];
  const precons = choosePreconFile(candidates, printedCardIdsOf(set));
  const rejected = precons.rejected[0];
  if (rejected !== undefined) throw new Error(`${rejected.candidate.path}: ${rejected.why}`);
  return { set, precons };
}

export async function startFrozenTable(options: FrozenTableOptions): Promise<RunningServer> {
  const plan = loadFrozenTablePlan(options.root);
  const gameplayRoot = resolveDataDir(gameplayDir(options.repoRoot), options.repoRoot);
  const recorder = gameplayRecorder({
    root: gameplayRoot,
    sets: setIdentitySources([{ set: plan.set, selected: true }]),
  });
  return startTableService({
    ...plan,
    webPort: options.webPort,
    port: options.port,
    recorder,
  });
}

async function main(): Promise<void> {
  const options = readFrozenTableOptions(process.argv.slice(2));
  const server = await startFrozenTable(options);
  process.stdout.write(
    `frozen tables: http://127.0.0.1:${String(server.port)}/api; invites use port ${String(options.webPort)}\n`,
  );
  let closing: Promise<void> | null = null;
  const stop = (): void => {
    closing ??= server.close();
    void closing.then(
      () => process.exit(0),
      (cause: unknown) => {
        process.stderr.write(`Frozen table shutdown failed: ${String(cause)}\n`);
        process.exit(1);
      },
    );
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

const isEntrypoint =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  void main().catch((cause: unknown) => {
    process.stderr.write(`Frozen table startup failed: ${String(cause)}\n`);
    process.exitCode = 1;
  });
}
