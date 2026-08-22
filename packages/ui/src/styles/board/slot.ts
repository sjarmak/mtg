/**
 * The slot: a place on the mat, occupied or not.
 *
 * A slot is as wide as the compact face it holds, so its width is interpolated
 * from `../../card/anatomy.ts` — the same declaration `../card.ts` gives the
 * face itself, rather than a second literal kept level with it by hand
 * (ADR-0002 §6.2), and through `cssNumber` on the way in, for the reason
 * `../number.ts` records.
 *
 * A slot is card-shaped at both zones, and a face is centered in it with
 * flexbox rather than an absolute `translate(-50%, -50%)`. The centering method
 * is load-bearing rather than a tidy-up: a transform makes an element a
 * containing block for fixed-position descendants, and the hover zoom in
 * `../card.ts` is `position: fixed` precisely so the `overflow: auto` well cannot
 * clip it. A transformed slot would have trapped the zoom inside the card, and
 * rotated it along with a tapped permanent.
 *
 * **A hand is drawn when empty and a battlefield is not, and that asymmetry is
 * the point rather than an oversight.** A hand of two in a rail of seven reads
 * as a hand of two rather than as a surface that failed to lay itself out, and
 * the rail is the one place on the table where the *number of places* is a fact
 * of the game (`../../routes/play/position.ts` reads it off the kernel's opening
 * hand size). A battlefield has no such number — there is no limit on
 * permanents, and the four places the row used to pad itself out to were a
 * design choice about how still the lane sat. the playtester, 2026-08-14: "not sure
 * why there are dashed line card boxes on the battlefield, no reason for them".
 * Measured before deleting them, they held nothing up at any of four viewports,
 * so the row simply stopped drawing them (`../../board/Battlefield.ts`) and this
 * rule narrowed to the surface that still does. An empty battlefield now says
 * `no permanents` in the zone's own words, which is a stronger answer to "did
 * this render" than a row of holes was.
 *
 * `EMPTY_SLOT_HEIGHT_REM` has the measurement that sized the marker.
 *
 * Three things about a slot are the chrome around the face rather than the face
 * itself, and they are all here: whether the card in it can be acted on, what
 * room a tapped card is given, and where the corner marks sit. The last of those
 * is no longer a fact about the slot's corners at all — the badges are anchored
 * to the card's own art window (`mtg-9edk`, and the rule above `.mtg-slot__marks`
 * has the measurement) — but they are still drawn from here, because they are
 * still a child of the slot rather than of the face.
 */
import { CARD_TRIM_MM, COMPACT_FACE_WIDTH_REM } from '../../card/anatomy';
import { cssNumber } from '../number';
import { HOVER_SCALE } from './geometry';

/** A slot holds one compact face, so it is that face's width. */
const SLOT_WIDTH_REM = COMPACT_FACE_WIDTH_REM;

/**
 * And that face's height, because a card in a slot is card-shaped: the compact
 * face has no intrinsic height (it drops the art window and the rules box), so
 * without this a thumbnail is three stacked bars rather than a card.
 */
const SLOT_HEIGHT_REM = (COMPACT_FACE_WIDTH_REM * CARD_TRIM_MM.height) / CARD_TRIM_MM.width;

/**
 * How wide a place with nothing in it is drawn, as a share of a card's height.
 *
 * A slot with nothing in it used to be drawn at the full size of a card and
 * `mtg-ej5` is what that cost: on turn 1, measured in a real browser, one side
 * of the table was four dashed rectangles of 128 x 179 and a single 73 x 48 land
 * tile, so the one real permanent was a fifteenth the area of an empty box
 * beside it. The eye went to the placeholders.
 *
 * The place is still drawn, because the reason for drawing it has not changed:
 * a hand of two in a rail of seven reads as a hand of two rather than as a
 * surface that failed to lay itself out. It is drawn as a *marker* instead of as
 * a card — card-shaped, so the row still says what goes there, and small enough
 * that nothing on the table is louder than the permanents. 2.25rem is 36px tall
 * and 25.8px wide, which is 928 square pixels against the 22,904 an empty
 * battlefield slot measured before: a twenty-fifth of it, and a quarter of the
 * smallest real object on the table.
 *
 * The row gets that width back. Empty slots are flex items like any other, so
 * four of them were holding 512px of a battlefield row away from the permanents
 * that had to shrink to fit in what was left.
 */
const EMPTY_SLOT_HEIGHT_REM = 2.25;

/**
 * Where the room a rotated card needs comes from: the slot, not the card.
 *
 * A permanent's slot is card-shaped, so a face rotated a quarter turn is wider
 * than the box it was in by the difference between a card's height and its
 * width. Something has to give, and there are only three places to take it
 * from. Forge and XMage widen the *pitch* between slots (`PlayArea` L1309:
 * `cardSpacingX = (cardHeight - cardWidth) + …`), which costs them cards per
 * row and nothing else, because they are width-bound and their rows do not
 * shrink to fit. Magic Online reserves nothing and lets a rotated card overhang
 * its neighbor, which a row that shrinks to fit cannot do — the overhang would
 * be painted over the card beside it. This build used to take it out of the
 * card: a tapped face rotated *and* scaled by 63/88, so its rotated width was
 * exactly the width of the slot it was already in and nothing in the row moved.
 *
 * **That third choice is what `mtg-yi5` is, and it is reversed here.** The price
 * was named in this docblock as "a tapped permanent drawn at 72% of its
 * untapped neighbors" and waved off with the hover zoom. Measured in a real
 * browser at the end of a played game, the price was worse than the name: an
 * untapped creature drew 128 x 179 with a 106 x 15 name box, and the same slot
 * tapped drew the card at 128 x 92 with a name box of **11 x 76** — a column of
 * type eleven pixels wide, at 51% of the area. Five of nine creatures on screen
 * were in that state at the end of one game, because attacking taps, and the
 * `ATK` and power/toughness badges stayed pinned to the slot's own corner while
 * the card shrank away from them.
 *
 * So the reserve comes out of the slot instead: a tapped slot is square, side
 * equal to its height, and the card inside it is drawn to fill that square —
 * which makes the tapped card's layout box exactly the box it had upright.
 * Tapped and untapped are the same size and the same shape; the only difference
 * between them is the quarter turn.
 *
 * **The square is a flex base size, and `flex-shrink` takes width off it and
 * cannot take height off it. That is `mtg-bm1`.** This rule shipped with the
 * card drawn off the slot's *height* (`height: 100%`, `width: auto`), which is
 * the same number as the square's side right up until the row is overfull.
 * `./fit.ts` makes a battlefield slot `flex: 0 1 auto` so a crowded row shrinks
 * rather than scrolls, and shrinking is a main-axis operation: measured in
 * chrome-headless-shell 151 at 1440x900 with six permanents a side, both slots
 * came out at 0.9238 of their base — the upright one 113.9 wide down to 105.3,
 * the tapped one 159.1 down to 147.0 — while the tapped slot's *height* stayed
 * at the 159.1 the row gave it. A card drawn off that height is 159.1 wide after
 * the quarter turn in a slot 147.0 wide, and the 12.1px difference is painted
 * half onto the neighbor on each side. It is worse where the row is tighter:
 * 33.4px of overhang and 10 overlapping face pairs at 1024x768.
 *
 * So the card is drawn off the slot's **width** instead, which is the axis the
 * row actually settled (`TAPPED_FACE_WIDTH`). When the square survives, the two
 * are the same number and nothing about the drawing changes; when the row took
 * width off it, the card comes down with the slot rather than over its
 * neighbors, which is the same thing an upright face already does.
 *
 * Two costs, both real and both smaller than the one they replace. The row
 * reflows when a permanent taps, by the 0.284 of a card's height the rotation
 * needs — the no-reflow property `docs/mockups/README.md` argued for is spent
 * here, and it was bought with the readability of every attacking creature.
 * And a tapped slot holds more of the row's width, so a crowded row shrinks
 * sooner; `./fit.ts`'s `MIN_SLOT_WIDTH_REM` floor and the row's own sideways
 * scroll are unchanged, and `EMPTY_SLOT_HEIGHT_REM` above hands back more width
 * than this spends at every board state with an empty place in it.
 *
 * The square is the *tapped* slot only. An untapped row is still card-shaped,
 * which is the shape this file's earlier reversal measured and kept: change
 * every slot's `aspect-ratio` to 1 and the face comes out 180x184 at 1280x800,
 * a bigger rectangle that is not a card.
 */
const TAPPED_SLOT_ASPECT = '1';

/**
 * How wide the card in a tapped slot is drawn, as a share of the slot's width.
 *
 * The card is rotated, so its own width is what ends up on the *vertical* axis
 * and its own height is what ends up along the row. A card is 63:88, so a card
 * whose height is exactly the slot's width is 63/88 of that width across — and
 * a quarter turn then lays it into the slot's width exactly, edge to edge, with
 * nothing left over to paint on a neighbor.
 *
 * A percentage of the slot rather than `height: 100%`, and that is the whole of
 * `mtg-bm1`: a percentage width resolves against the width the row settled on,
 * after `flex-shrink` has taken whatever it took, while `height: 100%` resolves
 * against a cross size the shrink never touched. `TAPPED_SLOT_ASPECT` above has
 * the measurement.
 */
const TAPPED_FACE_WIDTH = (CARD_TRIM_MM.width / CARD_TRIM_MM.height) * 100;

/**
 * How far a rotated card's painted edge lies inside its own slot, on the block
 * axis, as a length a rule can hand straight to `top` or `bottom`.
 *
 * The turn is paint-only. The card's layout box keeps the width above and the
 * height its aspect gives it, and only the trip to the screen swaps them, so a
 * tapped card *paints* as tall as it was laid out *wide* and the slot's own
 * centering leaves half the difference at each end. On the square
 * `TAPPED_SLOT_ASPECT` asks for, that is 14.2% of the slot above the card and
 * 14.2% below it: 20px of empty slot under a 141px attacker, measured in
 * chrome-headless-shell at 1440x900.
 *
 * So anything that means to sit against the *card* has to subtract this, and a
 * rule that trusts the slot's own edge instead draws its line 20px clear of the
 * card and reads as a bar with nothing to do with it. `./band.ts` draws
 * the seat strip along an attacker's near edge and did exactly that until
 * `mtg-oeq0`.
 *
 * Stated in the slot's own container units, and in the same shape as the width
 * above, because the two have to agree: where the second term binds - a slot
 * capped on the block axis, which `./hand.ts` does to a battlefield row - the
 * card is laid out from the slot's height, paints the slot's full height, and
 * the inset is exactly zero. A constant percentage would have been right only
 * while the square survived.
 */
export const TAPPED_FACE_INSET = `calc((100cqh - min(${cssNumber(TAPPED_FACE_WIDTH)}cqw, 100cqh)) / 2)`;

/**
 * The name the marks row anchors to: the card's own art window.
 *
 * A dashed ident and not a design token — nothing ever reads it with `var()`,
 * and `../../test/tokens.test.ts` scans for exactly that — but it carries the
 * project's prefix because it shares the custom-property namespace and a bare
 * `--art` would collide with the first sheet that wanted the word.
 *
 * Exported for one reason, and it is not styling: `./arrival.ts` and `./band.ts`
 * have to ask the same `@supports` question this file asks, because whether the
 * badges are glued to the picture decides whether an entrance animation may move
 * them. A second copy of the ident in those files would be a guard that agrees
 * with this one only until somebody renames it here.
 */
export const ART_ANCHOR = '--mtg-art-anchor';

/**
 * And the name of the one thing already in that window: the mana cost badge.
 *
 * A second anchor rather than a reserved width, because the cost's width is its
 * pips and a board face may draw one or five of them. A card that draws no cost
 * badge declares no such name, which is what leaves the marks row the whole
 * picture on a land.
 */
const COST_ANCHOR = '--mtg-cost-anchor';

/**
 * How far above the slot's middle the rotated card's top edge sits, as a share
 * of the slot's *width*.
 *
 * **Only where anchor positioning is unavailable.** With it the badges are
 * anchored to the picture itself and follow the rotated card for free
 * (`MARKS_CSS` below); this is the arithmetic a browser that cannot do that
 * still needs, and it is what this build drew everywhere until `mtg-9edk`.
 *
 * The rotated card is as wide as the slot and 63/88 of that across the block
 * axis, so it sits centered with half of the remainder empty above it and half
 * below. The corner marks are positioned against the *slot*, so without this
 * they float in that gap instead of sitting on the card — which is the second
 * half of what `mtg-yi5` reported, the `ATK` and P/T badges "floating in the
 * empty space above and to the left of the shrunken card rather than attached
 * to it".
 *
 * It is spent as a negative `margin-block-start` under an `inset-block-start` of
 * 50%, which is the one arrangement that can measure a block-axis offset in
 * inline-axis units: a percentage `inset` resolves against the containing
 * block's height, and a percentage *margin* resolves against its width (CSS 2.1
 * §8.3), on both axes. The offset the marks need is `slot height / 2 - card
 * height / 2`, and the card's height is a share of the slot's width, so the two
 * halves have to come from different axes or the badge drifts off the card
 * exactly as far as the row shrank the slot — 4.4px at 1440x900 and 21px at
 * 1024x768, which is the defect this constant exists to prevent.
 */
const TAPPED_MARK_PULL = (CARD_TRIM_MM.width / CARD_TRIM_MM.height / 2) * 100;

export const SLOT_CSS = `
/* container-type, so the face inside can be *measured* rather than guessed at.
   ../card.ts draws the identity frame as a share of the card's own width
   (FRAME_BAND_SHARE) and a board face has no stated width - it is whatever the
   row settled on, between about 40px and 160px on this surface. The two rules
   below publish that width to the face as --card-w in the slot's own container
   units, mirroring the width expression on the same selector term for term, so
   the frame cannot drift from the card it is drawn round.

   A tapped slot already declared container-type: size for the rotated face's
   height cap, and the hover zoom in it is still placed against the viewport
   (measured: both a tapped and an upright entry put their zoom at the same fixed
   corner), so this is the containment that block already relies on, widened to
   every slot on the inline axis. */
.mtg-slot {
  position: relative; flex: none;
  display: flex; align-items: center; justify-content: center;
  width: ${cssNumber(SLOT_WIDTH_REM)}rem; height: ${cssNumber(SLOT_HEIGHT_REM)}rem;
  container-type: inline-size;
}
.mtg-slot[data-slot='hand'][data-empty='true'] {
  flex: none; align-self: center;
  width: auto; height: ${cssNumber(EMPTY_SLOT_HEIGHT_REM)}rem;
  min-width: 0; min-height: 0;
  aspect-ratio: ${cssNumber(CARD_TRIM_MM.width)} / ${cssNumber(CARD_TRIM_MM.height)};
  border: 1px dashed var(--mtg-mat-edge); border-radius: var(--mtg-radius-sm); background: var(--mtg-mat);
}
.mtg-zone[data-tone='rail'] .mtg-slot[data-empty='true'] {
  background: var(--mtg-surface-sunken); border-color: var(--mtg-line-strong);
}
/* The face is the trim's shape, and min-height: 0 is what makes that true rather
   than aspirational. A box with a preferred aspect ratio takes its *content* as
   its automatic minimum size (CSS Sizing 4), and a minimum beats a maximum, so
   the ratio and the max-height above it were both being overruled by whatever
   the bars and the rules box happened to need: measured over the flagship set at
   twelve permanents a side in chrome-headless-shell 151, one row of twelve came
   out at three heights between 138.2 and 155.4 against the 136.5 the trim
   allows, and the trims read 0.629, 0.676 and 0.707 against 0.716. the playtester,
   2026-08-13: "some of the cards end up taller than the others but I want them
   uniform". ../card.ts's FACE_TRIM is the same pair one size up and its
   docblock has the longer argument — the pair is load-bearing in both places and
   neither half works alone.

   What pays for a wrapped name is then the picture, which is the only region on
   this face that can (../card.ts, BOARD_FACE): the bars are flex: none and the
   window is flex: 1 1 auto with a min-height of its own. */
.mtg-slot > .mtg-card {
  width: 100%; --card-w: 100cqw; height: auto; max-height: 100%; min-height: 0;
  aspect-ratio: ${cssNumber(CARD_TRIM_MM.width)} / ${cssNumber(CARD_TRIM_MM.height)};
}
.mtg-slot[data-slot][data-tapped='true'] {
  width: ${cssNumber(SLOT_HEIGHT_REM)}rem; aspect-ratio: ${TAPPED_SLOT_ASPECT};
}
/* A rotated card is sized off whichever side of its slot is shorter, and the
   container is what lets it ask about the other one.

   TAPPED_FACE_WIDTH is a share of the slot's width, and a card's width is what
   the quarter turn lays along the slot's *height*. On a square that got the side
   it asked for the two sides are the same number and the second term is exactly
   non-binding, so this costs nothing wherever TAPPED_SLOT_ASPECT holds. It binds
   only where the square did not get its side: ../board/hand.ts caps a
   battlefield slot at BOARD_FACE_MAX_SHARE of the row, and a slot capped on the
   block axis keeps the width the card is drawn from. A card as wide as the side
   the cap did not touch is, after the turn, a card *taller* than the slot on the
   side the cap did touch, and ./fit.ts's row clips it - the visual top of a
   rotated face is the card's own leading edge, so what the row cut off was the
   first characters of every line. the playtester's 2026-08-16 captures
   (references/UI_issues/) read "...dgeland Barracuda" and "...ature - Bat" for
   that reason, and none of the horizontal overhang
   ../../../tools/tap-rotation.ts measures was ever nonzero while it happened.

   Measured over tap-rotation.html in chrome-headless-shell 151 at 1440x560: the
   card was 128.5 wide across a slot 85.8 tall, 15.3px of it outside the slot and
   10.1px of it outside the row. With the second term it is 73.5 across a slot
   73.5 tall and both are zero. A maximum on the card's *height* cannot say this
   - height is the axis the turn lays along the row, not the one that clipped -
   which is why the guard is on the width and needs the slot's block size to
   state it. Hence container-type: size on the slot: a share of a length the
   element can only reach by asking. */
.mtg-slot[data-tapped='true'] {
  container-type: size;
}
.mtg-slot[data-tapped='true'] > .mtg-card {
  rotate: 90deg;
  width: min(${cssNumber(TAPPED_FACE_WIDTH)}%, 100cqh);
  --card-w: min(${cssNumber(TAPPED_FACE_WIDTH)}cqw, 100cqh);
  height: auto; min-width: 0; max-height: none;
}
/* A card with a move on it, drawn as lit. The renderer already knew which cards
   those were - data-interactive is on the face and clicking it already plays the
   card - and drew nothing, which is mtg-8ou: measured side by side in one hand,
   a castable card and an unaffordable one had the same border, the same outline,
   the same opacity, the same filter and the same shadow. The border they share
   is the card's color identity, so two red cards look alike whether or not you
   can afford either, and nobody discovers that clicking works.

   Lit rather than outlined, which is the playtester's own word for it: "same for
   whatever is playable in your hand", said in one breath with wanting the active
   player's side of the board "a little more lit". An outline says this one is
   selected; light says this one is available, and those are different sentences.
   The same three declarations should be what the turn indicator scales up to a
   whole seat.

   Three channels, and the count is the point rather than the polish. Brightness
   alone is invisible to a viewer who cannot separate two luminances and it is
   the first thing a screen at half brightness throws away, so the light carries
   a warm rim (hue, at 3.11:1 on the mat) and a halo spilling onto the mat under
   it. A card is lifted, ringed and haloed; losing any one of the three still
   leaves a difference you can point at.

   The rim is two rings rather than one, and ./band.ts is why. --mtg-ready is a
   mid amber, so how far it stands off the ground depends entirely on how light
   the ground is: 3.60:1 on the hand's paper rail, 2.85:1 on the well every
   permanent used to sit on, and 1.97:1 on the near band that replaced it. A
   lighter amber cannot fix that - no color clears 3:1 upward from a ground that
   is already at lightness 0.77 - so the rim keeps the amber it needs for hue
   and carries a hairline of --mtg-mat-seam outside it, which clears 4.19:1 on
   the darkest band this card can be drawn on, 7.91:1 on the lightest and 7.66:1
   on the paper rail the hand is dealt into. The state is now legible on a ground
   of any tone, which is what WCAG 1.4.11 asks of a control that only says it is
   a control by being drawn differently.

   The lift is a filter on the *face*. A filter makes an element a containing
   block for fixed-position descendants and the hover zoom is fixed, but the zoom
   is a sibling of the face and a descendant of the slot, so the face is the one
   element in this subtree where a filter is free - ../styles/board/lands.ts
   records the same finding about the tapped tile's grayscale. The shadow keeps
   the card's own shadow as its last layer instead of replacing it, so a lit card
   is still a card sitting on the mat. */
.mtg-slot > .mtg-card[data-interactive='true'] {
  filter: var(--mtg-ready-lift);
  box-shadow:
    0 0 0 2px var(--mtg-ready),
    0 0 0 3px var(--mtg-mat-seam),
    0 0 14px 2px var(--mtg-ready-soft),
    var(--mtg-shadow-card);
}
.mtg-slot > .mtg-card[data-interactive='true']:hover { transform: none; scale: ${cssNumber(HOVER_SCALE)}; }
/* The badges, over the picture rather than over the card's name.
 *
 * mtg-9edk. The row was pinned to the slot's own top-left corner, which was the
 * top of the art window until ca9ce2b put the title bar first, and after it was
 * the first letters of the name. Measured over ../../../tools/corner-marks.ts in
 * chrome-headless-shell 151 on the flagship set, four permanents a side, every
 * one of them summoning sick with a point of damage: the row starts at the
 * slot's (4, 4) and the name's own box starts at (11, 10), so the overlap is
 * 54.2 x 9.4 and the longest name on the board loses fifteen letters at
 * 1440x900 - 106 letters across the eight faces. Every mark rides that one row,
 * so the defect is the row's origin and not any badge: what a wider row buys is
 * more letters, and at eight a side the damage badge wraps to a second line and
 * the worst face loses twenty-seven. A tapped slot had it at the other corner -
 * the quarter turn sends the card's top-left to the slot's top *right*, which is
 * where TAPPED_MARK_PULL was putting them - and lost up to eight a face there.
 *
 * **The row is anchored to the art window, which is the region with no text
 * under it.** ../card.ts already made that argument for the mana cost and put it
 * in the window's other corner; this is the same argument and the same window.
 * What is new is only how the row finds it. The row may not become a *child* of
 * the window, which would be the obvious way: an interactive face is a button
 * element, and WAI-ARIA gives that role presentational children, so every mark
 * inside one would be stripped from the accessibility tree - and these badges
 * are the only path a screen reader has to three facts the drawing carries
 * silently (../../board/Mark.ts, the silent field). So the row stays a child of
 * the slot, outside the button, and asks the browser where the picture is
 * instead.
 *
 * The alternatives, and why not:
 *
 * - **A fixed offset down the face.** The name bar is one to three lines
 *   (BOARD_NAME_LINES) and measured between 22.5 and 31.7px on one board, so a
 *   constant would be a second derivation of the face's internals kept level by
 *   hand, which is the thing ADR-0002 §6.2 exists to stop.
 * - **The card's other bottom corner.** Universal and cheap, and it trades the
 *   name for the rules box's last line - or, under BOARD_RULES_MIN_REM where
 *   there is no rules box, for the type line. mtg-611 already has the corner P/T
 *   badge overlapping that line; a second thing there is a worse bug, not a fix.
 * - **Indenting the name past the row.** The row's width is its badges' text, so
 *   the reserve would have to be a guess, and it is paid on every line of a
 *   wrapped name at a width where names are already being cut (mtg-b8e).
 * - **Shrinking the badges at small faces.** Buys letters and not the defect:
 *   the row still starts on the name, and a smaller badge over a smaller name
 *   covers the same share of it.
 *
 * What it costs: two geometries, because anchor positioning is Chromium 131 and
 * Safari 26 and Firefox has not shipped it. The declarations below the guard are
 * exactly what this build drew before, so an unsupporting browser is left where
 * it already was rather than somewhere new - including TAPPED_MARK_PULL, which
 * survives for that branch alone. mtg-9edk.1 tracks retiring the fallback.
 * The guard tests anchor-scope rather than anchor-name, and which of the two is
 * tested matters: a browser with the name and not the scope would resolve every
 * slot's badges against the *last* card in the document, which is a worse
 * drawing than the one being fixed. */
.mtg-slot__marks {
  position: absolute; inset-inline-start: var(--mtg-space-1); inset-block-start: var(--mtg-space-1);
  display: flex; gap: 2px; z-index: 1;
}
@supports not (anchor-scope: ${ART_ANCHOR}) {
  /* A quarter turn clockwise sends the card's top-left corner to the top *right*
     of the slot and the foot that prints the power and toughness to the top
     left, so a slot-anchored row is put at the end rather than the start: the
     numbers combat turns on are the ones it must never cover. */
  .mtg-slot[data-tapped='true'] > .mtg-slot__marks {
    inset-block-start: 50%;
    margin-block-start: calc(var(--mtg-space-1) - ${cssNumber(TAPPED_MARK_PULL)}%);
    inset-inline-start: auto; inset-inline-end: var(--mtg-space-1);
  }
}
@supports (anchor-scope: ${ART_ANCHOR}) {
  /* Scoped to the slot, so a slot's badges can only see its own card's window.
     Without this the name is document-wide and the browser takes the last
     acceptable anchor in tree order, which is some other permanent. */
  .mtg-slot { anchor-scope: ${ART_ANCHOR}, ${COST_ANCHOR}; }
  /* The two faces a slot draws (../../board/CardSlot.ts, SlotFace). Not the
     zoom's, which is a full-size face in the same slot and would otherwise be
     the later of two anchors carrying one name. */
  .mtg-card[data-size='board'] > .mtg-art,
  .mtg-card[data-size='art'] > .mtg-art { anchor-name: ${ART_ANCHOR}; }
  /* The window's own start corner, and the badges stay level: an anchor
     rectangle is the anchor's box in the containing block's axes, so a rotated
     card hands back its upright bounding box and a tapped permanent's badges
     land on the near corner of its picture reading the way every other badge on
     the table reads. That is the whole of what TAPPED_MARK_PULL was computing.

     The row is also held to the picture's width and wraps inside it, which is
     the same measurement read the other way. A quarter turn puts the card's
     short side along the row, so a tapped window at 1440x900 four a side is
     44.5px across where the upright one is 83.2 - and an unbounded row of 61.2px
     ran 12.7px past it and back onto the name it had just been taken off. Wrapped
     it costs a second line of badges over the picture, which is the one region
     with nothing under it; that is why this is the axis that gives. */
  /* The window's *near* corner, and the block axis is the one that must not be
     negotiable: a row that wraps has to grow into the picture and never back
     toward the bar it was just taken off. Anchoring the far edge instead was
     measured and reversed - at 1024x768 eight a side the window is 17.4px tall,
     a two-badge row wraps to 30.8, and a bottom-pinned row grew straight back
     through the title bar and covered 91 letters that this arrangement leaves
     alone.

     The inline end stops at the cost rather than at the picture, because the
     window already has a tenant: ../card.ts puts the mana cost in its top-right
     corner, and at 1440x900 four a side a row of 61.2px in a 66.6px window
     painted over the generic pip of a two-pip cost. So the row is pinned to the
     cost badge's own near edge through a second anchor and wraps in what is
     left. A face with no cost badge - every land, and the art tile, since
     ../card.ts draws that corner for castable board faces only - has no such
     anchor, which makes the declaration invalid at computed-value time and
     leaves the property at auto: the row takes the whole picture, which is
     the right answer for a card with nothing in that corner. */
  .mtg-card__corner { anchor-name: ${COST_ANCHOR}; }
  .mtg-slot__marks {
    position-anchor: ${ART_ANCHOR};
    inset-block-start: anchor(start); inset-inline-start: anchor(start);
    inset-inline-end: anchor(${COST_ANCHOR} start);
    max-width: anchor-size(width); flex-wrap: wrap;
  }
}
/* A badge. Not scoped to .mtg-slot, and that is now load-bearing rather than
   incidental: ../../board/StackZone.ts draws the same badge on a stack entry, so
   the two ends of a target mark are one shape drawn by one rule (mtg-njrp).

   align-self is that move's one cost, and it is paid here rather than in the
   stack's own sheet. A badge on a stack entry sits in .mtg-stack__meta, which is
   a flex row, and a flex item stretches to the row by default: measured in
   chrome-headless-shell 151 at 1280x800, the reticle on an entry whose target
   line wrapped came out 25.6 x 111.6 - a pill as tall as the paragraph beside
   it. Centering it is what makes a badge the same object in both places. */
.mtg-mark {
  display: inline-flex; align-items: center; align-self: center; gap: 2px;
  padding: 0 var(--mtg-space-1); border-radius: var(--mtg-radius-pill);
  background: var(--mtg-ink); color: var(--mtg-ink-inverse);
  font-size: var(--mtg-text-xs); font-weight: 700; line-height: 1.4;
}
/* An upright badge is one pill; a rotated one is allowed to break.

   Both halves of that are measured (mtg-9edk, ../../tools/corner-marks.ts). A
   badge is a flex item in a row bounded by the picture it sits on, so when the
   strip is narrower than the badge the text inside it wraps and "1 dmg" becomes
   a two-line red blob a third the height of the card - which happens upright at
   four permanents a side on any card whose cost is two pips wide, because the
   row ends where the cost begins. Forbidding the break there costs nothing: the
   picture on an upright face is at least a badge wide at all three viewports and
   both crowdings, so the pill stays on the art and the name is untouched.

   A rotated face has no such floor. Its picture is a quarter-turn strip - 17.4px
   wide at eight permanents a side at 1024x768 - and a badge that cannot break is
   a badge that leaves the picture: forbidding the break on tapped slots too took
   the letters covered on all-tapped boards from 0/0/0/0/46/92 to 0/0/19/35/98/148
   across the six tapped readings. Wrapping is how a mark fits on a strip. */
.mtg-slot:not([data-tapped='true']) > .mtg-slot__marks .mtg-mark {
  white-space: nowrap;
}
/* The number beside a glyph, in tabular figures for the reason a scoreboard
   uses them: the two ends of the mark are read against each other, and a 1 that
   is half the width of a 2 makes the same badge two shapes. */
.mtg-mark__badge { font-variant-numeric: tabular-nums; }
/* And the loud half of the target mark: the place on the mat is ringed.

   A badge alone is a badge among badges. A player scanning the table for "which
   one is it aimed at" is looking at cards rather than at corners, so the ring is
   what carries the mark at a glance and the badge is what says which stack
   object it belongs to.

   Three properties of the ring are each answering a constraint this route has
   already paid for.

   It is drawn *inside the slot's own box*, which is where a ring on this route
   has to be: a ring outside the border box is what ../zone.ts records losing to
   overflow: auto, whole. Inset by two pixels, so nothing can clip it.

   It is a pseudo-element on the slot rather than a property of the card, and the
   first two attempts are why. .mtg-card already spends both channels that could
   have carried it - box-shadow is the lit-and-playable state and outline is the
   selected state - so a ring on the card would delete a state somebody else's
   lane shipped. And an outline property on the *slot* is painted under the card: the
   card fills the slot exactly (152 x 212.3 at the same origin, measured in
   chrome-headless-shell 151 at 1280x800), so all that survived were four blue
   slivers at the corners. A positioned ::after with the marks row's own z-index
   paints over the face, which is the only place a ring on this card can be seen.

   It is *dashed*, which is the whole of the colorblind answer: the difference
   between a targeted place and an ordinary one is a broken line against no line
   at all, and the accent it is drawn in is a second channel rather than the
   only one.

   It costs no layout and takes no click. The ring is absolutely positioned, so
   the slot's footprint is unchanged and the board's vertical budget - 2.6px of
   headroom at 1280x800 with four a side - does not pay for this; pointer-events
   are off, so the face under it is still the button it was. */
.mtg-slot:has(> .mtg-slot__marks > .mtg-mark[data-mark^='targeted'])::after {
  content: ''; position: absolute; inset: 2px; z-index: 1; pointer-events: none;
  border: 2px dashed var(--mtg-accent); border-radius: var(--mtg-radius-sm);
}
/* Said, not shown. Two marks are drawn by the table itself now — an attacker is
   in the combat band and a derived size is underlined — and the badge would be
   the same sentence a second time on a face with no room for it. the playtester,
   2026-08-14: "the modified power toughness from static effects does not need to
   be repeated on a label in black and white on a card, the underlining of the
   power and toughness on the card itself is sufficient".

   The rule that went with this one is gone with the badge: the derived mark used
   to be drawn a size up with tabular figures, because mtg-3rm found it illegible
   at 11px. Nothing is drawn now, so nothing has to be legible.

   Clipped rather than display: none or visibility: hidden, and that is the
   whole of why this is a rule instead of a deletion. Both of those take the
   element out of the accessibility tree, and this element *is* the accessible
   path to two facts a screen reader has no other way to reach: a position is not
   readable and neither is an underline. Absolute positioning also takes it out
   of the marks row's flex layout, so a silent mark costs no gap beside the
   badges that are still drawn.

   It must also stay in the *tree*, not only in the sheet: ./attach.ts selects
   the dotted underline under the foot's power and toughness through
   a :has() test for the derived mark on this very element, so a rule that
   removed the mark would remove the drawing that replaced it. */
.mtg-mark[data-silent='true'] {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: 0; border: 0;
  overflow: hidden; clip-path: inset(50%); white-space: nowrap;
}
.mtg-mark[data-tone='negative'] { background: var(--mtg-negative); }
.mtg-mark[data-tone='positive'] { background: var(--mtg-positive); }
.mtg-mark[data-tone='pending'] { background: var(--mtg-pending); color: var(--mtg-ink-inverse); }
`;
