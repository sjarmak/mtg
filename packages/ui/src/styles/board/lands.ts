/**
 * The mana base: art tiles, one row, under the cards in play.
 *
 * **This reverses an argued decision for the second time in a day, and both
 * arguments are left corrected rather than deleted.** The rule here first drew a
 * land as a chip carrying a color swatch and a name, on the grounds that "a mana
 * base is five to nine permanents that say one thing each, and drawn as faces
 * they take half the battlefield away from the permanents whose text matters".
 * The playtester, 2026-08-13: "I would like to see the lands in play as their card
 * art by the way not just pips." That made a land the same board face every
 * other permanent gets, three lines of them in a 12rem band beside the row.
 * Then, having played it: "I want the lands to show up a little nicer so they
 * are in a row below the cards in play and that they just show their art no
 * thick border and no text."
 *
 * The premise has survived both reversals and is what the tile keeps: a mana
 * base is permanents that say one thing each, so it may not compete with the
 * spells for the row's width. The band no longer does — it is out of the row
 * entirely, under it, one line tall at a stated height. What it costs instead is
 * the row's *height*, and dropping four of the face's five regions is what makes
 * that cost small: a tile shows a bigger picture at 48px than a board face
 * managed at 90.
 *
 * The band scrolls past its line rather than wrapping to a second one, which is
 * the one place `docs/research/prior-art-board-layout.md` §2 finds a scrolling
 * battlefield precedented: nobody scrolls one "except Arena, and Arena scrolls
 * only its land row".
 */
import { ART_WINDOW } from '../../card/anatomy';
import { cssNumber } from '../number';
import { HOVER_SCALE } from './geometry';

/**
 * How tall one line of land tiles is drawn.
 *
 * A rem rather than a share of the row, which is what the three-line band of
 * board faces this replaces took. Recognizing a picture needs absolute pixels:
 * a share is the right unit for a thing competing for a budget and the wrong
 * one for the smallest a photograph may be and still be read. 3rem is 48px at a
 * 16px root, which draws the tile 73 x 48 at the printed window's ratio —
 * against the 26 x 23.5 window the three-line band's land face managed at
 * 1280x800, which is 5.7 times the area for a band that is now the row's only
 * fixed cost.
 *
 * The same number on both routes, which is what retired the play-scoped land
 * block entirely. The band used to divide the row's height by its line count,
 * so the played table and the replay board needed two sets of rules; a tile
 * with a stated height needs one, and `.mtg-lands > .mtg-slot[data-slot='play']`
 * is specific enough to beat `./fit.ts`'s floors without being scoped to a
 * route.
 *
 * Unguarded by any test that can see a box, like every other length here
 * (`mtg-bc2.130`). What a browser gate would assert is the table in the commit
 * message: the spell face and the row's scroll onset at 4, 7, 10 and 14 lands a
 * side, at 1280x800 and 1440x900.
 *
 * **3.5rem now, and the eight pixels are the whole of what the lane had.**
 * The playtester, 2026-08-14: "I want the lands to show up a bit bigger too so it's
 * obvious they're lands". A taller band spends the lane's height, the lane
 * spends its height on the spell row, and the spell face is the size of its
 * *width* cap (`./hand.ts`, `BOARD_TO_HAND`) turned by the printed trim — so
 * every pixel the band takes past the row's slack comes off the face's height
 * with its width unmoved, which is not a smaller card but a squashed one.
 *
 * Read in chrome-headless-shell 151 over `../../tools/card-uniformity.ts` on
 * the flagship set, four permanents a side and a seven-land mana base, walking
 * this constant with `BOARD_FACE_MAX_SHARE` left at the 85% it shipped with.
 * The near seat's face, and its trim against the printed 0.716:
 *
 *   tile   1440x900        1280x800        1024x768
 *   3rem   99.2 x 138.5    82.6 x 115.4    68 x 95      0.716 everywhere
 *   3.5    99.2 x 138.5    82.6 x 103.3    68 x 95      0.800 at 1280x800
 *   3.75   99.2 x 136.5    82.6 x  99.9    68 x 95      0.727 and 0.827
 *   4.5    99.2 x 119.9    82.6 x  79.2    68 x 88.6    0.827, 1.043, 0.767
 *
 * At 4.5rem a card at 1280x800 is *wider than it is tall*. So the band had no
 * height at all to take, and the eight pixels come from somewhere else:
 * `BOARD_FACE_MAX_SHARE` reserves a share of the row as empty mat under the
 * cards, and at 96% rather than 85% the 3.5rem band is free — every face box,
 * every trim and every clipped-name count at all four viewports and all three
 * densities is the 3rem baseline to the tenth of a pixel. 3.75rem is not: it
 * takes 1280x800 to 0.732. So 3.5 is the last clean rung and it is the number.
 *
 * The tile is 85.2 x 56 against 73 x 48, which is 36% more picture, and it is
 * carrying a mana symbol now (`../card.ts`, `ART_TILE`) — the two halves of
 * "bigger, and obviously lands". More than that needs height the lane does not
 * have; `mtg-rgc`'s rail work is returning some, and this is the constant to
 * re-walk when it lands.
 */
const LAND_TILE_HEIGHT_REM = 3.5;

/**
 * And how tall a land tile is on a table too short to give it 3.5rem.
 *
 * The playtester, 2026-08-22, on the landscape phone: "we want to be able to see as
 * much of the relevant game state as possible (so not needing to scroll to see
 * lands in play)". Measured at 844x390 with five lands a side, the band was
 * **9.05px tall over 27px of content** on the near seat and 6.73 over 25 on the
 * far one, so the mana base was a sliver behind a scroller. At 932x430 it was
 * 28.61 of 36.
 *
 * The squeeze is `./fit.ts`'s, and it is the right rule at every viewport that
 * has room: the band is capped at what the lane has left *after* the cards in
 * play take their 4.5rem floor, so a mana base can never push the spells row off
 * the seat. On a short table there is nothing left after that floor, so the cap
 * computes to single digits and the rule that was protecting the row starts
 * erasing the band instead.
 *
 * What `../mobile.ts` does about it is lift that cap and shorten the *tile*,
 * which is the half that actually shows a land. Capping the band alone does not:
 * the tile is a stated 3.5rem and the band centers it, so a 32px band over a
 * 56px tile draws the middle 32px of each land and hides the rest — a crop, and
 * a worse one than the scroller, because nothing on the screen says a picture
 * was cut. At 2.25rem the tile is 36px, the band is that plus its 2px of
 * padding either side, and five lands sit inside it whole.
 *
 * 36px is the floor of the picture and not a share of the leftover: at the
 * `ART_WINDOW` ratio it is 54.8px wide, which is a legible strip of art with its
 * mana symbol on it. The remainder goes to the spells row, which is the reverse
 * of the roomy priority and is deliberate: a card in play is floored at
 * `./fit.ts`'s `MIN_SLOT_REM` and stops shrinking, so the row gives up its slack
 * rather than its cards.
 */
export const SHORT_TABLE_LAND_TILE_REM = 2.25;

/**
 * How much a tapped tile is scaled so its rotation costs the row no width.
 *
 * A landscape tile rotated 90 degrees puts its height on the row's width axis,
 * so scaling by the window's inverse ratio makes the rotated tile exactly as
 * wide as the box it was already in and nothing on the row moves.
 *
 * **`./slot.ts` made the opposite choice for a card and this rule deliberately
 * does not follow it.** A tapped *permanent* now takes a square slot and keeps
 * its full size, because the room a rotated card needs is room along the row and
 * the row can give it. A tile's rotation needs room along the *other* axis: the
 * tile is landscape, so upright it is 73 x 48 and rotated it wants 48 x 73, and
 * the band is one line of a stated height with the spell row above it taking
 * everything the band does not. Reserving the rotated height means a 73px band
 * instead of a 48px one, twice — once per seat — and measured at 1600x1000 the
 * two lanes hand that 50px to three rows of cards, so every permanent on the
 * table loses about 17px of height (179 to 162, 18% of its area) to make a
 * tapped land tile 2.3 times larger. That inverts the premise the band is built
 * on: a mana base is permanents that say one thing each, and it may not take the
 * row's space from the permanents whose text matters.
 *
 * So the tapped tile is the one object on the table still drawn smaller than its
 * untapped self, at 31.6 x 48 against 73 x 48, and `mtg-yi5`'s note that "lands
 * are the same in miniature" is answered with a number rather than a fix. What
 * makes that payable is that a tile has no words on it to become illegible, and
 * that it says tapped twice — the rotation and `TAPPED_TILE_GRAYSCALE`.
 */
const TAPPED_TILE_SCALE = ART_WINDOW.height / ART_WINDOW.width;

/**
 * How much color a tapped tile gives up, on top of the rotation.
 *
 * The tile is the one thing on the table with no words on it, and rotation
 * alone is a far quieter signal on a picture than it is on a card: a card turned
 * on its side has a name bar and a type line visibly lying down, and a
 * photograph has nothing but its own contents. So the tile says it twice. This
 * is the second half, and it is a `filter` on the face rather than on the slot
 * because a filter makes an element a containing block for fixed-position
 * descendants — the hover zoom is a *sibling* of the face and a *descendant* of
 * the slot, and putting this one class higher would have trapped the zoom inside
 * a scrolling well.
 */
const TAPPED_TILE_GRAYSCALE = 0.65;

export const LANDS_CSS = `
.mtg-board__spells {
  display: flex; flex-wrap: wrap; gap: var(--mtg-space-2);
  align-items: flex-start; min-width: 0;
}
.mtg-zone__body[data-layout='board'] { flex-direction: column; align-items: stretch; flex-wrap: nowrap; }
.mtg-lands {
  display: flex; flex-wrap: nowrap; gap: var(--mtg-space-1);
  flex: none; align-items: center; min-width: 0;
  overflow-x: auto; padding-block: 2px;
}
.mtg-lands > .mtg-slot[data-slot='play'] {
  flex: none; width: auto; height: ${cssNumber(LAND_TILE_HEIGHT_REM)}rem;
  min-width: 0; min-height: 0;
  aspect-ratio: ${cssNumber(ART_WINDOW.width)} / ${cssNumber(ART_WINDOW.height)};
}
.mtg-slot > .mtg-card[data-size='art'] { width: 100%; height: 100%; max-height: 100%; aspect-ratio: auto; }
.mtg-slot[data-tapped='true'] > .mtg-card[data-size='art'] {
  scale: ${cssNumber(TAPPED_TILE_SCALE)}; filter: grayscale(${cssNumber(TAPPED_TILE_GRAYSCALE)});
}
.mtg-slot[data-tapped='true'] > .mtg-card[data-size='art'][data-interactive='true']:hover {
  scale: ${cssNumber(TAPPED_TILE_SCALE * HOVER_SCALE)};
}
`;
