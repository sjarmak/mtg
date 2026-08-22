/**
 * The ten color-pair decks the benchmarks play.
 *
 * They are built by `buildDeckForPair` from a generated set on disk — the same
 * function and, by default, the same frozen set the balance gate measures. That
 * is the whole point: a throughput number taken on synthetic decks over the
 * DSL's sixteen example cards would be measuring a different game. The gate's
 * decks run materially slower per game than fixture decks do, so a benchmark
 * that used fixture decks would over-report the sweep's speed.
 *
 * This is why `@mtg/sim` depends on `@mtg/deckbuild`: only the benchmarks use
 * it, and only so the published wall clock is the wall clock of the real
 * corpus rather than of a stand-in.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { buildDeckForPair, COLOR_PAIRS, colorPairKey } from '@mtg/deckbuild';
import type { DeckList } from '@mtg/kernel';

/**
 * The balance gate's frozen corpus, at its one committed home in `@mtg/setgen`
 * (`mtg-bc2.86`). Reached by path rather than by import because it is a fixture
 * file: benchmarks read it, nothing here depends on the generator's code.
 */
export const DEFAULT_SET_PATH = fileURLToPath(
  new URL('../../setgen/fixtures/sets/tideglass-reach.set.json', import.meta.url),
);

export interface BenchSet {
  readonly pool: readonly Card[];
  readonly label: string;
  readonly path: string;
}

export function loadSet(path: string): BenchSet {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error: unknown) {
    throw new Error(`cannot read the set at ${path}: ${String(error)}`);
  }
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== 'object' || raw === null || !('cards' in raw)) {
    throw new Error(`${path} has no "cards" array; pass --set <generated set json>`);
  }
  const { cards, set } = raw as { cards: unknown; set?: { code?: unknown; name?: unknown } };
  if (!Array.isArray(cards) || cards.length === 0) {
    throw new Error(`${path} has an empty "cards" array`);
  }
  const pool = cards.map((card) => parseCard(card));
  const code = typeof set?.code === 'string' ? set.code : 'unknown set';
  const name = typeof set?.name === 'string' ? ` ${set.name}` : '';
  return { pool, label: `${code}${name} (${pool.length} cards)`, path };
}

/** One deck per two-color Limited archetype, named by its WUBRG pair key. */
export function buildBenchDecks(pool: readonly Card[]): readonly DeckList[] {
  return COLOR_PAIRS.map((pair) => {
    const key = colorPairKey(pair);
    const result = buildDeckForPair(pool, pair);
    if (result.deck.length !== result.config.deckSize) {
      throw new Error(
        `the ${key} deck has ${result.deck.length} cards, not the ${result.config.deckSize} a legal Limited deck needs`,
      );
    }
    return { name: key, cards: result.deck };
  });
}
