/**
 * The seam, over a document built during the test rather than committed.
 *
 * `tools/analysis-run.ts` writes `FormatHealth` verbatim and the route reads
 * `RunHealth`, which is a narrowing of it. `tsc` checks three of the four
 * blocks — they are the reader's own types on the producer's side — and it
 * cannot check that one, because a narrowing is not the type it narrows. So
 * this file closes it the only way left: play a small sweep, build a document
 * from the games, serialize it, and push it back through `readAnalysisRun`.
 *
 * Deliberately not asserted against the committed fixtures. Those were written
 * by a build of this repository that is already behind — regenerating them at
 * one point moved a color pair from 41.3% to 39.7% across 56 commits to the
 * kernel, sim and deckbuild — so a fixture proves the reader accepts what the
 * producer wrote *then*. This proves it accepts what the producer writes now.
 *
 * Two pairs and two games per matchup: the smallest sweep that still produces
 * a real under-sampled statistic, a real `notApplicable` gate and a real
 * `unjudged` verdict, which are the three states a hand-built object gets
 * wrong. It costs a couple of seconds of kernel time and buys the one check
 * `tsc` structurally cannot make.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { COLOR_PAIRS, buildDeckForPair, colorPairKey } from '@mtg/deckbuild';
import type { DeckList } from '@mtg/kernel';
import { greedySpec, runRoundRobin } from '@mtg/sim';
import { deriveSkeletonLite } from '@mtg/design-data';
import { buildAnalysisRun, skeletonTargets } from '../../tools/analysis-run';
import type { AnalysisDocument } from '../../tools/analysis-run';
import { readAnalysisRun } from '../../src/routes/analysis/read';
import { FAIRNESS_QUESTIONS, GATE_STATUSES } from '../../src/routes/analysis/model';

const SET_FIXTURE = fileURLToPath(
  new URL('../../../setgen/fixtures/sets/tideglass-reach.set.json', import.meta.url),
);

function loadPool(): readonly Card[] {
  const raw: unknown = JSON.parse(readFileSync(SET_FIXTURE, 'utf8'));
  if (typeof raw !== 'object' || raw === null || !('cards' in raw)) {
    throw new Error(`${SET_FIXTURE} has no "cards" array`);
  }
  const { cards } = raw as { cards: unknown };
  if (!Array.isArray(cards)) throw new Error(`${SET_FIXTURE} "cards" is not an array`);
  return cards.map((card) => parseCard(card));
}

async function produce(): Promise<AnalysisDocument> {
  const pool = loadPool();
  const decks: readonly DeckList[] = COLOR_PAIRS.slice(0, 2).map((pair) => ({
    name: colorPairKey(pair),
    cards: buildDeckForPair(pool, pair).deck,
  }));
  const run = await runRoundRobin(decks, {
    runSeed: 'mtg-ui/analysis/round-trip',
    gamesPerMatchup: 2,
    collectLogs: true,
    botFor: (deck: DeckList) => greedySpec(`greedy:${deck.name}`),
  });
  return buildAnalysisRun({
    id: 'round-trip',
    label: 'round trip',
    seed: 'mtg-ui/analysis/round-trip',
    set: { code: 'TGR', name: 'Tideglass Reach' },
    producedBy: 'packages/ui/test/analysis/round-trip.test.ts',
    pool,
    decks,
    logs: run.logs,
    targets: skeletonTargets(deriveSkeletonLite()),
    healthLabel: `round trip — ${run.games} games`,
  });
}

/** One sweep, shared: the assertions below all read the same document. */
const DOCUMENT = await produce();
/** Through JSON, because that is the only form the route ever sees. */
const WIRE: unknown = JSON.parse(JSON.stringify(DOCUMENT));

describe('a document this producer builds today', () => {
  it('is accepted by the reader that has to read it', () => {
    const run = readAnalysisRun(WIRE, 'round-trip');
    expect(run.id).toBe('round-trip');
    expect(run.health.games).toBe(DOCUMENT.health.games);
    expect(run.health.distinctGames).toBe(DOCUMENT.health.distinctGames);
  });

  it('narrows the health block without changing any number in it', () => {
    const run = readAnalysisRun(WIRE, 'round-trip');
    expect(run.health.gates.map((gate) => gate.id)).toEqual(DOCUMENT.health.gates.map((g) => g.id));
    for (const [index, gate] of run.health.gates.entries()) {
      const source = DOCUMENT.health.gates[index];
      expect(source).toBeDefined();
      if (source === undefined) continue;
      expect(gate.status).toBe(source.status);
      expect(gate.observed).toBe(source.observed);
      expect(gate.band).toEqual(source.band);
    }
    // The bands the charts draw are lifted out of `config`, which the reader
    // drops: this is the one place the narrowing moves a value rather than
    // copying it, so it is the one place it can silently take the wrong one.
    expect(run.health.bands.balance.colorPairWinRate).toEqual(
      DOCUMENT.health.config.balance.colorPairWinRate,
    );
    expect(run.health.bands.length.medianRounds).toEqual(DOCUMENT.health.config.length.medianRounds);
    expect(run.health.bands.decisiveness.maxStallRate).toBe(DOCUMENT.health.config.decisiveness.maxStallRate);
  });

  it('carries a verdict the reader accepts, over all four questions', () => {
    const run = readAnalysisRun(WIRE, 'round-trip');
    expect(run.fairness.readings.map((reading) => reading.question)).toEqual([...FAIRNESS_QUESTIONS]);
    expect(run.fairness.verdict).toBe(DOCUMENT.fairness.verdict);
    // Four games is nowhere near any floor: the answer has to be "not judged",
    // and a producer that called this fair would be the bug this route exists
    // to prevent.
    expect(run.fairness.verdict).toBe('unjudged');
  });

  it('reaches the two gate statuses no hand-built fixture produces', () => {
    const run = readAnalysisRun(WIRE, 'round-trip');
    const statuses = new Set(run.health.gates.map((gate) => gate.status));
    expect(statuses.has('underSampled')).toBe(true);
    expect(statuses.has('notApplicable')).toBe(true);
    for (const status of statuses) expect(GATE_STATUSES).toContain(status);
  });
});
