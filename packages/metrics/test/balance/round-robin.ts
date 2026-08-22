/**
 * The seeded mass-simulation the balance gate runs on.
 *
 * Shape follows the the prior project precedent (`the prior-project reuse audit`
 * item 5, metrics report §6.2): fixed seed, one deck per strategy, every pairing
 * played, win-rate bands and a no-dominant-strategy guard asserted as tests.
 * Scaled up from its ten strategies to the ten Limited color pairs the thin
 * slice targets (`decision-synthesis.md` §5: "1,000 seeded games per color-pair
 * matchup x 10 pairs").
 *
 * What is under test, precisely: ten decks built by `@mtg/deckbuild` from a
 * generated set, one per color pair. Both halves of that matter.
 *
 * The pool is a real 90-card generated set rather than `@mtg/dsl`'s
 * `EXAMPLE_CARDS`, because that 16-card demonstration cannot fill 23 spell slots
 * and the gate's previous fixture decks only reached 40 cards by cycling the
 * pool — three and four copies of the same handful of cards. Win rates measured
 * on those decks were a property of the padding, not of the content.
 *
 * The decks come from `buildDeckForPair`, the same function the thin slice
 * calls, so the gate cannot grade cards through a construction path the loop
 * does not use. A measurement-only builder is how a harness ends up reporting
 * on decks nobody would ever play.
 *
 * Which set the pool comes from is an input, not a constant of this module:
 * `subjects.ts` names the sets and `set.ts` loads them. Nothing here reads a
 * path, which is what lets one harness measure the committed fixture and a
 * candidate set identically.
 *
 * The sweep runs across `@mtg/sim`'s reusable worker pool. The pool used to be
 * built and torn down per `runMatch` call, which made 45 short matchups spend
 * more time spawning threads than playing games; `runRoundRobin` keeps one pool
 * warm for the whole sweep instead. `playIndex` is a pure function of (spec,
 * index), so which worker plays which game changes nothing: pooled and serial
 * runs produce identical digests, and the test stays reproducible.
 */
import type { Card } from '@mtg/dsl';
import type { DeckBuildConfigInput } from '@mtg/deckbuild';
import { buildDeckForPair, COLOR_PAIRS, colorPairKey } from '@mtg/deckbuild';
import type { RoundRobinRun } from '@mtg/sim';
import {
  gamesPerMatchupFor,
  greedySpec,
  PINNED_SWEEP_GAMES,
  runRoundRobin as runRoundRobinPooled,
} from '@mtg/sim';
import type { DeckList } from '@mtg/kernel';

export type { RoundRobinRun };

/**
 * The ten two-color Limited archetypes, re-exported from `@mtg/deckbuild`
 * rather than restated here: a second hand-written list is a second thing that
 * can disagree with the builder about what a color pair is.
 */
export { COLOR_PAIRS } from '@mtg/deckbuild';

/**
 * One deck per color pair, built from the given pool.
 *
 * Deck names are the WUBRG color string, because the log exporter derives
 * `main_colors` from the deck's cards and the metrics group on that: naming the
 * deck the same thing keeps the report readable when a run is inspected by hand.
 *
 * A pool too thin to fill a legal Limited deck fails here rather than three
 * hundred lines later as an inexplicable win rate. That check is why a set is
 * measured through this function and not by hand-assembling deck lists.
 */
export function decksFor(
  pool: readonly Card[],
  setLabel: string,
  input: DeckBuildConfigInput = {},
): readonly DeckList[] {
  return COLOR_PAIRS.map((pair) => {
    const key = colorPairKey(pair);
    const result = buildDeckForPair(pool, pair, input);
    if (result.deck.length !== result.config.deckSize) {
      throw new Error(
        `balance gate: on ${setLabel} the ${key} deck has ${result.deck.length} cards, not the ${result.config.deckSize} a legal Limited deck needs`,
      );
    }
    return { name: key, cards: result.deck };
  });
}

export const BALANCE_RUN_SEED = 'mtg-balance/v0';

/**
 * What a sweep collects beyond its outcomes.
 *
 * Both default to what the gate wants, so the gate's call is unchanged and an
 * instrument that wants something else asks for it by name.
 * `packages/metrics/tools/ability-weight-census.ts` is the instrument that does.
 */
export interface SweepOptions {
  /** The replay logs every metric in `@mtg/metrics` reads. On by default. */
  readonly collectLogs?: boolean | undefined;
  /** Per-condition trigger chances and takings on every outcome. Off by default. */
  readonly censusAbilities?: boolean | undefined;
}

/**
 * The pinned volume from `decision-synthesis.md` §5 — 1,000 games per color
 * pair over ten pairs — spread across the 45 unordered matchups those pairs
 * actually produce, so 223 games each and 10,035 in total.
 *
 * The gate ran 120 per matchup until the sim worker pool started being reused
 * across a whole sweep. Measured on this hardware afterwards: the full pinned
 * sweep takes 9.2 s pooled against 37-55 s serial, and serial and pooled agree
 * digest-for-digest, so the volume is no longer worth trading away. Re-measured
 * 2026-08-09 on the regenerated set with the closing bots: 10,035 games in
 * 7.0-10.1 s across five runs (994-1,440 games/s). The spread is machine load,
 * not the sweep — the run is seeded, so every one of those five produced the
 * same numbers.
 *
 * The volume is per subject: two subjects play two sweeps. It is the same
 * number for both, because a subject measured at a lower volume is a subject
 * whose gates abstain, and `underSampled` is not a pass.
 */
export function gamesPerMatchup(): number {
  const raw = process.env['MTG_BALANCE_GAMES'];
  if (raw === undefined) return gamesPerMatchupFor(COLOR_PAIRS.length, PINNED_SWEEP_GAMES);
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`MTG_BALANCE_GAMES must be a positive integer, got ${raw}`);
  }
  return parsed;
}

/**
 * Every unordered pair of decks, once, across a warm worker pool.
 *
 * Seat 0 always holds the alphabetically earlier deck and the play/draw seat
 * alternates inside each matchup, so the on-play measurement is a property of
 * the format rather than of the schedule. Which worker plays which game is a
 * scheduling detail: `playIndex` is a pure function of (spec, index), which is
 * why the pooled aggregate is identical to the serial one.
 *
 * Every subject runs under the same `BALANCE_RUN_SEED`. Two sets measured under
 * two seeds differ by their content and by their dice, and only one of those is
 * a design fact.
 *
 * **How much of a reading is the dice.** `seed` exists so that question can be
 * asked; the gate never passes one and is unaffected. Run
 * `packages/metrics/tools/seed-variance.ts` over a pool to ask it.
 *
 * The quantity is not written here any more, and that is the point of this
 * paragraph. It used to be: a two-line table of per-subject mean, standard
 * deviation and range, measured 2026-08-14 under `mtg-x1s`. Two days later the
 * flagship line was wrong by half — recorded 0.117, actually 0.179 — and nothing
 * anywhere went red, because a docblock is not checked. Worse than merely stale:
 * `src/seed-noise.ts` derived a live constant from those numbers, and later beads
 * quoted the flagship figure as the before-number for changes that had already
 * moved it. A measurement that other things depend on has to be data.
 *
 * So the readings live where something asserts them. Each subject in
 * `subjects.ts` carries the `balance.spread` its baseline was measured against,
 * `spreadDrift` in `baseline.ts` is the check, and `format-health.test.ts` fails
 * when a subject stops reading what was recorded for it. The seed-to-seed
 * deviation of the statistic is `seedDeviation('balance.spread')` in
 * `src/seed-noise.ts`, which is the number `withinNoise` already abstains on, so
 * there is exactly one copy of it.
 *
 * What survives here is the method, which does not go stale. `balance.spread` is
 * a max minus a min over ten win rates, so it inherits the noise of both ends and
 * gains nothing back: it is the noisiest statistic in the report, noisier than
 * any single pair. **Two single-seed spread readings have to differ by about two
 * seed deviations before the difference is anything but dice**, and several
 * deltas argued in `baseline.ts` are smaller than that. The remedy is not a
 * wider bound — the bound is 30% and everything passes it — but reading a
 * one-seed spread as a direction rather than a quantity, and running the
 * variance tool before an attribution rests on one.
 */
export async function runRoundRobin(
  decks: readonly DeckList[],
  games = gamesPerMatchup(),
  seed: string = BALANCE_RUN_SEED,
  options: SweepOptions = {},
): Promise<RoundRobinRun> {
  return runRoundRobinPooled(decks, {
    runSeed: seed,
    gamesPerMatchup: games,
    collectLogs: options.collectLogs ?? true,
    censusAbilities: options.censusAbilities ?? false,
    botFor: (deck) => greedySpec(`greedy:${deck.name}`),
  });
}
