/**
 * Self-play win-rate-when-drawn, scaled onto `@mtg/draft-export`'s [0, 5]
 * rating band as `PlayDataRating`s.
 *
 * This is `rateCards`' min-max transform (`packages/draft-export/src/
 * rating.ts`) over a different input: observed win rate in place of
 * `evaluateCard`'s context-free score. It lives here rather than beside
 * `rateCards` because the arrow between the two packages runs one way —
 * `@mtg/metrics` already depends on `@mtg/draft-export` for the legacy-cube
 * calibration lane, and the reverse dependency would be a cycle.
 *
 * Every rating this returns carries `source: 'play-data'`, and its provenance
 * is our own simulator, not 17lands: these are our bots playing, and our bots
 * are not good players. The number is measured rather than judged, which is
 * the improvement over the evaluator's rank, but it measures a weaker
 * metagame than a human one. A card without enough evidence gets no rating at
 * all rather than a noisy one — matching `card-performance.ts`'s "under-
 * sampled cards are nulled, not dimmed" — so callers needing every card rated
 * fall back to `evaluatorRating` for the ones missing here.
 *
 * Lands are excluded, matching `rateCards`: a land's `evaluateCard` score is a
 * sentinel rather than a measurement, and its win-rate-when-drawn is exactly
 * as uninformative — a land is in nearly every kept hand regardless of the
 * set, so its number is closer to the format's baseline win rate than to a
 * judgment of the card.
 */
import type { Card } from '@mtg/dsl';
import { isLand } from '@mtg/dsl';
import type { PlayDataRating } from '@mtg/draft-export';
import { playDataRating, RATING_MAX, RATING_MIN } from '@mtg/draft-export';
import type { SimGameLog } from '@mtg/sim';
import { cardWinRatesWhenDrawn } from './card-win-rate';
import type { MetricsConfig } from './config';
import { DEFAULT_METRICS_CONFIG } from './config';

/** Same precision as `rateCards`', so the emitted rating never implies more than either input carries. */
const RATING_DECIMALS = 3;

function round(value: number): number {
  const factor = 10 ** RATING_DECIMALS;
  return Math.round(value * factor) / factor;
}

/**
 * Rates every non-land card in `cards` that cleared the sample floor in
 * `logs`, min-max scaled onto [0, 5] over the cards that did.
 */
export function simCardRatings(
  cards: readonly Card[],
  logs: readonly SimGameLog[],
  config: MetricsConfig = DEFAULT_METRICS_CONFIG,
): readonly PlayDataRating[] {
  const records = cardWinRatesWhenDrawn(logs, config);
  const byName = new Map(records.map((entry) => [entry.cardName, entry]));

  const evidenced = cards.flatMap((card) => {
    if (isLand(card)) return [];
    const winRate = byName.get(card.name)?.winRate.value ?? null;
    return winRate === null ? [] : [{ card, winRate }];
  });
  if (evidenced.length === 0) return [];

  const rates = evidenced.map((entry) => entry.winRate);
  const low = Math.min(...rates);
  const span = Math.max(...rates) - low;
  const midpoint = (RATING_MIN + RATING_MAX) / 2;

  return evidenced.map(({ card, winRate }) => {
    if (span === 0) return playDataRating(card, winRate, midpoint);
    const share = (winRate - low) / span;
    return playDataRating(card, winRate, round(RATING_MIN + share * (RATING_MAX - RATING_MIN)));
  });
}
