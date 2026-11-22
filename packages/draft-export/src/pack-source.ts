/**
 * Where a drafted pack comes from.
 *
 * Two answers, and the difference between them is the whole of `mtg-nmqp`. A
 * generated set has no sheets, so its packs are dealt from a rarity recipe —
 * `buildSheets` and `buildLayouts`, the same pair the emitted Draftmancer file
 * describes. A reduced printing carries the sheets it was actually collated on,
 * and `@mtg/deckbuild`'s `openCollatedPool` deals from those: weighted within a
 * sheet, one weighted configuration per pack, basics included when the printing
 * puts one in the pack. A rarity recipe reproduces none of that, and the Play
 * tab was already dealing the real thing while this one dealt the recipe.
 *
 * A source is a function of a stream name rather than of an `Rng`, because the
 * two samplers do not share a generator and must not: `@mtg/deckbuild`'s belongs
 * to sealed pools and this package copied its own for the reason `rng.ts` gives.
 * Naming the stream is what the draft loop already does for every pack it opens
 * (`seed/pack/2/5`), so handing the name across the seam costs nothing and keeps
 * both halves seeded the way they were.
 *
 * The collated arm is not a second implementation of weighted drawing. It opens
 * one pack through the one function that knows those rules, and turns that
 * function's refusal into this package's error so a caller catches one type.
 */
import { openCollatedPool, SealedPoolError } from '@mtg/deckbuild';
import type { PackCollation } from '@mtg/deckbuild';
import type { Card } from '@mtg/dsl';
import type { DraftmancerLayouts, DraftmancerSheet } from './collation';
import { DraftError } from './errors';
import { openPackFromLayouts } from './packs';
import { createRng } from './rng';

/** Opens the pack for one named stream. Same name, same pack, every run. */
export type PackSource = (stream: string) => readonly Card[];

/** Packs off the rarity sheets and layouts the export file describes. */
export function layoutPackSource(
  sheets: readonly DraftmancerSheet[],
  layouts: DraftmancerLayouts,
): PackSource {
  return (stream: string): readonly Card[] => {
    const [cards] = openPackFromLayouts(sheets, layouts, createRng(stream));
    return cards;
  };
}

/** Packs off a printing's own collation, dealt by `openCollatedPool`. */
export function collationPackSource(cards: readonly Card[], collation: PackCollation): PackSource {
  return (stream: string): readonly Card[] => {
    let opened;
    try {
      opened = openCollatedPool(cards, collation, { seed: stream, boosters: 1 });
    } catch (cause: unknown) {
      if (cause instanceof SealedPoolError) throw new DraftError(cause.message);
      throw cause;
    }
    const pack = opened.boosters[0];
    if (pack === undefined) throw new DraftError('the collation opened no pack at all');
    return pack;
  };
}
