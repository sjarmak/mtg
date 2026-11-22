/**
 * Editing a built deck inside the document it was written as, and the numbers
 * that follow the edit.
 *
 * `mtg-ipse`. A built `@mtg/decklab` artifact used to open read-only, and
 * `./saved-decks.ts` says why the obvious route out is shut: an artifact entry
 * keys a card by **name**, because a Scryfall printing has no id this page can
 * resolve, while `./build.ts`'s build is counts by DSL card **id** resolved
 * against the staged set's pool. There is no pool an artifact deck's cards are
 * members of, so seeding the Constructed editor from one has nothing to seed
 * against.
 *
 * The way past that is to stop looking for a pool. MTGO picks a deck's pool by
 * where the deck came from and never makes a deck read-only for want of one --
 * a list arriving from outside shelves beside every other deck, editable, its
 * cards at quantity zero -- and the shipped artifact carries `count`,
 * `manaCost`, `manaValue`, `typeLine`, `colorIdentity` and `priceUsd` per entry.
 * So cutting a card, changing a count, putting a cut card back and moving the
 * basics are **arithmetic over fields already in the file**. This module is that
 * arithmetic and nothing else: no store, no network, no pool.
 *
 * # What an edit is
 *
 * A count per entry name, and only where it differs from the built one. Keying
 * by name is safe *within a pane* -- a card is in exactly one of `spells`,
 * `lands` and `basics` -- and is deliberately not safe across them, which is why
 * a sideboard that reprints a main-deck card carries its own edit rather than
 * sharing this one. An entry back at the count the build chose leaves the map
 * entirely, so `isEdited` is an exact statement rather than a high-water mark:
 * cut a card and put it back and the deck is the built deck again, in the
 * screen's words as well as in its numbers.
 *
 * # The ceiling is the game's rule, not the build's criteria
 *
 * A nonbasic stops at `CONSTRUCTED_COPY_LIMIT`; a basic has no ceiling, which is
 * the rule for a card with the basic supertype and the reason moving the mana
 * base is a move at all. The deck's own criteria are **not** re-enforced: a
 * singleton build states its copy limit in a sentence a person wrote, and
 * reading intent out of that sentence is exactly the keyword-matching this
 * codebase delegates to a model rather than encodes. The criteria stay frozen
 * evidence of the build (`./DeckFacts.ts`), and the ceiling here is the one rule
 * the format states for everybody. A built count already above the ceiling keeps
 * its own count as the ceiling, because an edit surface may not force a cut
 * nobody asked for.
 *
 * # The recomputation is the artifact's own
 *
 * Every figure below is computed the way `@mtg/decklab` computed the one in the
 * file: the price is `(priceUsd ?? 0) * count` over the spells and the nonbasic
 * lands (a basic is unpriced and contributes nothing, which is `deckPrice`'s own
 * rule), the curve is over the **spells** alone, and the card count is the whole
 * main deck. `../../../test/deck/artifact-edit.test.ts` holds that seam shut by
 * asserting the recomputation reproduces `totalCards`, `priceUsd` and the whole
 * curve on the unedited deck, to the digit. Two different numbers for one deck
 * with nothing to say which is wrong is the failure that test exists to prevent.
 */
import { COLORS } from '@mtg/dsl';
import type { Color } from '@mtg/dsl';
import { CONSTRUCTED_COPY_LIMIT, curveBucket, emptyCurveHistogram } from '@mtg/deckbuild';
import type { CurveBucket, CurveHistogram } from '@mtg/deckbuild';
import type { DeckArtifact, DeckArtifactEntry } from '../../lab/deck-artifact';

/** Counts by entry name, holding only the entries whose count has moved. */
export type DeckEdit = ReadonlyMap<string, number>;

/** The deck as it was built: nothing edited. */
export const BUILT_DECK: DeckEdit = new Map<string, number>();

/**
 * The most copies of this entry an edit may reach, or `null` for no ceiling.
 *
 * A basic land has none: `Basic` is a supertype and the game's copy limit does
 * not apply to it, which is what makes apportioning the mana base an edit rather
 * than a special case. Everything else stops at the constructed limit or at its
 * own built count, whichever is higher.
 */
export function copyCeiling(entry: DeckArtifactEntry): number | null {
  if (/^Basic\b/.test(entry.typeLine)) return null;
  return Math.max(CONSTRUCTED_COPY_LIMIT, entry.count);
}

/** How many copies of this entry the deck holds now: the edit's, or the build's. */
export function entryCount(edit: DeckEdit, entry: DeckArtifactEntry): number {
  return edit.get(entry.name) ?? entry.count;
}

/**
 * The edit with one entry at a new count, clamped to what the ceiling allows.
 *
 * Clamped rather than refused because the callers are a `+` and a `-` button
 * that are already dark at the limits; a count arriving out of range is a bug in
 * this file's own callers, and landing on the limit is the repair a person would
 * make. Zero is a cut and is a real count: the card leaves the pane and shows up
 * in what can be put back.
 */
export function withEntryCount(edit: DeckEdit, entry: DeckArtifactEntry, count: number): DeckEdit {
  const ceiling = copyCeiling(entry);
  const clamped = Math.max(0, ceiling === null ? count : Math.min(count, ceiling));
  const next = new Map(edit);
  if (clamped === entry.count) next.delete(entry.name);
  else next.set(entry.name, clamped);
  return next;
}

/** Whether anything on screen differs from the deck the artifact records. */
export function isEdited(edit: DeckEdit): boolean {
  return edit.size > 0;
}

/** The deck as it stands: built entries at their edited counts, cuts dropped. */
export function editedEntries(
  entries: readonly DeckArtifactEntry[],
  edit: DeckEdit,
): readonly DeckArtifactEntry[] {
  return entries
    .map((entry) => ({ ...entry, count: entryCount(edit, entry) }))
    .filter((entry) => entry.count > 0);
}

/**
 * The entries cut to nothing, at the counts the build chose for them.
 *
 * They keep their built counts rather than a zero, because that is what putting
 * one back restores and what the row on screen has to be able to say.
 */
export function cutEntries(
  entries: readonly DeckArtifactEntry[],
  edit: DeckEdit,
): readonly DeckArtifactEntry[] {
  return entries.filter((entry) => entryCount(edit, entry) === 0);
}

/** How many cards of one color the deck plays, counted by color identity. */
export interface ColorSpread {
  readonly color: Color;
  readonly cards: number;
}

/** Every number on the deck's own line, recomputed from the entries on screen. */
export interface DeckFactsValue {
  readonly cards: number;
  readonly priceUsd: number;
  readonly histogram: CurveHistogram;
  readonly averageManaValue: number;
  /** One row per color some card in the deck carries. A color nobody plays is absent. */
  readonly colors: readonly ColorSpread[];
}

function totalOf(entries: readonly DeckArtifactEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.count, 0);
}

function priceOf(entries: readonly DeckArtifactEntry[]): number {
  return entries.reduce((sum, entry) => sum + (entry.priceUsd ?? 0) * entry.count, 0);
}

function curveOf(spells: readonly DeckArtifactEntry[]): {
  readonly histogram: CurveHistogram;
  readonly averageManaValue: number;
} {
  const histogram = emptyCurveHistogram();
  let total = 0;
  let cards = 0;
  for (const entry of spells) {
    const bucket: CurveBucket = curveBucket(entry.manaValue);
    histogram[bucket] += entry.count;
    total += entry.manaValue * entry.count;
    cards += entry.count;
  }
  return { histogram, averageManaValue: cards === 0 ? 0 : total / cards };
}

function spreadOf(entries: readonly DeckArtifactEntry[]): readonly ColorSpread[] {
  return COLORS.map((color) => ({
    color,
    cards: totalOf(entries.filter((entry) => entry.colorIdentity.includes(color))),
  })).filter((spread) => spread.cards > 0);
}

/**
 * The deck's live figures under an edit of its main deck.
 *
 * The main deck is what every one of these describes in the built document —
 * `totalCards`, `priceUsd` and `curve` are all written over the spells, the
 * nonbasic lands and the basics, with the sideboard outside all three — so the
 * sideboard's own edit moves the count in its pane's heading and nothing here.
 */
export function deckFacts(deck: DeckArtifact, edit: DeckEdit): DeckFactsValue {
  const spells = editedEntries(deck.spells, edit);
  const main = [...spells, ...editedEntries(deck.lands, edit), ...editedEntries(deck.basics, edit)];
  const curve = curveOf(spells);
  return {
    cards: totalOf(main),
    priceUsd: priceOf(main),
    histogram: curve.histogram,
    averageManaValue: curve.averageManaValue,
    colors: spreadOf(main),
  };
}
