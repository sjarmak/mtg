/**
 * The known-red baselines the gate measures against.
 *
 * The balance gate blocks CI. That is only tolerable if the gates that are
 * already red for known reasons are listed here rather than suppressed
 * wholesale, because a blanket `continue-on-error` cannot tell a pre-existing
 * content problem from a regression someone introduced this morning.
 *
 * A waiver list belongs to one set, not to the harness: "UR sits at 38%" is a
 * statement about a card pool, and carrying it over to a second pool would
 * excuse a failure nobody measured. So each subject in `subjects.ts` names its
 * own list, and a set handed to the gate through `MTG_BALANCE_SET` gets none,
 * which is the strictest setting available.
 *
 * The list is a ratchet, not an amnesty. Four things fail the build:
 *   - a gate fails that is NOT waived for that subject (a real regression),
 *   - a gate abstains inside the seed noise that is NOT waived for that subject
 *     (the pinned run could not answer and nobody has recorded why),
 *   - a waived gate starts passing (the waiver is stale; delete the entry),
 *   - a waived gate's value drifts beyond DRIFT_TOLERANCE (the content or the
 *     bots changed materially and the baseline needs re-measuring).
 *
 * **An entry covers a fail or an abstention, and the second arm is the one that
 * had to be argued for.** `withinNoise` arrived after this file did, and the
 * pinned suite failed on any abstention at all — which reads as an invariant and
 * is really a premise: that 10,035 games resolves every bound for every pool. A
 * content edit can falsify that premise without touching the harness, and one
 * did. Two things follow. An abstention is the one non-pass status that **cannot
 * be bought with more games** (`7c02dc2` says so from the other side), so a
 * subject sitting on a bound has no run it can buy to become green. And the
 * verdict was **non-monotone**: a pair missing its floor by 2.1pp was a `fail`,
 * waivable with a number and a bead, while the same pair improving to a 0.7pp
 * miss became an abstention with no channel to record anything at all. A gate
 * that gets harder to satisfy as the set gets better is measuring the wrong
 * thing. So an abstention is declared here on exactly the terms a failure is,
 * and `unwaivedAbstentions` below is what the suite reads.
 *
 * **The prototype set's list carries one entry, and it is the one kind of entry
 * that is not a measurement.** It was emptied by measurement and stayed empty
 * for ten days; what put an entry back on 2026-08-19 was the playtester retiring the
 * subject as a set anybody would tune again, which is a decision and is recorded
 * as one. The emptying is still the more useful half of the record, because it
 * is what the list is for. Re-measured 2026-08-09 at the pinned volume from
 * `decision-synthesis.md` §5 — 45 matchups x 223 games, 10,035 games, seed
 * `mtg-balance/v0` — after two changes landed together:
 *
 *   - `mtg-bc2.35` (bots): the greedy v0 bots learned to close. The long-tail,
 *     stall and decided gates were waived because neither bot pressed an
 *     advantage; on the unchanged fixture set the same sweep now reads
 *     longTail 0.015, stall 0.001, decided 0.991 against the waived 0.177,
 *     0.081, 0.846.
 *   - `mtg-bc2.36` (set generation): the archetype reservation pass replaced
 *     the fixture set. Every color pair is now inside the 40-70% band —
 *     UR 0.421 and WU 0.440 were the two that were not — and the spread fell
 *     from 0.304 to 0.136.
 *
 * On the two together the three game-shape gates read longTail 0.083, stall
 * 0.010, decided 0.944. The regenerated set plays longer than the old one under
 * the same bots (0.015 to 0.083 on the long tail), which is worth watching: the
 * margin under the 15% bound is real but smaller than the bot change alone
 * suggests, so a future content change that lengthens games again is the most
 * likely way this gate comes back.
 *
 * With an empty list the ratchet is at its strictest setting: every gate the
 * report emits has to pass, a failure and an abstention block alike, and
 * `expectNoUnwaivedFailures` and the abstention test in the suite are what
 * enforce it. Adding an entry back is a deliberate act that costs a bead and a
 * measured number, which is the point.
 *
 * The run is seeded and deterministic, so re-running unchanged code reproduces
 * these numbers exactly; any movement means something real changed.
 */

import type { GateResult } from '@mtg/metrics';

export interface WaivedGate {
  /** Gate id, exactly as `formatHealth` emits it. */
  readonly gate: string;
  /**
   * The value the pinned run produced when this waiver was written.
   *
   * The pinned sweep is seeded, so this is exact and the drift check below
   * compares against it byte for byte. For an abstention it is still the pinned
   * seed's own reading, not a multi-seed mean: the drift check reads
   * `gate.observed`, and a mean the gate never computes could not be compared
   * with anything. The mean belongs in `why`, where the argument is.
   */
  readonly measured: number;
  /** The bead tracking the underlying problem. */
  readonly bead: string;
  /**
   * Why this is content or bot behavior rather than a harness defect — and, for
   * an abstention, the measurement that says which of the three causes it is:
   * the volume, the bound, or a subject sitting on the bound.
   */
  readonly why: string;
}

/**
 * Seeded runs are exact, so this only has to absorb genuine change. Anything
 * beyond two percentage points is a signal, not noise.
 *
 * Two points is about twice the largest per-pair seed deviation anybody has
 * measured on either committed pool — 1.10pp and 0.95pp across eight seeds,
 * `packages/metrics/tools/seed-variance.ts` — which is the right order for a
 * number that never has to absorb a re-seed at all. The gate holds one seed, so
 * a waived gate's observation only moves when the content or the bots move, and
 * what this tolerance buys is the difference between a card edit nudging a
 * waived pair and a card edit relocating it.
 */
export const DRIFT_TOLERANCE = 0.02;

/**
 * One entry, and it is a decision rather than a measurement — the only kind of
 * entry this file admits without a diagnosis behind it, and it says so in its
 * own `why`. See the header: the two causes that put the previous six entries
 * here — bots that never closed (`mtg-bc2.35`) and a set with two unarmed blue
 * archetypes (`mtg-bc2.36`) — were both fixed by measurement, which is the
 * ordinary route and the one to try first.
 *
 * A new entry needs all four fields filled honestly: the gate id exactly as the
 * report prints it, the value a real run produced, the bead tracking the
 * underlying problem, and a reason that identifies it as content or bot
 * behavior. A gate that used to pass and now fails is a regression to fix, not
 * a waiver to write.
 */
export const TIDEGLASS_REACH_WAIVERS: readonly WaivedGate[] = [
  {
    gate: 'balance.pair.WU',
    measured: 0.394,
    bead: 'mtg-w6r4',
    why:
      "The owner's decision rather than a measurement, and the entry says so outright. The pinned " +
      'seed reads 788W-1211L-8D = 39.4% [95% CI 37.3%-41.6%], which misses the 40% floor by 0.006 ' +
      'and sits inside the 0.020 this statistic moves on the seed alone over 10,035 games, so the ' +
      'gate abstains and one abstention takes the whole run to not-judged. That is the third of the ' +
      'three causes the field above asks to be distinguished: a subject sitting on the bound, not ' +
      'the volume and not the bound itself. What settles it is that this subject is the prototype ' +
      'built before the flagship existed - nothing ships from it, and the playtester retired it on ' +
      "2026-08-19 with 'don't worry about the old prototype at all.' It stays a subject because it " +
      'is the deckbuild control: a builder change that breaks a 75-card pool and not a 281-card one ' +
      'is visible only while both are measured. So the pair is waived on a decision not to tune this ' +
      'set again, and the drift check still holds the reading at 0.394 - a card or bot change that ' +
      'relocates this pair fails here rather than passing quietly under the waiver.',
  },
];

/**
 * The `balance.spread` reading a subject's baseline was measured against.
 *
 * A waiver records what a *red* gate reads and the drift check holds it there.
 * Nothing held a *passing* gate, and `balance.spread` is the one where that gap
 * costs the most: it is the whole-format statistic the per-pair numbers are
 * argued against, its band is 30% so nearly anything passes it, and it gets
 * quoted out of this package into beads and briefs as a before-number. Green,
 * load-bearing and unasserted is the exact recipe for a figure that ages without
 * anyone finding out.
 *
 * It aged that way. `round-robin.ts` recorded the flagship at 0.117 on
 * 2026-08-14 as prose; the same sweep over the same fixture path read 0.179 on
 * 2026-08-16. Nothing went red at any point in between, because prose is not
 * checked, and the stale figure was cited in later beads as the before-number
 * for changes that had already moved it.
 *
 * So the reading becomes data the harness asserts. The pin is the subject of the
 * assertion rather than a value smuggled into one: the claim is not "the spread
 * is 0.179", it is "the reading recorded here still describes this tree". That
 * makes a re-pin the correct response to a legitimate move, which is the honest
 * cost of doing this — an assertion nobody may update is a bound, and this is
 * not a bound, the band in `src/config.ts` is. What stops a reflex re-pin is
 * `why`: it has to name what moved, and a re-pin whose `why` still describes the
 * previous tree is visible in review in a way that editing a numeral is not.
 */
export interface RecordedSpread {
  /** `balance.spread` under `BALANCE_RUN_SEED` — the seed the gate pins. */
  readonly measured: number;
  /** ISO date of the run that produced it. */
  readonly when: string;
  /** What the tree was, and what a re-pin has to explain having moved. */
  readonly why: string;
}

/**
 * Has the recorded reading stopped describing this tree.
 *
 * `DRIFT_TOLERANCE` is the right width here and no second constant is needed.
 * The gate pins its seed, so a fixed tree reproduces this number exactly and the
 * dice are not in the error bar at all — seed variance is what makes a *cross-
 * seed* comparison unreadable, and this is not one. What the tolerance absorbs
 * is content and bot movement, which is the same quantity the waiver drift check
 * absorbs, at the same width, for the same reason.
 *
 * The message names both causes because a constant twenty lines away tells them
 * apart: a red spread beside a green `THE_FLAGSHIP_SET_POOL_SHA256` means the
 * engine or the builder moved it and not the cards. That distinction is the
 * whole reason this is worth asserting — the 2026-08-14 to 2026-08-16 move was
 * both, and prose recorded neither.
 */
export function spreadDrift(recorded: RecordedSpread, gate: GateResult): string | null {
  if (gate.observed === null) {
    return `${gate.id} recorded ${recorded.measured.toFixed(4)} on ${recorded.when} but reports no reading now (status ${gate.status})`;
  }
  const delta = Math.abs(gate.observed - recorded.measured);
  if (delta <= DRIFT_TOLERANCE) return null;
  return (
    `${gate.id} reads ${gate.observed.toFixed(4)}, ${delta.toFixed(4)} from the ${recorded.measured.toFixed(4)} recorded on ${recorded.when}, ` +
    `past the ${DRIFT_TOLERANCE.toFixed(2)} tolerance. Either the pool moved or the engine or the builder did; a green pool digest ` +
    `beside this failure means it was not the cards. Re-measure, then re-pin measured, when and why together — a new number under an ` +
    `old reason is the drift this check exists to catch.`
  );
}

/** A subject with no measured baseline waives nothing. */
export const NO_WAIVERS: readonly WaivedGate[] = [];

export function waiverFor(waivers: readonly WaivedGate[], gate: string): WaivedGate | undefined {
  return waivers.find((waiver) => waiver.gate === gate);
}

export function isWaived(waivers: readonly WaivedGate[], gate: string): boolean {
  return waiverFor(waivers, gate) !== undefined;
}

function unwaivedWithStatus(
  waivers: readonly WaivedGate[],
  gates: readonly GateResult[],
  status: GateResult['status'],
): readonly GateResult[] {
  return gates.filter((gate) => gate.status === status && !isWaived(waivers, gate.id));
}

/**
 * The gate's own verdict, in one place: a red gate this subject does not waive.
 * The suite asserts this list is empty and the broken-set proof asserts it is
 * not, so both are talking about the same predicate rather than two similar
 * filters that could drift apart.
 */
export function unwaivedFailures(
  waivers: readonly WaivedGate[],
  gates: readonly GateResult[],
): readonly GateResult[] {
  return unwaivedWithStatus(waivers, gates, 'fail');
}

/**
 * The other blocking verdict: a gate that declined to answer and that this
 * subject has not declared it expects to decline.
 *
 * An abstention is not a softer failure, and this is not a courtesy channel for
 * one. `withinNoise` means the miss is smaller than the amount the statistic
 * moves on the seed alone, so the run has no opinion about the bound — and
 * unlike `underSampled`, the one status you can answer by buying games, it
 * cannot be bought at all: `scaledSeedDeviation` scales the noise floor up for
 * thin runs and never down for fat ones. A subject whose true rate sits on a
 * bound therefore has no volume that turns it green, and blocking on any
 * abstention at all quietly asserts the opposite — that the pinned volume
 * resolves every bound for every pool, which is a property of the pool relative
 * to its band and not of the harness.
 *
 * Sharing `unwaivedWithStatus` with `unwaivedFailures` is the point rather than
 * a tidiness move: the two arms have to agree on what "this subject waived it"
 * means, and a second `isWaived` call written out by hand is where they would
 * stop agreeing.
 */
export function unwaivedAbstentions(
  waivers: readonly WaivedGate[],
  gates: readonly GateResult[],
): readonly GateResult[] {
  return unwaivedWithStatus(waivers, gates, 'withinNoise');
}
