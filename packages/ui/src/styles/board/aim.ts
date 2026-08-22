import { cssNumber } from '../number';

/**
 * How much of itself a card gives up while it is not a legal target.
 *
 * Low enough to read as unavailable at a glance across a whole table of cards,
 * high enough that the card is still legible — the player has to be able to see
 * what the illegal thing *is* in order to understand why it is illegal, and a
 * board of blanks would answer "why am I being asked this" with nothing.
 * `mtg-bz2.6`'s own wording is the constraint: *rather than hiding unavailable
 * commands, the interface clearly distinguishes currently legal cards and
 * actions from inactive ones*. Hiding is the thing being ruled out, so the
 * number cannot go to zero and cannot go near it.
 */
const AIM_DIM = 0.38;

/**
 * The table while a target is being chosen (`mtg-bz2.6`).
 *
 * One rule, and the reason there is only one is that the other half was already
 * built. A card the caller gave no handler is drawn without its button
 * (`../../board/Battlefield.ts`), so it is already neither a click target nor a
 * tab stop; and a card the caller *did* give a handler already wears the amber
 * ring `./slot.ts` puts on every face you may act on. So the legal targets light
 * up for free, in the vocabulary the surface already uses for "you may act on
 * this", and what was missing is the other end of the sentence: the cards that
 * are not answers looked exactly as they always do. `../../board/Battlefield.ts`
 * used to say outright that no rule in the shipped sheet dims an unplayable
 * permanent, which is the gap this closes, and it is closed only inside the
 * targeting state — an unplayable permanent at every other moment is still drawn
 * at full strength, because "you cannot act on this right now" is the resting
 * condition of most of a board and dimming it always would dim the board.
 *
 * What makes the two channels tell different stories is that they are on at
 * different times: outside a target choice a lit card means "you may play this",
 * and inside one the rest of the table has gone quiet around the lit cards, so
 * the same ring reads as "this is what the spell can be aimed at". A second
 * highlight color was the alternative and is not built — `./slot.ts` records
 * that a face has already spent `box-shadow` on lit and `outline` on selected,
 * and the slot's `::after` is spent on the reticle that marks a permanent
 * something on the stack is *already* aimed at (`mtg-njrp`). Three rings on one
 * card is not a distinction, it is a pile.
 *
 * **`opacity` and nothing else.** It is the only property this block declares,
 * and no other block in `./index.ts` declares it on a card face, so this rule
 * ties with nothing and its position in the cascade is where it reads rather
 * than what makes it win. That is deliberate rather than lucky: `filter` was the
 * obvious second channel and it is taken twice over on these exact elements —
 * `./slot.ts` lifts a lit face with it and `./lands.ts` grays a tapped tile with
 * it — so a dim written as a filter would have silently ungrayed every tapped
 * land the moment a spell was aimed.
 *
 * The hand is covered by the same selector because a hand card is a `.mtg-slot`
 * too (`../../board/Hand.ts`), which is what makes "the table goes quiet" one
 * rule instead of three.
 */
export const AIM_CSS = `
.mtg-board[data-aiming='true'] .mtg-slot > .mtg-card:not([data-interactive='true']) {
  opacity: ${cssNumber(AIM_DIM)};
}
`;
