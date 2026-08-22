/**
 * Rebuilds the committed analysis fixtures from a real sweep.
 *
 *   npx tsx packages/ui/test/analysis/fixtures/make-fixtures.ts
 *   npx prettier --write "packages/ui/test/analysis/fixtures/*.json"
 *
 * Nothing in `*.json` beside this file is hand-written. Each document is built
 * by `tools/analysis-run.ts` — the same function `npm run analyze` calls — over
 * games `@mtg/sim` actually played on the frozen Tideglass Reach set. That is
 * the whole point: a dashboard tested against invented numbers is a dashboard
 * that has never seen a real under-sampled statistic, and this route exists to
 * render exactly those honestly. It is also why the producer is shared rather
 * than copied: a fixture built by a second implementation tests the second
 * implementation.
 *
 * The set's ability pool now reaches `formatHealth`, and the first thing that
 * bought was a bug. Tideglass Reach carries no activated or triggered ability
 * on any of its 90 cards, so both `abilities.*` gates come back
 * `notApplicable` — a status `model.ts`' `GateStatus` did not have, because no
 * producer had ever emitted one. A document like these four would have been
 * *refused* by `readAnalysisRun` rather than drawn.
 *
 * Four documents, each chosen to exercise a case the route has to survive:
 *
 *  - `run-a.json` — ten color pairs, enough games that most statistics clear
 *    their floors. The ordinary case, and it is `unfair`: one pair sits at
 *    39.7%, just under the 40% floor, which is a real property of this set and
 *    not a number anybody chose for the fixture.
 *  - `run-b.json` — eight pairs, a different seed. Two `balance.pair.*` gates
 *    therefore exist in `run-a` and not here, which is the diff view's hard
 *    case, produced rather than mocked.
 *  - `run-strict.json` — `run-a`'s games scored against a tightened balance
 *    profile, which is how a fixture with genuinely failing gates comes out of
 *    a set that happens to be balanced. Still real metrics output.
 *  - `run-sparse.json` — two games per matchup. Almost everything is under the
 *    floor, so the empty states are tested against real withheld statistics.
 *
 * Determinism: `runRoundRobin` is seeded and `playIndex` is a pure function of
 * (spec, index), so re-running this script reproduces the same bytes.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { COLOR_PAIRS, buildDeckForPair, colorPairKey } from '@mtg/deckbuild';
import type { DeckList } from '@mtg/kernel';
import { greedySpec, runRoundRobin } from '@mtg/sim';
import { metricsConfig } from '@mtg/metrics';
import { deriveSkeletonLite } from '@mtg/design-data';
import { buildAnalysisRun, skeletonTargets } from '../../../tools/analysis-run';

const HERE = fileURLToPath(new URL('.', import.meta.url));
/** The one committed copy of the set, in `@mtg/setgen`'s tree (`mtg-bc2.86`). */
const SET_FIXTURE = fileURLToPath(
  new URL('../../../../setgen/fixtures/sets/tideglass-reach.set.json', import.meta.url),
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

function decksFor(pool: readonly Card[], pairs: number): readonly DeckList[] {
  return COLOR_PAIRS.slice(0, pairs).map((pair) => ({
    name: colorPairKey(pair),
    cards: buildDeckForPair(pool, pair).deck,
  }));
}

interface RunSpec {
  readonly file: string;
  readonly id: string;
  readonly label: string;
  readonly seed: string;
  readonly pairs: number;
  readonly gamesPerMatchup: number;
  /**
   * A tightened metrics profile. Still real `@mtg/metrics` output — the same
   * games scored against a stricter band — and the only way to get a fixture
   * with genuinely failing gates out of a set that happens to be balanced.
   */
  readonly strict?: boolean;
}

const STRICT_CONFIG = metricsConfig({
  balance: { colorPairWinRate: { min: 0.45, max: 0.55 }, maxWinRateSpread: 0.1 },
});

const RUNS: readonly RunSpec[] = [
  {
    file: 'run-a.json',
    id: 'tgr-r1',
    label: 'TGR rev 1',
    seed: 'mtg-ui/analysis/a',
    pairs: 10,
    gamesPerMatchup: 120,
  },
  {
    file: 'run-b.json',
    id: 'tgr-r2',
    label: 'TGR rev 2',
    seed: 'mtg-ui/analysis/b',
    pairs: 8,
    gamesPerMatchup: 120,
  },
  {
    file: 'run-strict.json',
    id: 'tgr-r1-strict',
    label: 'TGR rev 1 (strict profile)',
    seed: 'mtg-ui/analysis/a',
    pairs: 10,
    gamesPerMatchup: 120,
    strict: true,
  },
  {
    file: 'run-sparse.json',
    id: 'tgr-probe',
    label: 'TGR probe',
    seed: 'mtg-ui/analysis/sparse',
    pairs: 10,
    gamesPerMatchup: 2,
  },
];

async function main(): Promise<void> {
  const pool = loadPool();
  const targets = skeletonTargets(deriveSkeletonLite());

  for (const spec of RUNS) {
    const decks = decksFor(pool, spec.pairs);
    const run = await runRoundRobin(decks, {
      runSeed: spec.seed,
      gamesPerMatchup: spec.gamesPerMatchup,
      collectLogs: true,
      botFor: (deck: DeckList) => greedySpec(`greedy:${deck.name}`),
    });
    const document = buildAnalysisRun({
      id: spec.id,
      label: spec.label,
      seed: spec.seed,
      set: { code: 'TGR', name: 'Tideglass Reach' },
      producedBy:
        `packages/ui/test/analysis/fixtures/make-fixtures.ts ` +
        `(${spec.pairs} pairs x ${spec.gamesPerMatchup} games/matchup` +
        `${spec.strict === true ? ', strict profile' : ''})`,
      pool,
      decks,
      logs: run.logs,
      targets,
      healthLabel: `${spec.label} — ${run.games} games`,
      ...(spec.strict === true ? { config: STRICT_CONFIG } : {}),
    });
    writeFileSync(`${HERE}${spec.file}`, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    process.stdout.write(
      `${spec.file}: ${run.games} games, ${document.health.distinctGames} distinct, ` +
        `${document.health.gates.filter((gate) => gate.status === 'fail').length} gates failing, ` +
        `${document.fairness.verdict}, ${run.elapsedMillis}ms\n`,
    );
  }
}

await main();
