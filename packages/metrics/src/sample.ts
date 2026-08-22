/**
 * Sample-size floors, and the sample *illusion* they exist to catch.
 *
 * Two rules, both sourced.
 *
 *  1. Under-sampled statistics are reported as `null`, never asserted on.
 *     17lands does exactly this — their `card_ratings` endpoint returns null
 *     for cards below a sample threshold rather than publishing noise
 *     (`docs/research/prior-art-playability-metrics.md` §2.5, §8 step 7).
 *
 *  2. The floor is checked against *distinct* games, not games played.
 *     Risk §10.7 of the same report: "bot determinism means N games are not N
 *     independent human-like samples". Two seeded games that produced the same
 *     trajectory are one piece of evidence, and a run that replays one line a
 *     thousand times must not read as a thousand samples. `gameFingerprint`
 *     below collapses identical trajectories so the floor sees the real number.
 */
import type { SimGameLog } from '@mtg/sim';

/** Games seen, and how many of them were actually different games. */
export interface SampleCount {
  readonly total: number;
  readonly distinct: number;
}

/**
 * A statistic that knows whether it is allowed to exist.
 *
 * `value` is `null` exactly when `underSampled` is true; consumers gate on the
 * flag and report the counts, which is what makes an under-sampled gate say
 * "no evidence" instead of silently passing.
 */
export interface Sampled<T> {
  readonly value: T | null;
  readonly samples: number;
  readonly distinctSamples: number;
  readonly floor: number;
  readonly underSampled: boolean;
}

export function emptyCount(): SampleCount {
  return { total: 0, distinct: 0 };
}

/** Builds a `Sampled`, skipping the computation entirely when below the floor. */
export function sampled<T>(count: SampleCount, floor: number, compute: () => T): Sampled<T> {
  const underSampled = count.distinct < floor;
  return {
    value: underSampled ? null : compute(),
    samples: count.total,
    distinctSamples: count.distinct,
    floor,
    underSampled,
  };
}

/** A `Sampled` that is under-sampled by construction, for empty groups. */
export function unsampled<T>(floor: number): Sampled<T> {
  return { value: null, samples: 0, distinctSamples: 0, floor, underSampled: true };
}

/**
 * A stable identity for one game's *trajectory*.
 *
 * Deliberately not the seed: two different seeds that produced move-for-move
 * the same game are the same evidence. The fingerprint covers the outcome, the
 * shape (length, who was on the play, both decks), the per-game totals, and the
 * per-turn life and board trace — enough that two games sharing it differed in
 * nothing this package measures.
 */
export function gameFingerprint(log: SimGameLog): string {
  const parts: string[] = [
    log.metadata.main_colors,
    log.metadata.opp_colors,
    String(log.metadata.on_play),
    String(log.metadata.num_turns),
    String(log.extras.sim_winner),
    log.extras.sim_end_reason,
  ];
  for (const side of ['user', 'oppo'] as const) {
    const totals = log.totals[side];
    parts.push(
      [
        totals.cards_drawn,
        totals.cards_discarded,
        totals.lands_played,
        totals.creatures_cast,
        totals.non_creatures_cast,
        totals.instants_sorceries_cast,
        totals.mana_spent,
      ].join('.'),
    );
  }
  for (const record of log.turns) {
    parts.push(
      [
        record.turn,
        record.owner,
        record.lands_played,
        record.creatures_cast,
        record.non_creatures_cast,
        record.creatures_attacked,
        record.creatures_blocked,
        record.user.eot_life,
        record.oppo.eot_life,
        record.user.eot_creatures_in_play,
        record.oppo.eot_creatures_in_play,
        record.user.eot_lands_in_play,
        record.oppo.eot_lands_in_play,
      ].join('.'),
    );
  }
  return parts.join('|');
}

/** Counts a group of games, collapsing repeated trajectories. */
export function countGames(logs: readonly SimGameLog[]): SampleCount {
  const seen = new Set<string>();
  for (const log of logs) seen.add(gameFingerprint(log));
  return { total: logs.length, distinct: seen.size };
}

/** Counts pre-fingerprinted games; used when a caller groups games itself. */
export function countFingerprints(fingerprints: readonly string[]): SampleCount {
  return { total: fingerprints.length, distinct: new Set(fingerprints).size };
}

/**
 * Share of games in a group that duplicated another game's trajectory.
 *
 * A high number does not invalidate a run, but it does mean the confidence
 * intervals are lies, so it is surfaced at the top of every report.
 */
export function duplicateShare(count: SampleCount): number {
  if (count.total === 0) return 0;
  return (count.total - count.distinct) / count.total;
}
