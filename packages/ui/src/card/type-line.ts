/**
 * What a board face's type bar draws, and the width at which it stops drawing
 * each part of it.
 *
 * `mtg-mq81`: the board face decided it had room for a type line and then cut
 * the line it drew. Two rules were saying different things about one bar.
 * `BOARD_TYPE_LINE_MIN_REM` in `../styles/card.ts` hides the region below a
 * 96px face — a threshold about the *face* — and above it the bar drew the
 * whole type line under `text-overflow: ellipsis`, which is a decision about
 * the *text* and was never made. Measured in chrome-headless-shell 151 over the
 * `@mtg/dsl` example set, at four permanents a side and 1280x800, eight of forty
 * type lines were cut, the worst by 42px of the 109px `Creature — Goblin
 * Warrior` wants; at ten and sixteen a side and 1440x900 it was 22 of 64 and 32
 * of 88, worst 33px. A wider viewport did not resolve it, because the bar's font
 * grows with the face (`clamp(0.5625rem, 9cqw, var(--mtg-text-sm))`), so the
 * capacity in *characters* barely moves between a 104px face and a 144px one.
 *
 * The rule this file states instead: **the bar draws whole units, and marks
 * what it left out.** A type line is three parts — supertypes, card types,
 * subtypes — and they are dropped from the right in that order as the face
 * narrows. Every state is a whole phrase rather than a cut of one:
 *
 *   Legendary Creature — Bird Soldier     everything fits
 *   Legendary Creature…                   the subtypes went
 *   Creature…                             the supertypes went too
 *   (no bar)                              not even the card type fits
 *
 * The ellipsis is the same mark the reader had before and it now falls at a
 * word boundary rather than through a glyph, so `Creature…` says there is more
 * of this line somewhere. Where is unchanged: `./Card.ts` spells the whole line
 * into the face's `title` through `faceDetailText` and into its `aria-label`
 * through `faceAccessibleName`, at every size, and the mark is drawn by a CSS
 * `::after` so no reader of the element's text sees a character the card does
 * not have.
 *
 * **Which state a face is in is a container query, not a measurement.** The
 * three bands below are published into the markup as `data-type-*` attributes
 * and `../styles/card.ts` turns the ladder into one `@container` block per band.
 * That is the same arrangement as `RULES_FIT_STEPS` and `NAME_FIT_STEPS` in
 * `./anatomy.ts` — the card's own step is written where jsdom, a proof sheet and
 * the parity suite can all read it, and only the width is left to the browser.
 *
 * The capacity model is the part that is approximate, and it is calibrated to
 * err toward hiding rather than toward cutting. Measured on the same rig, a
 * board type line sets at 0.47 to 0.49 of the font size per character
 * (`Creature — Goblin Warrior`, 25 characters, 109px at 9px type;
 * `Artifact Creature — Golem`, 25 characters, 110px at 9.4px), and the widest
 * per-character reading over every drawn line at either viewport was 0.573 —
 * from a four-character line with room to spare. `ADVANCE` is 0.55, which is
 * 12% above what a real type line sets at, and the band is then rounded up to
 * the next rung, so a line the model gets wrong loses its bar rather than its
 * tail. Nothing here is load-bearing for correctness: the pin is
 * `../../test/play/type-line-fit.browser.test.ts`, which measures `scrollWidth`
 * against `clientWidth` on every type line at every built position and fails on
 * any cut at all.
 *
 * This is a `board` decision and no other face's. The full face sets its type
 * line with `typeFitStep` and one line, measured clean: over ten full faces at
 * 214px, zero cuts.
 */
import type { Card as DslCard } from '@mtg/dsl';
import { typeLineParts } from '@mtg/dsl';

/**
 * The bar's own furniture, in px: 2px of padding a side, the 2px gap before the
 * rarity seal, and 3px of slack. Measured against the drawn bar, the model is
 * 0.6 to 1.0px conservative at every width the rig reached — 17.8 against a
 * measured 17 at an 84px content box, 19.8 against 19 at 108px.
 */
const BAR_FURNITURE_PX = 9;

/** The seal beside the line, `clamp(0.55rem, 10cqw, 0.95rem)` in `../styles/card.ts`. */
const SEAL_MIN_PX = 8.8;
const SEAL_CQW = 0.1;
const SEAL_MAX_PX = 15.2;

/** The line's own size, `clamp(0.5625rem, 9cqw, var(--mtg-text-sm))`. */
const FONT_MIN_PX = 9;
const FONT_CQW = 0.09;
const FONT_MAX_PX = 13;

/** Mean glyph advance as a fraction of the font size; see the docblock. */
const ADVANCE = 0.55;

/** The mark a dropped part leaves behind, drawn by `::after`. */
const ELLIPSIS = '…';

/**
 * The rungs a band may take, in rem of the face's *content box* — which is what
 * a size query is evaluated against, so 5rem is an 80px content box and a 96px
 * face. Fine where board faces actually land (a played table draws faces between
 * about 5 and 11rem) and coarse above it, because the difference between an 18rem
 * face and a 20rem one is a face nobody is looking at on a battlefield.
 */
export const TYPE_BANDS: readonly number[] = [
  5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 10, 11, 12, 13, 14, 16, 18, 20,
];

/**
 * The band value for a part no face is wide enough to draw. A rule keyed on it
 * sits outside every `@container` block, so the part is never drawn at all.
 */
export const TYPE_BAND_NEVER = 'never';

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Whether `text` fits the type bar of a face whose content box is `rem` wide. */
function fitsAt(text: string, rem: number): boolean {
  const width = rem * 16;
  const seal = clamp(width * SEAL_CQW, SEAL_MIN_PX, SEAL_MAX_PX);
  const font = clamp(width * FONT_CQW, FONT_MIN_PX, FONT_MAX_PX);
  return text.length * ADVANCE * font <= width - BAR_FURNITURE_PX - seal;
}

/**
 * The widest face that must *not* draw `text`, as a band attribute value.
 *
 * Fit is monotone in the width, so the first rung the text fits at is the last
 * rung it may be hidden at, and `@container (max-width: <band>rem)` is exactly
 * the rule that hides it there and everywhere narrower.
 */
function bandFor(text: string): string {
  for (const band of TYPE_BANDS) {
    if (fitsAt(text, band)) return String(band);
  }
  return TYPE_BAND_NEVER;
}

/** The three parts of a type line, as the board face draws them. */
export interface TypeLinePieces {
  /** Supertypes and the space after them, or `''`. */
  readonly supertypes: string;
  /** The card types, which every card has. */
  readonly types: string;
  /** The em dash and the subtypes, or `''`. */
  readonly subtypes: string;
}

/**
 * The type line cut into the three parts the bar drops in order.
 *
 * Concatenated it is `renderTypeLine(card)` character for character, which is
 * what keeps the element's own text the card's text: the space after the
 * supertypes and the em dash before the subtypes travel inside the part that
 * would leave without them.
 */
export function typeLinePieces(card: DslCard): TypeLinePieces {
  const parts = typeLineParts(card);
  return {
    supertypes: parts.supertypes.length > 0 ? `${parts.supertypes.join(' ')} ` : '',
    types: parts.types.join(' '),
    subtypes: parts.subtypes.length > 0 ? ` — ${parts.subtypes.join(' ')}` : '',
  };
}

/**
 * The three widths at which a board face gives something up.
 *
 * `null` where there is nothing to give: a card with no supertypes never drops
 * one, and the attribute is left off the face rather than published as a rung
 * no rule should fire at.
 */
export interface TypeBands {
  /** Below this the subtypes go and the mark appears. */
  readonly subtypes: string | null;
  /** Below this the supertypes go too. */
  readonly supertypes: string | null;
  /** Below this the bar is not drawn. */
  readonly hidden: string;
}

/**
 * Which band each part of `card`'s type line leaves at.
 *
 * Read from the richest state down: each rung is measured as the text that
 * *remains* once the part above it has gone, mark included, because that is the
 * line the face has to fit once it has made the drop.
 */
export function typeBands(card: DslCard): TypeBands {
  const pieces = typeLinePieces(card);
  const whole = `${pieces.supertypes}${pieces.types}${pieces.subtypes}`;
  const withoutSubtypes = `${pieces.supertypes}${pieces.types}${ELLIPSIS}`;
  const typesOnly = `${pieces.types}${ELLIPSIS}`;
  const hasSubtypes = pieces.subtypes.length > 0;
  const hasSupertypes = pieces.supertypes.length > 0;
  const afterSubtypes = hasSubtypes ? withoutSubtypes : whole;
  return {
    subtypes: hasSubtypes ? bandFor(whole) : null,
    supertypes: hasSupertypes ? bandFor(afterSubtypes) : null,
    hidden: bandFor(hasSupertypes ? typesOnly : afterSubtypes),
  };
}
