/**
 * Card geometry, in tenths of a millimeter.
 *
 * The unit choice is the whole point of "at set scale": a Magic card is
 * 63 x 88 mm, so the SVG carries `width="63mm" height="88mm"` with a viewBox of
 * 630 x 880 user units. One user unit is 0.1 mm at print size, every constant
 * below is a real physical measurement, and the same file is correct on a
 * screen at any zoom and on a printer at any DPI without a second scale factor
 * anywhere in the renderer.
 *
 * The regions are an *original* frame anatomy — a title bar, an art window, a
 * type bar, a rules box, a P/T badge and a collector line. It borrows the
 * arrangement that every trading card has used since the 1930s and none of
 * Wizards' artwork: no frame asset is copied, traced or measured off a scan
 * (ADR-0001 section 5, `docs/research/prior-art-data-sources.md` section 5.4 —
 * frame reproduction is exactly what drew the CardConjurer C&D).
 *
 * The trim and the art window's ratio are not decided here. They come from
 * `@mtg/ui`'s `card/anatomy.ts`, which the web face builds from as well, so a
 * card cannot be one shape on screen and another on paper (ADR-0002). The row
 * heights below *are* decided here, because they only mean anything against a
 * fixed trim, which is exactly the difference the split rests on.
 */
import type { Card } from '@mtg/dsl';
import { isPlaneswalker } from '@mtg/dsl';
import {
  ART_WINDOW,
  CARD_TRIM_MM,
  FRAME_BAND_MM,
  LOYALTY_SHIELD_SHARE,
  PLANESWALKER_ART_WINDOW,
  TITLE_PIP_TO_TEXT,
} from '@mtg/card-geometry';

/** Trimmed card size in millimeters; the physical size the SVG declares. */
export const CARD_WIDTH_MM = CARD_TRIM_MM.width;
export const CARD_HEIGHT_MM = CARD_TRIM_MM.height;

/** User units per millimeter. Everything below is in user units. */
export const UNITS_PER_MM = 10;

export const CARD_WIDTH = CARD_WIDTH_MM * UNITS_PER_MM;
export const CARD_HEIGHT = CARD_HEIGHT_MM * UNITS_PER_MM;

/** An axis-aligned rectangle in user units. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function box(x: number, y: number, width: number, height: number): Box {
  return { x, y, width, height };
}

/** Shrinks a box by a uniform padding on every side. */
export function inset(outer: Box, padding: number): Box {
  return box(outer.x + padding, outer.y + padding, outer.width - padding * 2, outer.height - padding * 2);
}

/** True when `inner` lies entirely within `outer`, allowing a rounding epsilon. */
export function contains(outer: Box, inner: Box, epsilon = 0.01): boolean {
  return (
    inner.x >= outer.x - epsilon &&
    inner.y >= outer.y - epsilon &&
    inner.x + inner.width <= outer.x + outer.width + epsilon &&
    inner.y + inner.height <= outer.y + outer.height + epsilon
  );
}

/** The frame band, in user units. `FRAME_BAND_MM` is the one declaration of it. */
const BORDER = FRAME_BAND_MM * UNITS_PER_MM;
const GAP = 8; // 0.8 mm between stacked regions

/**
 * Where the identity ring sits, and how thick it is.
 *
 * Named here rather than left as two literals in `frame.ts` because the numbers
 * are a print decision, not a drawing one. The ring used to sit 0.7 mm in at
 * 0.5 mm wide, so it occupied the band 0.45–0.95 mm from the trim. A card cut
 * by hand lands within about half a millimeter of where it was aimed, which put
 * the cut *inside the ring* on a routine miss: the line comes out thinner down
 * one edge than the other, and the eye reads that instantly on a rectangle.
 *
 * At 1.8 mm in, the same half-millimeter miss leaves the ring whole and only
 * moves the margin around it. The outer edge lands 2.05 mm from the trim and
 * the printed content starts at `BORDER`, 2.6 mm, so the ring keeps 0.55 mm of
 * clear space on the inside as well.
 */
const RING_INSET = 18;
const RING_WIDTH = 5;

const contentX = BORDER;
const contentWidth = CARD_WIDTH - BORDER * 2;

const titleY = 32;
const titleHeight = 66;
const artY = titleY + titleHeight + GAP;
/** The window fills the content column, so its height follows the shared ratio. */
const artHeight = (contentWidth * ART_WINDOW.height) / ART_WINDOW.width;
const typeY = artY + artHeight + GAP;
const typeHeight = 56;
const rulesY = typeY + typeHeight + GAP;
const rulesHeight = 244;
const footerY = rulesY + rulesHeight + GAP;
const footerHeight = 30;
/** Width the P/T badge reserves at the right of the footer row. */
const PT_WIDTH = 120;
const PT_HEIGHT = 44;
/** Clear space between the footer bar and whichever badge shares its row. */
const BADGE_GUTTER = 10;

/**
 * The planeswalker face, which is the same stack with two rows re-cut.
 *
 * A planeswalker prints three or four abilities where a creature prints one,
 * and the box they go in is the same rectangle, so the box has to grow and the
 * only region on the face with height to spare is the picture. That is what a
 * printed planeswalker does too — its window is visibly shorter than a
 * creature's — and `@mtg/card-geometry`'s `PLANESWALKER_ART_WINDOW` is the one
 * declaration of the shorter ratio, read by this file and by `@mtg/ui`'s sheet.
 *
 * Nothing above the window moves: the title bar is where it always was, and the
 * type bar and the rules box each rise by exactly the height the window gave
 * up. The bottom of the rules box is not where an ordinary card's is either,
 * and that is the second half of this — the shield is a real object with a real
 * rectangle, and a box that ran under it would be a box whose last ability is
 * covered by the number it belongs to. `mtg` UI feedback, 2026-08-18: "the
 * loyalty is covering up too much text". So the box stops one `GAP` above the
 * shield, the same gap that separates every other pair of stacked regions, and
 * the clearance is arithmetic rather than a hope.
 *
 * The shield's foot is the identity ring's inner edge, so the shape hangs off
 * the bottom of the printed content, across the frame band, and stops where the
 * ring begins instead of crossing it. That is what "sits on the border" has to
 * mean on a face that draws a ring: a badge that ran through it would read as a
 * printing error rather than as a badge.
 */
const LOYALTY_ART_HEIGHT = (contentWidth * PLANESWALKER_ART_WINDOW.height) / PLANESWALKER_ART_WINDOW.width;
const LOYALTY_ART_GIFT = artHeight - LOYALTY_ART_HEIGHT;
const loyaltyTypeY = typeY - LOYALTY_ART_GIFT;
const loyaltyRulesY = rulesY - LOYALTY_ART_GIFT;
/** The starting-loyalty shield, sized off the card's width on both axes. */
const SHIELD_WIDTH = CARD_WIDTH * LOYALTY_SHIELD_SHARE.width;
const SHIELD_HEIGHT = CARD_WIDTH * LOYALTY_SHIELD_SHARE.height;
const shieldY = CARD_HEIGHT - RING_INSET - RING_WIDTH - SHIELD_HEIGHT;
const loyaltyRulesHeight = shieldY - GAP - loyaltyRulesY;

/**
 * The size a card name is set at when it fits at full size. `regions.ts` takes
 * the title band's ceiling from it, and the cost pip is sized against it here,
 * so the one number lives above both rather than beside one of them.
 */
export const TITLE_MAX_SIZE = 34;

/**
 * A cost pip's radius: half the title's own line box, which is the shared rule
 * (`@mtg/ui`'s `TITLE_PIP_TO_TEXT`).
 *
 * It was a flat 15.5 and is now 20.4, which looks like the wrong direction —
 * the complaint that produced the rule was that the *screen* pip was too large.
 * Both faces move toward each other. As a share of the card's height the screen
 * pip went from 4.93% to 4.58% and the printed one from 3.52% to 4.64%, where
 * before this the printed pip was a third smaller relative to its card than the
 * screen pip was to its own. A specification that only fixed the loud half
 * would have widened that.
 *
 * The title bar pays for it in name width: a five-pip cost now reserves 216
 * units of the 578-unit content column instead of 167. `renderTitle` wraps a
 * name that no longer fits on one line and `checkSvgOverflow` fails one that
 * fits on neither, so the cost of being wrong here is loud.
 */
const PIP_RADIUS = (TITLE_MAX_SIZE * TITLE_PIP_TO_TEXT) / 2;

/** Every region of the face, resolved once and shared by renderer and checker. */
export interface CardGeometry {
  readonly card: Box;
  /** The frame border ring: the card minus the printed content area. */
  readonly frame: Box;
  readonly title: Box;
  readonly art: Box;
  readonly type: Box;
  readonly rules: Box;
  readonly footer: Box;
  /** P/T badge, sitting on the bottom-right corner of the rules box. */
  readonly powerToughness: Box;
  /**
   * The starting-loyalty shield, in the card's bottom-right corner.
   *
   * Declared on every face and drawn on one. A card that is not a planeswalker
   * has no starting loyalty, so `regions.ts` draws nothing here — but the
   * rectangle is a property of the *frame* rather than of the card, and stating
   * it once means the planeswalker geometry can be described as "the ordinary
   * stack, with the rules box stopped above this" instead of as a second set of
   * numbers nothing relates to the first.
   */
  readonly loyalty: Box;
  readonly cornerRadius: number;
  /** Distance from the trim to the outside of the identity ring, in user units. */
  readonly ringInset: number;
  /** Stroke width of the identity ring. */
  readonly ringWidth: number;
  readonly framePadding: number;
  /** Inner padding of the title, type, rules and footer boxes. */
  readonly textPadding: number;
  /** Radius of one mana pip. */
  readonly pipRadius: number;
  /** Horizontal gap between adjacent pips. */
  readonly pipGap: number;
}

export const CARD_GEOMETRY: CardGeometry = {
  card: box(0, 0, CARD_WIDTH, CARD_HEIGHT),
  frame: box(0, 0, CARD_WIDTH, CARD_HEIGHT),
  title: box(contentX, titleY, contentWidth, titleHeight),
  art: box(contentX, artY, contentWidth, artHeight),
  type: box(contentX, typeY, contentWidth, typeHeight),
  rules: box(contentX, rulesY, contentWidth, rulesHeight),
  // The footer stops short of the P/T badge rather than running under it, so
  // "does this text fit its box" stays a question about one rectangle.
  footer: box(contentX, footerY, contentWidth - PT_WIDTH - BADGE_GUTTER, footerHeight),
  powerToughness: box(
    contentX + contentWidth - PT_WIDTH,
    footerY - (PT_HEIGHT - footerHeight) / 2,
    PT_WIDTH,
    PT_HEIGHT,
  ),
  loyalty: box(contentX + contentWidth - SHIELD_WIDTH, shieldY, SHIELD_WIDTH, SHIELD_HEIGHT),
  cornerRadius: 30,
  ringInset: RING_INSET,
  ringWidth: RING_WIDTH,
  framePadding: BORDER,
  textPadding: 20,
  pipRadius: PIP_RADIUS,
  pipGap: 3,
};

/**
 * The planeswalker variant of the same frame: shorter window, taller rules box
 * stopped above the shield, and a footer bar narrowed for the shield rather
 * than for a P/T plate. Everything else is the ordinary face's, spread in from
 * it rather than restated, so a change to the trim or the ring reaches both.
 */
export const PLANESWALKER_GEOMETRY: CardGeometry = {
  ...CARD_GEOMETRY,
  art: box(contentX, artY, contentWidth, LOYALTY_ART_HEIGHT),
  type: box(contentX, loyaltyTypeY, contentWidth, typeHeight),
  rules: box(contentX, loyaltyRulesY, contentWidth, loyaltyRulesHeight),
  footer: box(contentX, footerY, contentWidth - SHIELD_WIDTH - BADGE_GUTTER, footerHeight),
};

/**
 * The frame a card is drawn in. One card kind takes the variant above; every
 * other kind takes the ordinary face, unchanged and byte for byte.
 *
 * `@mtg/ui`'s sheet asks the same question as `:has(.mtg-card__shield)`, and
 * `@mtg/card-geometry`'s `artWindow` is where both of them get the window they
 * switch to, so the two faces cannot end up with different pictures.
 */
export function cardGeometry(card: Card): CardGeometry {
  return isPlaneswalker(card) ? PLANESWALKER_GEOMETRY : CARD_GEOMETRY;
}

/** Inner padding of the single-line bars (title, type, footer). */
export const BAR_PADDING = 12;

/**
 * The standard bleed, in millimeters. Three is what every printer asks for and
 * it is the number a hand cut needs too, for the same reason.
 */
export const DEFAULT_BLEED_MM = 3;

/**
 * The document a card is drawn into, once a bleed is allowed for.
 *
 * The trim box keeps the origin. Every region above is measured from the top
 * left of the finished card and none of them move when a bleed is added; what
 * changes is that the viewBox starts at a negative coordinate and the document
 * is larger than the card. That is the whole trick, and it is why bleed could
 * be added without renumbering a single region: the coordinate space a designer
 * reasons in is still "distance from the corner of the card".
 *
 * Why any of this is needed. The ground is a rounded rectangle drawn exactly on
 * the trim, so the four corners of the sheet are unpainted. Cut a proxy out by
 * hand and the blade goes through paper the ink never reached, which shows up as
 * a white nick at each corner and a white hairline down whichever edge the cut
 * drifted outward on. Ink has to run *past* the cut for the cut to be invisible,
 * and that ink has nowhere to live unless the document is bigger than the card.
 */
export interface BleedGeometry {
  /** Bleed on each side, in user units. Zero for a trim-sized document. */
  readonly bleed: number;
  /** The full document, including bleed; the viewBox. */
  readonly document: Box;
  /** The finished card inside it, which is what gets cut to. */
  readonly trim: Box;
  readonly widthMm: number;
  readonly heightMm: number;
}

/** Resolves the document box for a bleed given in millimeters. */
export function bleedGeometry(bleedMm: number, geometry: CardGeometry = CARD_GEOMETRY): BleedGeometry {
  if (!Number.isFinite(bleedMm) || bleedMm < 0) {
    throw new RangeError(`bleed must be a non-negative number of millimeters, got ${bleedMm}`);
  }
  const bleed = bleedMm * UNITS_PER_MM;
  return {
    bleed,
    document: box(-bleed, -bleed, geometry.card.width + bleed * 2, geometry.card.height + bleed * 2),
    trim: geometry.card,
    widthMm: CARD_WIDTH_MM + bleedMm * 2,
    heightMm: CARD_HEIGHT_MM + bleedMm * 2,
  };
}

/** Total width a pip run of `count` symbols occupies. */
export function pipRunWidth(count: number, geometry: CardGeometry = CARD_GEOMETRY): number {
  if (count <= 0) return 0;
  return count * geometry.pipRadius * 2 + (count - 1) * geometry.pipGap;
}
