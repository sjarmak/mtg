/**
 * The deck editor on a phone held upright: three rows of small controls that
 * are right in a 900px pane and ragged in a 358px column.
 *
 * `mtg-dcxg.7`, 2026-08-23, measured at 390x844 over the flagship's five
 * written decks. Every row here is `flex-wrap: wrap` over items of unequal
 * intrinsic width, which is the correct desk behavior and produces, at this
 * width, a staircase: the five *Start from* buttons came out 154px, 120px,
 * 144px, 148px and 133px over three rows, each starting at a different x, and
 * the mana base's five stepper groups wrapped three-then-two with the first row
 * pushed 64px right by the words `Lands 24` sharing the line.
 *
 * The answer is one column per row rather than a smaller control: the items are
 * deck names and mana counts, so their widths are content nobody chose and no
 * amount of shrinking makes them agree. The toolbar's actions and the written
 * decks each take the full column; the five colors take a three-column grid,
 * which is the widest arrangement that leaves each `- pip count +` group whole.
 *
 * All of it is the decks section of Customize and phone-only, so nothing a desk
 * draws is re-valued here. It is a sheet of the route's own, wired last in
 * `./index.ts`, exactly as `./replay-mobile.ts` is and for the same reason:
 * `./mobile.ts` is what every route shares.
 */
import { PHONE_MAX_REM } from './mobile';
import { viewScope } from './tokens';

const DECKS = viewScope('customize', 'decks');

export const DECK_MOBILE_CSS = `
@media (max-width: ${String(PHONE_MAX_REM)}rem) {
  /* The sticky bar is a stack: the two readouts, the mirror note, the three
     actions and the sentence under whichever of them is dark. A full-width
     button also gives the two ways to play a target a thumb reaches without
     aiming, which the 44px floor alone does not. */
  ${DECKS} .mtg-builder__bar {
    display: grid; grid-template-columns: minmax(0, 1fr); align-items: stretch;
  }
  /* The written decks take two columns rather than one. Their names are four
     words long, so one column is five full-width rows and puts the deck being
     built two screens down; two equal columns align the same way and cost half
     the height. The label above them spans both. */
  ${DECKS} .mtg-builder__starters {
    display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: stretch;
  }
  ${DECKS} .mtg-builder__starters > .mtg-fact__label { grid-column: 1 / -1; }
  /* A spacer that pushes controls to the right end of a row is an empty row
     once the row is a column. */
  ${DECKS} .mtg-builder__bar > .mtg-toolbar__spacer,
  ${DECKS} .mtg-builder__starters > .mtg-toolbar__spacer { display: none; }
  ${DECKS} .mtg-builder__bar > .mtg-btn,
  ${DECKS} .mtg-builder__starters > .mtg-btn { inline-size: 100%; }
  /* Three columns, so each color's minus, pip, count and plus stay on one line
     and the five line up under each other. \`Lands 24\` takes the row above
     them rather than the first third of this one. */
  ${DECKS} .mtg-manabar { display: flex; flex-wrap: wrap; }
  ${DECKS} .mtg-manabar__lands { flex: 1 0 100%; }
  ${DECKS} .mtg-manabar__color {
    flex: 0 0 calc((100% - 2 * var(--mtg-space-2)) / 3);
    justify-content: space-between;
  }
  ${DECKS} .mtg-manabar > .mtg-toolbar__spacer { display: none; }
}
`;
