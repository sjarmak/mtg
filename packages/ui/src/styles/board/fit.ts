/**
 * The mat under a height budget, on the two routes that draw a whole table.
 *
 * A game is played on a screen, so `../views.ts` makes the route a column the
 * height of the viewport and hands the whole of it to the mat; this is what the
 * mat does with it.
 *
 * **The replay viewer is the second of those routes (`mtg-ryix`).** This file
 * used to open "on the play route only", and the sentence under it said a replay
 * frame is read down a page and may be as tall as it likes. That was a claim
 * about a page nobody had watched a game on: the same `Board` in ordinary flow
 * measured 1038.7px at every viewport, so the frame you were watching did not
 * fit the window it was in and neither battlefield was whole at 1280x800.
 * The playtester asked for the replay's sizing to match the play route's, and
 * `./geometry.ts`'s `TABLE` is how it does — the same rules, not a second set of
 * numbers that agree today. `PLAY` is still here for the two rules that are
 * about playing rather than about fitting.
 *
 * The mat has to be able to take that instruction, and the first version of
 * these rules could not. `./zone.ts` floors a well at 4.5rem so an empty zone
 * still reads as a place on the table, and the status line was as tall as its
 * life total. Under a budget those floors made the mat incompressible and the
 * column overflowed. So on this route a well's floor is zero and the well
 * scrolls, which is the same bargain the hand rail already made on the
 * horizontal axis.
 *
 * **The status line is not on this column at all any more (`mtg-rgc.1`).** It
 * was a strip at the top of each lane, `flex: none`, so the two of them took a
 * fixed 80px off the height whatever else was happening — measured at 1440x900
 * with twelve permanents a side, 36px of strip and 4px of gap per seat. The
 * vitals are a pod in a fixed column of their own now (`./mat.ts`,
 * `./status.ts`), which is width rather than height, so the whole 80px goes back
 * to the wells and the rules that flattened the strip into one row here are gone
 * with it. That also leaves the opponent's lane a two-column grid of one row
 * instead of two: the row that carried the strip across both columns has no
 * occupant left.
 *
 * **And the near lane holds a third row now (`mtg-rgc.6`).** The step bar came
 * off the strip above the table and into the band between the battlefield and
 * the hand, which is where Magic Online draws it. It is the one block on this
 * column whose height is fixed by its own content rather than by what is left —
 * 33.9px, plus the gap this file takes back below — so it comes off the two
 * battlefield rows and off nothing else. Measured over `../../tools/hand-scale.ts`
 * at three viewports and 4, 8 and 12 permanents a side: a near face loses 8.1px
 * at 1440x900 and 8.0px at 1280x800 on an uncrowded board, nothing at all at
 * 1024x768, and nothing anywhere at twelve a side — which is where `mtg-0sq`
 * lives, and it does not move by a tenth of a pixel. The strip pays some of it
 * back, 33.9px down to 28.8 and a whole second row at 1024x768.
 *
 * **The pod column is the ask column now (`mtg-rgc.4`), so its track bends.** It
 * carries the move list between the two pods, which is a block that has to be
 * read rather than a pair of blocks that only have to be recognized, so the
 * track is `clamp(POD_WIDTH_REM, ASK_PERCENT%, PLAY_ASK_REM)` rather than a
 * fixed width: it grows to Magic Online's own 176px where there is room and
 * falls back toward the pod's own width where there is not. `./rail.ts` states
 * all three numbers and argues them, because the two rails' widths trade against
 * the lanes as one decision.
 *
 * **The whole of the leftover is now the mat's, and that is `mtg-bc2.137`.**
 * Two blocks used to be siblings of the mat on this column, and both of them
 * grew with the game state. The move list took up to 32% of the table's height
 * and took more of it the more legal moves there were, so a busy priority shrank
 * every card on the table. The altered-size notes were `flex: none` with no cap
 * at all (one line per creature whose current power and toughness differ from
 * its printed pair), so a combat trick shrank them too: measured at 1280x800
 * with six permanents a side, a battlefield face went 117x164 at no notes,
 * 114x160 at three, 87x122 at eight and 65x91 at twelve, with the block itself
 * 270px tall and page overflow 0 the whole way, so nothing announced it.
 *
 * Both are in the side rail now, where they cost width instead, which is the
 * geometry Forge, Magic Online, XMage and Cockatrice all use, and `Board`'s
 * `rail` prop is the seam. Three consequences are visible here: the two lanes
 * divide the entire column, nothing on this column caps or floors the mat
 * against a sibling any more, and a card's size no longer moves when the option
 * count or the note count does. That last one is now measured at both viewports
 * across 0, 1, 3, 5, 8 and 12 notes and comes out one number.
 *
 * What is left over is spent so the card rows come out about equal, and the two
 * lanes take equal shares of it. They did not always: the near lane held two
 * rows and grew twice as fast, which was right while a permanent was three
 * stacked bars that could be squeezed and a hand you pick from could not, and a
 * permanent now carries a picture worth exactly as much as the one in your hand.
 * `./hand.ts` then took the hand off the height axis entirely — the row is as
 * tall as its cards and no taller — so both lanes hold one row of cards and the
 * double share went with the reason for it. **It went as a second declaration
 * reversing the first, and that pair is `mtg-d6s`'s false lead**: this file
 * still read `flex-grow: 2` while the sheet computed 1, so a bead written from
 * this docblock blamed a rule the cascade had already turned off. There is no
 * declaration now, because `.mtg-board__side`'s own `flex: 1 1 auto` above says
 * the same thing once. The opponent's hand stays out of the column entirely, in
 * a second grid track beside their board, because seven face-down rectangles
 * whose only fact is already printed in their pod are not worth a row.
 *
 * The lanes' zone heads go, and that is a real reclaim rather than tidying:
 * "You battlefield 4" over a status line that already prints `hand 7 library 27
 * graveyard 2` is the same count twice, and three of those bands is about 48px
 * of the column — a sixth of a card row. The rail's zones keep theirs, because
 * nothing else says how deep a graveyard is. The section keeps its `aria-label`
 * either way, so nothing leaves the accessible tree.
 *
 * And the slot fits the room the row actually has, on both axes, which is the
 * pattern `docs/research/prior-art-board-layout.md` finds in three of the four
 * clients and not in ours. Its height is the well's, through `align-items:
 * stretch`; its width follows from the printed 63:88 trim; and it may then
 * *shrink* below that width, down to `MIN_SLOT_WIDTH_REM`, when the row holds
 * more permanents than fit. The face inside is width-driven so it shrinks with
 * the slot and stays card-shaped, which is Forge's binary search and XMage's
 * 10px walk expressed as one flex rule.
 */
import { CARD_TRIM_MM } from '../../card/anatomy';
import { cssNumber } from '../number';
import { RATIO, TABLE } from './geometry';
import { ASK_PERCENT, PLAY_ASK_REM, PLAY_RAIL_REM, RAIL_WIDTH_VAR } from './rail';
import { POD_WIDTH_REM } from './status';

/**
 * The shortest a battlefield *slot* is drawn before the well gives up and
 * scrolls instead. The face inside it may still be shorter, because the face is
 * width-driven and only its width is floored (`MIN_SLOT_WIDTH_REM`).
 *
 * A floor rather than the operating point, which is the change `mtg-bc2.137`
 * is. It used to be both: the mat got whatever the command bar left, the command
 * bar grew with the number of legal options, so a busy priority shrank every
 * card on the table and the wells came out at 96px, 101px and 122px at
 * 1280x800. Both variable-length blocks are on the width axis now (`../views.ts`,
 * `./rail.ts`), so the mat's height no longer moves with the option count or the
 * note count at all, and this number is what a genuinely short window would hit
 * rather than what an ordinary game does.
 *
 * Re-measured after the notes moved, driving the sealed game to its end at 284
 * steps: the shortest a battlefield face got was 172px tall at 1280x800 and
 * 205px at 1440x900, 2.2x and 2.6x this floor. (The number this docblock carried
 * before, 138px, was the 1440x900 figure quoted against 1280x800, and both were
 * taken with the note channel still open.) A built crowded position goes further
 * than any driven game does: at 1280x800 six permanents a side measures 164px,
 * eight measures 120px, and this floor does not bind until fourteen a side,
 * where the row is already at `MIN_SLOT_WIDTH_REM` and the face is 48px wide.
 */
const MIN_SLOT_REM = 5;

/**
 * And the narrowest, which is what a crowded row shrinks a card down to before
 * the well scrolls sideways instead.
 *
 * WCAG 2.5.8 requires an interactive target of at least 24 x 24 CSS px and
 * every board face is a button, so no fit-to-fill rule may go under that. 3rem
 * is 48px, twice the requirement, and a card that narrow is 67px tall — which
 * is where a face stops being a card rather than where it stops being clickable.
 *
 * **A floor on the slot is not a floor on the card, and a tapped slot is where
 * the two come apart.** A tapped slot is square with the card laid across it, so
 * 48px of slot is 34px of card there against 48px of card in an upright one —
 * and a row that reaches the floor therefore stops shrinking its upright slots
 * while its tapped ones keep going, which draws the same permanent at two sizes
 * depending on whether it is turned. Nothing reached it before `mtg-d6s` made a
 * board face smaller, and the tap rig found it at once: twelve a side at
 * 1024x768 came out 48 x 67 upright against 40.2 x 56.1 tapped. So the tapped
 * floor is this one turned by the trim, and the two states hit bottom together.
 */
const MIN_SLOT_WIDTH_REM = 3;

/**
 * And the opponent's face-down cards, drawn at a chip's size because they are
 * the one thing on the table that is neither read nor acted on. The width is
 * derived rather than typed so the chip is still card-shaped: a hidden card is
 * still a card, and a row of squares would not read as a hand.
 */
const FACEDOWN_PLAY_HEIGHT_REM = 2;

/**
 * How far left of the window's right edge the hover zoom is anchored on this
 * route, which is far enough to clear the rail.
 *
 * The rule this replaces is one `mtg-bc2.137` itself made stale. `../card.ts`
 * argues the bottom-right corner as "our bottom-right is the graveyard pile,
 * which is the least load-bearing thing on the screen", and that was true until
 * the move list moved into that column. Measured at 1280x800 before this rule,
 * the panel covered 239 x 341px of the rail and five choice buttons with it. The
 * panel is `pointer-events: none` and transient, so the cost was visual only; it
 * was still the action surface that was being covered.
 *
 * Left of the rail it lands on the right end of the card rows instead, which is
 * a row the player is already reading one card out of. The offset is the rail's
 * own width plus what sits between the rail and the edge of the window (the
 * shell's inline padding, the mat's padding and its 1px border), rounded up to
 * one spacing step so the two never touch.
 */
const ZOOM_CLEARANCE = 'var(--mtg-space-6)';

/**
 * The height the battlefield row stops donating at.
 *
 * It used to be `min-height: 0`, and the row was the only band on the played
 * table that could shrink: the mana band under it is `flex: none`, and so are
 * the phase bar and the hand. So every pixel the page ran short by came out of
 * this one row, which gave until it was 25px tall holding 34px of card and
 * clipped the difference — the reported symptom, a band of cut art strips with
 * an intact mana band beneath it.
 *
 * 4.5rem rather than a face's own height, because a floor is not a fit: the
 * worst face measured 53px of content at 1024x768 with the played route's full
 * page furniture above the mat, and 72px clears that with the row's block
 * padding taken out. Past the floor the row scrolls, which is why `overflow`
 * is now set on both axes rather than on `x` alone.
 *
 * Deliberately not `BOARD_FACE_MIN_REM`, which is the same number for an
 * unrelated reason: that one is the narrowest readable face *width*, fixed by
 * where flagship names start clipping. Sharing the literal would tie this floor
 * to a re-measurement of name clipping.
 *
 * **Who pays it is stated below** (`LANE_GAP`): the floor stopped the row
 * donating without saying where the height was to come from instead, so it came
 * out of the mana band, which was the next unshrinkable thing on the lane.
 */
const SPELLS_ROW_MIN_REM = 4.5;

/**
 * What that floor becomes on a short table, where the lane cannot pay it.
 *
 * The floor above is a promise the lane has to keep, and on a landscape phone it
 * cannot: measured in chrome-headless-shell at 932x430 with the two shut columns
 * and four lands a side, the battlefield body was 116px tall holding 128px of
 * content, and the 12px that did not fit came off the mana base, because the row
 * floors at 4.5rem and `../mobile.ts` has already taken the band's cap off so the
 * band is `flex: none` at its own tile height. Nothing squashed; the lands simply
 * went under the fold, which is the playtester's 2026-08-22 report ("I'm still not
 * seeing lands once I play them") measured (mtg-posv).
 *
 * So on this tier the row is the child that gives, and 3rem is what it gives down
 * to: at 932x430 the lane can afford 60px and the floor does not bind at all, at
 * 932x400 and 844x390 it binds and the body overflows by single digits, and
 * `../mobile.ts` sticks the band to the bottom of the scrollport so that residue
 * costs the cards their bottom edge rather than costing the player the mana base.
 * A board card on this tier is read by tapping it open, not by squinting at the
 * tile, which is what makes a 48px tile a legible board rather than a broken one.
 */
export const SHORT_TABLE_SPELLS_MIN_REM = 3;

/**
 * The gap between the battlefield row and the mana band under it, restated so
 * the band's cap can subtract it.
 *
 * `./zone.ts` declares it on `.mtg-zone__body`, and a `max-height` cannot read a
 * gap back — the same one number level with another file by hand that
 * `./hand.ts`'s `HAND_GAP` is, and for the same reason. The token rather than
 * its value, so a re-valued spacing scale moves both together.
 */
const LANE_GAP = 'var(--mtg-space-2)';

export const FIT_CSS = `
${TABLE} .mtg-board {
  ${RAIL_WIDTH_VAR}: ${cssNumber(PLAY_RAIL_REM)}rem;
  --ask-w: clamp(${cssNumber(POD_WIDTH_REM)}rem, ${cssNumber(ASK_PERCENT)}%, ${cssNumber(PLAY_ASK_REM)}rem);
  flex: 1; align-items: stretch; grid-template-rows: minmax(0, 1fr); min-height: 0;
  grid-template-columns:
    var(--ask-w)
    minmax(0, 1fr)
    var(${RAIL_WIDTH_VAR});
  padding: var(--mtg-space-1); gap: var(--mtg-space-2);
}
${TABLE} .mtg-board__pods { min-height: 0; gap: var(--mtg-space-1); }
${TABLE} .mtg-board__lanes { min-height: 0; gap: var(--mtg-space-1); }
${TABLE} .mtg-board__divider { margin: 0; }
${TABLE} .mtg-board__side { flex: 1 1 auto; min-height: 0; gap: var(--mtg-space-1); }
${TABLE} .mtg-board__side > .mtg-zone { flex: 1 1 auto; }
/* The step bar sits flush under the battlefield rather than a gap below it
   (mtg-rgc.6). The band is a flex column with one gap between every pair of
   children, so a third child costs the cards a second gap for no reading, and
   Magic Online draws the bar hard against the bottom edge of the board panel
   anyway. What the 4px buys is measured rather than assumed: a near-seat face at
   four permanents a side goes 145.0 to 146.7 at 1440x900 and 114.8 to 116.5 at
   1280x800, and nothing moves at 1024x768 or at twelve a side. That is not
   enough on its own to keep the flagship's 48-character name off a fourth line
   at 1280x800, which is what the move cost and what mtg-rgc.13 would pay back;
   it is kept because the reading is right and the pixels are free. */
${TABLE} .mtg-board__side > .mtg-phasebar { margin-block-start: calc(-1 * var(--mtg-space-1)); }
${TABLE} .mtg-board__side .mtg-zone__head { display: none; }
${TABLE} .mtg-zone { min-height: 0; padding: var(--mtg-space-1) var(--mtg-space-2); gap: var(--mtg-space-1); }
${TABLE} .mtg-zone__body {
  flex: 1; min-height: 0;
  flex-wrap: nowrap; align-items: stretch;
  overflow: auto; padding-block: var(--mtg-space-1);
}
/* The spell row is the scroller on a battlefield now, not the body: the body is
   a column holding the row and the mana base under it, and a row that scrolled
   its parent would take the lands off the screen with it. The block padding is
   the room the 1.03 hover scale needs, moved here with the overflow that would
   otherwise clip it — the hand rail's own layout rule in ZONE records the same
   reason. */
/* And a row that scrolls says so. Twelve permanents a side is 548px of row past
   the edge at 1024x768 and 516 at 1440x900, and a scroller nobody can see is a
   board with permanents on it the player has no reason to look for. Naming
   scrollbar-color is what makes the bar visible rather than what colors it: a
   scroller with that property set to anything but auto is drawn a classic
   always-visible scrollbar by Chromium instead of the overlay one, and the
   overlay one is the default on macOS, which is the machine the 2026-08-16
   captures came from. A thin width then pays some of it back - the row reserved
   15px of its own height for the bar at 1024x768 in chrome-headless-shell 151,
   reserves 10 now, and reserves nothing at four a side, where nothing overflows.
   The track is transparent so the band's own ground shows through it. */
${TABLE} .mtg-board__spells {
  flex: 1 1 auto; min-height: ${cssNumber(SPELLS_ROW_MIN_REM)}rem;
  flex-wrap: nowrap; align-items: stretch;
  overflow: auto; padding-block: var(--mtg-space-1);
  scrollbar-width: thin; scrollbar-color: var(--mtg-line-strong) transparent;
}
/* And the mana band takes no more of the lane than the row's floor leaves it,
   which is the half of that floor mtg-z1h8 did not write down (mtg-bduq).

   The lane is a column of two children and neither of them could give: the row
   floors at SPELLS_ROW_MIN_REM above, ./lands.ts's band is flex: none at a
   stated tile height, and the body they sit in is overflow: auto. So a lane
   shorter than 72 + this gap + the band's 60 does not squash anything — it
   overflows, and what goes under the fold is the band, because it is last.
   Measured in chrome-headless-shell over ../../test/play/combat-allocation
   .browser.test.ts's four boards at 1440x560, the near seat's land tiles stood
   6.5px, 6.5px, 25.7px and 22.4px below their own lane; over ./spells-row-floor
   .browser.test.ts's page, which carries the played route's full furniture above
   the mat, 40.9px at 1024x768 and 9.9px at 1280x800. Every one of those is a
   mana base drawn off the bottom of the seat that owns it.

   A percentage of the lane rather than an arithmetic against 100vh: the row's
   floor is a length, the gap is a length, and what is left is the lane's own
   height minus the two — the one quantity a proxy for the room cannot get wrong.
   Where the lane can afford both the cap is above the band's natural height and
   binds on nothing, which is every cell in both rigs except the ones listed
   above: lane, row, band, tile and face box are identical to the tenth of a
   pixel at 1440x900, 1394x824, 1280x800, 1024x768 and 1392x766.

   The tile follows its band rather than being cut by it. A max-height of 100%
   computes to none while the band's own height is content-driven, so a tile at
   an uncrowded viewport is ./lands.ts's stated 3.5rem to the pixel; it binds only
   where the cap above has made the band's height definite, and ./lands.ts's
   aspect-ratio then brings the width down with it, so a squeezed mana base is
   drawn smaller and whole instead of full-size and clipped. That order matters
   for the one place the band is legitimately taller than its tile: a mana base
   wide enough to scroll grows by its scrollbar (75px at 1024x768 with eight
   lands), and a *stated* band height would have taken that 15px out of the tile
   instead. The cap is a maximum, so it leaves that case alone.

   Not a min() of 3.5rem and 100% on the tile, which was measured and is
   circular: the band's height is its content's, so a tile stated as a share of
   its band resolves against itself, and chrome-headless-shell settled every
   roomy viewport on a 44.1px tile instead of 56. */
${TABLE} .mtg-zone__body[data-layout='board'] > .mtg-lands {
  max-height: max(0px, calc(100% - ${cssNumber(SPELLS_ROW_MIN_REM)}rem - ${LANE_GAP}));
}
${TABLE} .mtg-lands > .mtg-slot[data-slot='play'] { max-height: 100%; }
${TABLE} .mtg-facedown { flex: none; align-self: flex-start; }
${TABLE} .mtg-facedown {
  height: ${cssNumber(FACEDOWN_PLAY_HEIGHT_REM)}rem;
  width: ${cssNumber((FACEDOWN_PLAY_HEIGHT_REM * CARD_TRIM_MM.width) / CARD_TRIM_MM.height)}rem;
}
${TABLE} .mtg-slot {
  flex: 0 1 auto;
  width: auto; height: auto;
  aspect-ratio: ${RATIO};
  min-height: ${cssNumber(MIN_SLOT_REM)}rem;
  min-width: ${cssNumber(MIN_SLOT_WIDTH_REM)}rem;
}
/* A tapped slot is square (../board/slot.ts) and has to work out that side for
   itself here, which is the only thing this route has to say about it:
   everywhere else a slot is a fixed 9.5rem card, so the square's side is a
   number that can be written down, and here it is whatever height the well
   left. An automatic width under the square aspect ratio next door is what
   turns that height into the slot's flex base size.

   It is a *base* size, and this row shrinks: the flex-shrink of 1 above means a
   crowded row takes width off the square and cannot take height off it, so a
   shrunk tapped slot is narrower than it is tall. That is not a defect on its
   own — an upright slot shrinks the same way — and what made it one was the
   card inside being drawn off the height. mtg-bm1 is the whole story and
   ../board/slot.ts holds it. */
${TABLE} .mtg-slot[data-tapped='true'] {
  width: auto;
  min-width: calc(${cssNumber(MIN_SLOT_WIDTH_REM)}rem * ${cssNumber(CARD_TRIM_MM.height)} / ${cssNumber(CARD_TRIM_MM.width)});
}
/* The zoom clears the rail on this route; ZOOM_CLEARANCE above says why. */
${TABLE} .mtg-zoom {
  inset-inline-end: calc(var(${RAIL_WIDTH_VAR}) + ${ZOOM_CLEARANCE});
}
`;
