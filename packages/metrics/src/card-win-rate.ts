/**
 * Per-card win-rate-when-drawn, the same statistic on two sources of games:
 * our own seeded self-play, and — since `mtg-1j00i.2` — 17lands' own GAME
 * dataset rows for a printed format they observed.
 *
 * `packages/sim/src/log/schema.ts`'s `cards` field carries their GAME-dataset
 * per-card columns (`deck_`, `drawn_`, `opening_hand_`, `sideboard_`), all
 * `user`-seat-only. "Games in hand" is `opening_hand + drawn`: a card counts
 * once it has been seen, whether it arrived in the opening seven or was drawn
 * later, matching 17lands' own GIH definition. `WinRateGameRow` below is the
 * shape both sources reduce to before touching the shared accumulator, so
 * there is exactly one place this statistic is computed rather than one per
 * source.
 *
 * Two decisions mirror `win-rate.ts`'s color-pair report on purpose, because
 * they are the same statistic at a different grain:
 *
 *  - **Draws are excluded from the denominator.** A turn-cap draw is not half
 *    a win for a card that was in hand for it.
 *  - **The floor is checked against distinct game trajectories,** not raw
 *    counts, for the same reason `colorPairWinRates` does: seeded bots
 *    replaying one line is one sample, not many. A real 17lands row is
 *    already a distinct human game by construction, so its fingerprint
 *    (`draft_id:match_number:game_number`) is never expected to collide —
 *    unlike a seeded bot line, which can.
 *
 * The playtester's 2026-09-20 ruling (`mtg-1j00i`, `dec-h80y`) is what this feeds:
 * a card rating's provenance ladder is 17lands human data where it exists,
 * else our own numbers. `cardWinRatesWhenDrawn` (over `SimGameLog`s) is the
 * "our own numbers" half for a generated set, which 17lands never sees.
 * Worth restating at that call site: these are our bots playing, and our
 * bots are not good players. The number is measured rather than judged,
 * which is the improvement over the evaluator's rank, but it measures a
 * weaker metagame than a human one. `cardWinRatesWhenDrawnFromRows` is the
 * 17lands half, fed by `packages/metrics/tools/ingest-17lands-ktk.ts`.
 */
import type { SimGameLog } from '@mtg/sim';
import type { MetricsConfig } from './config';
import { DEFAULT_METRICS_CONFIG } from './config';
import { gameFacts } from './game';
import type { Sampled } from './sample';
import { countFingerprints, gameFingerprint, sampled } from './sample';
import { share } from './stats';

export interface CardWinRateRecord {
  readonly cardName: string;
  /** Decided games (draws excluded) where the card was in the opening hand or drawn. */
  readonly gamesInHand: number;
  readonly wins: number;
  readonly losses: number;
  readonly winRate: Sampled<number>;
}

/** One card's opening-hand and later-drawn sightings in a single decided game. */
export interface CardHandCounts {
  readonly opening_hand: number;
  readonly drawn: number;
}

/**
 * One decided game, reduced to what `cardWinRatesWhenDrawnFromRows` needs:
 * who won, a fingerprint identifying the game's trajectory (for the
 * distinct-samples floor), and the hand-sighting counts for every card the
 * game actually saw. A `SimGameLog` and a parsed 17lands GAME CSV row both
 * reduce to this.
 */
export interface WinRateGameRow {
  /** Whether the tracked side (our `user` seat, or the 17lands submitter) won. */
  readonly won: boolean;
  readonly fingerprint: string;
  readonly cards: Readonly<Record<string, CardHandCounts>>;
}

interface CardAccumulator {
  cardName: string;
  fingerprints: string[];
  wins: number;
  losses: number;
}

function record(accumulators: Map<string, CardAccumulator>, cardName: string): CardAccumulator {
  const existing = accumulators.get(cardName);
  if (existing !== undefined) return existing;
  const created: CardAccumulator = { cardName, fingerprints: [], wins: 0, losses: 0 };
  accumulators.set(cardName, created);
  return created;
}

function finishRecord(entry: CardAccumulator, config: MetricsConfig): CardWinRateRecord {
  const decided = entry.wins + entry.losses;
  const count = countFingerprints(entry.fingerprints);
  return {
    cardName: entry.cardName,
    gamesInHand: decided,
    wins: entry.wins,
    losses: entry.losses,
    winRate: sampled(count, config.floors.card, () => share(entry.wins, decided)),
  };
}

/**
 * Accumulates `WinRateGameRow`s one at a time rather than over a materialized
 * array, so a caller streaming 200k+ real GAME rows off disk (the KTK ingest)
 * never has to hold them all in memory at once.
 */
export interface CardWinRateAccumulator {
  readonly add: (row: WinRateGameRow) => void;
  readonly finish: (config?: MetricsConfig) => readonly CardWinRateRecord[];
}

export function createCardWinRateAccumulator(): CardWinRateAccumulator {
  const accumulators = new Map<string, CardAccumulator>();
  return {
    add(row) {
      for (const [cardName, stats] of Object.entries(row.cards)) {
        const gamesInHand = stats.opening_hand + stats.drawn;
        if (gamesInHand === 0) continue;
        const entry = record(accumulators, cardName);
        entry.fingerprints.push(row.fingerprint);
        if (row.won) entry.wins += 1;
        else entry.losses += 1;
      }
    },
    finish(config = DEFAULT_METRICS_CONFIG) {
      return [...accumulators.values()]
        .map((entry) => finishRecord(entry, config))
        .sort((a, b) => a.cardName.localeCompare(b.cardName));
    },
  };
}

/** Win rate when a card was in hand, one record per card name seen across `rows`. */
export function cardWinRatesWhenDrawnFromRows(
  rows: Iterable<WinRateGameRow>,
  config: MetricsConfig = DEFAULT_METRICS_CONFIG,
): readonly CardWinRateRecord[] {
  const accumulator = createCardWinRateAccumulator();
  for (const row of rows) accumulator.add(row);
  return accumulator.finish(config);
}

/**
 * Win rate when a card was in hand, one record per card name seen across
 * `logs`. Only the `user` seat's cards are measured — `cards` on `SimGameLog`
 * carries no `oppo` counterpart, matching 17lands' single-submitter GAME
 * dataset.
 */
export function cardWinRatesWhenDrawn(
  logs: readonly SimGameLog[],
  config: MetricsConfig = DEFAULT_METRICS_CONFIG,
): readonly CardWinRateRecord[] {
  function* rows(): Generator<WinRateGameRow> {
    for (const log of logs) {
      const facts = gameFacts(log);
      if (facts.winner === null) continue;
      yield { won: facts.winner === 'user', fingerprint: gameFingerprint(log), cards: log.cards };
    }
  }
  return cardWinRatesWhenDrawnFromRows(rows(), config);
}
