/**
 * One strip per copy, overlapped so a column of any depth fits a fixed box.
 *
 * `./columns.ts` refused this and named three reasons. the playtester overruled it on
 * 2026-08-29 against three fresh captures, and two of the three reasons turn out
 * to have been arguments about a different pane than the one we are now
 * building; the third was right and is answered here rather than dismissed.
 *
 * *"The stack solves a problem the strip count already solved for us."* It did,
 * for a 60-card deck drawn as 13 tiles. It does not for the pane the captures
 * show, where the count above a column is a count of cards and the reader is
 * meant to be able to point at the third copy of a card and cut it. A `4x`
 * badge is one object; four strips are four objects, and the decision that a
 * copy is grabbable is what makes the count above the column literally count the
 * things under it.
 *
 * *"Drawing the last card of each column full is a second density."* The answer
 * given here was that it is not a density at all: nothing selects it, the bottom
 * strip of an overlapped stack is the one with nothing covering it, so it has
 * room to show a whole card and the ones above it do not, and it falls out of
 * the overlap the way the tail of a fanned hand does. the playtester overruled that
 * on 2026-09-17 (`mtg-mxkrk`, "the compact view needs to just show the titles
 * not the card images"). Falling out of the overlap is not the same thing as
 * being wanted, and one picture at the foot of a column of names is a second
 * kind of object in a list that is otherwise one kind. So a compact column is
 * bars all the way down, and `full` is the only density that draws a face.
 * `./view-mode.ts`'s rule that a third mode is a bead rather than a quiet
 * addition is untouched, because this removes a drawing rather than adding a
 * mode.
 *
 * *"Overlapping means negative margins and a stacking order."* That one stands,
 * and it is why this file exists as arithmetic rather than as CSS. The pitch is
 * computed here, per column, and handed to the drawing as one number; the
 * drawing then positions strips absolutely inside a column of a stated height
 * rather than pulling them upward with negative margins into a box that has to
 * be told how tall it became. `../../styles/board/zone.ts` paid for the clip
 * twice with negative margins; nothing here has one.
 *
 * # Why the box height is settled per region and the pitch moves inside it
 *
 * The second decision of 2026-08-29: the deck region is one height and scrolls
 * sideways. Its rationale was "the count row is always one line, and the box's
 * height is the same at pick 1 and pick 45", which is what makes a draft usable
 * — the pack does not walk down the page as the pool fills. A box that does not
 * move and a column that grows can only be reconciled by tightening the pitch,
 * which is what MTGO does and what `stackMetrics` computes.
 *
 * The boxes below are the floor rather than the whole answer. They were the
 * whole answer until `mtg-47xi`, and being a constant is what made a 1440x900
 * desk draw its columns with 300px of empty pane under them; `./stack-box.ts`
 * raises the box to the room the pane turns out to have, wherever the pane has a
 * height of its own to report. What does not move is the box *within a region*:
 * every column in one pane is laid out against one number, which is the whole of
 * what the sentence above is protecting.
 *
 * The pitch has a floor of its own. Below `minPitch` a strip stops being
 * readable, and a column of sixty copies is a deck problem rather than a layout
 * problem, so past the floor the column is taller than its box and the box
 * scrolls it. `clipped` says which columns those are, so the sheet can give them
 * the scroll and a test can find them.
 */

/** What a single copy of a card is, once a column has been expanded. */
export interface Strip<T> {
  /** Stable per copy: the member's key and which copy this is. */
  readonly key: string;
  /** The thing the pane holds, handed straight back to its own click handler. */
  readonly member: T;
  readonly name: string;
  /** The printed cost, drawn through the shared symbol registry. `null` for a land. */
  readonly manaCost: string | null;
  /** WUBRG letters; the tint. Never the only carrier of color — see `./StripColumns.ts`. */
  readonly colorIdentity: string;
  /** 1-based within this card's copies, so a strip can say "2 of 4". */
  readonly copy: number;
  /** How many copies of this card the column holds. */
  readonly of: number;
  /**
   * The bottom strip of the column: the one with nothing covering it, and so the
   * one the full density draws open without anybody selecting it. Since
   * `mtg-mxkrk` the compact density draws it as an ordinary bar; see the
   * docblock.
   */
  readonly full: boolean;
  /**
   * This copy came off the foil sheet.
   *
   * Absent rather than `false` where nobody measured it, which is `mtg-jpbv`'s
   * rule about the pool and holds one layer down for the same reason: a strip
   * that said `false` on a pane drawn from a card list would be asserting every
   * copy is ordinary when the truth is that the question was never asked.
   */
  readonly foil?: boolean | undefined;
}

/** What a strip needs to draw itself, stated by the caller as its facts are. */
export interface StripFacts {
  readonly key: string;
  readonly name: string;
  readonly manaCost: string | null;
  readonly colorIdentity: string;
  /** Copies of this card in this column. A pool pane says 1; a deck pane says the count. */
  readonly copies: number;
  /**
   * Whether this member is a foil copy, where the pane knows.
   *
   * Stated per member rather than per card, because a foil is a property of the
   * printed copy and not of the card: a pane whose member is a pool position can
   * answer it, and a pane whose member is a card and whose `copies` is four
   * cannot, since the four copies need not agree. Those panes leave it absent
   * and every strip they expand is absent too.
   */
  readonly foil?: boolean | undefined;
}

/**
 * Expands a column's members into one strip per copy, in the members' order.
 *
 * The order is the group's, which `./grouping.ts` has already sorted by name, so
 * the four copies of a card are four adjacent strips and the reader can count
 * them without reading any of them.
 */
export function stripsOf<T>(members: readonly T[], factsOf: (member: T) => StripFacts): readonly Strip<T>[] {
  const strips: Strip<T>[] = [];
  for (const member of members) {
    const facts = factsOf(member);
    for (let copy = 1; copy <= facts.copies; copy += 1) {
      strips.push({
        key: `${facts.key}#${String(copy)}`,
        member,
        name: facts.name,
        manaCost: facts.manaCost,
        colorIdentity: facts.colorIdentity,
        copy,
        of: facts.copies,
        full: false,
        foil: facts.foil,
      });
    }
  }
  const last = strips.length - 1;
  return strips.map((strip, index) => (index === last ? { ...strip, full: true } : strip));
}

/**
 * The measurements a column is laid out against, in CSS pixels.
 *
 * Here rather than in `@mtg/card-geometry` on that package's own rule: it
 * answers questions about a card face, and how far apart two rows of a deck list
 * sit is a question about this application's chrome. Nothing outside `@mtg/ui`
 * has ever needed one of these numbers.
 */
export interface StackBox {
  /** The fixed height of the region every column is laid out inside. */
  readonly boxHeight: number;
  /** One strip's own height: the name-and-cost bar, unoverlapped. */
  readonly stripHeight: number;
  /**
   * The bottom strip of the stack: the one nothing covers.
   *
   * A whole card face at the full density, and since `mtg-mxkrk` one more name
   * bar at compact, where it is the same height as every strip above it.
   */
  readonly faceHeight: number;
  /** Below this a strip stops being readable and the column is clipped instead. */
  readonly minPitch: number;
}

export interface StackMetrics {
  /** Distance between one strip's top and the next one's. */
  readonly pitch: number;
  /** What the column actually occupies, which may exceed the box. */
  readonly height: number;
  /** The box cannot hold the column even at `minPitch`. */
  readonly clipped: boolean;
}

/**
 * The pitch that fits `strips` into the box, floored so a strip stays readable.
 *
 * A column of one is its face and nothing else, so the pitch is not consulted;
 * it is still reported as the unoverlapped height rather than as zero, because a
 * caller that writes it into a custom property should not have to special-case
 * the count it is already handling.
 */
export function stackMetrics(strips: number, box: StackBox): StackMetrics {
  if (strips <= 0) return { pitch: box.stripHeight, height: 0, clipped: false };
  if (strips === 1) {
    return {
      pitch: box.stripHeight,
      height: box.faceHeight,
      clipped: box.faceHeight > box.boxHeight,
    };
  }
  const room = (box.boxHeight - box.faceHeight) / (strips - 1);
  const pitch = Math.max(box.minPitch, Math.min(box.stripHeight, room));
  const height = pitch * (strips - 1) + box.faceHeight;
  // Tolerant by a pixel: `room` is a float, and a column that fits exactly
  // should not report itself clipped because the division landed at 199.9999.
  return { pitch, height, clipped: height > box.boxHeight + 1 };
}

import { DRAFT_POOL_COLUMN_FLOOR_PX } from '../../styles/panel';

/**
 * One name-and-cost bar's own height, unoverlapped, in CSS pixels.
 *
 * Named once and used as both `stripHeight` and `faceHeight` since `mtg-mxkrk`:
 * one strip is one strip wherever it is drawn, and at compact the bottom one is
 * a strip too. It was 132 while that strip held a picture, and leaving it there
 * once the picture was gone would reserve a whole card's height for a bar and
 * leave every column a 106px hole at its foot.
 */
const STRIP_HEIGHT_PX = 26;

/**
 * The measurements a deck editor's pane lays its columns out against, floored.
 *
 * `boxHeight` is a floor since `mtg-47xi`: `./stack-box.ts` raises it to the
 * pane's own height where the pane declares one, and hands this back unchanged
 * where it does not. The number itself is the height the region had everywhere
 * before there was a pane to ask.
 */
export const DECK_STACK_BOX: StackBox = {
  boxHeight: 360,
  stripHeight: STRIP_HEIGHT_PX,
  faceHeight: STRIP_HEIGHT_PX,
  minPitch: 13,
};

/**
 * The same columns, shallower, for the draft pool under the pack.
 *
 * Everything but the box is the deck's: one strip is one strip wherever it is
 * drawn, and the floor is the point below which a name stops being readable,
 * which is a fact about type rather than about a pane. What differs is what the
 * region is *for*. A deck editor's pane owns its column of the page and the
 * cards in it are the subject; the draft pool shares its column with the pack,
 * and the pack is the decision being made — a pool that took the deck's 360px
 * would leave a 1440x900 window about a row and a half of the thing it is
 * choosing from.
 *
 * So it tightens sooner and clips sooner, and both are the right trade here:
 * past the floor the column is a reference you scroll, and the pack above it
 * stays a pack you can read.
 */
export const DRAFT_STACK_BOX: StackBox = {
  boxHeight: DRAFT_POOL_COLUMN_FLOOR_PX,
  stripHeight: STRIP_HEIGHT_PX,
  faceHeight: STRIP_HEIGHT_PX,
  minPitch: 13,
};

/**
 * How a strip names itself when it is spoken rather than drawn.
 *
 * The copy number is in the sentence because four adjacent strips are four
 * identical accessible names otherwise, and the action bar the click grammar
 * puts them under says "2 of 4" as well — a reader who cannot see the outline
 * needs the two to agree.
 *
 * `foil` is in the sentence for the same reason and it is the whole of what a
 * reader who cannot see the mark gets. A mark drawn and not spoken is the defect
 * this file's tint rule already refuses one modality over: the fill is never the
 * only carrier of color, and the sheen may not be the only carrier of the foil.
 * Only `true` is spoken — an ordinary copy is the unmarked case, and a pane that
 * measured nothing says nothing.
 */
export function stripLabel(strip: Strip<unknown>): string {
  const named =
    strip.of === 1 ? strip.name : `${strip.name}, copy ${String(strip.copy)} of ${String(strip.of)}`;
  return strip.foil === true ? `${named}, foil` : named;
}

import { CARD_TRIM_MM, FULL_FACE_WIDTH_REM } from '@mtg/card-geometry';

/**
 * Which of the two densities a region is drawn at.
 *
 * `./view-mode.ts` owns the word and the control; this is the same two values
 * seen from the arithmetic's side, because what a density changes here is three
 * numbers and one of them is derived from the pane rather than named.
 */
export type StripDensity = 'compact' | 'full';

/**
 * The card's trim, as a height per unit of width.
 *
 * `@mtg/card-geometry`'s `CARD_TRIM_MM` is the source and the sheet hands the
 * same pair to `aspect-ratio`, so a full face's height is its width times this
 * whatever width a column gives it. Restated as a ratio rather than imported as
 * a pair because what this file needs is the multiplier, and the two cannot
 * disagree: `../../../test/deck/strips.test.ts` divides the constant.
 */
export const CARD_TRIM_RATIO = CARD_TRIM_MM.height / CARD_TRIM_MM.width;

/**
 * How much of a whole face shows when the card under it is overlapping it.
 *
 * The title bar and most of the art window: enough to name the card and to tell
 * it apart from the three beside it by its picture, which is the whole reason
 * somebody switched to this density. Below the band the face is the rules box
 * and the foot, and those are what the open card is for.
 */
export const FULL_BAND_SHARE = 0.42;

/**
 * The least a full-density strip may be pitched at, in CSS pixels.
 *
 * The same 26px `DECK_STACK_BOX` gives a compact strip, and deliberately the
 * same number rather than a share of the face: what the floor protects is a
 * name bar staying readable, which is a fact about type and not about how big
 * the picture above it is. A column past it is taller than its box and scrolls,
 * exactly as a compact one does.
 */
export const FULL_MIN_PITCH_PX = 26;

/**
 * The narrowest and widest a full-density column is drawn.
 *
 * The floor and ceiling are the same `FULL_FACE_WIDTH_REM`: whole cards remain
 * at the width where their official rules text is measured and readable. The
 * earlier adaptive floor squeezed four columns to 200px and some official
 * cards to 5–7px rules text; a full-card view that needs horizontal scrolling
 * is more useful than one that technically shows every column but cannot be
 * read. Compact density remains the no-scroll overview.
 */
export const FULL_COLUMN_MIN_PX = FULL_FACE_WIDTH_REM * 16;
export const FULL_COLUMN_MAX_PX = FULL_FACE_WIDTH_REM * 16;

/** The gap between two columns: `--mtg-space-3`, which is what the sheet writes. */
export const STRIP_COLUMN_GAP_PX = 12;

/**
 * How wide each full-card column is.
 *
 * The region measurement and group count remain inputs because the strip
 * component asks the same geometry question at both densities. With the
 * readable floor now equal to the face's measured ceiling, every answer is the
 * canonical width; a future wider reading face can reopen the interval without
 * changing the component seam.
 *
 * A region that has not been measured passes `null` and gets the floor, which is
 * what server rendering and every jsdom suite in this package draw.
 */
export function fullColumnWidth(regionWidth: number | null, columns: number): number {
  if (regionWidth === null || columns <= 0) return FULL_COLUMN_MIN_PX;
  const share = (regionWidth - STRIP_COLUMN_GAP_PX * (columns - 1)) / columns;
  return Math.max(FULL_COLUMN_MIN_PX, Math.min(FULL_COLUMN_MAX_PX, Math.floor(share)));
}

/**
 * The measurements a column of whole faces is laid out against, for a column of
 * that width.
 *
 * Everything but the pitch floor is a share of the width, because at this
 * density the thing being stacked is a card rather than a bar: its height is its
 * trim, and how much of it shows under the next one is a share of that. The
 * `boxHeight` here is only the floor `./stack-box.ts` raises to the pane's own
 * height, and one whole face is the right floor -- a region too short to draw a
 * single card whole has nothing to say at this density.
 */
export function fullStackBox(columnWidth: number): StackBox {
  const faceHeight = Math.round(columnWidth * CARD_TRIM_RATIO);
  return {
    boxHeight: faceHeight,
    stripHeight: Math.round(faceHeight * FULL_BAND_SHARE),
    faceHeight,
    minPitch: FULL_MIN_PITCH_PX,
  };
}

/** What a column costs once one of its strips has been opened in place. */
export interface OpenStack {
  /** How far every strip below the open one slides down. Zero when none is. */
  readonly push: number;
  /** What the column occupies with it open, which may exceed the box. */
  readonly height: number;
  readonly clipped: boolean;
}

/**
 * The column with one of its strips showing whole, and the ones below it moved.
 *
 * The playtester, 2026-08-29, choosing where a selected card's whole face is drawn:
 * in place, in its column, with the cards below sliding down "like a pile
 * opening" and nothing else on the pane moving. So there is no preview area to
 * size and no second copy of the face anywhere: the strip that is open is the
 * strip that was already there, at its own full height, and the column is that
 * much taller while it is open.
 *
 * The bottom strip is open already -- it is the one with nothing covering it,
 * which is `stackMetrics`'s whole arrangement -- so opening it moves nothing and
 * costs nothing.
 */
export function openedStack(
  metrics: StackMetrics,
  box: StackBox,
  strips: number,
  openIndex: number | null,
): OpenStack {
  const shut = { push: 0, height: metrics.height, clipped: metrics.clipped };
  if (openIndex === null || openIndex < 0 || openIndex >= strips - 1) return shut;
  const push = Math.max(0, box.faceHeight - metrics.pitch);
  if (push === 0) return shut;
  const height = metrics.height + push;
  return { push, height, clipped: height > box.boxHeight + 1 };
}
