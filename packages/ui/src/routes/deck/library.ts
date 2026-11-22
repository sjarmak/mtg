/**
 * The deck library's shelves: every deck this browser can open, grouped by the
 * set it was cut from, under the Custom/Magic taxonomy.
 *
 * `mtg-tewc.6`. Decks used to be shelved by *what kind of deck* they are —
 * a *Preconstructed* grid over a *My decks* grid — which is the wrong axis for
 * the same reason splitting a deck's cards by card class was: nobody looks for a
 * deck by asking who wrote it, they look for it by asking which set they were
 * playing. Kind is still on the tile, where one deck's provenance belongs, and
 * the shelf is now the set.
 *
 * # Grouping is `../../lab/set-origin.ts`'s, not a second copy of it
 *
 * The taxonomy above the set shelves is the one every set-aware surface draws:
 * `groupSetsByOrigin` puts Custom before Magic, drops an origin with nothing
 * under it, and labels each group — so a lab holding only generated sets shows
 * one heading, and the word *official* never reaches a screen. What this module
 * adds is only the level in between, which is genuinely new: a set holds decks
 * and the picker's rows do not.
 *
 * # A deck whose set is not known is not filed under a guess
 *
 * Three populations arrive without one: a deck saved before the store recorded
 * a set (`./saved-decks.ts` argues why that field is optional rather than a
 * version bump), a deck built on a page opened on a flat set document with no
 * index row behind it, and `@mtg/decklab`'s artifact, which is real printings
 * out of the card store and belongs to no staged set at all. Filing any of them
 * under the set that happens to be staged today would be an invented claim, so
 * they come back separately and the page shelves them under their own heading.
 */
import { groupSetsByOrigin } from '../../lab/set-origin';
import type { SetGroup, SetOrigin } from '../../lab/set-origin';

/** A set, as much of one as a deck list needs to name and file it. */
export interface DeckSetRef {
  readonly name: string;
  readonly origin: SetOrigin;
}

/** What this module reads off a row; everything else on it is the page's. */
export interface ShelvedDeck {
  /** The set the deck was cut from, or `null` when nothing recorded one. */
  readonly set: DeckSetRef | null;
}

/** One set's decks, in the order they were handed over. */
export interface DeckSetShelf<Row> {
  readonly setName: string;
  readonly origin: SetOrigin;
  readonly rows: readonly Row[];
}

export interface DeckShelves<Row> {
  /** The set shelves in their origin groups, `Custom` first, empties dropped. */
  readonly groups: readonly SetGroup<DeckSetShelf<Row>>[];
  /** The decks that name no set, in arrival order. Drawn under their own heading. */
  readonly unplaced: readonly Row[];
}

/**
 * The decks as they are drawn: set shelves inside origin groups, and the ones
 * that name no set kept aside.
 *
 * Set shelves come out in the order their first deck arrived rather than
 * alphabetically, so the staged set — whose written decks the page lists first —
 * is the first shelf under its heading. Alphabetical order would move the set
 * somebody is looking at to wherever its initial falls.
 */
export function shelveDecks<Row extends ShelvedDeck>(rows: readonly Row[]): DeckShelves<Row> {
  const shelves: DeckSetShelf<Row>[] = [];
  const byName = new Map<string, Row[]>();
  const unplaced: Row[] = [];
  for (const row of rows) {
    if (row.set === null) {
      unplaced.push(row);
      continue;
    }
    const held = byName.get(row.set.name);
    if (held === undefined) {
      const own: Row[] = [row];
      byName.set(row.set.name, own);
      shelves.push({ setName: row.set.name, origin: row.set.origin, rows: own });
      continue;
    }
    held.push(row);
  }
  return { groups: groupSetsByOrigin(shelves), unplaced };
}
