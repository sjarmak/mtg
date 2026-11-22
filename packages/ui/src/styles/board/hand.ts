/**
 * Responsive geometry for cards on the played table.
 *
 * A hand lays out seven slots across, never narrower than a complete face.
 * Battlefield cards keep the original 11rem row-width basis. Both zones stop
 * growing at the same 10rem face, crowded rows scroll at a readable size, and so
 * does a hand whose seven no longer fit.
 *
 * The rule between the two zones is PARITY, and it is the playtester's call
 * (`mtg-gohr`, 2026-09-03): on a table, on a sparse board, off combat, a held
 * card and a permanent draw the same size within a tolerance. Neither of the two
 * sentences this file and `../../../tools/hand-scale.ts` used to carry survived
 * her reading of them — one said the board outranks the hand, the other said
 * the hand outranks the board, and they were written eleven days apart. The
 * evidence for neither is in Magic Online: measured off three of Wizards' own
 * client screenshots, the same client draws a permanent at 0.82, 1.26 and 2.29
 * times its hand card, because the player sizes the zones. So there is no ratio
 * to copy, and what is left is that the card you are deciding from and the card
 * you are deciding about should not be two different sizes for no reason.
 *
 * Three exceptions, each measured rather than assumed, and each one a rule in
 * this file rather than a caveat about it:
 *
 * - CROWDING. Past seven represented permanents in a row, the hand becomes a
 *   labeled 48px thumbnail rail and direct board places keep a 72px floor before
 *   they wrap. Rows remain direct through nine nonland places; at ten, their
 *   exact-state duplicate cohorts may pile. the playtester chose battlefield
 *   legibility over hand parity on 2026-09-07 and deferred duplicate compaction
 *   to ten board places on 2026-09-12.
 * - COMBAT. `COMBAT_HAND_FACE_MAX_REM` spends the vertical budget on the rows
 *   while there are attackers on the table, so there the board draws larger and
 *   the hand is a labeled 56px thumbnail rail. the playtester accepted that explicit
 *   exception on 2026-09-07.
 * - A WINDOW THAT IS NOT A TABLE. Below the three-column table and outside the
 *   upright-tablet band the hand sits on `./fit.ts`'s slot floor at 48px beside
 *   a 100px permanent, because seven complete faces are 700px of row on a 390px
 *   phone. the playtester accepted that as a labeled thumbnail rail on 2026-09-07;
 *   the fixed zoom remains the reading surface.
 *
 * Measured at the parity ceiling, resting board, five-card hand, held card
 * against the viewer's permanent: 1024x768 88/87.8, 1280x801 101.1/101.1,
 * 1440x900 124/124, 1920x1080 and every wider viewport 160/160, 768x1024 and
 * 810x1080 100/100. The two short-table cells are the tolerance: 1280x800
 * 88/100 and 1392x766 88/98.4, and `SHORT_TABLE_HAND_FACE_MAX_REM` is where the
 * sweep that says why lives.
 *
 * The slot height follows the printed trim. `min-height: 0` is required
 * because a preferred aspect ratio otherwise takes its content as an automatic
 * minimum and can defeat the row's maximum.
 */
import { CARD_TRIM_MM } from '../../card/anatomy';
import { cssNumber } from '../number';
import { TRAY_BLOCK_CHROME_PX } from './attach';
import { MIN_SLOT_WIDTH_REM } from './fit';
import { PLAY, playedPlace, playedSlot, RATIO, TABLE, THREE_COLUMN_MIN_WIDTH_PX } from './geometry';
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
 * Battlefield cards grow with the available row until they reach this width.
 *
 * It is declared here, above the hand's ceiling rather than beside its crowded
 * and short-table variants, because the hand's ceiling is this one: the parity
 * rule is a single number with two names, and two `10`s written out separately
 * would be free to drift apart.
 */
const BOARD_FACE_MAX_REM = 10;

/**
 * The hand's ceiling, which is the board's ceiling: this is the parity rule as a
 * number.
 *
 * It was 7.5rem, and the sentence under it said a wide monitor should reveal
 * more table rather than turn the hand into seven poster prints. That is the
 * hierarchy `mtg-gohr` retired: what 7.5 against `BOARD_FACE_MAX_REM`'s 10
 * actually drew was a held card three quarters the size of the permanent it was
 * about, on every window from 1920 up — 120px against 160 — while the two
 * zones were the same size at 1024x768 and at 1440x900, where neither ceiling
 * binds. So the hierarchy was not a hierarchy, it was a ceiling that only
 * appeared on large screens.
 *
 * Raising it to the board's is the whole change, and it is free rather than a
 * trade: measured over `../../../test/play/battlefield-geometry.browser.test.ts`'s
 * resting fixture at fifteen viewports, the battlefield face is identical at
 * every one of them (160 at 1920x1080 and above, 124 at 1440x900), the page
 * overflows on neither axis, and the whole `browser` project is unchanged. The
 * hand is height-capped by its own row and by `--hand-face-floor` long before
 * this ceiling binds anywhere under 1440px wide.
 */
export const HAND_FACE_MAX_REM = BOARD_FACE_MAX_REM;

/**
 * The battlefield's width basis, which is not the hand's and never was.
 *
 * A board face is sized from the row it sits in and then capped; this is the
 * basis half, kept at the measured 11rem while the two ceilings met at 10.
 */
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
 *
 * **What the number buys, measured** (`mtg-zhbz`, 2026-08-27,
 * `../../../tools/combat-cap.ts`: four boards, six viewports, ten ceilings).
 * Nothing clips at any of them, including with the rule deleted — no face, no
 * mana tile, no hand card, no band entry, and neither the page nor the table
 * overflows on the block axis. So this is not what keeps the combat board from
 * cutting a card; `./slot.ts`'s height guard on the rotated face is, which is
 * what the comment under the rule below already says. The hand does not move
 * with it either: its face is identical at all ten ceilings.
 *
 * What it does decide is a trade with no winner in it. On a sparse board it only
 * shrinks the face — at 1440x900 the row can afford 129.2px of card width, an
 * unbound face draws 124.0, and this number draws 105.5. On a crowded board the
 * row overflows on the inline axis, so a smaller face is more permanents
 * reachable without scrolling: at 1392x766 this number shows 8 of the near
 * seat's 12 where deleting the rule shows 7 and a flat 10rem ceiling shows 6.
 * The 8.2px the bead's first note measured off the near mana band at 1440x560 is
 * real and is the clamp's floor rather than this subtraction — there the
 * arithmetic yields 20.5px and every chrome number from 20rem to 36rem lands on
 * the same 4.5rem floor.
 *
 * So 29.875 stays: no swept value dominates it, and card size against
 * reachability is not a choice pixels can make. Moving it is a decision, and
 * `../../../test/play/combat-cap.browser.test.ts` is what makes it one — before
 * that test, deleting this rule outright left the whole `browser` project and
 * every `@mtg/ui` unit test byte-identical to baseline.
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
 * **A fourth reading used to hold the line at 800, and no longer does.** On the
 * full table at eight a side, a row that mixes tapped and upright permanents
 * drew them at two different sizes, and moving 800 to the tall arm failed
 * `../../../test/play/table-allocation.browser.test.ts`'s one-size-per-seat
 * assertion at 103.3 tapped against 96.9 upright. That was `mtg-6hhr`'s defect
 * rather than this bound's — the rotated face's height guard read the slot's
 * whole height where the upright face read the printed share of it — and
 * `08dc7ae8` fixed it at the guard. Re-measured on the tall arm afterwards, the
 * split is gone: 1280x801, 1360x801, 1400x801 and 1440x801 all read parity at
 * eight and at twelve a side, on rows carrying 126 to 786px of sideways scroll,
 * and those four cells are in the rig now so it cannot come back unmeasured.
 *
 * So the condition this bound was waiting on has been met, and what is left is
 * to re-measure the other three readings and decide: `mtg-rkld` owns that, and
 * 800 stays short until it answers.
 * `../../../test/play/short-table-boundary.browser.test.ts` pins both faces at
 * 1280x800 and at 1280x801 so the line cannot move by accident either way.
 */
const SHORT_TABLE_MAX_HEIGHT_REM = 50;

/** The lower picture/rules strip a following wrapped row may cover, never the name. */
const CROWDED_ROW_FAN_REM = 4;

/**
 * The narrowest window `TALL_NARROW_TABLE_QUERY` below will floor a hand face
 * in: 768px, an upright tablet's short edge.
 *
 * Named as a width rather than as a device because what it is bounding is the
 * room, and it sits above `../mobile.ts`'s `PHONE_MAX_REM` by a whole band on
 * purpose. It is restated here rather than imported because `../mobile.ts`
 * imports this file, so the arrow cannot run the other way;
 * `../../../test/play/hand-floor-band.browser.test.ts` pins the two numbers
 * against each other so the gap between them stays deliberate, and measures the
 * band's two edges.
 */
const TALL_NARROW_TABLE_MIN_WIDTH_REM = 48;

/**
 * The short table's own condition, written once because two rules ask it.
 *
 * They asked it twice in two files' worth of scrolling and had to be kept in
 * step by hand; `mtg-2s2k` needed to move the comparison and found the second
 * copy by grep.
 */
const SHORT_TABLE_QUERY = `(min-width: ${String(THREE_COLUMN_MIN_WIDTH_PX)}px) and (max-height: ${cssNumber(SHORT_TABLE_MAX_HEIGHT_REM)}rem)`;

/**
 * The narrowest table that is still tall enough to seat a complete hand face,
 * and the second arm of the floor below.
 *
 * A tablet held upright is under `THREE_COLUMN_MIN_WIDTH_PX` and is not a phone,
 * and the floor's first arm alone left that band with the smallest face on the
 * table in the zone the player reads most: measured 2026-08-28 at 810x1080 and
 * 768x1024 in chrome-headless-shell 1234 over `../../../tools/hand-scale.ts`,
 * a held card came out 48x67 against a 100x139.7 permanent, drew no rules box
 * at all where every permanent beside it drew one, and read 0.48 of the face it
 * was being played onto. 48px is `./fit.ts`'s `MIN_SLOT_WIDTH_REM`, so the hand
 * was on a floor the battlefield does not share — its own is
 * `BOARD_FACE_MIN_REM` at 72px, and the row it sits in reads its height as well
 * as its width while the hand slot is a seventh of a row and nothing else. A
 * tall narrow window is exactly where a width-only basis is furthest from the
 * room that is there: the seat had 641px of column and spent 95 of it on the
 * hand. `mtg-g52`.
 *
 * Both bounds are what the floor cannot afford to cross rather than device
 * names. 48rem is 768px, the narrowest upright tablet, and holds the floor off
 * the 641-to-767 band where the table is cramped on both axes anyway — at
 * 700x900 a permanent is already 55.5px, and a hand card floored at 100 would
 * be twice the card it is played onto. 50rem is `SHORT_TABLE_MAX_HEIGHT_REM`,
 * the same line the short table is drawn at, and it is what keeps a landscape
 * phone out: 844x390 clears the width and fails the height, which is the
 * shape the first arm's own note measured against.
 */
const TALL_NARROW_TABLE_QUERY = `(min-width: ${cssNumber(TALL_NARROW_TABLE_MIN_WIDTH_REM)}rem) and (min-height: ${cssNumber(SHORT_TABLE_MAX_HEIGHT_REM)}rem)`;

/** A row past seven permanents shrinks toward this readable face ceiling. */
const CROWDED_BOARD_FACE_MAX_REM = 7;

/** The crowded-row ceiling when the three-column table is also short. */
const SHORT_CROWDED_BOARD_FACE_MAX_REM = 5.25;

/** A crowded table uses the same 48px thumbnail floor as the phone tier. */
export const CROWDED_HAND_FACE_MAX_REM = MIN_SLOT_WIDTH_REM;

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
export const FACE_COMPLETE_REM = 6.25;

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
 * over `../../../tools/card-uniformity.ts`, a 1280x800 board at four a side went
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
 * `./mat.ts`'s different arrangement rather than this ladder's narrow end.
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
 * `BOARD_RULES_PANEL_MAX_REM`, so a hand card sized like Magic Online's puts every
 * permanent on the table under the threshold where its rules box stops taking its
 * own height and draws over its picture instead — `mtg-u69`'s defect moved one
 * zone over, and `mtg-8kc` turned that from a card with no text into a card whose
 * text costs the picture — and 57.9 is under `BOARD_FACE_MIN_REM`, which is where a name starts
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

/**
 * The board is in combat, as the condition every rule here asks it by.
 *
 * Five rules in this file turn on it and each one used to spell it out. That
 * was one declaration per reader of a selector whose *weight* is the thing two
 * of them are settled by — `mtg-a7hm` is what it cost to have it written five
 * times and reasoned about once — so it is written here and read there, the way
 * `./geometry.ts` holds `TABLE` for the same reason.
 *
 * Composed onto `.mtg-board` rather than including it, because two of the five
 * readers negate it (`:not(${COMBAT_BOARD})`) and one reaches a descendant
 * through it, and a selector that carried its own subject could do neither.
 */
const COMBAT_BOARD = `:has(.mtg-board__divider[data-combat='true'])`;

/**
 * The most cards the hand row divides itself by before it only scrolls.
 *
 * Twelve because a complete face is the floor either way: twelve 100px faces
 * and their gaps are 1288px, wider than the hand row at every viewport the rigs
 * measure, so a thirteenth divisor would only ever resolve to the floor too.
 */
const HAND_FIT_MOST = 12;

/**
 * A hand of more than seven shares its row out before it scrolls.
 *
 * The seventh below is the parity rule's — a held card the width of a permanent
 * at rest — and an opening hand never asks for more. Past seven it hid the card
 * just drawn: on the draw at 1440x900 the eighth card sat beyond the row's right
 * edge (1056px of cards in a 924px row), the newest card in hand was the one out
 * of sight, and the only sign of it was a 10px scrollbar under 180px of empty
 * lane. So a hand of `n` cards divides the row by `n`, still floored at the
 * complete face and capped at the hand's ceiling: eight fit at 1440x900, and
 * where `n` faces cannot clear the floor the row scrolls exactly as before.
 *
 * Counted with `:has()` on the row because nothing else in the sheet knows the
 * count; a filled eighth child implies eight cards, since `../../board/Hand.ts`
 * draws empty places only under seven. Scoped to the seat's own hand lane off a
 * dragged seam: a dragged seam sizes the slot from the height the player chose,
 * and the command zone's hand slots are not this row. `PLAY` rather than `TABLE`
 * because the replay viewer sizes its hands in `../replay.ts` and wins there only
 * by order; a rule this specific would take its eight-card frames from it.
 */
const HAND_FIT_CSS = Array.from({ length: HAND_FIT_MOST - HAND_ACROSS }, (_unused, index) => {
  const held = HAND_ACROSS + 1 + index;
  return `
${PLAY} .mtg-board__side[data-seat='you']:not([data-seam='true']) > .mtg-zone[data-tone='rail'] > .mtg-zone__body:has(> .mtg-slot[data-slot='hand']:not([data-empty='true']):nth-child(${String(held)})) > .mtg-slot[data-slot='hand']:not([data-empty='true']) {
  width: min(
    var(--hand-face-cap),
    max(
      calc((100% - var(${HAND_BASIS_TRIM_VAR}) - ${String(held - 1)} * ${HAND_GAP}) / ${String(held)}),
      var(--hand-face-floor)
    )
  );
}`;
}).join('');

export const HAND_CSS = `
${TABLE} .mtg-board {
  --hand-face-cap: ${cssNumber(HAND_FACE_MAX_REM)}rem;
  --board-width-basis-cap: ${cssNumber(BOARD_WIDTH_BASIS_MAX_REM)}rem;
  --hand-face-floor: 0px;
  ${HAND_BASIS_TRIM_VAR}: calc(${cssNumber(PLAY_RAIL_REM)}rem - var(${RAIL_WIDTH_VAR}));
}
/* The complete-face floor is the three-column table's, and one band under it.

   Below 901px the mat is a different arrangement (./mat.ts) with a different
   thing to spend height on, and the floor is a claim about a table whose two
   lanes each hold a battlefield. Measured at 390x844 in chrome-headless-shell
   151 over ../../../test/play/battlefield-geometry.browser.test.ts, letting a
   43.1px hand slot jump to a complete face took enough off both lanes to split
   the far side's own base width — a tapped permanent came out 72px against an
   upright 69.2, and that test's whole subject is the two being one number.
   A phone hand is unreadable at either size and the fix for it is a phone's,
   not a floor borrowed from a 1024px table.

   The second arm is TALL_NARROW_TABLE_QUERY above, and it is the band that note
   never measured: an upright tablet is neither a phone nor a three-column
   table, and with the first arm alone it drew the smallest face on the table in
   the hand — 48x67 against a 100x139.7 permanent, no rules box on any of the
   seven, 0.48 of the card being played onto (mtg-g52). The floor reaches it and
   stops there. A landscape phone fails the height bound and the cramped
   641-to-767 band fails the width bound, so the shape the note above measured
   is still outside.

   What it costs is the overview, and the cost is stated rather than hidden: at
   768x1024 the seat's hand row went from five of seven faces in view to two,
   and at 810x1080 from six to three, because 347px of column cannot hold seven
   complete faces at any floor. The row says so — ../fit.ts paints
   .mtg-board__spells a thin scrollbar, measured as a 10px gutter on exactly the
   rows that overflow — and the arrangement is the 1024x768 table's already,
   where five of seven are in view against an 88px face. The battlefield pays
   nothing: a permanent measured 100x139.7 before and after, and the height the
   hand took came out of the seat's slack rather than off the far lane. */
@media (min-width: ${String(THREE_COLUMN_MIN_WIDTH_PX)}px), ${TALL_NARROW_TABLE_QUERY} {
  ${TABLE} .mtg-board {
    --hand-face-floor: ${cssNumber(FACE_COMPLETE_REM)}rem;
  }
}
/* A crowded board lowers the hand cap, and off combat is where it may.

   Both this rule and the combat one below it exist only to make the hand
   smaller, and until \`mtg-a7hm\` they were settled against each other by
   weight: a \`:has()\` carrying a class, an \`:is()\` and an \`:nth-child()\`
   outranks one carrying a class and an attribute, so on a board that was both
   the 7rem won and the 3.5rem did nothing. Measured on \`../../../tools/combat-board.ts\`'s
   \`crowded-tapped\` fixture, the hand drew 112px at 1440x900 and 84 at 1280x800
   where the same board off a crowded row drew 56. A rule that only ever narrows
   the hand had undone another rule that only ever narrows the hand, and the
   busier the table the larger the cards it drew over it.

   Excluded rather than restated, because "the crowded cap is the one for a board
   that is not in combat" is the rule, and \`--board-face-max\` two blocks down is
   already written that way round — its combat ceiling is the heavier selector,
   which is why the battlefield face was combat's on a crowded board while the
   hand was not. \`../mobile.ts\` found the same fight on a landscape phone and
   answered it by restating the combat value under the crowded selector; that
   arm is left alone, because a phone's tier wins on order and has no fight to
   settle here. */
${TABLE} .mtg-board:has(.mtg-board__spells[data-crowded='true']):not(${COMBAT_BOARD}) {
  --hand-face-cap: ${cssNumber(CROWDED_HAND_FACE_MAX_REM)}rem;
}
@media ${SHORT_TABLE_QUERY} {
  ${TABLE} .mtg-board {
    --hand-face-cap: ${cssNumber(SHORT_TABLE_HAND_FACE_MAX_REM)}rem;
    --board-width-basis-cap: ${cssNumber(SHORT_TABLE_BOARD_WIDTH_BASIS_MAX_REM)}rem;
  }
  ${TABLE} .mtg-board:has(.mtg-board__spells[data-crowded='true']):not(${COMBAT_BOARD}) {
    --hand-face-cap: ${cssNumber(CROWDED_HAND_FACE_MAX_REM)}rem;
  }
}
${TABLE} .mtg-board${COMBAT_BOARD} {
  --hand-face-cap: ${cssNumber(COMBAT_HAND_FACE_MAX_REM)}rem;
}
/* A constrained hand is a labeled thumbnail rail, not a failed card row.

   The normal table keeps the head out of the way and preserves hand-to-board
   parity. Combat and a row with eight directly represented places spend that
   height on the battlefield instead. The cards stay selectable and retain
   their full hover/focus detail; the visible note names the deliberate mode. */
${TABLE} .mtg-board${COMBAT_BOARD} .mtg-board__side[data-seat='you'] > .mtg-zone[data-tone='rail'] > .mtg-zone__head,
${TABLE} .mtg-board:has(.mtg-board__spells[data-crowded='true']) .mtg-board__side[data-seat='you'] > .mtg-zone[data-tone='rail'] > .mtg-zone__head {
  display: flex;
  position: absolute; inset-block-start: 50%; inset-inline-start: var(--mtg-space-2);
  inline-size: 5rem; max-inline-size: 5rem; translate: 0 -50%; z-index: 1;
  padding-inline: var(--mtg-space-1);
  background: var(--mtg-surface-rail);
  flex-wrap: wrap; overflow-wrap: anywhere;
  font-size: var(--mtg-text-xs); line-height: 1;
}
${TABLE} .mtg-board${COMBAT_BOARD} .mtg-board__side[data-seat='you'] > .mtg-zone[data-tone='rail'],
${TABLE} .mtg-board:has(.mtg-board__spells[data-crowded='true']) .mtg-board__side[data-seat='you'] > .mtg-zone[data-tone='rail'] {
  position: relative;
  /* A 48/56px thumbnail is the whole rail, not a full card floating inside the
     ordinary rail's two layers of hover-halo padding. Keeping both layers
     would spend 16px of scarce block space on chrome after the card was
     deliberately reduced. */
  padding-block: 0; padding-inline-start: 5.75rem;
}
${TABLE} .mtg-board${COMBAT_BOARD} .mtg-board__side[data-seat='you'] > .mtg-zone[data-tone='rail'] > .mtg-zone__body,
${TABLE} .mtg-board:has(.mtg-board__spells[data-crowded='true']) .mtg-board__side[data-seat='you'] > .mtg-zone[data-tone='rail'] > .mtg-zone__body {
  padding-block: 0;
}
/* The row is as tall as its cards and no taller: the zone takes no share of the
   column's height, so what the hand does not need is the battlefield's. */
${TABLE} .mtg-board__side[data-seat='you'] > .mtg-zone[data-tone='rail'] { flex: none; }
/* And the divider itself, which costs the lane nothing to draw.

   .mtg-split is display: none until a surface places it (../panel.ts), and
   this is the placement. It is drawn on every table rather than only on a
   dragged one, because a control nobody can find is a control nobody has: the
   whole of it is a 2px line in the 8px gap the lane already leaves between the
   step bar and the hand.

   The negative margins are the draft divider's, for the reason ../panel.ts
   gives there: a handle between two children of a gapped column costs its own
   8px *and* a second 8px gap, and this lane's height is spent on cards. One
   gutter back either side leaves the undragged table the pixels mtg-gohr
   measured, which is what ../../../test/play/hand-seam.browser.test.ts asserts
   before it drags anything. */
${TABLE} .mtg-board__side[data-seat='you'] > .mtg-split {
  display: block;
  margin-block: calc(var(--mtg-space-2) * -1);
}
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
   (mtg-s3re). Measured in chrome-headless-shell 151 over ../../../test/play/
   hand-allocation.browser.test.ts, a 1024x768 table gave the row 556.3px, a
   seventh of it is a 71.5px face, and on the face of that date — 4px of border
   and 4px of padding a side, before mtg-iqyc made the band proportional — 71.5
   left a 55.5px content box, under ../card.ts's BOARD_RULES_PANEL_MAX_REM. So
   none of the seven cards in the opening hand drew a word of rules text at any
   board size, while a permanent beside them was 100px and drew all of it. (That
   threshold hid the box outright until mtg-8kc; the same face today draws a panel
   over its picture, which is a cost rather than a silence.) The
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
}${HAND_FIT_CSS}
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
/* And where the player has dragged the seam, the row is as tall as they said.

   mtg-7rhk. Everything above this line is a default, and mtg-gohr is what
   made the difference matter: parity is the right answer for somebody who has
   not said how they want the lane divided, and it is nobody's answer to how
   they want it divided. ../../routes/play/hand-seam.ts is the control and
   carries the rest of the argument; this is the arm of the sheet it writes to.

   **Three declarations, because a dragged hand is sized on the other axis.** A
   hand slot above is width-driven off a seventh of its row and the printed trim
   answers for the height, which is why nothing about this row's height decides
   how big a held card is. Under a seam the row is given a height, the slot
   stretches to it, and the trim answers for the width instead. So the zone takes
   the height (the body has to grow into it, which is the second rule, since the
   row is flex: none above and would otherwise stay as tall as its cards), and
   the slot takes align-self: stretch with width: auto (the third).

   min-content rather than a typed floor on the zone, and MIN_SLOT_WIDTH_REM
   rather than a second number under the slot. The floor a dragged hand may not
   pass is ../fit.ts's, which is stated on a *card*; what the zone needs is
   that card plus this row's own chrome, and min-content is that sum derived
   rather than a constant that goes stale the day ./zone.ts changes a padding.

   **After every default it replaces**, which is where this file already puts a
   rule that answers another (the empty-slot marker two blocks up says so in as
   many words). The seam attribute puts every rule in this arm ahead of the
   default it answers on specificity alone, so the order is not what makes them
   win; it is what keeps a reader who has just read a default from having to
   scroll up to find out it was overridden.

   **Empty places are excluded for the third time in this file**, and it is the
   same rule each time: ./slot.ts draws a place with nothing in it as a 2.25rem
   marker, and a marker stretched to a dragged row's height is the card-sized box
   mtg-ej5 removed. align-items: flex-start on the body stays where it is and
   the stretch is asked for per slot, which is what keeps the markers out of it.

   **Not in combat, which is this bead's one open question answered by the
   geometry rather than by preference.** Combat is already a re-division of the
   same lane -- ./band.ts gives the near side NEAR_GROW_IN_COMBAT and the
   ceiling above drops the hand to COMBAT_HAND_FACE_MAX_REM so the fight has
   room -- and a seam that survived it would either fight that ceiling for the
   same pixels or hold a dragged row open with a capped card in it and hand the
   battlefield dead space instead of height. Suspending it is the one answer with
   no second opinion in it: while attackers are declared the table is exactly the
   table mtg-gohr measured, and the seam comes back with the board. The crowded
   and short-table ceilings above are *not* suspended and are overridden on
   purpose, because both are the same default this control exists to replace --
   what stops a crowded board being squeezed by a dragged hand is the battlefield
   face's own floor two blocks down and the limits the handle may be dragged
   between.

   **Measure this arm with a still page.** The whole of it read as a no-op for
   an afternoon -- the zone took the dragged height and the card in it stayed at
   48x67 at every share and every viewport -- and the layout was never the
   subject. ../../../test/support/chrome-driver.ts's stillPage says why in full:
   a rig emulates prefers-reduced-motion, the app answers that with a 1ms
   transition on everything rather than none, and a measurement expression that
   sets data-seam and then reads a box synchronously reads t=0, which is the
   value from before it wrote. ../../../tools/seam-probe.ts wraps its mutating
   expression and the same sweep came back with the numbers in
   ../../routes/play/hand-seam.ts. Nothing about the selectors changed. */
${TABLE} .mtg-board:not(${COMBAT_BOARD}) .mtg-board__side[data-seat='you'][data-seam='true'] > .mtg-zone[data-tone='rail'] {
  block-size: var(--hand-seam);
  min-block-size: min-content;
}
${TABLE} .mtg-board:not(${COMBAT_BOARD}) .mtg-board__side[data-seat='you'][data-seam='true'] > .mtg-zone[data-tone='rail'] > .mtg-zone__body {
  flex: 1 1 auto; min-block-size: 0;
}
${TABLE} .mtg-board:not(${COMBAT_BOARD}) .mtg-board__side[data-seat='you'][data-seam='true'] .mtg-slot[data-slot='hand']:not([data-empty='true']) {
  align-self: stretch;
  width: auto;
  min-height: calc(${cssNumber(MIN_SLOT_WIDTH_REM)}rem * ${cssNumber(CARD_TRIM_MM.height)} / ${cssNumber(CARD_TRIM_MM.width)});
}
/* And the face follows the slot onto the other axis, for the reason the
   width-driven rule above gives from the other side: a card is one rectangle
   and the trim answers for whichever side is not being sized. */
${TABLE} .mtg-board:not(${COMBAT_BOARD}) .mtg-board__side[data-seat='you'][data-seam='true'] .mtg-slot[data-slot='hand']:not([data-empty='true']) > .mtg-card {
  width: auto; height: 100%;
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
   ../tokens.ts and checked against every reference by ../../../test/tokens.test.ts,
   and this is one sheet publishing a number to itself two selectors later. */
${TABLE} .mtg-board__spells {
  --hand-slot: min(
    var(--board-width-basis-cap),
    calc((100% - ${String(HAND_ACROSS - 1)} * ${HAND_GAP}) / ${String(HAND_ACROSS)})
  );
  /* The one-row fit counts actual width pressure, including the long side of a
     tapped face. At the readable floor any residual pressure is handed to
     flex-wrap instead of to a scrollbar or a smaller card. */
  --board-one-row-fit: calc(
    (100% - (var(--board-place-count) - 1) * ${HAND_GAP}) / var(--board-width-units)
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
${TABLE} .mtg-board__spells[data-crowded='true'] {
  --board-face-max: ${cssNumber(CROWDED_BOARD_FACE_MAX_REM)}rem;
}
${TABLE} .mtg-board${COMBAT_BOARD} .mtg-board__spells[data-crowded='true'] {
  --board-face-max: ${cssNumber(BOARD_FACE_MIN_REM)}rem;
  min-height: calc(
    2 * ${cssNumber(BOARD_FACE_MIN_REM)}rem * ${cssNumber(CARD_TRIM_MM.height)} / ${cssNumber(CARD_TRIM_MM.width)}
    - ${cssNumber(CROWDED_ROW_FAN_REM)}rem
  );
  column-gap: 0;
}
/* At 1024px a twelve-place tapped row is the only measured combat row that
   needs three lines: six long edges do not fit. Pay for the visible extent of
   its final rotated face only there; wider rows keep the two-line floor above. */
@media (max-width: 64rem) {
  ${TABLE} .mtg-board${COMBAT_BOARD} .mtg-board__spells[data-crowded='true']:has(> .mtg-attach > .mtg-slot[data-tapped='true']) {
    min-height: calc(
      3 * ${cssNumber(BOARD_FACE_MIN_REM)}rem * ${cssNumber(CARD_TRIM_MM.height)} / ${cssNumber(CARD_TRIM_MM.width)}
      - 2 * ${cssNumber(CROWDED_ROW_FAN_REM)}rem
      - (${cssNumber(BOARD_FACE_MIN_REM)}rem * ${cssNumber(CARD_TRIM_MM.height)} / ${cssNumber(CARD_TRIM_MM.width)} - ${cssNumber(BOARD_FACE_MIN_REM)}rem) / 2
      + var(--mtg-space-1)
    );
  }
}
/* Once distinct places wrap, their card edges provide the row boundary. Keep
   the ordinary inline gap for scanning left to right, but do not charge a full
   card-to-card gutter again between stacked rows: at 1024x768 that gutter is
   exactly the difference between two complete 72px faces and a clipped first
   row. */
${TABLE} .mtg-board__spells[data-crowded='true'] {
  align-content: flex-start;
  align-items: flex-start;
  min-height: calc(
    ${cssNumber(BOARD_FACE_MIN_REM)}rem * ${cssNumber(CARD_TRIM_MM.height)} / ${cssNumber(CARD_TRIM_MM.width)}
  );
  row-gap: 0;
  column-gap: var(--mtg-space-1);
  /* The wrapped row is no longer an overflow scroller, so its old scrollbar /
     hover-halo reserve is dead chrome on the block axis. */
  padding-block: 0;
}
/* Ten directly rendered places can require three wrapped lines once tapped
   cards spend their long edge on the row axis. Publish that visible extent to
   the lane instead of letting the final face hang below the row. On a phone the
   same population needs a fourth line; the board body remains the scroller, so
   increasing the row's honest content height preserves every exact object. */
${TABLE} .mtg-board__spells[data-crowded='true']:has(> :nth-child(10)) {
  min-height: calc(
    3 * ${cssNumber(BOARD_FACE_MIN_REM)}rem * ${cssNumber(CARD_TRIM_MM.height)} / ${cssNumber(CARD_TRIM_MM.width)}
    - 2 * ${cssNumber(CROWDED_ROW_FAN_REM)}rem
  );
}
@media (max-width: 27rem) {
  ${TABLE} .mtg-board__spells[data-crowded='true']:has(> :nth-child(10)),
  ${TABLE} .mtg-board${COMBAT_BOARD} .mtg-board__spells[data-crowded='true']:has(> :nth-child(10)) {
    min-height: calc(
      4 * ${cssNumber(BOARD_FACE_MIN_REM)}rem * ${cssNumber(CARD_TRIM_MM.height)} / ${cssNumber(CARD_TRIM_MM.width)}
      - 3 * ${cssNumber(CROWDED_ROW_FAN_REM)}rem
    );
  }
}
/* Wrapping spends cross-axis overlap, not the 72px identity floor. In combat
   the row is intentionally not a size container, so its children must publish
   the complete face height that establishes each flex line. */
${playedSlot(`${TABLE} .mtg-board__spells[data-crowded='true']`)}:not([data-empty='true']) {
  min-height: calc(
    ${cssNumber(BOARD_FACE_MIN_REM)}rem * ${cssNumber(CARD_TRIM_MM.height)} / ${cssNumber(CARD_TRIM_MM.width)}
  );
  max-height: none;
}
/* Four complete mixed-tap rows cannot coexist with the side rails once a row
   wraps, even after the hand and mana rail have reached their decided
   constrained sizes. Fan wrapped rows through the lower picture/rules region:
   every identity and name bar remains exposed, the last row remains complete, and
   hover/focus raises the exact permanent being inspected. The trailing reserve
   keeps the last face inside its row while negative end margin shortens each
   line pitch and leaves each name band exposed at the legibility floor. A
   single-line row is unchanged because its reserve and offset cancel. */
${TABLE} .mtg-board__spells[data-crowded='true'] {
  padding-block-end: ${cssNumber(CROWDED_ROW_FAN_REM)}rem;
}
${playedPlace(`${TABLE} .mtg-board__spells[data-crowded='true']`)} {
  position: relative;
  margin-block-end: calc(-1 * ${cssNumber(CROWDED_ROW_FAN_REM)}rem);
}
${playedPlace(`${TABLE} .mtg-board__spells[data-crowded='true']`)}:hover,
${playedPlace(`${TABLE} .mtg-board__spells[data-crowded='true']`)}:focus-within { z-index: 2; }
/* A rotated name bar lies on the lower edge that the following fan covers.
   Repeat only that public identity horizontally at the safe leading edge;
   the Card remains the sole accessible name. */
${TABLE} .mtg-board__spells[data-crowded='true'] .mtg-slot[data-tapped='true'] > .mtg-slot__fan-name {
  position: absolute; inset-block-start: 0; inset-inline-start: 0; z-index: 1;
  display: block; max-width: 100%; padding-block: 1px; padding-inline: var(--mtg-space-1);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--mtg-ink); background: var(--mtg-surface-raised);
  font-family: var(--mtg-font-card); font-size: var(--mtg-text-xs); line-height: 1.15;
  pointer-events: none;
}
@media ${SHORT_TABLE_QUERY} {
  ${TABLE} .mtg-board__spells[data-crowded='true'] {
    --board-face-max: ${cssNumber(SHORT_CROWDED_BOARD_FACE_MAX_REM)}rem;
  }
}
@media (min-width: ${String(THREE_COLUMN_MIN_WIDTH_PX)}px) {
  ${TABLE} .mtg-board${COMBAT_BOARD} .mtg-board__spells {
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
   56px content box is under ../card.ts's BOARD_RULES_PANEL_MAX_REM and under its
   BOARD_TYPE_LINE_MIN_REM, so no permanent on that table drew a type line or a
   rules box at any board size (the box became a panel over the picture in
   mtg-8kc; it was hidden then) - while the row it sat in was 170.4px tall and the
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
   which is where the same shortfall was being paid in clipped words.

   **This declaration is also what keeps shutting the side panel from shrinking
   a battlefield face**, which is mtg-t34 and is measured by
   ../../../test/play/rail-collapse-board.browser.test.ts. Before it a face was
   what the lane had left after the hand took its share, so a hand row that grew
   on collapse took the growth off the battlefield under it and the viewer's own
   face came out smaller than the opponent's. A face that is the largest card
   fitting its row cannot be paid for that way, and that is this rule.

   The natural reading is that --hand-basis-trim below is what holds that, and
   it is not. Zeroing the trim leaves the outcome green at all six viewports the
   test measures: at 1280x900 the hand goes 101.1 -> 120 and the near board face
   still goes 101.1 -> 111.2 on collapse, at 1366x900 113.4 -> 120 and 101.5 ->
   111.2, against clean shut readings of 120.2 and 114.3. The trim is worth
   9.0px of face there, so it earns its keep; what it is not is the thing
   standing between here and mtg-t34. The collapse hands the lane 228px and the
   hand can take about 33 of them, which is why no face comes back smaller
   either way (mtg-8xpu). Weaken the containment above and a test three
   directories away is what fails, so this is the paragraph that names both. */
${TABLE} .mtg-board:not(${COMBAT_BOARD}) .mtg-board__spells {
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
${playedSlot(`${TABLE} .mtg-board__spells`)}:not([data-empty='true']) {
  --board-face: max(
    ${cssNumber(BOARD_FACE_MIN_REM)}rem,
    min(var(--board-one-row-fit), var(--hand-slot), var(--board-face-max))
  );
  flex: 0 0 auto;
  width: var(--board-face);
  height: auto; min-height: 0;
  max-height: ${cssNumber(BOARD_FACE_MAX_SHARE)}%;
  align-self: center;
}
/* And a tray takes the half of that rule that is about being on the row rather
   than about being a card, which is \`mtg-ijze\`'s second half.

   A permanent holding an Equipment is drawn as a \`.mtg-attach\` tray with two
   cards in it (\`../../board/Battlefield.ts\`), so it cannot take the width above
   — that is one card's width, and \`--board-face\` carries a percentage of the
   row that would re-resolve against the tray anyway. What it can take, and had
   to have, is the zero shrink factor: \`./attach.ts\` starts the tray at
   \`flex: 0 1 auto\` and both boxes inside it declare \`min-width: 0\`, so on a
   row that overflows the tray was the one item flexbox could take the overflow
   out of. It took all of it. Measured at 1440x900 with eight permanents on the
   row, the tray was **6px wide** — its own padding and border with nothing
   between them — its host was pinned at \`./fit.ts\`'s \`MIN_SLOT_WIDTH_REM\`, and
   both cards were drawn outside the keyline whose whole purpose is to say the
   two of them belong together. The row scrolls instead now, which is what every
   other place on it already did.

   **The height is where the width cap reaches these cards**, and that is the
   whole of the second bound. A tray keeps \`./fit.ts\`'s stretch rather than
   taking \`align-self: center\`, because everything inside it is sized off its
   height — \`./attach.ts\` draws the held card at 70% of it and the host takes
   the rest, both of them deriving a width from \`aspect-ratio\` — so a tray is
   height-driven where every bare place beside it is width-driven. Bound only by
   the row's share, the two axes disagree exactly when the crowded cap bites: at
   1280x800 with eight permanents, the cap held a bare face to 84px and the tray
   took 96% of the row, so its host came out **100.9px, 20% larger than the
   neighbor it is crowded against**. The bigger card on the more crowded board
   is the same wrong picture \`mtg-ijze\` was filed for, one axis over.

   So the tray is *also* bounded by the tallest a face at the cap may be drawn:
   the maximum width times the printed trim, plus what \`./attach.ts\` spends on
   its own keyline. \`--board-face-max\` rather than \`--board-face\` because
   \`--board-face\` carries a percentage of the row, which a declaration on a
   tray's *child* re-resolves against the tray — that is what makes the width
   above unusable here, and it is not a bound that can be moved to the tray
   itself, because the tray's own width has two cards and a link in it. The
   max is a \`clamp()\` upper bound and is always a length: rems in the three
   caps here, viewport units in \`../mobile.ts\`'s combat one. Where the row is
   the narrower constraint the row still wins, which is what \`min()\` says.
   Measured after: 84px host against 84px bare at 1280x800, 112 against 112 at
   1440x900. */
${TABLE} .mtg-board__spells > .mtg-attach:not([data-holds='false']) {
  flex: 0 0 auto;
  max-height: min(
    ${cssNumber(BOARD_FACE_MAX_SHARE)}%,
    calc(
      var(--board-face-max) * ${cssNumber(CARD_TRIM_MM.height)} / ${cssNumber(CARD_TRIM_MM.width)}
      + ${cssNumber(TRAY_BLOCK_CHROME_PX)}px
    )
  );
}
/* A crowded row may wrap but may not buy a fit by making the host inside an
   attachment tray less legible than a bare permanent. Trays are height-driven,
   so state the same 72px face floor on their block axis, plus the keyline they
   own; the row's wrap/fan policy absorbs the extra place instead of clipping
   either exact object. */
${TABLE} .mtg-board__spells[data-crowded='true'] > .mtg-attach:not([data-holds='false']) {
  min-height: calc(
    ${cssNumber(BOARD_FACE_MIN_REM)}rem * ${cssNumber(CARD_TRIM_MM.height)} / ${cssNumber(CARD_TRIM_MM.width)}
    + ${cssNumber(TRAY_BLOCK_CHROME_PX)}px
  );
  max-height: none;
  align-self: center;
}
${TABLE} .mtg-board__spells[data-crowded='true'] > .mtg-attach:not([data-holds='false']) > .mtg-slot {
  flex: 0 0 auto;
  width: ${cssNumber(BOARD_FACE_MIN_REM)}rem;
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
   row.

   **The floor is absolute on a constrained table.** The previous curve let the
   row's room overrule name legibility. The crowded-board contract now spends
   the hand first, shrinks faces only to BOARD_FACE_MIN_REM, and then wraps
   distinct exact-state places. A face never becomes an unlabeled sliver merely
   to preserve a one-row layout.

   The combat rule above keeps the bare floor. The row is not a size container
   in combat (./band.ts's lane factors need its content in the flex basis), so
   there is no cqh to floor against, and inventing a second proxy for the room
   here would be a second opinion about the number this rule exists to read. */
${playedSlot(`${TABLE} .mtg-board:not(${COMBAT_BOARD}) .mtg-board__spells`)}:not([data-empty='true']) {
  --board-room: calc(${cssNumber(BOARD_FACE_MAX_SHARE)}cqh * ${cssNumber(CARD_TRIM_MM.width)} / ${cssNumber(CARD_TRIM_MM.height)});
  --board-face: max(
    ${cssNumber(BOARD_FACE_MIN_REM)}rem,
    min(
      var(--board-one-row-fit),
      var(--board-room),
      max(var(--hand-slot), ${cssNumber(FACE_COMPLETE_REM)}rem),
      var(--board-face-max)
    )
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
${playedSlot(`${TABLE} .mtg-board__spells`)}:not([data-empty='true']):not([data-tapped='true']) > .mtg-card {
  width: auto; height: 100%; max-width: 100%; margin-inline-end: auto;
}
/* A tapped slot reserves the long side of the same face before rotating it.
   The short-table and crowded-row ceilings above keep that request below the
   row's height guard; the zero shrink factor is the flex: 0 0 auto on the
   spells slot above, which this selector narrows rather than replaces, and it
   keeps flexbox from shrinking only the tapped slot's wider row-axis box. A
   crowded row overflows into its own scroller instead, which is what lets the
   two states stay one size at every width. */
${playedSlot(`${TABLE} .mtg-board__spells`)}[data-tapped='true']:not([data-empty='true']) {
  width: calc(var(--board-face) * ${cssNumber(CARD_TRIM_MM.height)} / ${cssNumber(CARD_TRIM_MM.width)});
}
`;
