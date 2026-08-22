/**
 * Stage 2 — the generated set becomes ten playable decks.
 *
 * One deck per two-color Limited archetype, because the metrics the loop ends
 * on are per-color-pair. `buildDeckForPair` forces the pair and verifies the
 * builder honored it, since a builder that silently chose a different pair
 * would mislabel every win rate downstream. The balance gate builds its decks
 * through the same function, so the loop and the gate cannot drift apart.
 *
 * Curve shortfalls are reported, not fatal: a 90-card slice set has 17 cards
 * per color, so some buckets are genuinely unfillable. A missing *spell slot*
 * or a deck that is not 40 cards is fatal — that is a deck nobody can play.
 */
import type { Card } from '@mtg/dsl';
import type { ColorPair, DeckBuildResult, Shortfall } from '@mtg/deckbuild';
import { COLOR_PAIRS, buildDeckForPair, colorPairKey, formatDeckReport } from '@mtg/deckbuild';
import type { DeckList } from '@mtg/kernel';
import { failStage } from '../errors';

export interface SliceDeck {
  readonly key: string;
  readonly pair: ColorPair;
  readonly deck: DeckList;
  readonly creatureCount: number;
  readonly removalCount: number;
  readonly massTwoToFour: number;
  readonly complete: boolean;
  readonly shortfalls: readonly Shortfall[];
  readonly report: string;
}

export interface DeckStageResult {
  readonly decks: readonly SliceDeck[];
  /** Decks that met every target, including the curve. */
  readonly completeDecks: number;
}

const FATAL_SHORTFALLS: ReadonlySet<Shortfall['kind']> = new Set(['spellSlots', 'creatureFloor']);

function buildOne(pool: readonly Card[], pair: ColorPair): SliceDeck {
  const key = colorPairKey(pair);

  let result: DeckBuildResult;
  try {
    result = buildDeckForPair(pool, pair);
  } catch (error: unknown) {
    failStage('deckbuild', `building the ${key} deck failed`, error);
  }

  if (result.deck.length !== result.config.deckSize) {
    failStage(
      'deckbuild',
      `the ${key} deck has ${result.deck.length} cards, not the ${result.config.deckSize} a legal Limited deck needs`,
    );
  }
  const fatal = result.shortfalls.filter((shortfall) => FATAL_SHORTFALLS.has(shortfall.kind));
  if (fatal.length > 0) {
    failStage(
      'deckbuild',
      `the ${key} deck is short of playables: ${fatal.map((item) => `${item.kind} missing ${item.missing}`).join(', ')}`,
    );
  }

  return {
    key,
    pair,
    deck: { name: key, cards: result.deck },
    creatureCount: result.creatureCount,
    removalCount: result.removalCount,
    massTwoToFour: result.curve.massTwoToFour,
    complete: result.complete,
    shortfalls: result.shortfalls,
    report: formatDeckReport(result),
  };
}

export function runDeckStage(cards: readonly Card[]): DeckStageResult {
  if (cards.length === 0) failStage('deckbuild', 'the set is empty; there is no pool to build from');
  const decks = COLOR_PAIRS.map((pair) => buildOne(cards, pair));
  return { decks, completeDecks: decks.filter((entry) => entry.complete).length };
}
