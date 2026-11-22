import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parsePrintedConstructedFormat } from '@mtg/printed-card';
import type { PrintedConstructedFormat } from '@mtg/printed-card';
import { withForgeLock } from '../test-load/host-lock';
import { parsePairArg, remainingPairings, resolvePairings, type Pairing } from './pairings';
import { runPairing } from './run';
import {
  METHOD_STATEMENT,
  parseCommanderHeadToHeadResults,
  type CommanderHeadToHeadDeck,
  type CommanderHeadToHeadPairing,
  type CommanderHeadToHeadResults,
} from './schema';
import { tallyOverall, tallyPairing } from './tally';

interface CliArgs {
  readonly formatPath: string;
  readonly outPath: string;
  readonly games: number;
  readonly pairs: readonly Pairing[];
  readonly clockSeconds: number;
  readonly jobs: number;
  readonly resumePath: string | null;
  readonly baseSeed: number;
}

interface RawCliArgs {
  formatPath?: string;
  outPath?: string;
  games?: number;
  clockSeconds?: number;
  jobs?: number;
  resumePath?: string;
  seed?: number;
  pairs: Pairing[];
}

function scanArgs(argv: readonly string[]): RawCliArgs {
  const raw: RawCliArgs = { pairs: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${String(arg)} needs a value`);
      i += 1;
      return value;
    };
    switch (arg) {
      case '--format':
        raw.formatPath = next();
        break;
      case '--out':
        raw.outPath = next();
        break;
      case '--games':
        raw.games = Number(next());
        break;
      case '--pair':
        raw.pairs.push(parsePairArg(next()));
        break;
      case '--clock':
        raw.clockSeconds = Number(next());
        break;
      case '--jobs':
        raw.jobs = Number(next());
        break;
      case '--resume':
        raw.resumePath = next();
        break;
      case '--seed':
        raw.seed = Number(next());
        break;
      default:
        throw new Error(`unrecognized argument: ${String(arg)}`);
    }
  }
  return raw;
}

function validateArgs(raw: RawCliArgs): CliArgs {
  const { formatPath, outPath, games, seed } = raw;
  const clockSeconds = raw.clockSeconds ?? 120;
  const jobs = raw.jobs ?? 1;
  const resumePath = raw.resumePath ?? null;

  if (formatPath === undefined) throw new Error('--format is required');
  if (outPath === undefined) throw new Error('--out is required');
  if (games === undefined || !Number.isInteger(games) || games <= 0 || games % 2 !== 0) {
    throw new Error('--games must be a positive even integer');
  }
  if (!Number.isInteger(clockSeconds) || clockSeconds <= 0) {
    throw new Error('--clock must be a positive integer');
  }
  if (!Number.isInteger(jobs) || jobs <= 0) throw new Error('--jobs must be a positive integer');
  if (seed === undefined || !Number.isInteger(seed) || seed <= 0) {
    throw new Error('--seed is required and must be a positive integer');
  }

  return { formatPath, outPath, games, pairs: raw.pairs, clockSeconds, jobs, resumePath, baseSeed: seed };
}

export function parseArgs(argv: readonly string[]): CliArgs {
  return validateArgs(scanArgs(argv));
}

function loadFormat(path: string): PrintedConstructedFormat {
  return parsePrintedConstructedFormat(JSON.parse(readFileSync(resolve(path), 'utf8')));
}

function loadPartial(path: string): CommanderHeadToHeadResults {
  return parseCommanderHeadToHeadResults(JSON.parse(readFileSync(resolve(path), 'utf8')));
}

function buildResults(
  format: PrintedConstructedFormat,
  forgeVersion: string,
  measuredAt: string,
  gamesPerPairing: number,
  clockSeconds: number,
  baseSeed: number,
  decks: ReadonlyMap<string, CommanderHeadToHeadDeck>,
  pairings: readonly CommanderHeadToHeadPairing[],
): CommanderHeadToHeadResults {
  return {
    schemaVersion: 2,
    format: { id: format.id, contentSha256: format.contentSha256 },
    forgeVersion,
    measuredAt,
    gamesPerPairing,
    clockSeconds,
    method: METHOD_STATEMENT,
    baseSeed,
    players: 'forge-ai-both-seats',
    confidence: 0.95,
    decks: [...decks.values()],
    pairings: [...pairings],
    overall: [
      ...tallyOverall(
        format.decks.map((deck) => deck.id),
        pairings,
      ),
    ],
  };
}

export async function main(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv);
  const format = loadFormat(args.formatPath);
  const deckIds = format.decks.map((deck) => deck.id);
  const deckById = new Map(format.decks.map((deck) => [deck.id, deck]));
  const allRequested = resolvePairings(deckIds, args.pairs);

  const measuredAt = new Date().toISOString();
  const decks = new Map<string, CommanderHeadToHeadDeck>();
  const pairings: CommanderHeadToHeadPairing[] = [];
  let forgeVersion = '';

  if (args.resumePath !== null) {
    const partial = loadPartial(args.resumePath);
    forgeVersion = partial.forgeVersion;
    for (const deck of partial.decks) decks.set(deck.id, deck);
    pairings.push(...partial.pairings);
  }

  const todo = remainingPairings(
    allRequested,
    pairings.map((pairing) => ({ a: pairing.a, b: pairing.b })),
  );
  const partialPath = `${args.outPath}.partial`;

  function writePartial(): void {
    const results = buildResults(
      format,
      forgeVersion,
      measuredAt,
      args.games,
      args.clockSeconds,
      args.baseSeed,
      decks,
      pairings,
    );
    writeFileSync(resolve(partialPath), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  }

  async function runOne(pairing: Pairing): Promise<void> {
    const deckA = deckById.get(pairing.a);
    const deckB = deckById.get(pairing.b);
    if (deckA === undefined || deckB === undefined) {
      throw new Error(`pairing names an unknown deck: ${pairing.a}:${pairing.b}`);
    }
    const result = await runPairing({
      format,
      deckA,
      deckB,
      gamesPerPairing: args.games,
      clockSeconds: args.clockSeconds,
      baseSeed: args.baseSeed,
    });
    forgeVersion = result.forgeVersion;
    decks.set(result.decks[0].id, result.decks[0]);
    decks.set(result.decks[1].id, result.decks[1]);
    const tallied = tallyPairing(pairing.a, pairing.b, result.seeds, result.commands, result.records);
    pairings.push(tallied);
    console.log(
      `${pairing.a} vs ${pairing.b}: a=${String(tallied.aWins)} b=${String(tallied.bWins)} ` +
        `rulesDraws=${String(tallied.rulesDraws)} clockDraws=${String(tallied.clockDraws)}`,
    );
    writePartial();
  }

  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < todo.length) {
      const pairing = todo[nextIndex]!;
      nextIndex += 1;
      await runOne(pairing);
    }
  }
  const workerCount = Math.max(1, Math.min(args.jobs, todo.length));
  if (todo.length > 0) {
    await withForgeLock(`commander-head-to-head pid ${String(process.pid)}`, () =>
      Promise.all(Array.from({ length: workerCount }, () => worker())),
    );
  }

  const finalResults = buildResults(
    format,
    forgeVersion,
    measuredAt,
    args.games,
    args.clockSeconds,
    args.baseSeed,
    decks,
    pairings,
  );
  writeFileSync(resolve(args.outPath), `${JSON.stringify(finalResults, null, 2)}\n`, 'utf8');
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
