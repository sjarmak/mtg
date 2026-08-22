/**
 * What a pane holds, in the three counts a deck builder reads first.
 *
 * `references/mtgo+interface+(1)-3169202701.png` writes `Lands: 24  Creatures:
 * 17  Other: 19` in the Main Deck's own header bar, beside the count in its
 * title, and the three sum to that count. `mtg-o5z1` asks for the same line.
 * Every artifact entry already carries the printed `typeLine`, so this is
 * derived from what the page holds — no schema field, no model, no second
 * source that could disagree with the tiles underneath it.
 *
 * # Why there is no list of card types
 *
 * The obvious shape is a bucket per card type — creature, instant, sorcery,
 * artifact, enchantment, planeswalker, battle — and it rots the day Magic prints
 * an eighth: the new card falls into no bucket, the three numbers stop summing
 * to the count in the pane's own title, and nothing on the page says so. So the
 * partition is two named tests and a complement. `Other` is defined as what the
 * first two did not take, which makes the sum an identity rather than a
 * coincidence, and a type nobody has printed yet is counted truthfully on the
 * day it exists.
 *
 * # A land that is also a creature is counted as a land
 *
 * The two tests overlap on the few printings that are both, so an order has to
 * be chosen rather than left to whichever `if` came first. Land wins, because
 * the number exists to answer "does this deck have enough lands" and a permanent
 * that taps for mana answers that question whatever else it does. Counting it as
 * a creature understates the mana base, and that is the one of the two errors a
 * reader cannot recover from the rest of the page.
 */
import type { DeckArtifactEntry } from '../../lab/deck-artifact';

export interface DeckTypeCounts {
  readonly lands: number;
  readonly creatures: number;
  /** Everything the other two did not take. See the docblock. */
  readonly other: number;
}

// Word-bounded rather than a substring: `Land` has to be a type on the line and
// not the tail of a creature type. The em dash a printed type line uses to
// separate types from subtypes is surrounded by spaces, so it is a boundary too.
const LAND = /(?:^|\s)Land(?:\s|$)/u;
const CREATURE = /(?:^|\s)Creature(?:\s|$)/u;

/** Cards, not entries: a four-of contributes four, as everywhere else on the page. */
export function deckTypeCounts(entries: readonly DeckArtifactEntry[]): DeckTypeCounts {
  return entries.reduce<DeckTypeCounts>(
    (counts, entry) => {
      if (LAND.test(entry.typeLine)) return { ...counts, lands: counts.lands + entry.count };
      if (CREATURE.test(entry.typeLine)) return { ...counts, creatures: counts.creatures + entry.count };
      return { ...counts, other: counts.other + entry.count };
    },
    { lands: 0, creatures: 0, other: 0 },
  );
}

/**
 * The line as the header prints it, empty buckets left out.
 *
 * `Other: 0` on a pane of nothing but lands is a bucket that is not there rather
 * than a fact about the deck, and the pane's own title already carries the total
 * the printed numbers sum to. A pane holding nothing gets the empty string, and
 * its header draws no note at all — what an empty pane has to say is said in its
 * body instead.
 */
export function typeCountsLine(counts: DeckTypeCounts): string {
  return (
    [
      ['Lands', counts.lands],
      ['Creatures', counts.creatures],
      ['Other', counts.other],
    ] as const
  )
    .filter(([, cards]) => cards > 0)
    .map(([label, cards]) => `${label}: ${String(cards)}`)
    .join(' · ');
}
