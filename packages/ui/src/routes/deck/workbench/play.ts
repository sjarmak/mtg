/**
 * A built variation, reopened against the staged pool so it can be played.
 *
 * This is the whole reason the workbench builds out of staged sets rather than
 * out of the card store. A deck of real printings can be priced, validated and
 * read, and this kernel cannot run one card of it; a deck cut from a staged set
 * is DSL cards throughout, so the same document that explains the deck also
 * deals a game. `@mtg/decklab`'s `pool.ts` carries the map that makes it
 * possible, and this is the page's end of it.
 *
 * # A card the pool no longer holds is refused, not dropped
 *
 * `../saved-decks.ts` states the rule and the reason, and both apply here word
 * for word: sets are regenerated between sessions and card ids do not survive
 * that, so a load that quietly dropped the three cards the staged set no longer
 * prints would hand back a 57-card deck under the name of a 60-card one, and the
 * person would find out by losing a game. So the missing ids come back named,
 * the caller says so on screen, and nothing is dealt.
 *
 * The variation itself is never rewritten by this. It is a record of what was
 * built, against the pool that existed then; a set staged tomorrow does not make
 * it a different deck, it makes it a deck this lab cannot currently deal.
 */
import { BASIC_LAND_COLOR } from '@mtg/dsl';
import type { BasicLandCounts } from '@mtg/deckbuild';
import type { Card, Color } from '@mtg/dsl';
import type { ConstructedBuild } from '../build';
import { emptyBuild } from '../build';
import type { Variation } from './client';

export interface ReopenResult {
  /** The deck, ready to deal. Absent when anything it names is missing. */
  readonly build: ConstructedBuild | null;
  /** Cards the staged pool no longer holds, by the name the variation recorded. */
  readonly missing: readonly string[];
}

/** What to say when a variation names cards the staged sets no longer print. */
export function missingNote(missing: readonly string[]): string {
  return (
    `This deck cannot be dealt: the staged sets no longer hold ${missing.join(', ')}. ` +
    'A set regenerated since this was built prints different card ids. The variation is ' +
    'untouched; rebuild it against the sets staged now.'
  );
}

export function reopenVariation(pool: readonly Card[], variation: Variation): ReopenResult {
  const byId = new Map(pool.map((card) => [card.id, card]));
  const counts: Record<string, number> = {};
  const missing: string[] = [];

  // The counts are written directly rather than through `addCopy`, and the
  // difference is load-bearing: that function caps at the builder's own
  // four-copy limit, and a variation may legitimately hold more — a stated
  // `maxCopies` of 1 makes a singleton deck, and a card reading "any number of
  // cards named" is unbounded. The build the model produced was already checked
  // against the criteria it was given, so re-checking it against a different
  // limit here would silently cut cards the deck was verified with.
  for (const entry of [...variation.spells, ...variation.lands]) {
    if (!byId.has(entry.id)) {
      missing.push(entry.name);
      continue;
    }
    counts[entry.id] = (counts[entry.id] ?? 0) + entry.count;
  }

  // Basics are counted by color rather than by id, because that is the shape the
  // builder's mana base holds and the shape `@mtg/deckbuild` mints them from.
  // A basic the pool does not hold is still not missing: `setBasics` mints one
  // for any set that does not print its own, which is the same function the
  // variation's id came from.
  //
  // The printings are kept beside the counts rather than folded into them
  // (`mtg-ac0h`). Five numbers by color cannot say *which* Plains, and the pool
  // here is the union of every staged set, so the count alone was answered by
  // whichever Plains that union offered first — M11's, on this machine, in a
  // deck built from the flagship set alone. The ids the variation recorded are
  // the answer, and `ConstructedBuild.set` is where the builder already reads
  // one.
  const basics: Partial<Record<Color, number>> = {};
  const printings: Card[] = [];
  for (const basic of variation.basics) {
    const card = byId.get(basic.id);
    const color =
      card?.kind === 'land' && card.basicLandType !== undefined
        ? BASIC_LAND_COLOR[card.basicLandType]
        : basic.color;
    basics[color] = (basics[color] ?? 0) + basic.count;
    if (card !== undefined) printings.push(card);
  }

  if (missing.length > 0) return { build: null, missing };

  const counted: BasicLandCounts | null = Object.keys(basics).length === 0 ? null : basics;
  // A type the variation named no printing for is minted from the set code these
  // carry, which is the recorded deck's set rather than the union's, so the
  // colors that were not recorded land in the same set as the ones that were.
  const set = printings.length === 0 ? null : printings;
  return { build: { ...emptyBuild(pool), counts, basics: counted, set }, missing: [] };
}
