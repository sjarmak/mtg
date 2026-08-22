/**
 * Opening one pack from the collation this package already compiles.
 *
 * A drafted pack is drawn from the same sheets and the same layout the emitted
 * file describes — `buildSheets` for the pools, `buildLayouts` for the per-slot
 * counts — so the packs a bot drafts here are the packs a Draftmancer would
 * build from the file, up to the collation mode. That is the one claim this
 * runtime can make about the file without running a Draftmancer against it.
 *
 * Sheets carry no collation token, which selects the format's documented
 * default of `random`: distinct cards within a pack, drawn uniformly, repeating
 * freely across packs. That is `openSealedPool`'s rule too, and for the same
 * reason — one pack never holds a card twice, three packs frequently do.
 */
import type { Card } from '@mtg/dsl';
import type { DraftmancerLayout, DraftmancerLayouts, DraftmancerSheet } from './collation';
import { DraftError } from './errors';
import type { Rng } from './rng';
import { nextBelow } from './rng';

/** Draws `count` distinct cards from one sheet, uniformly and without replacement. */
function drawDistinct(from: readonly Card[], count: number, rng: Rng): readonly [readonly Card[], Rng] {
  const remaining = [...from];
  const drawn: Card[] = [];
  let current = rng;
  for (let taken = 0; taken < count; taken += 1) {
    const [index, advanced] = nextBelow(current, remaining.length);
    current = advanced;
    const [card] = remaining.splice(index, 1);
    if (card === undefined) throw new DraftError('a sheet ran out of cards mid-pack');
    drawn.push(card);
  }
  return [drawn, current];
}

/**
 * Everything about a layout that would deal a short pack, checked before a card
 * is drawn: a slot naming a sheet the set does not print, and a slot asking for
 * more distinct cards than its sheet holds. `collationReport` says the same
 * thing about a whole set before a draft starts; this is the guard for a caller
 * that opened one pack directly.
 */
function assertLayoutFits(sheets: readonly DraftmancerSheet[], layout: DraftmancerLayout): void {
  const bySheet = new Map(sheets.map((sheet) => [sheet.name, sheet]));
  for (const [name, count] of Object.entries(layout.slots)) {
    const sheet = bySheet.get(name);
    if (sheet === undefined) {
      throw new DraftError(`the layout draws from sheet ${name}, which the set does not print`);
    }
    if (sheet.cards.length < count) {
      throw new DraftError(
        `slot ${name} needs ${String(count)} cards per pack but its sheet holds ${String(sheet.cards.length)}`,
      );
    }
  }
}

/**
 * Opens one pack. Slots are filled in sheet order, so a pack reads
 * commons-then-uncommons the way the recipe lists them; a bot scores the whole
 * pack, so the order inside it is presentation rather than mechanism.
 */
export function openPack(
  sheets: readonly DraftmancerSheet[],
  layout: DraftmancerLayout,
  rng: Rng,
): readonly [readonly Card[], Rng] {
  assertLayoutFits(sheets, layout);
  const cards: Card[] = [];
  let current = rng;
  for (const sheet of sheets) {
    const count = layout.slots[sheet.name] ?? 0;
    if (count === 0) continue;
    const [drawn, advanced] = drawDistinct(sheet.cards, count, current);
    current = advanced;
    cards.push(...drawn);
  }
  return [cards, current];
}

/** Chooses one weighted layout, then opens the pack that layout describes. */
export function openPackFromLayouts(
  sheets: readonly DraftmancerSheet[],
  layouts: DraftmancerLayouts,
  rng: Rng,
): readonly [readonly Card[], Rng] {
  const choices = Object.values(layouts);
  if (choices.length === 0) throw new DraftError('the recipe describes no pack layout');
  let total = 0;
  for (const layout of choices) {
    if (!Number.isSafeInteger(layout.weight) || layout.weight <= 0) {
      throw new DraftError(`layout weight must be a positive safe integer, got ${String(layout.weight)}`);
    }
    total += layout.weight;
  }
  if (!Number.isSafeInteger(total)) throw new DraftError('layout weights exceed the supported range');
  const only = choices[0];
  if (choices.length === 1 && only !== undefined) return openPack(sheets, only, rng);
  const [roll, advanced] = nextBelow(rng, total);
  let cursor = roll;
  let selected = choices[choices.length - 1];
  for (const layout of choices) {
    cursor -= layout.weight;
    if (cursor < 0) {
      selected = layout;
      break;
    }
  }
  if (selected === undefined) throw new DraftError('the recipe describes no pack layout');
  return openPack(sheets, selected, advanced);
}
