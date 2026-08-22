/**
 * The loop.
 *
 * mechanics prompt -> set generation -> DSL validators + critique -> deck build
 * -> seeded mass sim -> metrics verdict -> Forge boot gate, with every stage
 * attributed and none of them allowed to hand the next stage a default.
 *
 * Ordering note: the Forge gate runs last even though it is a check on the
 * *set*, so that a machine without Forge still produces the throughput numbers
 * and the metrics verdict. Transpile rejections are the exception — those fail
 * inside the gate whether or not Forge is installed, because an unmappable
 * construct is a defect in the set rather than in the environment.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DeckList } from '@mtg/kernel';
import { runStage } from './errors';
import { failStage } from './errors';
import { formatSummary } from './format';
import type { SliceOptions } from './options';
import { runBenchStage } from './stages/bench';
import { runDeckStage } from './stages/decks';
import type { DeckStageResult } from './stages/decks';
import { runForgeStage } from './stages/forge';
import { runSetgenStage } from './stages/setgen';
import { runSimStage } from './stages/simulate';
import { runStoreStage } from './stages/store';
import { runVerdictStage } from './stages/verdict';
import type { SliceSummary } from './summary';
import { buildSummary, writeSummary } from './summary';

export interface SliceRunResult {
  readonly summary: SliceSummary;
  readonly summaryPath: string;
  readonly memo: string;
}

function writeDeckReports(dir: string, decks: DeckStageResult): void {
  mkdirSync(dir, { recursive: true });
  for (const deck of decks.decks) {
    writeFileSync(join(dir, `${deck.key}.md`), `${deck.report}\n`, 'utf8');
  }
}

function benchDecks(decks: DeckStageResult): readonly [DeckList, DeckList] {
  const first = decks.decks[0];
  const second = decks.decks[1];
  if (first === undefined || second === undefined) {
    failStage('bench', 'the benchmark needs two decks and the deck stage produced fewer');
  }
  return [first.deck, second.deck];
}

export async function runSlice(options: SliceOptions): Promise<SliceRunResult> {
  const startedAt = new Date().toISOString();
  const started = Date.now();

  const setgen = await runStage('setgen', () => runSetgenStage(options));

  const requestedStore = options.storePath;
  const storePath =
    requestedStore === null
      ? null
      : (await runStage('setgen', () => runStoreStage(setgen.cards, requestedStore))).path;

  const decks = await runStage('deckbuild', () => {
    const built = runDeckStage(setgen.cards);
    writeDeckReports(join(options.outDir, 'decks'), built);
    return built;
  });

  const sim = await runStage('sim', () =>
    runSimStage({
      decks: decks.decks,
      runSeed: options.runSeed,
      gamesPerMatchup: options.gamesPerMatchup,
      workers: options.workers,
      expansion: setgen.brief.setCode,
      logPath: join(options.outDir, 'logs', 'replay.jsonl'),
    }),
  );

  const metrics = await runStage('metrics', () =>
    runVerdictStage(
      sim.logs,
      `${setgen.brief.setName} (${setgen.brief.setCode}) — greedy self-play, seed ${options.runSeed}`,
      join(options.outDir, 'metrics'),
    ),
  );

  const bench = await runStage('bench', () =>
    runBenchStage({
      decks: benchDecks(decks),
      seed: options.runSeed,
      games: options.benchGames,
      forkIterations: options.forkIterations,
      copyIterations: options.copyIterations,
    }),
  );

  const forge = await runStage('forge', () =>
    runForgeStage(setgen.cards, { skip: options.skipForge, forgeHome: options.forgeHome }),
  );

  const summary = buildSummary({
    options,
    startedAt,
    durationMs: Date.now() - started,
    setgen,
    decks,
    sim,
    metrics,
    bench,
    forge,
    storePath,
  });

  const summaryPath = writeSummary(join(options.outDir, 'summary.json'), summary);
  const memo = formatSummary(summary);
  writeFileSync(join(options.outDir, 'memo.txt'), `${memo}\n`, 'utf8');
  return { summary, summaryPath, memo };
}
