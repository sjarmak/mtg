/**
 * `tsx packages/setgen/src/cli.ts` — run the generator from a brief file.
 *
 * Two modes matter. Without `--record` it replays recorded responses, which is
 * how CI and a curious reader run the pipeline for free. With `--record` it
 * calls the live provider (the authenticated `claude` binary by default) and
 * writes every request/response pair into the fixtures directory, so the run
 * that proves the loop works is also the run that makes it reproducible.
 *
 *   tsx packages/setgen/src/cli.ts --brief briefs/tideglass.json --record
 *   tsx packages/setgen/src/cli.ts --brief briefs/tideglass.json --out out/TGR
 */
import { readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createBudgetGuard,
  createFixtureProvider,
  manifestId,
  runManifestPath,
  writeRunManifest,
} from '@mtg/llm';
import type { LlmProvider, RunManifest } from '@mtg/llm';
import { allocateSlots } from './allocate';
import type { Allocation } from './allocate';
import { parseBrief } from './brief';
import type { SetBrief } from './brief';
import { derivePins } from './pins';
import type { PinDerivation } from './pins';
import { createResumableRecorder } from './record';
import { generateSet } from './generate';
import { writeSetOutput } from './emit';
import { formatReport } from './report';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '..', '..');
export const DEFAULT_FIXTURE_DIR = join(PACKAGE_ROOT, 'fixtures', 'llm');
export const RUN_MANIFEST_DIR = join(PACKAGE_ROOT, 'fixtures', 'runs');

/**
 * The manifest a finished recording leaves behind.
 *
 * Kept as a pure function of the keys the recorder reported so the CLI half is
 * only the write. `calls` counts requests and `keys` counts files: a request
 * repeated verbatim resolves to one fixture, and saying both means a bill summed
 * over the files can be checked against the calls that produced them.
 *
 * The id carries the finish time, so two runs of one brief land in two files.
 * They did not, once: the flagship was regenerated an hour after its first
 * recording and the brief-named manifest took the second run's keys, leaving no
 * record of what the first had served.
 */
export function buildRunManifest(
  briefPath: string,
  keys: readonly string[],
  recordedAt = new Date().toISOString(),
): RunManifest {
  const unique = [...new Set(keys)];
  const [first, ...rest] = unique;
  if (first === undefined)
    throw new Error('a recorded run served no fixtures, so there is nothing to record');
  const run = basename(briefPath, '.json');
  return {
    id: manifestId(run, recordedAt),
    run,
    brief: relative(REPO_ROOT, briefPath),
    recordedAt,
    calls: keys.length,
    keys: [first, ...rest],
  };
}

interface CliOptions {
  readonly briefPath: string;
  readonly outDir?: string;
  readonly fixtureDir: string;
  readonly record: boolean;
  readonly maxUsd?: number;
  readonly critique: boolean;
  readonly flavor: boolean;
  /**
   * Build the brief at this size instead of the one the file states.
   *
   * The flagship brief is one list of cards and the set it describes is a
   * different set at every size, so the size belongs on the command that runs it
   * rather than in the file: editing the file to run at 249 would take the 75
   * that two committed fixtures replay against with it.
   */
  readonly targetSize?: number;
  /**
   * Derive the pins, allocate, print the skeleton, and stop.
   *
   * Model-free and free of charge. It is the answer to "what would this brief
   * build at that size", which is the question a run costing an hour and real
   * money should not be the first thing to answer.
   */
  readonly pinsOnly: boolean;
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined || !arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      flags.add(key);
      continue;
    }
    values.set(key, next);
    index += 1;
  }

  const briefPath = values.get('brief');
  if (briefPath === undefined) {
    throw new Error(
      'usage: cli.ts --brief <brief.json> [--out <dir>] [--fixtures <dir>] [--record] [--no-critique] [--no-flavor] [--max-usd <n>] [--target-size <n>] [--pins]',
    );
  }
  const targetSizeRaw = values.get('target-size');
  const targetSize = targetSizeRaw === undefined ? undefined : Number(targetSizeRaw);
  if (targetSize !== undefined && !Number.isInteger(targetSize)) {
    throw new Error(`--target-size must be an integer, got ${targetSizeRaw}`);
  }
  const maxUsdRaw = values.get('max-usd');
  const maxUsd = maxUsdRaw === undefined ? undefined : Number(maxUsdRaw);
  if (maxUsd !== undefined && (!Number.isFinite(maxUsd) || maxUsd <= 0)) {
    throw new Error(`--max-usd must be a positive number, got ${maxUsdRaw}`);
  }
  const out = values.get('out');
  return {
    briefPath: absolute(briefPath),
    ...(out === undefined ? {} : { outDir: absolute(out) }),
    fixtureDir: absolute(values.get('fixtures') ?? DEFAULT_FIXTURE_DIR),
    record: flags.has('record'),
    critique: !flags.has('no-critique'),
    flavor: !flags.has('no-flavor'),
    ...(maxUsd === undefined ? {} : { maxUsd }),
    ...(targetSize === undefined ? {} : { targetSize }),
    pinsOnly: flags.has('pins'),
  };
}

/** The brief the run will actually build, at the size the command asked for. */
export function loadBrief(briefPath: string, targetSize?: number): SetBrief {
  const raw = JSON.parse(readFileSync(briefPath, 'utf8')) as Record<string, unknown>;
  return parseBrief(targetSize === undefined ? raw : { ...raw, targetSize });
}

/**
 * What the brief builds at this size, printed and not paid for.
 *
 * Every pin the size moved is named with what it moved to, then the skeleton is
 * summarized per tier. That is `mtg-mj5m`'s whole lesson written as a command: a
 * brief is a claim about a skeleton, and the claim is checkable for nothing.
 */
export function formatPins(brief: SetBrief, pins: PinDerivation, allocation: Allocation): string {
  const lines = [`${brief.setName} (${brief.setCode}) at ${brief.targetSize} cards`, ''];
  lines.push(pins.notes.length === 0 ? 'every stated pin holds at this size' : 'pins the size moved:');
  for (const note of pins.notes) lines.push(`  ${note}`);
  lines.push('', 'required cards, as seated:');
  for (const slot of allocation.slots.filter((candidate) => candidate.requiredCard !== undefined)) {
    lines.push(
      `  ${slot.id}  ${slot.rarity.padEnd(8)} ${(slot.color ?? 'colorless').padEnd(9)} ` +
        `${slot.cardKind.padEnd(8)} MV ${slot.manaValueMin}-${slot.manaValueMax}  ${slot.requiredCard?.name ?? ''}`,
    );
  }
  lines.push('', 'the tier a bomb may be printed at:');
  for (const slot of allocation.slots.filter((candidate) => candidate.rarity === 'rare')) {
    const carries =
      slot.abilityKinds.length > 0
        ? slot.abilityKinds.join('/')
        : slot.effectKinds.length > 0
          ? slot.effectKinds.join('/')
          : 'no printed rules text';
    lines.push(
      `  ${slot.id}  ${(slot.color ?? 'colorless').padEnd(9)} ${slot.cardKind.padEnd(8)} ` +
        `${slot.role.padEnd(26)} MV ${slot.manaValueMin}-${slot.manaValueMax}  ${carries}`,
    );
  }
  return lines.join('\n');
}

function absolute(path: string): string {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

/** Recording appends every key it serves to `served`, which becomes the manifest. */
function buildProvider(options: CliOptions, served: string[]): LlmProvider {
  const budget = options.maxUsd === undefined ? undefined : createBudgetGuard({ maxUsd: options.maxUsd });
  if (!options.record) {
    return createFixtureProvider({
      dir: options.fixtureDir,
      record: false,
      ...(budget === undefined ? {} : { budget }),
    });
  }
  // Recording is resumable: anything already on disk replays for free, only new
  // requests reach the live `claude` binary. An interrupted run costs nothing to
  // restart.
  return createResumableRecorder({
    dir: options.fixtureDir,
    ...(budget === undefined ? {} : { budget }),
    onCall: (event) => {
      served.push(event.key);
      console.log(`  call ${served.length}: ${event.source} ${event.key}`);
    },
  });
}

export async function main(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv);
  const brief = loadBrief(options.briefPath, options.targetSize);
  if (options.pinsOnly) {
    const pins = derivePins(brief);
    console.log(formatPins(pins.brief, pins, allocateSlots(pins.brief)));
    return 0;
  }
  const served: string[] = [];
  const provider = buildProvider(options, served);

  const result = await generateSet({
    provider,
    brief,
    critique: options.critique,
    flavor: options.flavor,
  });
  const outDir = options.outDir ?? join(PACKAGE_ROOT, 'out', brief.setCode);
  const paths = writeSetOutput(outDir, result);

  console.log(formatReport(result.report));
  console.log(`\nset:    ${paths.setPath}\nreport: ${paths.reportPath}\nslots:  ${paths.slotsPath}`);

  // Written on the way out of a paid run, because reconstructing it later means
  // replaying against prompts that have moved on. See `fixture-manifest.ts`.
  if (options.record && served.length > 0) {
    const manifest = buildRunManifest(options.briefPath, served);
    const manifestPath = runManifestPath(RUN_MANIFEST_DIR, manifest.id);
    writeRunManifest(manifestPath, manifest);
    console.log(`run:    ${manifestPath}`);
  }
  return result.report.enforceable ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    });
}
