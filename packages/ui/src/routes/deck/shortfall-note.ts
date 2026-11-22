/**
 * A shortfall said to the person building the deck.
 *
 * `@mtg/deckbuild`'s `formatShortfall` writes for a CLI and a metrics gate, and
 * it reads like one: *spell slots: 0/36 filled (36 short)*, *curve MV 3: 1/4
 * filled (3 short)*. Both builders drew those strings straight onto the screen,
 * which is the same class of leak as a build path in a heading — the value is
 * right and the voice belongs to a log.
 *
 * So the producer keeps its wording, because the slice CLI and the balance gate
 * assert on it, and the screen gets its own. One function for both builders:
 * the sealed pool and the constructed pool fail in exactly the same four ways,
 * and two copies of this sentence set would drift the first time one of them
 * was reworded.
 *
 * The counts are what somebody does next — how many more, of what — rather than
 * a filled-over-target ratio, which the counter row above the notes already
 * carries for the deck as a whole.
 */
import { plural } from '../../copy';
import type { Shortfall } from '@mtg/deckbuild';
import { curveBucketLabel } from '@mtg/deckbuild';
import { assertNever } from '@mtg/dsl';
import { colorWord } from '../../card/symbols';

export function shortfallNote(shortfall: Shortfall): string {
  switch (shortfall.kind) {
    case 'spellSlots':
      return `${plural(shortfall.missing, 'more card')} to go before the deck is full.`;
    case 'curveSlot':
      return `${plural(shortfall.missing, 'more card')} at mana value ${curveBucketLabel(shortfall.bucket)}.`;
    case 'creatureFloor':
      return `${plural(shortfall.missing, 'more creature')} for a deck that can hold the board.`;
    case 'colorSources':
      return `${plural(shortfall.missing, 'more source')} of ${colorWord(shortfall.color) ?? shortfall.color} mana.`;
    default:
      return assertNever(shortfall, 'shortfallNote');
  }
}
