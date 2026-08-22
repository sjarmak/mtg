/**
 * Responsive geometry for cards on the played table.
 *
 * A hand lays out seven slots across, never narrower than a complete face, and
 * stops growing at 7.5rem. Battlefield cards keep the original 11rem row-width
 * basis and stop at 10rem. The board therefore remains the primary reading
 * surface without turning either zone into poster-sized cards; crowded rows
 * scroll at a readable size, and so does a hand whose seven no longer fit.
 *
 * Real-Chrome coverage holds that hierarchy from 390px phones through the
 * supplied 2048 x 1280 screenshot and 2784 x 1532 high-density view: sparse
 * battlefield cards are never smaller than the visible hand, and become
 * strictly larger when the table has enough room. Crowded rows may meet the
 * hand at their shared readable scrolling ceiling.
 *
 * The slot height follows the printed trim. `min-height: 0` is required
 * because a preferred aspect ratio otherwise takes its content as an automatic
 * minimum and can defeat the row's maximum.
 */
import { CARD_TRIM_MM } from '../../card/anatomy';
import { cssNumber } from '../number';
import { RATIO, TABLE, THREE_COLUMN_MIN_WIDTH_PX } from './geometry';
import { PLAY_RAIL_REM, RAIL_WIDTH_VAR } from './rail';

/**
 * How many cards the hand is sized to lay out across its row.
 *
 * Seven, because seven is an opening hand. A rig that sized the row for five
 * would report the roomiest case as the ordinary one, and a hand only ever gets
 * smaller than seven during a game — the row then draws seven cards' worth of
 * slots and leaves the slack at the end, which is the same honesty `../../board/
 * Hand.ts` applies when it draws the empty places.
 *
 * Past seven the row scrolls, which is what the rail layout has always done
 * (`./zone.ts`) and what `MIN_SLOT_WIDTH_REM` in `./fit.ts` bounds: an
 * eight-card hand shrinks a little further and a twenty-card hand scrolls rather
 * than drawing twenty unreadable slivers.
 */
export const HAND_ACROSS = 7;

/**
 * The gap between two slots in the row, restated so the cap can subtract it.
 *
 * A `max-width` cannot read a gap back, so this is the one number in this file
 * that is level with another file by hand rather than by import. It is the token
 * rather than its value, so a re-valued spacing scale moves both together.
 *
 * The card-to-card gap belongs to `./zone.ts`'s `.mtg-zone__body`; the
 * smaller gap in `./fit.ts` separates a zone heading from its body.
 */
export const HAND_GAP = 'var(--mtg-space-2)';

/**
 * A wide monitor should reveal more table, not turn the hand into seven poster
 * prints. Seven and a half rem keeps a held card readable without letting
 * hidden options dominate the permanents that determine combat. The
 * battlefield may grow to ten rem; crowded rows lower this cap with their own
 * scrolling ceiling.
 */
const HAND_FACE_MAX_REM = 7.5;

/** Preserve the measured battlefield curve while lowering only the hand. */
const BOARD_WIDTH_BASIS_MAX_REM = 11;

/**
 * The hand ceiling on a short three-column table.
 *
 * At the supplied 1392 x 766 viewport, five hand cards consumed 181.7px while
 * the two battlefield rows were left 141.6px and 115.9px. The width-sized
 * battlefield then hit its height cap differently in each lane: an upright
 * face fell to 74.2 x 103.6 while a tapped peer bypassed the cap at
 * 163.7 x 117.2. A 5.5rem cap makes the hand 88 x 123px, returns the missing
 * height to both lanes, and keeps the held card readable without overtaking a
 * height-capped battlefield face.
 */
const SHORT_TABLE_HAND_FACE_MAX_REM = 5.5;

/** Preserve the former short-table battlefield width while shrinking the hand. */
const SHORT_TABLE_BOARD_WIDTH_BASIS_MAX_REM = 5.75;

/**
 * Combat state spends the vertical budget on permanents, not held options.
 *
 * Exported since `mtg-l4w0`, because a short viewport is in that condition for
 * the whole game rather than for one step: `../mobile.ts`'s landscape tier reads
 * it as the standing cap there. The same number and the same sentence, so a
 * re-measurement of one moves both — which is the point of sharing it rather
 * than writing 3.5 twice.
 */
export const COMBAT_HAND_FACE_MAX_REM = 3.5;

/**
 * Fixed chrome above, between, and below the two battlefield rows in combat.
 *
 * A subtraction from `100vh`, which is a proxy for the room the rows have and
 * not the room itself; `FACE_COMPLETE_REM`'s rule below replaces exactly this
 * kind of arithmetic off combat and says why it stops at the band.
 */
const COMBAT_BOARD_VERTICAL_CHROME_REM = 29.875;

/**
 * A table this tall or shorter is a short table; above it, the caps below step
 * back and the full table's apply.
 *
 * **Chosen against 1280x800, not inherited from the capture it was fitted to.**
 * It arrived as a round rem above the supplied 2784 x 1532 capture's inferred 2x
 * CSS viewport height of 766, read by a `max-height` query, which is inclusive.
 * That put a window exactly 800px tall — the most common laptop height on the
 * table, and one of the three every play rig measures — on the short side of a
 * line nobody had measured at 800. `mtg-2s2k` measured it. The bound did not
 * move, and the measurement is why rather than the round number.
 *
 * Measured at 1280 wide in chrome-headless-shell, 800 against 801:
 *
 * | a side | h   | hand face  | board face | type line |
 * | ------ | --- | ---------- | ---------- | --------- |
 * |      4 | 800 |         88 |      99.98 | both      |
 * |      4 | 801 |     103.28 |     103.27 | both      |
 * |      8 | 800 |         84 |      83.98 | neither   |
 * |      8 | 801 |     103.28 |      97.25 | both      |
 *
 * One pixel of viewport is worth 15px of hand face at four a side, and at eight
 * it is the type line on the held card and on every permanent the viewer owns:
 * an 84px face has a 78px content box, under `../card.ts`'s
 * `BOARD_TYPE_LINE_MIN_REM`. So the tall arm reads better at 800, and three of
 * the cheap objections do not hold — page overflow, worst face clip and hand-row
 * sideways scroll are 0 in both arms at 4, 8 and 12 a side — and 800 is above
 * the crossover where the tall treatment stops being paid for by the board:
 * swept with the short arm disabled, at four a side the battlefield face is
 * 6.4px under the hand at 780, 1.2 under at 795, 0.20 at 798, and 0.01 from 799
 * upward.
 *
 * **What holds the line at 800 is a fourth reading the first three missed.** On
 * the full table at eight a side, a row that mixes tapped and upright permanents
 * draws them at two different sizes: `../../test/play/table-allocation.browser.test.ts`
 * asserts one size per seat, and moving 800 to the tall arm fails it at 103.3
 * tapped against 96.9 upright. The row asks for more width than it has —
 * `./fit.ts` gives a battlefield slot a flex-shrink of 1, and a tapped slot
 * carries an explicit width off `--board-face` while an upright one takes its
 * width from the row's height under the slot's aspect ratio — so the two kinds
 * do not shrink alike and the upright permanents come out the smaller. It is not
 * this bound's defect: measured on the tall arm as it already ships, the same
 * split is there at 1280x801 (103.3 / 97.3), 1360x801 and 1400x801
 * (103.4 / 96.5) and 1440x801 (112 / 105.4), and gone by 1280x900 and 1440x900.
 * A band of heights just above this bound is broken at eight a side, and 800
 * sits against it.
 *
 * So 800 stays short and the query stays inclusive, and this is the condition on
 * revisiting rather than a verdict against the tall arm: fix the crowded tapped
 * row, and 800 wants to move up one pixel.
 * `../../test/play/short-table-boundary.browser.test.ts` pins both faces at
 * 1280x800 and at 1280x801 so the line cannot move by accident either way.
 */
const SHORT_TABLE_MAX_HEIGHT_REM = 50;

/**
 * The short table's own condition, written once because two rules ask it.
 *
 * They asked it twice in two files' worth of scrolling and had to be kept in
 * step by hand; `mtg-2s2k` needed to move the comparison and found the second
 * copy by grep.
 */
const SHORT_TABLE_QUERY = `(min-width: ${String(THREE_COLUMN_MIN_WIDTH_PX)}px) and (max-height: ${cssNumber(SHORT_TABLE_MAX_HEIGHT_REM)}rem)`;

/**
 * Battlefield cards grow with the available row until they reach this width.
 * Its ceiling is above the hand's because permanents determine combat and must
 * remain the primary reading surface during play.
 */
const BOARD_FACE_MAX_REM = 10;

/** A row past seven permanents scrolls at a readable, height-safe face width. */
const CROWDED_BOARD_FACE_MAX_REM = 7;

/** The crowded-row ceiling when the three-column table is also short. */
const SHORT_CROWDED_BOARD_FACE_MAX_REM = 5.25;

/**
 * The smallest readable battlefield width.
 *
 * At narrower widths, flagship names start clipping abruptly between roughly
 * 65px and 67px. A 4.5rem request stays above that boundary. The battlefield
 * row scrolls when it cannot fit that width; coupling this floor to a seven-card
 * hand slot made a lone near-side creature only 48px wide on a 390px phone.
 */
const BOARD_FACE_MIN_REM = 4.5;

/**
 * The width at which a face drawn at board size draws everything it has, and the
 * point past which surplus row height stops buying anything.
 *
 * `../card.ts` states the face's anatomy as three container queries against the
 * face's own *content* box: the pending label goes at 5rem, the type line goes
 * at 5rem, the rules box goes at 4rem and narrows to two lines at 6rem. A board
 * face carries no padding and a band that is a share of its own width, so a 5rem
 * content box is an 87px face, a 6rem face is 96px with a 90px content box, and
 * every one of those thresholds is cleared by 6rem of face. The
 * quarter rem on top is slack against a row whose width divides into fractions:
 * a face landing a tenth of a pixel under the query draws no type line at all,
 * and that is not a difference anybody can see in the number.
 *
 * **One number for both regions, and the name lost its `BOARD_` for that
 * reason.** A held card and a permanent wear the same `data-size='board'` and
 * are read by the same three queries, so "the width at which a face draws
 * everything it has" is a fact about the face rather than about the battlefield.
 * Two copies of it would be two things to keep level by hand the next time
 * `../card.ts` moves a threshold, and the hand is where the copy would have gone
 * (mtg-s3re): its slot reads this as a floor, the battlefield slot reads it as a
 * ceiling on the height-derived term, and neither reading is the other's.
 *
 * On the battlefield it is a ceiling on the *height-derived* term only, never on
 * the width basis below. Beyond a complete face, extra room is the mat's, which
 * is the sentence `BOARD_FACE_MAX_REM` already makes about extra width; this is
 * the same sentence about extra height, and without it a tall row would draw
 * four enormous permanents and scroll away the fifth.
 */
const FACE_COMPLETE_REM = 6.25;

/**
 * And the guard under it: the tallest a battlefield slot may be drawn, as a share
 * of the row it is in.
 *
 * This number used to be the operating point — a definite height, from which the
 * slot's width followed — and it is a maximum now because the width is what is
 * stated. Read in that order the slot is the size of the face inside it on both
 * axes, which is what keeps `./slot.ts`'s corner marks on the card: the marks are
 * positioned against the *slot*, and a slot stretched over a shorter face floats
 * the `ATK` and power/toughness badges above it, which is half of what `mtg-yi5`
 * reported. The old pairing had exactly that defect wherever the width cap bound
 * — measured at 1024x768 with four permanents a side, the viewer's slot was
 * 67.4 x 121.8 over a face of 67.4 x 94.1, so the badges sat 13.9px clear of the
 * card they belonged to.
 *
 * It survives as a maximum because a window can always be shorter than the width
 * the cap asks for. Measured, it binds at no viewport that draws a usable board:
 * at 1024x768 the cap asks for 73.4px of height against the 121.8 this share
 * allows, and the two do not meet until the window is about 570px tall.
 *
 * **96 rather than 85, and the eleven points are what paid for a bigger mana
 * base.** The sentence above is true and is about the row the file shipped with;
 * it stops being true the moment anything else on the lane grows, because what
 * this share reserves is *empty mat under the cards* and the face is already
 * standing on the rest. `./lands.ts`'s tile went from 3rem to 3.5rem
 * (2026-08-14, "I want the lands to show up a bit bigger"), and at 85% those
 * eight pixels came straight off the face's height with its width unmoved: read
 * over `../../tools/card-uniformity.ts`, a 1280x800 board at four a side went
 * from 82.6 x 115.4 to 82.6 x 103.3, a trim of 0.800 against the printed 0.716.
 * A squashed card is a worse answer than a smaller one and this share is what
 * was choosing it.
 *
 * At 96 the guard is still a guard — a slot may not be more than the row — and
 * the band is free: every face box, every trim and every clipped-name count at
 * 1440x900, 1280x800, 1024x768 and 810x1080 by three densities is the reading
 * this file shipped with, to the tenth of a pixel. 100 was measured too and also
 * holds today, and is not taken: with no reserve at all a row one pixel shorter
 * than the cap asks for makes `./fit.ts`'s spell row scroll on the axis nobody
 * scrolls a battlefield on, and 4% of the row is what keeps that a maximum
 * rather than a coincidence.
 */
const BOARD_FACE_MAX_SHARE = 96;

/**
 * What the hand's width basis leaves out: the width the side panel would have
 * been taking if it were open.
 *
 * `mtg-u9uc`. Collapsing the panel is sold as regaining gameboard space
 * (`../../routes/play/rail-collapse.ts` quotes the ask) and it hands the lane
 * `PLAY_RAIL_REM` minus the strip, the same number at every viewport because
 * both terms are absolute. Both zones on the lane were sized from that same
 * lane width, so the reclaim was split rather than spent: a hand slot is a
 * seventh of the hand row, the row is exactly as tall as one hand card
 * (`flex: none` two blocks down), and the height the row took on collapse came
 * off the battlefield row under it. Measured at 1366x900 with four permanents a
 * side and the route's own furniture above the mat, shutting the panel moved
 * the hand slot 114px to 120 and moved the near battlefield row 174.7px to
 * 170.5 and its face 114 to 111.7 — a collapse that made the board *smaller*.
 *
 * So the hand is sized from the lane as the open state would have measured it,
 * and the collapse reaches the battlefield alone. A constant cap on the slot was
 * measured and rejected first (`mtg-ihss`): the widest open-panel slot is wider
 * than the narrowest shut-panel one, so no constant binds on the second without
 * shrinking a hand nobody asked to shrink.
 *
 * It is a difference of the two rail widths rather than a second copy of the
 * strip's width, which is what keeps it from drifting: `../board/rail.ts`
 * publishes the column's current width to the sheet, `./fit.ts` writes the open
 * value into the same property, so this term is zero while the panel is open by
 * construction rather than by a rule that has to remember to say so.
 */
const HAND_BASIS_TRIM_VAR = '--hand-basis-trim';

/**
 * How many lines of its rules text a card *in hand* prints, by how wide its face
 * is drawn.
 *
 * `mtg-rgc.9.1`. A held card wears `data-size='board'`, so until this ladder it
 * spent a battlefield thumbnail's budget: `../card.ts`'s `BOARD_RULES_LINES` is
 * three line boxes and `BOARD_RULES_NARROW_LINES` is two under a 6rem content
 * box. Measured in chrome-headless-shell 151 over `../../../tools/hand-scale.ts`
 * against the flagship set, that put the hand on **two** lines at 1280x800 and at
 * 1024x768 and three at 1440x900, and the set does not fit either: at the columns
 * those faces draw — 21, 24 and 28 characters — 22.6%, 28.8% and 35.0% of the 371
 * cards print whole in two line boxes, and 42.3%, 48.8% and 56.3% print whole in
 * three. More than half the set was elided in the one zone a player decides from.
 *
 * **A budget is a maximum and not a reservation, which is what makes this
 * affordable at all.** `../card.ts` gives the window `flex: 1 1 auto` and every
 * bar `flex: none`, so a card with one line of text draws one line box and the
 * picture keeps the rest: raising the clamp costs those cards nothing. What pays
 * is exactly the card that was being cut, and what it pays in is picture.
 *
 * So the ladder is chosen against a floor under the picture — **the window keeps
 * at least 24% of the face's height and never gets thinner than 2.75 : 1** — and
 * it can be chosen exactly rather than guarded, because a face's height is its
 * width over the printed trim, so a width band is a height band. A `min-height`
 * on the window would be the guard, and it is the wrong instrument: flexbox would
 * shrink the rules box under its own clamp and cut a line with no mark on it,
 * which is the one thing a budget stated in line boxes exists to prevent.
 *
 * Measured, four permanents a side, the wordiest card of the flagship at each
 * width, before and after:
 *
 *     content   face            lines        window          share   shape
 *     7rem      120 x 167.6     3 -> 5       64.8 -> 41.0     24.5%   2.73 : 1
 *     5.94rem   103.3 x 144.3   2 -> 4       59.7 -> 38.1     26.4%   2.49 : 1
 *     5.13rem   88 x 122.9      2 -> 3       43.9 -> 33.1     26.9%   2.48 : 1
 *
 * And the ordinary hand rather than the worst one, which is where the budget is
 * actually spent — `HAND_SCALE_OFFSET=180`, the seven cards at the middle of the
 * same sort. At 1440x900 they need 3.2 to 5.3 line boxes, cards cut went 2 of 7
 * to 0 of 7, and **five of the seven kept their window to the pixel** (79.6,
 * 65.8, 64.8, 65.8, 74.6): only the two that were being elided paid anything at
 * all, 63.8 to 41.0 and 80.5 to 67.2. At 1280x800 that hand needs 4.1 to 5.3
 * against three and stays cut, which is the 88px face rather than the budget and
 * is the finding under this block.
 *
 * Under 4.5rem of content box the ladder does not fire and the board's own two
 * lines stand: `--hand-face-floor` above keeps a held card at a complete face on
 * the three-column table, so a hand face that narrow is a phone's, and a phone is
 * `../mat.ts`'s different arrangement rather than this ladder's narrow end.
 *
 * **The 88px face at 1280x800 is where this stops, and the cause is one pixel of
 * viewport.** `SHORT_TABLE_MAX_HEIGHT_REM` is 50rem and the query is inclusive,
 * so an 800px-tall window is a short table and the hand takes
 * `SHORT_TABLE_HAND_FACE_MAX_REM`; at 801px it does not, and the same page draws
 * the face at 103.3 with a 24-character column and a fourth line box. Probed by
 * lifting both hand ceilings at 1280x800, the battlefield does not collect what
 * the hand gives up there — the viewer's permanent is 100px either way and only
 * the row's empty mat moves, 169.7 to 159. `mtg-2s2k` measured where that line
 * belongs and left it: 800 stays short, and that constant's docblock names the
 * crowded tapped row that decides it and would release it.
 *
 * **What was rejected is a larger hand face**, which is the other shape
 * `mtg-rgc.9.1` names and the one it recommends, on the grounds that the row is
 * width-bound at `HAND_ACROSS` and that Magic Online overlaps its hand rather
 * than fitting it. Measured, the row is barely the bound: lifting both hand
 * ceilings entirely takes the face 120 to 124 at 1440x900, 88 to 103.3 at
 * 1280x800 and 88 to 100 at 1024x768, which is four pixels where the complaint is
 * loudest and buys no line box anywhere. Drawing it at Magic Online's 176 is the
 * shape the recommendation actually points at, and the battlefield pays for it:
 * the viewer's permanent goes 124 to 115.6 at 1440x900, 100 to 68.9 at 1280x800
 * and 100 to 57.9 at 1024x768. The last two are under `../card.ts`'s
 * `BOARD_RULES_MIN_REM`, so a hand card sized like Magic Online's takes the rules
 * box off every permanent on the table — `mtg-u69`'s defect, moved one zone over
 * — and 57.9 is under `BOARD_FACE_MIN_REM`, which is where a name starts
 * clipping. Seven 176px faces are also 1288px of row against the 924 a 1440x900
 * table has, so the hand would overlap or scroll on top of that. A bigger face is
 * a trade between two zones; a bigger budget is a trade inside one card.
 *
 * The bands are stated as [content-box width in rem, line boxes] and they
 * increase, so the widest one that fires is the one that wins: each block is
 * later in the sheet than the one before it and all three carry equal
 * specificity.
 */
const HAND_RULES_LADDER: readonly (readonly [number, number])[] = [
  [4.5, 3],
  [5.5, 4],
  [6.5, 5],
];

/**
 * And the ladder as sheet text.
 *
 * Scoped by the *slot* rather than by a fourth `CardSize`, which is the
 * implementation `mtg-rgc.9.1` proposes and the one measurement argued out of.
 * A hand face and a battlefield face are the same face — the same regions in the
 * same order, the same bars, the same corner badge — and at 1440x900 they are
 * 120px and 124px wide, so nothing about the *card* tells them apart and a width
 * query never could. What tells them apart is the zone, `./zone.ts` already
 * publishes it on the slot, and `../card.ts`'s own container queries go on
 * resolving against the face's inline size from in here. A fourth size would have
 * carried a region list identical to `BOARD_REGIONS` and a fourth arm on each of
 * `../../card/Card.ts`'s three `size === 'board'` decisions, every one of which
 * would have had to answer the same as `board` — four places for a distinction
 * that lives in one number.
 */
const HAND_RULES_CSS = HAND_RULES_LADDER.map(
  ([content, lines]) => `
@container (min-width: ${cssNumber(content)}rem) {
  ${TABLE} .mtg-slot[data-slot='hand'] .mtg-card[data-size='board'] > [data-region='rules'] {
    -webkit-line-clamp: ${cssNumber(lines)};
  }
}`,
).join('');

export const HAND_CSS = `
${TABLE} .mtg-board {
  --hand-face-cap: ${cssNumber(HAND_FACE_MAX_REM)}rem;
  --board-width-basis-cap: ${cssNumber(BOARD_WIDTH_BASIS_MAX_REM)}rem;
  --hand-face-floor: 0px;
  ${HAND_BASIS_TRIM_VAR}: calc(${cssNumber(PLAY_RAIL_REM)}rem - var(${RAIL_WIDTH_VAR}));
}
/* The complete-face floor is the three-column table's, and stops at its
   breakpoint rather than reaching the phone.

   Below 901px the mat is a different arrangement (./mat.ts) with a different
   thing to spend height on, and the floor is a claim about a table whose two
   lanes each hold a battlefield. Measured at 390x844 in chrome-headless-shell
   151 over ../../test/play/battlefield-geometry.browser.test.ts, letting a
   43.1px hand slot jump to a complete face took enough off both lanes to split
   the far side's own base width — a tapped permanent came out 72px against an
   upright 69.2, and that test's whole subject is the two being one number.
   A phone hand is unreadable at either size and the fix for it is a phone's,
   not a floor borrowed from a 1024px table. */
@media (min-width: ${String(THREE_COLUMN_MIN_WIDTH_PX)}px) {
  ${TABLE} .mtg-board {
    --hand-face-floor: ${cssNumber(FACE_COMPLETE_REM)}rem;
  }
}
${TABLE} .mtg-board:has(.mtg-board__spells > .mtg-slot:nth-child(8)) {
  --hand-face-cap: ${cssNumber(CROWDED_BOARD_FACE_MAX_REM)}rem;
}
@media ${SHORT_TABLE_QUERY} {
  ${TABLE} .mtg-board {
    --hand-face-cap: ${cssNumber(SHORT_TABLE_HAND_FACE_MAX_REM)}rem;
    --board-width-basis-cap: ${cssNumber(SHORT_TABLE_BOARD_WIDTH_BASIS_MAX_REM)}rem;
  }
  ${TABLE} .mtg-board:has(.mtg-board__spells > .mtg-slot:nth-child(8)) {
    --hand-face-cap: ${cssNumber(SHORT_CROWDED_BOARD_FACE_MAX_REM)}rem;
  }
}
${TABLE} .mtg-board:has(.mtg-board__divider[data-combat='true']) {
  --hand-face-cap: ${cssNumber(COMBAT_HAND_FACE_MAX_REM)}rem;
}
/* The row is as tall as its cards and no taller: the zone takes no share of the
   column's height, so what the hand does not need is the battlefield's. */
${TABLE} .mtg-board__side[data-seat='you'] > .mtg-zone[data-tone='rail'] { flex: none; }
/* The row's block padding is left where ./zone.ts put it, and that is a
   measurement rather than an omission. ./slot.ts lights a castable card with
   three channels and the third is a halo spilling 16px onto the rail; the body
   clips at its padding box, so the question is how much slack the face had, and
   the answer is none either side of this change. At 1440x900 the rail measured a
   190px body over a 182.4px face before and a 199px body over a 190.8px face
   after, which is its two 4px steps of padding both times. The halo is clipped to
   the same 4px it always was and the step still covers the 1.03 hover scale, 2.9px
   either way on a face this tall. Doubling it to reclaim the rest of the glow was
   measured too: it costs a board face 2.5px, which at 1280x800 is one name
   clipping that had fitted, and that is a poor price for a softer edge on a light
   whose state is already carried by two rings the clip cannot reach. */
${TABLE} .mtg-board__side[data-seat='you'] > .mtg-zone[data-tone='rail'] > .mtg-zone__body {
  flex: none; align-items: flex-start;
}
/* A hand slot is a seventh of the row *or a complete face, whichever is larger*,
   and never more than the hand's own ceiling.

   A seventh of the row as the panel-open state would have measured it, which is
   what HAND_BASIS_TRIM_VAR above subtracts and why: the collapse is width the
   board asked for, and a hand sized from the widened row spent it on itself.

   A seventh of the row is the same proxy the battlefield stopped using two
   blocks down, and the hand went on paying for it after that lane was fixed
   (mtg-s3re). Measured in chrome-headless-shell 151 over ../../test/play/
   hand-allocation.browser.test.ts, a 1024x768 table gave the row 556.3px, a
   seventh of it is a 71.5px face, and on the face of that date — 4px of border
   and 4px of padding a side, before mtg-iqyc made the band proportional — 71.5
   left a 55.5px content box, under ../card.ts's BOARD_RULES_MIN_REM. So
   none of the seven cards in the opening hand drew a word of rules text at any
   board size, while a permanent beside them was 100px and drew all of it. The
   hand is the zone a player reads most and it was the one region on the table
   that could not be read.

   The floor is what fixes it and the ceiling is what bounds it. FACE_COMPLETE_REM
   is the width at which this face draws everything it has, so asking for it is
   asking for a readable card rather than for a bigger one; --hand-face-cap is
   already the design's statement of the most height the hand may take (the
   short-table and crowded-row ceilings above), so the floor can never push past
   what those ceilings allow. Where the seventh already clears a complete face —
   1440x900, and 1280x800 up to its cap — nothing here moves by a pixel.

   Seven no longer fit at 1024x768 and the row scrolls instead, which is the cost
   and is the arrangement the rail was built for: ./zone.ts has scrolled this row
   since it existed and HAND_ACROSS above already says an eight-card hand goes
   past the end. Seven 88px faces and their gaps are 664px of row against 556.3,
   so about 5.9 of the 7 are in view and the seat pod's count is what says the
   rest are there. The alternative measured against it was leaving the face at
   71.5 and lowering ../card.ts's threshold instead, which is mtg-rgc.9.1's
   named non-answer: it would draw rules text nobody can read rather than a card
   that is too small.

   flex: 0 0 auto rather than the grow-and-cap pair this rule used to be. The old
   basis of 0 made every slot claim an equal share of the row and the cap stopped
   it, which is the same width as this while the cap binds and cannot express a
   floor at all — a share of a row is exactly the thing that has no lower bound.
   Zero shrink is what sends the overflow to the scroller instead of back into the
   face.

   A slot with nothing in it is excluded by name. ./slot.ts draws an empty place
   as a 2.25rem marker rather than as a card (EMPTY_SLOT_HEIGHT_REM has the
   measurement and mtg-ej5 has the reason), it declares that at the same
   specificity this block has, and this block is later — so without the :not the
   hand's empty places would be card-sized boxes again, which is the exact defect
   that measurement removed. The rail draws seven places for an opening hand, so
   every hand under seven cards has them. */
${TABLE} .mtg-slot[data-slot='hand']:not([data-empty='true']) {
  flex: 0 0 auto;
  width: min(
    var(--hand-face-cap),
    max(
      calc((100% - var(${HAND_BASIS_TRIM_VAR}) - ${String(HAND_ACROSS - 1)} * ${HAND_GAP}) / ${String(HAND_ACROSS)}),
      var(--hand-face-floor)
    )
  );
  height: auto;
  aspect-ratio: ${RATIO};
  min-height: 0;
}
/* And a hand that scrolls says so, in the words ./fit.ts's spell row already
   uses. The row has always been able to overflow and never had to at seven
   cards; it does now at 1024x768, and a scroller nobody can see is a card in
   hand the player has no reason to look for. scrollbar-color set to anything but
   auto is what makes Chromium draw the classic always-visible bar instead of the
   overlay one, and thin pays back most of the height that costs — 10px of the
   zone where it overflows, nothing at all where it does not. */
${TABLE} .mtg-board__side[data-seat='you'] > .mtg-zone[data-tone='rail'] > .mtg-zone__body {
  scrollbar-width: thin; scrollbar-color: var(--mtg-line-strong) transparent;
}
/* And the face fills it on the axis the slot is sized on. Width-driven, so the
   height is the trim's answer rather than a second opinion about it. */
${TABLE} .mtg-slot[data-slot='hand']:not([data-empty='true']) > .mtg-card {
  width: 100%; height: auto; max-height: none; min-height: 0;
  aspect-ratio: ${cssNumber(CARD_TRIM_MM.width)} / ${cssNumber(CARD_TRIM_MM.height)};
}
/* And what the face does with the height it has, which is the half of the
   question the slot's width cannot answer. HAND_RULES_LADDER above carries the
   distribution it is chosen from, the floor under the picture, and the larger
   face it was chosen instead of. */${HAND_RULES_CSS}
/* How wide a hand slot would be on this row, which is the unit a battlefield
   face is stated in.

   It is a custom property on the *row* rather than a length in the slot rules
   because of where a percentage resolves. Both battlefield rows have the same
   available-width shape now that a concealed opposing hand is represented only
   by the public count in its seat pod.

   A percentage inside a custom property is substituted rather than resolved, so
   the 100% here still resolves against the slot's own containing block, which is
   this row. That is the whole reason the property works: it moves *which row's*
   width is named without moving what the percentage is measured against.

   It carries no --mtg- prefix, for the reason ../card.ts's --name-scale
   carries none: that prefix is the design vocabulary, declared once in
   ../tokens.ts and checked against every reference by ../../test/tokens.test.ts,
   and this is one sheet publishing a number to itself two selectors later. */
${TABLE} .mtg-board__spells {
  --hand-slot: min(
    var(--board-width-basis-cap),
    calc((100% - ${String(HAND_ACROSS - 1)} * ${HAND_GAP}) / ${String(HAND_ACROSS)})
  );
}
/* The battlefield grows from the same available-width basis as the hand, with
   its own ceiling and a name-legibility floor. On a narrow screen the floor may
   exceed a seven-card hand slot: one permanent remains readable and its row
   scrolls, while the denser hand keeps all seven cards in view.

   Seat-blind because both rows publish the same width basis above. */
${TABLE} .mtg-board__spells {
  --board-face-max: ${cssNumber(BOARD_FACE_MAX_REM)}rem;
}
${TABLE} .mtg-board__spells:has(> .mtg-slot:nth-child(8)) {
  --board-face-max: ${cssNumber(CROWDED_BOARD_FACE_MAX_REM)}rem;
}
@media ${SHORT_TABLE_QUERY} {
  ${TABLE} .mtg-board__spells:has(> .mtg-slot:nth-child(8)) {
    --board-face-max: ${cssNumber(SHORT_CROWDED_BOARD_FACE_MAX_REM)}rem;
  }
}
@media (min-width: ${String(THREE_COLUMN_MIN_WIDTH_PX)}px) {
  ${TABLE} .mtg-board:has(.mtg-board__divider[data-combat='true']) .mtg-board__spells {
    --board-face-max: clamp(
      ${cssNumber(BOARD_FACE_MIN_REM)}rem,
      calc((100vh - ${cssNumber(COMBAT_BOARD_VERTICAL_CHROME_REM)}rem) / 4),
      ${cssNumber(BOARD_FACE_MAX_REM)}rem
    );
  }
}
/* And off combat, the row says how tall it is, which is the half of the question
   the width basis above cannot answer.

   A seventh of the row's width is a proxy for the room a face has, and measured
   over ../../../tools/hand-scale.ts in chrome-headless-shell 151 it is wrong by
   most of a card: at 1024x768 a seventh of a 556.3px row is a 72px face, whose
   56px content box is under ../card.ts's BOARD_RULES_MIN_REM and under its
   BOARD_TYPE_LINE_MIN_REM, so no permanent on that table drew a type line or a
   rules box at any board size - while the row it sat in was 170.4px tall and the
   slot inside it 100.6, which is 67.6px of the row's height spent on nothing.
   The width basis had no way to see that, because a row's height is the one
   thing a length in the row's own width cannot be a proxy for.

   So the row is a size query container and the face is the largest card that
   fits it on both axes: the width basis or a complete face, whichever is larger,
   and then never more than the row's height affords. Container query units
   resolve against the content box, which is this row less ./zone.ts's block
   padding, and the share is BOARD_FACE_MAX_SHARE - the same share the slot's own
   height guard uses, so where this term binds the guard under it is exactly
   non-binding rather than a second opinion about the same number.

   **Off combat, and that boundary is a flex base size rather than a preference.**
   Size containment makes a row's content stop contributing to its flex basis,
   which is free where the two lanes grow equally and is not free where they do
   not: ./band.ts gives the near lane NEAR_GROW_IN_COMBAT while the far lane
   keeps 1, so with both bases at zero the stated factors land undiluted.
   Measured at 1440x900 over ../../../tools/combat-zone.ts with one attacker
   declared, containing the row in combat moves the two spell rows from
   188.6/221.8 to 139.5/270.9 and the two seats stop drawing the same size face.
   That is a change to how combat divides the table, which is ./band.ts's
   decision and not this one's, so the combat board keeps the ceiling it had.
   What protects it instead is ./slot.ts's height guard on the rotated face,
   which is where the same shortfall was being paid in clipped words. */
${TABLE} .mtg-board:not(:has(.mtg-board__divider[data-combat='true'])) .mtg-board__spells {
  container-type: size;
}
/* The battlefield and hand grow together until their independent ceilings.
   Extra width after that becomes usable mat rather than ever-larger cards. At
   eight permanents the lower ceiling leaves room for the row's scrollbar; each
   slot keeps that width, so tap state cannot change which axis flexbox shrinks.

   Width-driven, so the height is the trim's answer rather than a second opinion
   about it and the slot is the size of the face inside it on both axes — which
   is what keeps ./slot.ts's corner marks on the card. The height floor goes back
   to zero for the reason the hand slot puts it back: ./fit.ts's MIN_SLOT_REM is
   a height, and a slot whose height comes from its width has no use for one that
   does not come down with it. MIN_SLOT_WIDTH_REM is the floor that still binds,
   and it binds on the axis the size is now stated on.

   An empty place is excluded here for the reason the hand slot excludes one, and
   it is the same rule of ./slot.ts's being outweighed: without it a battlefield
   with room in it drew four markers at 85% of the row, which is bigger than the
   card-sized boxes mtg-ej5 removed. */
${TABLE} .mtg-board__spells > .mtg-slot:not([data-empty='true']) {
  --board-face: clamp(
    ${cssNumber(BOARD_FACE_MIN_REM)}rem,
    var(--hand-slot),
    var(--board-face-max)
  );
  flex: 0 0 auto;
  width: var(--board-face);
  height: auto; min-height: 0;
  max-height: ${cssNumber(BOARD_FACE_MAX_SHARE)}%;
  align-self: center;
}
/* And where the row is a container, the same face bounded by the room it is in.

   Stated here on the slot and not on the row, and that is where a container
   query unit resolves rather than a preference: a cqh in a declaration on the
   query container itself resolves against that container's *own* ancestor
   container, so the row asking its own height is the one question it cannot ask.
   A slot is a descendant, so its cqh is the row's. The percentage inside
   --hand-slot resolves against the slot's containing block, which is this same
   row, so reading it a level down moves neither number.

   min() around the row's height and max() around the width basis, in that order:
   a face may grow past a seventh of the row to a complete one, and may never
   grow past what the row can hold. The other order was measured and is the
   defect being removed rather than a second way to write it - taking the larger
   of the two leaves a slot stated taller than its row, and a row clips.

   It carries the same :not() the container above does, because a cqh with no
   size container over it resolves against the small viewport, which is not a
   row. */
${TABLE} .mtg-board:not(:has(.mtg-board__divider[data-combat='true'])) .mtg-board__spells > .mtg-slot:not([data-empty='true']) {
  --board-face: clamp(
    ${cssNumber(BOARD_FACE_MIN_REM)}rem,
    min(
      calc(${cssNumber(BOARD_FACE_MAX_SHARE)}cqh * ${cssNumber(CARD_TRIM_MM.width)} / ${cssNumber(CARD_TRIM_MM.height)}),
      max(var(--hand-slot), ${cssNumber(FACE_COMPLETE_REM)}rem)
    ),
    var(--board-face-max)
  );
}
/* And the face inside it keeps the trim's shape even where the cap above binds,
   which is the one thing the pair of them could not do on their own. Read in
   order: the slot's width is stated, ./fit.ts's aspect-ratio fills in its height,
   and then the cap trims that height without the width coming down with it - so
   a capped slot is not the trim's shape, and a face declared width: 100% under a
   max-height: 100% took the box's shape instead of its own. Measured before this
   rule at 1280x800 with four permanents a side and the side panel shut, a face
   was drawn 108.7 x 107.5, a ratio of 1.011 against the printed trim's 0.716.

   Stating the face's height instead makes it the smaller of the two terms rather
   than one of them: the height is the slot's, which is already min(what the
   width asked for, what the row allows), and the width is read back off that
   through the ratio. Where the cap does not bind - which is every viewport in
   the open state, and ./hand.ts's BOARD_FACE_MAX_SHARE has the measurement - the
   two terms are equal and nothing moves by a pixel.

   The height guard can bind when closing the side panel makes the lane wider
   without giving the battlefield more vertical room.

   Aligned to the inline start rather than centered, and that is the corner marks
   rather than a preference. ./slot.ts positions them against the *slot*, so a
   face centered in a slot wider than itself floats the ATK and power/toughness
   badges 15.8px clear of the card at the worst reading, which is exactly the
   defect mtg-yi5 reported. Sharing the start edge keeps them on the card and
   spends the slack as gap between permanents instead.

   A tapped face is excluded by name: ./slot.ts rotates it a quarter turn and
   sizes it off the square slot's width, which is a different sentence with the
   same purpose, and this selector would outweigh it. */
${TABLE} .mtg-board__spells > .mtg-slot:not([data-empty='true']):not([data-tapped='true']) > .mtg-card {
  width: auto; height: 100%; max-width: 100%; margin-inline-end: auto;
}
/* A tapped slot reserves the long side of the same face before rotating it.
   The short-table and crowded-row ceilings above keep that request below the
   row's height guard; a zero shrink factor keeps flexbox from shrinking only the
   tapped slot's wider row-axis box. */
${TABLE} .mtg-board__spells > .mtg-slot[data-tapped='true']:not([data-empty='true']) {
  width: calc(var(--board-face) * ${cssNumber(CARD_TRIM_MM.height)} / ${cssNumber(CARD_TRIM_MM.width)});
}
`;
