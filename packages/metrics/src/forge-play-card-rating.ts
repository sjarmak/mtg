/**
 * Rung 3 (`docs/adr/0005-rating-provenance-ladder.md`) for a printed format
 * with no rung-1 (17lands) or rung-2 (Forge's own `DraftRankCache`) data:
 * our own measured win rate from Forge bot-play, reduced from a Forge
 * observed-game episode into the same `WinRateGameRow` shape
 * `card-win-rate.ts` already reduces seeded self-play and 17lands GAME rows
 * to, then scaled onto `@mtg/draft-export`'s [0, 5] band the way
 * `sim-card-rating.ts`'s `simCardRatings` scales generated-set self-play.
 *
 * ## Reading a hand from a Forge decision transcript
 *
 * `runForgeObservedPolicyGame` (`@mtg/forge-export`) records one
 * `ForgeObservedPolicyPosition` per decision, masked by `forgePolicyView` so
 * only the candidate seat's own hand is populated — the opponent's `hand` is
 * always `null` (`packages/forge-export/src/observed/policy-observation.ts`).
 * That matches the "measure only the tracked side's cards" convention
 * `card-win-rate.ts` already uses for both its sources.
 *
 * `createCardWinRateAccumulator` only needs *presence* — `gamesInHand` is
 * `opening_hand + drawn`, and a decision transcript has no clean opening-hand
 * cutoff without replaying mulligans — so every name seen in the visible hand
 * at any decision is recorded once, as `drawn: 1`. Exact opening-hand-vs-drawn
 * attribution is not required for the win-rate-when-drawn statistic's
 * correctness, only for the finer 17lands split this format has no data for.
 *
 * ## Fingerprint
 *
 * `card-win-rate.ts`'s floor is checked against *distinct* game trajectories,
 * because seeded self-play can replay one line many times. A real Forge game
 * carries no such risk — the episode id is unique per game by construction
 * (`stageStrengthGameEpisodeId`-style ids, or any caller-assigned unique id) —
 * so the episode id is used as the fingerprint directly rather than hashing
 * the transcript.
 */
import type { JsonValue } from '@mtg/bot-evidence';
import { RATING_MAX, RATING_MIN } from '@mtg/draft-export';
import type { CardWinRateRecord, WinRateGameRow } from './card-win-rate';
import { cardWinRatesWhenDrawnFromRows } from './card-win-rate';
import type { MetricsConfig } from './config';
import { DEFAULT_METRICS_CONFIG } from './config';

/** Same precision as `sim-card-rating.ts`'s. */
const RATING_DECIMALS = 3;

function round(value: number): number {
  const factor = 10 ** RATING_DECIMALS;
  return Math.round(value * factor) / factor;
}

function isRecord(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every card name visible in either seat's hand at this decision (an untracked seat's hand is `null`). */
function handNamesAt(observation: JsonValue): readonly string[] {
  if (!isRecord(observation)) return [];
  const view = observation['view'];
  if (!isRecord(view)) return [];
  const seats = view['seats'];
  if (!Array.isArray(seats)) return [];
  return seats.flatMap((seat) => {
    if (!isRecord(seat)) return [];
    const hand = seat['hand'];
    if (!Array.isArray(hand)) return [];
    return hand.flatMap((card) => {
      if (!isRecord(card)) return [];
      const name = card['name'];
      return typeof name === 'string' && name.trim().length > 0 ? [name] : [];
    });
  });
}

/**
 * The slice of a `BotEvidenceEpisode` this adapter actually reads: a unique
 * episode id and the decision transcript's recorded observations. Narrower
 * than picking from `BotEvidenceEpisode` itself so a caller (and a test) can
 * hand over a plain object without constructing a schema-valid episode.
 */
export interface ForgeGameplayEvidence {
  readonly episode: { readonly id: string };
  readonly decisions: readonly { readonly observation: { readonly value: JsonValue } }[];
}

/**
 * One Forge game, reduced to a `WinRateGameRow`. `null` when the episode's
 * transcript carries no visible hand at all (an episode that failed before
 * its first decision, or whose evidence predates a candidate seat).
 */
export function forgeEpisodeWinRateRow(evidence: ForgeGameplayEvidence, won: boolean): WinRateGameRow | null {
  const names = new Set<string>();
  for (const decision of evidence.decisions) {
    for (const name of handNamesAt(decision.observation.value)) names.add(name);
  }
  if (names.size === 0) return null;
  return {
    won,
    fingerprint: evidence.episode.id,
    cards: Object.fromEntries([...names].map((name) => [name, { opening_hand: 0, drawn: 1 }])),
  };
}

export interface ForgePlayCardRating {
  readonly cardName: string;
  readonly winRate: number;
  /** Min-max scaled onto `@mtg/draft-export`'s [`RATING_MIN`, `RATING_MAX`] band. */
  readonly quality: number;
}

/**
 * Rates every name in `cardNames` that cleared the sample floor in `rows`,
 * min-max scaled onto [`RATING_MIN`, `RATING_MAX`] over the names that did.
 * A name without enough evidence gets no rating at all, matching
 * `simCardRatings` — a card is either measured or unrated, never guessed.
 */
export function forgePlayCardRatings(
  cardNames: readonly string[],
  rows: Iterable<WinRateGameRow>,
  config: MetricsConfig = DEFAULT_METRICS_CONFIG,
): readonly ForgePlayCardRating[] {
  const records: readonly CardWinRateRecord[] = cardWinRatesWhenDrawnFromRows(rows, config);
  const byName = new Map(records.map((entry) => [entry.cardName, entry]));

  const evidenced = cardNames.flatMap((cardName) => {
    const winRate = byName.get(cardName)?.winRate.value ?? null;
    return winRate === null ? [] : [{ cardName, winRate }];
  });
  if (evidenced.length === 0) return [];

  const rates = evidenced.map((entry) => entry.winRate);
  const low = Math.min(...rates);
  const span = Math.max(...rates) - low;
  const midpoint = (RATING_MIN + RATING_MAX) / 2;

  return evidenced.map(({ cardName, winRate }) => ({
    cardName,
    winRate,
    quality:
      span === 0 ? round(midpoint) : round(RATING_MIN + ((winRate - low) / span) * (RATING_MAX - RATING_MIN)),
  }));
}
