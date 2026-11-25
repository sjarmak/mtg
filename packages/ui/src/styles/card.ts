/**
 * The card face.
 *
 * Two custom-property conventions are in play and the difference matters:
 * `--mtg-*` names are *global tokens* declared once in `tokens.ts` (a test
 * fails the build if a component references one that is not declared), while
 * unprefixed names like `--edge` are *component-local* channels set by a
 * `data-` attribute on the same element. The seven identity rules below are the
 * only place a card learns its color, which is why no component file needs to
 * know a color name at all.
 *
 * The identity is painted as the card's border (`mtg-bc2.46`, direction B) *and*
 * throughout its interior. Direction B chose the border because a tint under a
 * face whose every child repaints `surface-raised` survives only in the gutter
 * between regions, so a hand of six could not be read as six colors at a glance;
 * the printed border carries the whole edge of the card and reads at thumbnail
 * size, and it stays. What direction B then left standing was the premise rather
 * than the fix: the children went on repainting neutral paper, so a card was a
 * white rectangle in a colored rim and every color read as white first. The
 * children now paint the identity too — `--panel` on the bars, the rules box,
 * the P/T badge and the footnote bar, `--well` on the art window, `--frame` on
 * the ground under them all — which is the same four-surface arrangement the
 * printed face draws, and `packages/card-render/src/palette.ts` resolves the
 * same three channels from the same three tokens.
 *
 * `--frame` is the deep one of the four: the ground is the identity's *band* and
 * sits at least 0.12 in lightness under the boxes printed on it, which is why
 * every run of text on the face has a box of its own. `styles/tokens.ts` carries
 * the argument and `test/card-surfaces.test.ts` the numbers.
 *
 * The proportions this sheet cares about — the card's silhouette, the art
 * window's ratio, how much of a pip its symbol covers, which ink each rarity's
 * set symbol takes, how far the rules text steps down to fit, and how wide a
 * compact face is drawn — are interpolated from `../card/anatomy.ts` rather
 * than typed in. All but the last are decisions `@mtg/card-render` builds its
 * printed face from too; the compact width is DOM-only and lives there anyway,
 * because a stylesheet is not where the number that decides how a card reads in
 * hand belongs (ADR-0002 §6.2).
 *
 * Every one of those numbers goes through `cssNumber` on its way into the text,
 * which is not ceremony: this sheet becomes the content of a `<style>` element,
 * so an interpolated value is CSS source and one carrying `}` writes rules of
 * its own. `./number.ts` has the argument in full.
 */
import { READING_FACE_WIDTH_REM } from '@mtg/card-geometry';
import {
  ART_WINDOW,
  CARD_EDGE_MM,
  CARD_TRIM_MM,
  COMPACT_FACE_WIDTH_REM,
  FOIL_SHEEN_CLASS,
  FRAME_BAND_MM,
  FULL_FACE_WIDTH_REM,
  LOYALTY_BADGE_GUTTER,
  LOYALTY_BADGE_PAD_PX,
  LOYALTY_BADGE_POINTS,
  LOYALTY_BADGE_SHARE,
  LOYALTY_SHIELD_FLAT,
  LOYALTY_SHIELD_POINTS,
  LOYALTY_SHIELD_SHARE,
  LAND_ART_WINDOW,
  NAME_FIT_STEPS,
  RULES_TEXT_REM,
  RULES_TEXT_SHARE,
  PIP_GLYPH_SCALE,
  PLANESWALKER_ART_WINDOW,
  PRINTED_RULES_FIT_STEPS,
  RARITY_SEAL_INK,
  RULES_FIT_STEPS,
  outlineClipPath,
} from '../card/anatomy';
import { TYPE_BAND_NEVER, TYPE_BANDS } from '../card/type-line';
import { cssNumber, MICRO_LABEL } from './number';
import { COLOR_IDENTITIES } from './tokens';

/**
 * Every element that draws a card-colored frame. The channel rules are
 * generated across this list rather than written once per selector, because the
 * deck tile and the card face read the identity out of the same seven-way
 * mapping and a hand-copied second block is where the two would drift.
 *
 * The deck strip joined the list rather than defining a tint of its own, which
 * is what makes `../routes/deck/StripColumns.ts` able to claim the fill and the
 * printed cost say the same thing: both resolve through this mapping, so a
 * strip cannot be tinted a red the pips would not have drawn.
 */
const FRAMED_SELECTORS: readonly string[] = ['.mtg-card', '.mtg-deck-card', '.mtg-strips__card'];

const identityRules = COLOR_IDENTITIES.map(
  (identity) =>
    `${FRAMED_SELECTORS.map((selector) => `${selector}[data-identity='${identity}']`).join(', ')} ` +
    `{ --identity: var(--mtg-color-${identity}); --edge: var(--mtg-frame-${identity}-edge);` +
    ` --frame: var(--mtg-frame-${identity}); --panel: var(--mtg-frame-${identity}-panel);` +
    ` --well: var(--mtg-frame-${identity}-well); }`,
).join('\n');

/**
 * The artifact treatment. Same specificity as the identity rules above, so
 * source order is what decides it and it has to come after them, which
 * `packages/ui/test/polish.test.ts` pins.
 *
 * A plate is a change of material: every keyline on the face drops off the
 * identity's edge channel and onto muted ink, which separates by at least 0.08
 * in lightness from every one of the seven identity edges in both palettes —
 * lighter than the blue, black, red and green edges on paper and darker than the
 * bone, stone and gold ones, lighter than all seven in the dark — so the keyline
 * gains definition against the card ground either way. The printed border is not
 * one of those keylines and does not move: it carries the card's identity, and
 * an artifact has one — a mono-blue artifact creature is still blue, and a
 * colorless one already wears the colorless border.
 *
 * The separation is the point and it is asserted, not assumed. The first
 * version of this rule reached for `--mtg-line-strong`, which is a near-neutral
 * a few thousandths of lightness away from the colorless edge, so on the only
 * artifacts that can exist in a set it painted nothing at all: cost validation
 * forces every noncreature artifact colorless, and the test that guarded this
 * compared token names rather than the colors they resolve to, so it could not
 * see that. `packages/ui/test/card.test.ts` now compares the values.
 *
 * It is not the printed face's hatch, because on screen the hatch already means
 * pending art and face down; it is not a shadow, because The Object Shadow Rule
 * spends the card's one shadow elsewhere. And it is written once rather than
 * generated across the framed selectors above, because the other one draws a
 * decklab deck entry, which has no artifact flag to read.
 */
const ARTIFACT_RULE = `.mtg-card[data-artifact='true'] { --edge: var(--mtg-ink-muted); }`;

/**
 * The set symbol's ink, one rule per rarity.
 *
 * Generated across `RARITY_SEAL_INK` rather than written out, for the reason
 * the identity rules above are: `@mtg/card-render`'s `palette.ts` generates its
 * printed rules from the same record, so a rarity that gains an ink paints on
 * both faces or on neither. Nothing here names a color — the record holds token
 * names and `./tokens.ts` values them, in both themes, because one fixed value
 * cannot clear 3:1 against a panel that is lightness 0.902 on paper and 0.35 in
 * the dark.
 *
 * Ink and nothing else: the mark used to carry a hairline in `--edge` as well,
 * and one absolute stroke width stopped being able to serve it once the mark
 * stopped being one shape. A trisigil at this size wears a 0.6 keyline as a
 * rim; a set code drawn in the same box wears it as a third of its own stroke
 * weight. The ink already clears 3:1 against every panel it sits on
 * (`../../test/card-surfaces.test.ts`), so the keyline was adding weight that
 * no gate measures. `@mtg/card-render`'s `palette.ts` dropped the same rule.
 */
const SEAL_INK_RULES = Object.entries(RARITY_SEAL_INK)
  .map(
    ([rarity, token]) =>
      `.mtg-card__seal[data-rarity='${rarity}'] path { fill: var(${token}); }\n` +
      `.mtg-card__seal--icon[data-rarity='${rarity}'] { background-color: var(${token}); }`,
  )
  .join('\n');

/**
 * An official set's own icon in the seal's box, when a launcher staged it.
 *
 * The file is one black glyph (`../card/set-icon.ts` has the licensing
 * argument for referencing it and nothing more), so it is used as a mask over
 * the rarity's ink rather than drawn: the rule above paints the box in the same
 * token the drawn mark's path is filled with, and the mask cuts the glyph out
 * of it. Same ink, same box, same attributes; only the shape is the set's own.
 * The prefixed property is kept beside the standard one for the WebKit that an
 * iPad at the table still runs.
 */
const SEAL_ICON_RULES = `
.mtg-card__seal--icon {
  -webkit-mask: var(--mtg-set-icon) center / contain no-repeat;
  mask: var(--mtg-set-icon) center / contain no-repeat;
}`;

const IDENTITY = `
${identityRules}
${ARTIFACT_RULE}

.mtg-pip[data-pip='w'] { background: var(--mtg-color-w); color: var(--mtg-color-w-on); }
.mtg-pip[data-pip='u'] { background: var(--mtg-color-u); color: var(--mtg-color-u-on); }
.mtg-pip[data-pip='b'] { background: var(--mtg-color-b); color: var(--mtg-color-b-on); }
.mtg-pip[data-pip='r'] { background: var(--mtg-color-r); color: var(--mtg-color-r-on); }
.mtg-pip[data-pip='g'] { background: var(--mtg-color-g); color: var(--mtg-color-g-on); }
.mtg-pip[data-pip='c'] { background: var(--mtg-color-c); color: var(--mtg-color-c-on); }
.mtg-pip[data-pip='m'] { background: var(--mtg-color-m); color: var(--mtg-color-m-on); }
.mtg-pip[data-pip='generic'] { background: var(--mtg-surface-inset); color: var(--mtg-ink-muted); }

.mtg-swatch[data-identity='w'] { background: var(--mtg-color-w); }
.mtg-swatch[data-identity='u'] { background: var(--mtg-color-u); }
.mtg-swatch[data-identity='b'] { background: var(--mtg-color-b); }
.mtg-swatch[data-identity='r'] { background: var(--mtg-color-r); }
.mtg-swatch[data-identity='g'] { background: var(--mtg-color-g); }
.mtg-swatch[data-identity='c'] { background: var(--mtg-color-c); }
.mtg-swatch[data-identity='m'] { background: var(--mtg-color-m); }
`;

/** How much of the pip its symbol covers, as the percentage both axes take. */
const GLYPH_EXTENT = `${cssNumber(PIP_GLYPH_SCALE * 100)}%`;

/**
 * The two columns of a planeswalker's ability row, as percentages of the rules
 * box.
 *
 * The share and the gutter are `@mtg/card-geometry`'s, so the printed face
 * reserves the same fraction of its 538-unit box that this sheet reserves of
 * whatever width a viewport gave the DOM one, and the fit ladder charges the
 * narrower column against the same pair. A percentage rather than a rem: the
 * face is drawn at five widths between a battlefield thumbnail and a hover
 * zoom, and a badge fixed in absolute units is a badge that swallows the
 * sentence at the small end.
 */
const LOYALTY_BADGE_WIDTH = `${cssNumber((LOYALTY_BADGE_SHARE - LOYALTY_BADGE_GUTTER) * 100)}%`;
const LOYALTY_BADGE_GAP = `${cssNumber(LOYALTY_BADGE_GUTTER * 100)}%`;
/* The badge's type, as a share of the card's width. See the rule below. */
const LOYALTY_BADGE_TYPE_SHARE = 0.045;
/* The badge's block padding is interpolated rather than written, because the
   fit ladder charges it: a baseline-aligned flex row is as tall as its tallest
   ascent plus its tallest descent, so this padding hangs the badge over the
   sentence's first line and makes the row taller than the lines in it. It was a
   literal here and uncharged there, and the estimate came in under every walker
   the browser drew (mtg-ypz). LOYALTY_BADGE_PAD_PX carries the argument. */
const LOYALTY_BADGE_PAD = `${cssNumber(LOYALTY_BADGE_PAD_PX)}px`;

/*
 * A pip's box is `--pip-box`, and the default is written as a `var()` fallback
 * rather than as a declaration on `.mtg-pip` itself. That is the whole
 * mechanism by which the title bar can hand its pips a size: a custom property
 * declared on the element beats one inherited from an ancestor whatever the
 * specificity, so a `--pip-box: 1.05rem` here would win over the bar's and the
 * title-row rule would silently do nothing. A fallback loses to both.
 *
 * `SMALL_FACE` still overrides it on `.mtg-pip` directly and still wins, for
 * exactly the same reason in the other direction.
 */
const PIPS = `
.mtg-cost { display: inline-flex; gap: 2px; align-items: center; }
.mtg-pip {
  display: inline-flex; align-items: center; justify-content: center;
  width: var(--pip-box, 1.05rem); height: var(--pip-box, 1.05rem); border-radius: var(--mtg-radius-pill);
  font-family: var(--mtg-font-ui); font-size: var(--mtg-text-xs); font-weight: 700;
  line-height: 1; box-shadow: inset 0 0 0 1px var(--mtg-pip-ring);
}
.mtg-pip__glyph { width: ${GLYPH_EXTENT}; height: ${GLYPH_EXTENT}; display: block; }
.mtg-pip__glyph-fill { fill: currentColor; }
.mtg-pip__glyph-line { fill: none; stroke: currentColor; }
.mtg-swatch { display: inline-block; width: 0.6rem; height: 0.6rem; border-radius: var(--mtg-radius-pill); }
`;

/**
 * How much of a board face's own width one line of its name is drawn at.
 *
 * The number that answers the first of `mtg-bc2.129`'s two blocking defects.
 * The rejected attempt's art window was 63.73 x 39.83px on arrival and 41.34 x
 * 8.55px mid-game, because every text bar on the face kept its intrinsic height
 * whatever the face did — 77.32px of any board face was text regardless — so
 * the picture was whatever was left. Here the text is a *fraction of the face*,
 * through the `container-type: inline-size` the face already declares. Every
 * bar then shrinks and grows with the card, so the window is a size rather than
 * the residual it was.
 *
 * **Where that stops, which the first version of this docblock did not say.** It
 * claimed the window "keeps a roughly constant share (measured: 55-58% of face
 * height)". It does, until the bars reach their own `clamp` floors, and then the
 * window is the only thing left that can give. Re-measured over a row of
 * identical permanents, window height as a share of face height:
 *
 *   1280x800   4 a side 58.7%   6 56.1%   8 40.8%   10 23.4%   12 6.6%
 *   1440x900   4 61.8%   6 60.7%   8 52.0%   10 38.8%   12 24.2%
 *
 * A driven game does not reach the right-hand end of either row (the worst
 * across a game played to its end is 98px of window at 1280x800 and 124px at
 * 1440x900, both over 56%), and a built position does. `BOARD_TYPE_LINE_MIN_REM`
 * is what `mtg-bc2.142` did about it: below the width at which the window would
 * fall under a third of the face, the type line yields and the window stops
 * being the only region that can.
 *
 * Floored at `BOARD_TEXT_FLOOR_REM` below, which was `--mtg-text-xs` — exactly
 * what the small face drew — until `mtg-0sq` measured what that floor costs a
 * crowded row. The published legibility floors are all far above both — WCAG
 * 18.5px, the Xbox
 * Accessibility Guidelines' 18px at 1080p, Legge and Bigelow's 0.2 degree
 * critical print size of about 18px at arm's length — and no battlefield
 * thumbnail in any client in `docs/research/prior-art-board-layout.md` reaches
 * them either. The legibility guarantee on this surface is the hover zoom
 * (`../board/CardSlot.ts`), which draws the whole face at 244 x 341, and the
 * small face is sold on the same terms Daybreak sell Magic Online's.
 */
const BOARD_NAME_CQW = 11;

/**
 * The size a board face's two written labels stop shrinking at, whatever the
 * ladder says.
 *
 * `BOARD_NAME_CQW`'s docblock above says the name is "floored at
 * `--mtg-text-xs`", 11px, and that floor is what `mtg-0sq` reports from the
 * other end. The name ladder is calibrated against the *full* face's title bar —
 * `../card/anatomy.ts`'s `NAME_COLUMN` is 22 characters of a 137px bar — so a
 * 22-character name is step 0 there and is told to shrink by nothing at all. On
 * a battlefield thumbnail that same name is set at 11px in a 28px bar, which is
 * about four characters a line, and the budget is three lines: measured in
 * chrome-headless-shell 151 over `../../tools/card-uniformity.ts`, twelve of
 * twelve names on a 48px face wrapped to five, six and eight lines and every one
 * of them was cut.
 *
 * The clamp's proportional term already tracks the face — that is what `cqw` is
 * — and the floor is what stops it. So the floor drops to 9px, which is the
 * smallest type anywhere in this stylesheet (`BOARD_RULES_CQW`'s clamp already
 * sets it) and is where the type scale ends rather than a number picked for this
 * rule.
 *
 * **`min()` rather than a plain replacement, and the argument is that a name may
 * not get bigger here.** The ladder's own floor is `--mtg-text-xs` times the
 * scale, so a name already at step 4 resolves to 7.7px — under the 9px this
 * constant states. Writing 9px as the floor outright would set *that* name
 * larger than it is today and clip it further; taking the smaller of the two
 * leaves every name at most the size it is now. The five names in the flagship
 * set past step 0 are the ones this protects.
 *
 * **What it does not reach**, because that is the finding rather than a gap.
 * The card serif sets about 0.58 em a character in this bar, so three lines at
 * 9px hold a 22-character name only down to about a 58px face. Below that the
 * name is cut whatever the type
 * does — 22 characters in three lines of a 28px bar is a 6.6px face, and
 * `../card/anatomy.ts` already states where that ends: "text that keeps
 * shrinking stops being text". A row that crowded needs a layout answer rather
 * than a smaller font, and `mtg-0sq.1` is where that is filed. The whole name
 * stays reachable at every width through `faceDetailText` and
 * `faceAccessibleName`.
 *
 * **The type line takes the same floor, for a related reason rather than for
 * symmetry.** It wraps on this face too (`BOARD_TYPE_LINES`), so a floor it
 * cannot get under does not clip the line — it spends *height*, and on a face
 * whose window is the residual that height is the picture. Measured over
 * `../../tools/hand-scale.ts` at 1440x900, the wordiest card's two-line type bar
 * was 30.4px against a 33.1px window, and at 1280x800 it was 30.4 against 18.7:
 * the type line was larger than the illustration. It has no ladder of its own, so
 * the floor is the constant outright rather than a `min()` — nothing can already
 * be under it. Measured after, across the same 144 faces, type lines cut went
 * 5 to 3 and the window on a 110.8px face gained 4.8px.
 */
const BOARD_TEXT_FLOOR_REM = 0.5625;

/** The type line and the collector line, a step under the name. */
const BOARD_TEXT_CQW = 9;

/** A pip's diameter, as a share of the face. The corner cost scales with it. */
const BOARD_PIP_CQW = 15;

/**
 * The narrowest face that still prints the words "Art pending" in its window.
 *
 * Both the label and the corner cost stop scaling at their `clamp` floors, so
 * below a certain face the pip run stays 8.8px tall while the window keeps
 * shrinking, and the label, which is centered in the window rather than aligned
 * to its bottom, rises into the pips. Measured in chromium over a row of
 * identical permanents, at the point the two first touch:
 *
 *   1280x800   8 a side, face 86.0px wide, window 70x49  clear
 *              9 a side, face 75.5px wide, window 60x38  9 overlapping ink pairs
 *   1440x900  10 a side, face 83.2px wide, window 67x45  clear
 *             11 a side, face 74.9px wide, window 59x38  11 overlapping ink pairs
 *
 * The two viewports break at the same *face width* and not at the same permanent
 * count, which is what makes this a container query rather than a media query.
 * 5rem is 80px, between the widest broken case and the narrowest clean one.
 *
 * What is lost below it is the word, not the state: the window keeps the
 * diagonal hatch, which is what `.mtg-art[data-art-state='pending']` paints and
 * what the pending frame has always meant. the art pipeline's governance check is the check
 * that every card is either in the manifest or declared pending against a bead,
 * and it does not read the screen. A set that has been through the art pipeline
 * has no pending frame on the table at all, which is why every overlapping pair
 * measured here was this label against that cost and nothing else.
 */
const PENDING_LABEL_MIN_REM = 5;

/**
 * The narrowest board face that still prints its type line.
 *
 * `mtg-bc2.142`'s finding is that the art window is the only region on the face
 * that gives. Every bar takes its own `min-content` height, all of them reach
 * their `clamp` floors at about the same width, and from there every pixel the
 * face is short comes out of the picture. Measured in chromium over a built row
 * of identical creatures beside a seven-land mana base
 * (`../../tools/board-crowding.ts`), the three bars and the face's own chrome
 * cost a flat 71.6px whatever size the card is drawn at, so the window is only
 * what the card's height exceeds that by. Window height as a share of face
 * height, before:
 *
 *   1280x800   4 a side 59.3%   6 42.2%   8 20.5%   10 2.7%   12 2.7%   14 2.7%
 *   1440x900   4 62.3%   6 55.5%   8 39.3%   10 22.3%   12 4.4%   14 2.7%
 *
 * At the right-hand end the window is two pixels tall, and 71.6px is by then
 * more than the printed trim allows at `../styles/board/slot.ts`'s width floor, so
 * the face stops being card-shaped as well: 48 x 73.6, a ratio of 0.653 against
 * the printed 0.716.
 *
 * **So something other than the picture has to give, and it is the type line.**
 * `docs/research/prior-art-board-layout.md` §4 settles which channel survives
 * shrinking — art, in every client it surveys — and rules out the two answers
 * that leave the regions alone. Scrolling instead, by raising the width floor to
 * the width that still prints a window, starts hiding permanents at eight a side
 * at 1280x800, and §2 of the same report is that nobody scrolls a battlefield:
 * "Scrolling is the technique that hides game state, and it is the one we
 * reached for first." Wrapping the row is worse arithmetic than it looks,
 * because two lines halve the well's height and a slot's width follows its
 * height through the trim. Over the measured 940 x 192 well: one row of twelve
 * gives a 71px slot, two rows of six give 66px, and wrapping only starts winning
 * past thirteen a side, where the share it wins back is still 22%.
 *
 * The type line is what to spend, and not by elimination. It is never a whole
 * type line on this surface at any width either viewport reaches: measured, the
 * bar shows 118px of the 133px "Creature — Bird Soldier" wants at a 155.7px
 * face and 73px of 117 at a 105.5px one, so what the bar prints is always a cut
 * of the line and the question is only how short a cut is worth 19px of picture.
 * At the threshold it is down to about 64px of 117, a little over half, while
 * the three-bar window is at 46.6% and falling ten points every two permanents.
 * Nothing is lost to a reader who cannot see it, because that bar was never how
 * they got it: `../card/Card.ts` spells the type line into the face's own
 * `aria-label` through `faceAccessibleName` and into its `title` through
 * `faceDetailText`, at every size. What does go is the rarity seal, which rides
 * in the same bar. A permanent's rarity is a fact about the printing and about
 * nothing the rules turn on, and the collector line that spells it was already
 * dropped at board size.
 *
 * **5rem is 80px of the face's own content box, not of the face.** A size query
 * is evaluated against the query container's content box, and this face carries
 * no padding and an identity band that is a share of its own width
 * (`FRAME_BAND_SHARE` below), so there is no face width to state: measured over
 * a sweep of `--card-w`, the type line first draws at an 87px face with an 81px
 * content box. That is the fact to check first if this number is ever
 * re-derived, and the reason to derive it by measuring; it is
 * also true of `PENDING_LABEL_MIN_REM` above, whose docblock quotes face widths.
 * Measured after, the same rows:
 *
 *   1280x800   4 a side 58.9%   6 57.7%   8 41.8%   10 24.9%   12 21.9%   14 21.9%
 *   1440x900   4 61.8%   6 55.5%   8 55.6%   10 43.1%   12 30.1%   14 21.9%
 *
 * The floor is 21.9% rather than 2.7%, and it is a floor rather than a slide:
 * at the far end the face is 48 x 67 and card-shaped again, because two bars fit
 * inside what the trim allows at that width and three did not.
 */
const BOARD_TYPE_LINE_MIN_REM = 5;

/**
 * How many lines the name and the type line may take on the played table before
 * they are cut.
 *
 * `mtg-9k0`: ten of ten type lines visible at one moment were clipped — the list
 * includes `Basic Land — Mountain` cut by 22px and `Legendary Artifact —
 * Equipment` cut by 65px — and two of four battlefield names with them
 * (`Brigand Skirmisher` by 4px, `Nightclad Clan Blademaster` by 17px). The rule that
 * cut both is `white-space: nowrap` with an ellipsis, which the full face wears
 * for a stated reason (`FACE_TRIM`: with the art window fixed, a wrapped line
 * above the rules box is height the fit ladder is not told about, and three of
 * the eighty faces got an 86.7px rules box where the rest got 100.9px).
 *
 * **That reason does not hold at board size and never did.** This face's window
 * is `aspect-ratio: auto` and takes whatever the rest of the column leaves, so
 * there is no constant box for a second line to falsify; the picture absorbs it
 * the way it absorbs every other region here. So on this face both lines wrap.
 *
 * Bounded rather than unbounded, because a card whose lower half is its own type
 * line is worse than one that cut it. Measured against the flagship set, whose
 * longest type line is 35 characters: at the 137px face a 1600x1000 window draws
 * four permanents a side at, the type bar sets about 17.8 characters a line, so
 * two lines carry the longest line in the set and none of the eight faces on
 * that board is cut. Below about a 130px face some are, and the whole line is
 * still in the face's `title` and its `aria-label` (`../card/Card.ts`,
 * `faceDetailText` and `faceAccessibleName`) as it was when it was ellipsized.
 * Below `BOARD_TYPE_LINE_MIN_REM` the type bar is not drawn at all, which is the
 * older decision this one sits inside; the name bar is drawn at every width.
 *
 * The cut is quantized to whole line boxes, so a line past the budget is
 * dropped whole instead of being sliced through the middle of its glyphs. It was
 * `max-height` in the `lh` unit, which is quantized on the line the *element*
 * sets and is off by whatever padding shares the box: read back at a 26px name
 * bar the fourth line's ascenders were drawn and then sliced across, which is
 * `overflow: clip` doing exactly what it says and nobody asking for it. The
 * budget is `-webkit-line-clamp` now, which counts line boxes rather than
 * pixels, so the padding cannot leak a sliver of a line.
 *
 * **The name gets a line the type line does not, and the reason is that they
 * break differently.** A type line breaks at the em dash and reads as two facts;
 * a name breaks between whole words, so its line count is set by its longest
 * *word* rather than by its length, and no character ladder can predict it — a
 * flagship name of 23 characters over three words takes three lines at the
 * 89.3px face a 1280x800 window draws four permanents a side at, because its two
 * longest words do not share a line at any size it is still readable at, while a
 * 30-character name of five short words takes two. Measured with
 * `../../tools/card-uniformity.ts` over the flagship set at three viewports and
 * three crowdings, two lines cut 4 of 8 names on that board and three cut none
 * of them; what is left is the boards at twelve permanents a side, which are
 * past what a played game reaches and are filed as `mtg-0sq`.
 *
 * The third line is affordable now for a reason it was not when this constant was
 * one number: the face can no longer *grow* to hold it (`board/slot.ts` pins the
 * trim), so a wrapped name is paid for by the picture rather than by the row's
 * uniformity, which is what the playtester asked for on 2026-08-13.
 *
 * **The type line's budget is gone and the line is ellipsized instead**, which
 * reverses the second half of the paragraph above. the playtester, 2026-08-14: "its
 * art is all smushed". The two lines cost about 11px of a 115.4px face at
 * 1280x800 and the picture was the only region that could pay, and the sentence
 * this file already makes about that bar is what settles which of the two to
 * spend: "it is never a whole type line on this surface at any width either
 * viewport reaches", so the second line was carrying the tail of a cut rather
 * than a fact the first line lacked. The whole line stays in the face's `title`
 * and its `aria-label` (`../card/Card.ts`), the `typeFitStep` ladder still
 * shrinks it before it is cut, and below `BOARD_TYPE_LINE_MIN_REM` the bar is
 * not drawn at all as before. The name keeps all three lines, because a name cut
 * is `mtg-b8e`'s whole subject and `BOARD_FACE_MIN_REM` exists to prevent it.
 *
 * **What happens when three lines are still not enough, which is the half of the
 * rule this constant did not have** (`mtg-6hrz`, `mtg-5f9`, `mtg-9f0e`).
 * The playtester, watching the replay: "single word text is wrapping around so
 * letters end up on the next line". Two separate defects were making that one
 * sentence true, and neither was the line count.
 *
 * `overflow-wrap: break-word` broke a word inside its letters as soon as the
 * word was wider than the bar, so a two-word name came back as four fragments —
 * a five-letter piece, a space the line breaker had already collapsed, and the
 * rest — and each fragment reads as a different word than the one printed on the
 * card. And the budget then clipped with `overflow: clip`, which paints nothing
 * at all to say a cut happened, so a name that lost its last third looked like a
 * shorter name that had fitted. The readings are card names of a set no public
 * package may name, so they live in the rig's output rather than here;
 * `../../tools/face-floor.ts` prints each one as `name -> "what was drawn"`.
 *
 * Both are gone, and the two declarations that replace them were chosen by
 * measurement rather than by taste. `../../tools/face-floor.ts` set all 249 of
 * the flagship's names in a board name bar at nine face widths, in
 * chrome-headless-shell 151, under six candidate rules. Words broken across
 * lines, at the 48px face a row of twelve draws:
 *
 *   break-word (what shipped)          212 of 249
 *   break-word + hyphens: auto         212 of 249   — no dictionary, no effect
 *   overflow-wrap: normal               23 of 249   — and all 23 break at a
 *                                                     printed hyphen, which is
 *                                                     a mark the reader can see
 *
 * So the name keeps its words whole, and a word too wide for the bar overflows
 * its line rather than being cut in half. Letters lost fell with it — 1155 to
 * 869 at that width — because a broken word was spending line boxes on
 * fragments.
 *
 * The mark is `text-overflow: ellipsis` over a `-webkit-line-clamp` box, and
 * both halves earn their place. The clamp marks the *vertical* cut, at the end
 * of the third line. The `text-overflow` marks the *horizontal* one, on any line
 * whose single word was too wide — and this is the one a number cannot see: the
 * letters-lost count is identical with and without it, and only the rendering
 * says which. Read off a screenshot at a 26px bar, the four candidates draw
 * `Hebra Grizzl emaw`, `Hebra Grizzl emaw`, `Hebra Grizzle`, and `Hebra Gri…`.
 * The last is the only one that is both whole-worded and honest.
 *
 * **What it costs, said in the units the regression rigs count it in.** A word
 * that is no longer broken is a word that now overflows its line, and
 * `../../tools/card-uniformity.ts` and `../../tools/hand-scale.ts` both measure
 * exactly that as `namesCutSideways` (`scrollWidth > clientWidth`). Over their
 * own fixture set the count goes from none to some at every crowded reading —
 * 0 to 48 board faces at twelve a side at 1024x768, 0 to 24 at 1440x900, and 0
 * to 24 hand cards at the smallest — and none of that is a surprise or a
 * regression, it is the same event counted from the other side: what used to be
 * spent splitting a word over two line boxes is now spent overflowing one. The
 * difference is that every one of these is elided with a visible mark and none
 * of the old ones were, which is the whole exchange. Stated here because a rig
 * that goes from 0 to 48 and is not written down anywhere reads to the next
 * lane as a regression it has to bisect.
 *
 * **What was rejected, and why.** A smaller type ramp: the floor is already 9px
 * (`BOARD_TEXT_FLOOR_REM`) and that floor is what turned shrinking into
 * clipping in the first place. A two-line clamp: measured over the same 249
 * names it costs 948 letters at a 68px face against three lines' 63, which buys
 * 10px of picture for most of the name. A one-line clamp is worse again — 158 of
 * 249 names are still cut at the *99.2px* face. A stated minimum face width with
 * the row scrolling past it: every name in this set fits at 82.6px, and floored
 * there a 1024x768 row shows four permanents of twelve, so it hides two thirds
 * of the board to spell a name — and `docs/research/prior-art-board-layout.md`
 * §2 is that scrolling is the technique that hides game state and the one we
 * reached for first. What identifies a card below the width its name fits is the
 * picture and the hover zoom, which is the guarantee `BOARD_NAME_CQW` already
 * sells this surface on; what the name owes the player at that width is to say
 * that it has been cut, and now it does.
 */
const BOARD_NAME_LINES = 3;

/**
 * The rules text's size on the played table, as a share of the face's own width.
 *
 * A step under `BOARD_TEXT_CQW`, which is the type line's, because this box sets
 * several lines where that bar sets one and the difference between them is what
 * keeps the name and the type line reading as the louder facts. Clamped between
 * 0.5625rem — 9px at a 16px root, and the smallest type anywhere in this
 * stylesheet — and `--mtg-text-xs`, which is what the small face already draws
 * its name at, so the rules text can never be the largest thing on a thumbnail.
 *
 * **No fit ladder here, and that is deliberate rather than an omission.**
 * `rulesFitStep` exists to make a card's whole text fit one fixed box
 * (`../card/anatomy.ts`), and a battlefield thumbnail's box does not fit a whole
 * card's text at any step of it: the ladder's floor is 0.78, and a board face
 * would need a quarter of that. A ladder applied here would report a fit it did
 * not deliver. So the box is line-quantized and clips instead, and what makes
 * that honest is the order the lines are printed in — the keyword line is first
 * (`../card/Card.ts`, `textBox`), so the words that survive a clip are the ones
 * combat turns on. The face still publishes `data-fit`, because it is the card's
 * step and the zoom beside it is a `full` face that uses it.
 *
 * Exported because `./panel.ts` re-declares this box for a draft pack drawn at a
 * column wide enough to be read (`mtg-aqxi.15`) and changes only its ceiling.
 * Restating the share there would be a second number that has to be edited in
 * two places, and the point of that rule is that the box goes on tracking the
 * width it was given.
 */
export const BOARD_RULES_CQW = 8.5;

/**
 * How many lines of rules text a board face draws, and the narrower face that
 * draws fewer.
 *
 * Height on this face is zero-sum against the picture, so the budget is stated
 * in whole line boxes rather than in a percentage that lands mid-glyph: the box
 * is `-webkit-line-clamp: N`, so a clip is always a clip between lines and the
 * last line it keeps ends in a mark.
 *
 * Three above the threshold and two under it, and the threshold is where the
 * picture would otherwise be the thing paying. Measured in
 * chrome-headless-shell 151 over `../../tools/board-text.ts`, four permanents
 * and a seven-land mana base a side, on the flagship set with its own art: at
 * 1280x800 the face is 89.3 x 124.8 and at 1600x1000 it is 137 x 191.4. Two
 * lines cost the small face about 26px of its 125 and three would cost 38.
 */
const BOARD_RULES_LINES = 3;
const BOARD_RULES_NARROW_LINES = 2;
const BOARD_RULES_NARROW_MAX_REM = 6;

/**
 * And one under `BOARD_RULES_PANEL_MAX_REM`, where the box is a panel drawn
 * inside the picture rather than a column below it.
 *
 * Three, two, one: the budget falls as the face does, and this is the last step.
 * The panel is drawn between two boxes that already live in the window — the
 * cost pips in its upper corner (`.mtg-card__corner`) and the P/T badge in its
 * lower one — and a second line box is 10.8px the window has not got at the
 * bottom of this band. Measured in chrome-headless-shell 151 over
 * `../../test/play/page-overlap.browser.test.ts`'s own game-over position at
 * 1280x800: a 56 x 78.2 face, a 46px window, a cost that draws 8.8px from 2px
 * inside the window's head, and a two-line panel whose head landed 0.4px into
 * it. Not a near miss and not a wide face's problem either — the window's height
 * is the face's residual after a title bar that takes one line or two, so the
 * same collision reaches a 63.3px face whose name wraps.
 *
 * The line the budget keeps is the keyword line, which is the line the panel
 * exists to print (`BOARD_REGIONS` in `../card/anatomy.ts` prints it first for
 * this reason). What it costs is the second line of a wordy card at the two
 * narrowest bands, and what it buys is the cost pips staying readable and half
 * the picture back: the panel covers 25% to 32% of the window instead of 44% to
 * 55%.
 *
 * The alternative was to bound the panel's head against the pips as well as its
 * foot against the badge. It is expressible — the pip box is a `clamp()` like
 * `--board-pt-box` is — and it does not work: a box given both insets stretches
 * to fill them, so a one-line panel in a tall window would draw an empty band of
 * opaque ground over the picture, and a box given a `max-height` instead cuts
 * through the glyphs of the line it is keeping, which is the defect
 * `-webkit-line-clamp` was chosen over `max-height` to avoid one block above.
 */
const BOARD_RULES_PANEL_LINES = 1;

/**
 * The board face at which the rules box stops taking its own height and draws
 * as a panel over the foot of the picture.
 *
 * `mtg-8kc`. Under this width the box used to go entirely, and height is why: a
 * column this narrow cannot spend two line boxes on text and still leave a
 * window worth looking at. Removing it spent the whole of that cost on the
 * reader, and the zone it emptied first was the hand — `mtg-s3re` put seven held
 * cards at a 71.5px face beside permanents drawing every word of theirs. A panel
 * pays the height out of the picture instead, which is the trade the decision
 * sheet took from MTGO's own smallest face.
 *
 * Measured in chrome-headless-shell 151 over `../../tools/board-panel.ts`, nine
 * flagship creatures and two spells at a 63.3px face — a 60.1px content box:
 *
 *     the shipped sheet drew zero characters on all eleven
 *     the panel draws the keyword line whole at the 9px floor — Vigilance,
 *       First strike, Flying, Lifelink — in one 14.8px line box
 *     the window is 46.3 to 67px tall, so the panel costs 22% to 32% of it
 *
 * It is raised clear of the P/T badge rather than drawn under it, and the two
 * alternatives were measured rather than reasoned about. Under the badge, the
 * badge ate one to six characters of the very line the panel exists to print:
 * `Vigilanc`, `First stri`. Beside it, clearing the badge's width, cost no
 * characters but wrapped `First strike` onto a second line, which doubles the
 * height. Above it costs the picture exactly what under does — the badge already
 * occupied that strip — covers nothing, and prints every keyword line whole. It
 * reaches the title bar on none of the eleven, including the two whose names
 * take two lines, and that clearance is what the badge box below buys: the strut
 * version of the badge stood 21.75px tall and pushed the panel 1.33px into the
 * bar.
 *
 * The badge is reserved only on a face that draws one, which is the second rule
 * in the band. `.mtg-card__stats` is absent from a spell's face rather than
 * empty, so the unconditional reserve spent 17px of a sorcery's picture on a
 * badge it has not got, and at the bottom of this band those 17px are the
 * difference between a panel that clears the cost pips and one that does not.
 *
 * The type line stays out of the panel, which refines the sheet's decision to
 * move both regions. Its own ellipsis mark is present at every width up to
 * 82.6px, so what it draws there is `Creature…` and nothing more, and a second
 * line box would cost the window 14.8px to repeat what the badge in the corner
 * below already says.
 *
 * A face gets this narrow when a row is crowded past what a played game reaches
 * — `MIN_SLOT_WIDTH_REM` in `./board/fit.ts` floors a slot at 3rem — so this is
 * the same kind of bound `PENDING_LABEL_MIN_REM` above is rather than the
 * ordinary case. Like every other container query on this face it is evaluated
 * against the *content box*: the face carries no padding and a band that is a
 * share of its own width, so the rule fires at a 69px face with a 65px content
 * box, and the face width that clears it moves whenever the share does.
 */
const BOARD_RULES_PANEL_MAX_REM = 4;

/**
 * And the floor under the panel, below which the box goes after all.
 *
 * The panel is drawn between two boxes that are already in the window — the cost
 * in its upper corner and the P/T badge in its lower one — and the window is the
 * face's residual after a title bar that takes one line or two. Below some
 * height those four things do not fit, and the panel's head runs into the cost.
 * The height is not a width, which is the whole difficulty: at one face width
 * the same window is 12px shorter on a card whose name wraps, so no width band
 * can separate the two, and the floor has to be set where the *worst* card
 * clears rather than where a typical one does.
 *
 * Read in chrome-headless-shell 151 over `../../tools/board-panel.ts` with its
 * subject list opened to every non-land card in the flagship fixture, 79 faces
 * at each width, as the gap between the panel's head and the cost's foot:
 *
 *     content box   worst clearance   faces colliding
 *     57.06px       -2.11px           10 of 79
 *     58.91px        +0.5px            0
 *     60.08px       +2.02px            0
 *
 * The floor is 3.75rem — a 60px content box — rather than the 58.91px the
 * reading first clears at, because half a pixel is not a margin, and the worst
 * card at 60px keeps 2px. Under it the box is not drawn at all, exactly as it
 * was before `mtg-8kc`: there is no arrangement of a line of text between those
 * two corners in that much height, so the honest answer is the one the sheet
 * already gave. What that costs is real and is written down rather than
 * rounded off — `page-overlap.browser.test.ts`'s game-over table at 1280x800
 * draws a 56px face, so a board crowded that far still prints no rules text,
 * and `mtg-8kc` buys the band from 60px up rather than the whole of it.
 *
 * The alternative was to bound the panel's head against the cost the way its
 * foot is bounded against the badge. It does not work: a box given both insets
 * stretches to fill them, so a one-line panel in a tall window would draw an
 * empty band of opaque ground across the picture, and a `max-height` instead of
 * an inset cuts through the glyphs of the line it is keeping, which is the
 * defect `-webkit-line-clamp` was chosen over `max-height` to avoid one block
 * below.
 */
const BOARD_RULES_PANEL_MIN_REM = 3.75;

/**
 * The type bar's band ladder: which part of a type line a board face gives up,
 * and at what width.
 *
 * `mtg-mq81`. The threshold above says whether the *face* has room for a bar;
 * this says whether the *line* fits the bar, which is the question that was
 * never being asked — every nonland face measured cleared the threshold, drew
 * the bar, and then cut the line inside it, the worst by 42px of 109. The three
 * bands are the card's own and are published into the markup by `../card/Card.ts`
 * from `../card/type-line.ts`, which carries the capacity model, the
 * measurements it was fitted to, and the argument for dropping whole phrases
 * rather than slicing one.
 *
 * One `@container` block a rung, each holding all three of the ladder's rules,
 * because a card matches exactly the block its own band names: a part whose band
 * is `B` is hidden by the block at `B` for every width at or below `B`, and no
 * other block can select it. The `never` rules sit outside every block, for the
 * parts no face this side of a poster is wide enough to draw.
 *
 * The mark is a `::after` rather than an element. `text-overflow: ellipsis`
 * cannot be it — that is the rule this ladder replaces, and it draws its mark
 * only when the box overflows, which is the state that no longer happens. An
 * element would be worse than either: the type line's own text would then carry
 * a character the card does not have, and every reader of `textContent` — the
 * a11y rig, the parity suite, jsdom, which applies no container query at all and
 * so would never hide it — would see `Creature…` where the card says `Creature`.
 */
const TYPE_BAND_RULES = `${TYPE_BANDS.map(
  (band) => `
@container (max-width: ${cssNumber(band)}rem) {
  .mtg-card[data-size='board'][data-type-sub='${cssNumber(band)}'] .mtg-card__type-sub,
  .mtg-card[data-size='board'][data-type-super='${cssNumber(band)}'] .mtg-card__type-super { display: none; }
  .mtg-card[data-size='board'][data-type-sub='${cssNumber(band)}'] .mtg-card__type::after,
  .mtg-card[data-size='board'][data-type-super='${cssNumber(band)}'] .mtg-card__type::after { content: '…'; }
  .mtg-card[data-size='board'][data-type-hide='${cssNumber(band)}'] > [data-region='type'] { display: none; }
}`,
).join('')}
.mtg-card[data-size='board'][data-type-sub='${TYPE_BAND_NEVER}'] .mtg-card__type-sub,
.mtg-card[data-size='board'][data-type-super='${TYPE_BAND_NEVER}'] .mtg-card__type-super { display: none; }
.mtg-card[data-size='board'][data-type-sub='${TYPE_BAND_NEVER}'] .mtg-card__type::after,
.mtg-card[data-size='board'][data-type-super='${TYPE_BAND_NEVER}'] .mtg-card__type::after { content: '…'; }
.mtg-card[data-size='board'][data-type-hide='${TYPE_BAND_NEVER}'] > [data-region='type'] { display: none; }`;

/*
 * The played face: art-dominant, cost in the corner, and a rules box that
 * clips.
 *
 * The regions and their order are `../card/anatomy.ts`'s (`BOARD_REGIONS`);
 * this is only how they divide the height. Every bar takes exactly the height
 * its text needs and the window takes the rest, which is what makes the picture
 * a size rather than a residual.
 *
 * Emitted after `ART` rather than beside `FACE`, and the order is load-bearing:
 * the last two rules here re-declare the pending frame's own label and note, so
 * a block placed before `ART` would lose to it at equal specificity.
 */
const BOARD_FACE = `
.mtg-card[data-size='board'] {
  /* The slot's own nominal width, which is what a board face is drawn at when
     nothing has stretched or shrunk its slot. ../board/slot.ts overrides it with
     the width the row actually settled on, and that is the value the band's
     attackers are frame-sized from. */
  --card-w: ${cssNumber(COMPACT_FACE_WIDTH_REM)}rem;
  /* The P/T badge's height, as an expression rather than as a number, because
     under BOARD_RULES_PANEL_MAX_REM the rules panel has to clear it and CSS
     cannot read a sibling's box. It is .mtg-card__pt's own type — the same
     clamp that rule sets — plus its two 1px borders.

     .mtg-card__stats is display: flex below for this to be true. It holds one
     inline span, so its height was the *line box* around that span, and the
     strut of that line came from the page's root font rather than from the
     badge: 21.75px whatever the face's width, against 14px of drawn badge. The
     corner is a badge and not a line of text, so it is laid out as one, and the
     2px inset it already declares is now the inset it draws at. */
  --board-pt-box: calc(
    clamp(var(--mtg-text-xs), ${cssNumber(BOARD_NAME_CQW)}cqw, var(--mtg-text-base)) *
      var(--mtg-leading-tight) + 2px
  );
  gap: 2px; border-radius: var(--mtg-radius-md);
}
.mtg-card[data-size='board'] > * { flex: none; }
/* The one region that gives, and the only one that can: a window is a picture
   at any height and a name is not. aspect-ratio: auto, because the printed
   578:380 window is what a 63 x 88 card prints, and on the table the window's
   shape is whatever the row could spare. */
.mtg-card[data-size='board'] > [data-region='art'] { flex: 1 1 auto; min-height: 0; aspect-ratio: auto; }
.mtg-card[data-size='board'] .mtg-card__bar {
  min-height: 0; padding: 1px 2px; gap: 2px; line-height: var(--mtg-leading-tight);
}
/* Every term of the clamp takes the ladder, the floor included, and the floor is
   the one that matters: above about a 130px face the proportional term wins and
   a long name is set at the same size a short one is, but under it the name
   parks on the floor and stops tracking the bar it has to fit. That is where a
   five-line name came from. Scaling the floor is what lets a long name go on
   shrinking after the proportional term has stopped, and BOARD_TEXT_FLOOR_REM is
   what lets a *short* one keep shrinking after the ladder has stopped: the
   ladder is calibrated on the full face's bar and has nothing to say about a
   22-character name on a 48px thumbnail. The min() takes the lower of the two so
   the change can only ever make a name smaller. */
.mtg-card[data-size='board'] .mtg-card__name {
  font-size: clamp(
    min(${cssNumber(BOARD_TEXT_FLOOR_REM)}rem, calc(var(--mtg-text-xs) * var(--name-scale, 1))),
    calc(${cssNumber(BOARD_NAME_CQW)}cqw * var(--name-scale, 1)),
    calc(var(--mtg-text-base) * var(--name-scale, 1))
  );
}
.mtg-card[data-size='board'] .mtg-card__type,
.mtg-card[data-size='board'] .mtg-card__collector {
  font-size: clamp(${cssNumber(BOARD_TEXT_FLOOR_REM)}rem, ${cssNumber(BOARD_TEXT_CQW)}cqw, var(--mtg-text-sm));
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* The name wraps here rather than ending in an ellipsis; BOARD_NAME_LINES has
   the measurement, why the full face's rule does not apply on this one, and why
   the type line no longer shares the rule. The bar grows to fit what it draws,
   so a short name still costs one line rather than reserving three. The type
   line keeps the ellipsis FACE gave it and takes one line at every size, which
   is the printed face's rule and is now this face's too.

   BOARD_NAME_LINES's last three paragraphs carry what the declarations under
   white-space do and what was measured to choose them. In one sentence: a word
   is never broken inside its letters, and a cut always shows a mark.

   No backticks in this comment, and that is a rule rather than a style: this
   block is inside a template literal, so a pair of them ends the CSS and the
   file stops parsing 30 lines later with an error that names neither. */
.mtg-card[data-size='board'] .mtg-card__name {
  white-space: normal; overflow-wrap: normal;
  display: -webkit-box; -webkit-box-orient: vertical;
  -webkit-line-clamp: ${cssNumber(BOARD_NAME_LINES)};
  overflow: hidden; text-overflow: ellipsis;
}
/* The one field an ellipsis would falsify, so it is never given the chance:
   flex: none and no overflow rule, whatever the name and type line have to do.
   It is out of flow on this face (.mtg-card__stats below), so what this sizes is
   the badge inside the corner rather than a cell of the foot row.

   The corner is the window's, not the card's (mtg-kcv2). The badge is opaque and
   z-index: 1, and at the foot of a board face the thing under it is the last
   line of the rules box: measured in chrome-headless-shell 151 over the example
   set, 20 collisions at four permanents a side and 1280x800, 47 at ten and 69 at
   sixteen at 1440x900, worst 19.8 x 17.1px — "Lifelink, first strike" painted
   under a 2/3. Inside the window it can collide with nothing, for the reason
   .mtg-card__corner already gives one block down: the window is overflow:
   hidden, so a badge there is clipped by the picture rather than drawn over the
   words below it. It costs the column no height either way, which is why it left
   the foot row in the first place. The full face keeps the card's own corner —
   measured there, ten faces at 214px with a 12/12 on every creature, zero
   collisions — and that is also the placement @mtg/card-render draws, where the
   badge has a footer row of its own and the rules box stops above it. */
.mtg-card[data-size='board'] .mtg-card__pt {
  flex: none; padding: 0 2px; line-height: var(--mtg-leading-tight);
  font-size: clamp(var(--mtg-text-xs), ${cssNumber(BOARD_NAME_CQW)}cqw, var(--mtg-text-base));
}
.mtg-card[data-size='board'] .mtg-card__foot { gap: 2px; }
/*
 * The rules box on the played table: proportional, line-quantized, and clipped.
 *
 * mtg-u69 — every card a player could see printed its rules text nowhere, so a
 * creature with vigilance did not say so on the board and the only way to read a
 * card was to hover it. BOARD_REGIONS in ../card/anatomy.ts carries that
 * argument; the three constants above carry the numbers this block spends.
 *
 * The budget is stated in line boxes rather than in pixels, so the cut lands
 * between lines whatever width the face is drawn at. It was a max-height in
 * the lh unit, which states the same intent and does not deliver it: the box
 * is border-box (../base.ts) so the cap had to carry the padding as well, and
 * the + 4px that paid for it is most of a line at nine-point type. Read back
 * at a 60px box the fourth line's ascenders were painted and then sliced across
 * the middle. -webkit-line-clamp counts line boxes, so no padding can leak a
 * sliver of a line into the picture below.
 *
 * **And the cut says so now** (mtg-5f9). overflow-y: clip paints nothing to
 * mark it, so a card whose text ran to nineteen line boxes and got two showed
 * its opening clause and a full stop's worth of nothing — a sentence that
 * reads as finished. Measured over the flagship at 1440x900, 86 of the 200
 * rules-bearing cards were cut that way. text-overflow: ellipsis on the clamp
 * is the mark, it costs no height at all, and short cards are untouched: a
 * one-line Vigilance draws one line and no mark, because the box grows to what
 * it holds and only a box that overflows has anything to elide.
 *
 * Not overflow: auto, for FACE_TRIM's reason one size down: a pointer-events:
 * none zoom cannot be scrolled and a finger has no hover at all, so a scrollbar
 * here would be an affordance that answers nobody. The whole text is in the
 * face's own title and aria-label at every size.
 */
/* The block starts at the top of the box rather than centering in it, and this
   is the one face where that matters rather than a tidy-up. mtg-p3p centers the
   block in a box that is the residual of a fixed trim, which is a box the text
   normally fits; this box is a fixed number of line boxes that the text normally
   does *not* fit, and it clips. Centering here would clip a line off both ends
   and the keyword line — printed first precisely so it survives (see
   BOARD_REGIONS) — would be the one lost. A safe-centered box would fall back to start
   on the cards that overflow and center the short ones, which is worse than
   either: the first line of a board face would sit at a different height
   depending on how much text the card had, across a row of permanents. It was
   justify-content: flex-start against the full face's flex column; a
   -webkit-box packs from the start on its own, so the declaration is the
   display change rather than a second rule beside it. */
.mtg-card[data-size='board'] > [data-region='rules'] {
  min-height: 0;
  display: -webkit-box; -webkit-box-orient: vertical;
  -webkit-line-clamp: ${cssNumber(BOARD_RULES_LINES)};
  overflow: hidden; text-overflow: ellipsis;
  padding: 1px 2px;
  line-height: var(--mtg-leading-tight);
  font-size: clamp(0.5625rem, ${cssNumber(BOARD_RULES_CQW)}cqw, var(--mtg-text-xs));
}
/* Paragraphs are separated by a line's own leading here rather than by a
   spacing step: 4px between paragraphs is a third of a line box at this size,
   and it is height the box would rather spend on a line. */
.mtg-card[data-size='board'] .mtg-card__line + .mtg-card__line { margin-top: 1px; }
/* A planeswalker's ability rows are two columns everywhere but here, and the
   reason is that a flex row is a box a line budget cannot count (mtg-s55u).

   FACE lays a costed row out as display: flex so the badge stands in a column
   of its own and a long ability wraps beside it rather than running back under
   it. -webkit-line-clamp counts *line boxes*, and a flex row generates none of
   its own for the clamp to count, so on this face the budget above resolved on
   the region and bound on nothing at all: the box took its content's height,
   the window took what was left, and the rest was painted outside the card's
   trim rather than cut inside it. Measured in chrome-headless-shell 151 on a
   three-ability walker whose last row is a two-effect ultimate, at four
   permanents a side, held and played:

       viewport   zone         face            rules   window   past the trim
       1440x900   hand         120 x 167.6     178.7   2         70
       1440x900   battlefield  122.5 x 171.2   179.6   2         70
       1280x800   hand          88 x 122.9     234.9   2        149
       1024x768   battlefield   96.7 x 135     202.5   2        121

   The region is larger than the whole card at every one of them. Both zones,
   because what failed is the clamp and both wear data-size='board'; scoping
   the cure to the hand slot would have left the same defect on the battlefield.

   So the row is a block here and the badge leads its sentence inline, which is
   how every other line in this box is already set. After: 67px and 36.4px of
   rules against 43.4px and 52px of window at 1440x900 and 1024x768, nothing
   past the trim, and the window keeps 25.9% of the face at its worst, over
   ../../../test/play/hand-allocation.browser.test.ts's 24% floor.

   The divider above each row is kept. It costs five pixels a row and the
   measurement above clears the floor with it in, and three abilities running
   together in a box that only ever shows two to five lines of them is what a
   reader would lose. The badge takes the row's own gutter as a margin, because
   column-gap goes with the flex that declared it. */
.mtg-card[data-size='board'] .mtg-card__line[data-loyalty] { display: block; }
.mtg-card[data-size='board'] .mtg-card__loyalty { margin-inline-end: ${LOYALTY_BADGE_GAP}; }
/* Bold is scoped to this face on purpose (mtg-u69): a battlefield thumbnail
   clips its rules region to a couple of lines, the keyword line is printed
   first so it is the line the clip spares, and bold is what makes that
   surviving line legible at a glance across a crowded board. Real Magic
   reserves bold for an ability word, never a keyword (CR 207.2c), which is
   why the full and compact faces below never carry this declaration — a card
   is read there, not recognized, so it gets the reminder text explaining the
   keyword instead of a weight no printing gives it. This rule used to have no
   scope at all, which put the same bold on every face; ../../test/card-text-box.test.ts
   pins the scope for that reason. */
.mtg-card[data-size='board'] .mtg-card__keywords { font-weight: 600; }
@container (max-width: ${cssNumber(BOARD_RULES_NARROW_MAX_REM)}rem) {
  .mtg-card[data-size='board'] > [data-region='rules'] { -webkit-line-clamp: ${cssNumber(BOARD_RULES_NARROW_LINES)}; }
}
/* Under BOARD_RULES_PANEL_MAX_REM the box does not sit in the column: a column
   this narrow cannot spend a line box on text and still leave a window worth
   looking at. Written as the removal first and the panel second, because that
   is the shape of the decision — the box leaves the column at one width and
   comes back as a panel over the picture only where there is room for one, and
   BOARD_RULES_PANEL_MIN_REM is that room, measured. */
@container (max-width: ${cssNumber(BOARD_RULES_PANEL_MAX_REM)}rem) {
  .mtg-card[data-size='board'] > [data-region='rules'] { display: none; }
}
/* The panel. Nothing about how the box is *set* changes here — it is already an
   opaque panel on the badge's own ground and edge, already ellipsized — so this
   is a position and a line budget, and the box that used to go now sits over the
   foot of the picture.

   inset-inline: var(--pad) is the content box's own width. The block end puts
   the panel's foot on the window's, and on a face that draws a P/T badge the
   second rule lifts it clear of one: 2px is .mtg-card__stats's own inset inside
   the window and --board-pt-box is the badge. A spell has no badge element at
   all, so it takes the first block end and keeps the 17px.

   display is restated because the rule above removed it, and it is the same
   -webkit-box the base rule sets — the clamp counts its line boxes, so a box
   that came back as a block would ignore the budget entirely.

   BOARD_RULES_PANEL_MAX_REM carries the measurement and the two arrangements
   this one was chosen over; BOARD_RULES_PANEL_MIN_REM carries the floor and what
   is given up below it. */
@container (max-width: ${cssNumber(BOARD_RULES_PANEL_MAX_REM)}rem) and (min-width: ${cssNumber(BOARD_RULES_PANEL_MIN_REM)}rem) {
  .mtg-card[data-size='board'] > [data-region='rules'] {
    display: -webkit-box; -webkit-box-orient: vertical;
    position: absolute; z-index: 1;
    -webkit-line-clamp: ${cssNumber(BOARD_RULES_PANEL_LINES)};
    inset-inline: var(--pad);
    inset-block-end: var(--pad);
  }
  .mtg-card[data-size='board']:has(.mtg-card__stats) > [data-region='rules'] {
    inset-block-end: calc(var(--pad) + 2px + var(--board-pt-box));
  }
}
.mtg-card[data-size='board'] .mtg-card__seal { width: clamp(0.55rem, 10cqw, 0.95rem); height: clamp(0.55rem, 10cqw, 0.95rem); }
.mtg-card[data-size='board'] .mtg-pip {
  width: clamp(0.55rem, ${cssNumber(BOARD_PIP_CQW)}cqw, 1.05rem);
  height: clamp(0.55rem, ${cssNumber(BOARD_PIP_CQW)}cqw, 1.05rem);
  font-size: clamp(0.5rem, ${cssNumber(BOARD_TEXT_CQW)}cqw, var(--mtg-text-xs));
}
/*
 * The cost, in the window's own upper-right corner. Inside the window and not
 * over the face, and that is the whole guard against the second of the rejected
 * attempt's defects: the window is overflow: hidden, so however short the
 * window gets the pips are clipped by the picture rather than drawn on the name
 * below it. Positioned rather than laid out, so it costs the window no height,
 * and it wraps rather than overflowing, because a five-pip cost is wider than a
 * board face and a second row of pips is still a cost you can read.
 */
.mtg-card__corner {
  position: absolute; z-index: 1;
  inset-block-start: 2px; inset-inline-end: 2px;
  display: flex; justify-content: flex-end; max-width: calc(100% - 4px);
}
.mtg-card__corner .mtg-cost { flex-wrap: wrap; justify-content: flex-end; gap: 1px; }
/* The P/T in the window's other corner, on the same terms and at the same inset
   as the cost above it. The declarations it does not repeat — absolute,
   z-index, pointer-events — are .mtg-card__stats's own further down; this moves
   the box it is offset from, because ../card/Card.ts hands the badge to the
   window on this face and the window is what an absolute box inside it is
   measured against. */
.mtg-card[data-size='board'] .mtg-card__stats {
  display: flex;
  inset-block-end: 2px; inset-inline-end: 2px; max-width: calc(100% - 4px);
}
/*
 * The pending frame at board size. The card id is not drawn on any face (the
 * one rule for that is on \`.mtg-art__pending-note\` below, and this size was the
 * first to need it: under a 130px window the id is a row of cut glyphs), so what
 * is left here is the label. It is pushed clear of the two corner boxes by
 * exactly a pip each, and below PENDING_LABEL_MIN_REM it is not
 * drawn at all because a pip is no longer enough; the docblock on that constant
 * has the measurement and what a set with no art loses by it.
 *
 * The reserve is on *both* block ends, and the one-sided version it replaces is
 * why: it cleared the cost in the window's top corner by pushing the label down
 * past the window's center, straight into the P/T badge in the bottom corner.
 * The .mtg-card__stats rule above put the badge there, and this rule was written
 * before it. A tapped 5/7 with no art at an 88px face — window about 72x50 —
 * printed "Art pending" across the badge's own rows and overlapped its left edge
 * by 9.3 x 2.4px. Symmetric reserves put the label back where centering already
 * had it, which clears both corners at once: the label is 11px tall inside a
 * 50px window with 13px reserved at each end, so it sits between rows 19 and 31
 * and neither corner box reaches it.
 *
 * page-overlap.browser.test.ts is what found it and what fails if it comes back,
 * and it took a change of opponent to surface: the lab's bot became the tier-1
 * bot from @mtg/sim in the same lane, which keeps creatures alive and taps them
 * attacking, and no game the previous agent played had ever put a large tapped
 * creature with a pending frame on the board at game over.
 */
.mtg-card[data-size='board'] .mtg-art__pending-label {
  font-size: clamp(0.5rem, ${cssNumber(BOARD_TEXT_CQW)}cqw, var(--mtg-text-xs));
  padding: 1px var(--mtg-space-1);
  margin-block: clamp(0.55rem, ${cssNumber(BOARD_PIP_CQW)}cqw, 1.05rem);
}
@container (max-width: ${cssNumber(PENDING_LABEL_MIN_REM)}rem) {
  .mtg-card[data-size='board'] .mtg-art__pending-label { display: none; }
}
/* The region that gives before the picture does; BOARD_TYPE_LINE_MIN_REM has
   the measurement and the argument for spending this one and not another. The
   ladder below now hides this region on every card at this width too, since
   5rem is its floor rung — this rule is kept because it is a decision about the
   face rather than about any card's words, and it is the one that would still
   have to hold if a card's type line were ever short enough to want the room. */
@container (max-width: ${cssNumber(BOARD_TYPE_LINE_MIN_REM)}rem) {
  .mtg-card[data-size='board'] > [data-region='type'] { display: none; }
}
${TYPE_BAND_RULES}
`;

/**
 * The frame band as a share of the card's own width.
 *
 * `FRAME_BAND_MM` is 2.6 mm of a 63 mm card, which is what `@mtg/card-render`
 * insets its printed content by, so this is the printed card's own proportion
 * and not a number chosen for a screen.
 */
const FRAME_BAND_SHARE = FRAME_BAND_MM / CARD_TRIM_MM.width;

/*
 * The outer slice of that band, painted black on every card of every color.
 *
 * `mtg-d4g`. The band was the identity all the way out to the silhouette, so a
 * face read as a colored tile rather than as a card: the thing that makes a
 * pile of cards look like cards at a glance is that every one of them has the
 * same black edge and a different color just inside it. `CARD_EDGE_MM` is 0.9
 * of the 2.6, so the identity keeps two thirds of the band and the content
 * inset does not move — no text box is re-fitted by this rule.
 *
 * **A box has one border, and the black takes it.** The first build spent the
 * border on the identity and drew the black as a ring on `::before` pulled out
 * to the border box by a negative inset. It painted correctly and broke two
 * measuring rigs: an absolutely positioned box outside the padding box counts
 * toward its parent's scrollable overflow, so `test/play/loyalty-hand.browser`
 * and `test/play/hand-allocation.browser` both read 3-4px of overflow on a face
 * that had not moved, and their assertion — a face may not overflow its own
 * trim — is the right one to keep.
 *
 * So the band is divided by the box model instead, and nothing is added
 * outside it: the border is the black edge, the padding under it is the
 * identity, and `background-clip` is what makes the padding a ring rather than
 * a second ground. Two layers, top one first: `--frame` clipped to the content
 * box, `--identity` clipped to the padding box, which is the band's inner
 * slice and only that. Border plus padding is still `--frame-band` to the
 * pixel, so the content box is where it was, and the card's own overflow is
 * unchanged because there is no new box.
 */
const CARD_EDGE_SHARE = CARD_EDGE_MM / CARD_TRIM_MM.width;

/*
 * The identity border is the one border in the system above 1px, and DESIGN.md
 * §4 names it as the exception rather than leaving the old sentence to be read
 * as still true. It is a four-sided printed edge, not the colored left stripe
 * the same section bans and `test/polish.test.ts` fails the build on.
 *
 * **It is a share of the rendered card rather than a count of pixels, and that
 * is `mtg-iqyc`.** It used to be 7px on a full face, 5px on a compact one and
 * 4px on a board one — three constants that each held for exactly the width
 * their size was designed at, and the play surface draws board faces at every
 * width between about 40px and 160px. Measured in chrome-headless-shell at
 * 1440x900, a declared attacker in the combat band came out 87.8px wide wearing
 * 4px of border over 4px of the ground's own padding: 18% of the card was frame,
 * against 5% on the same face at rest, which is the "green frame swallows the
 * face" the bead was filed for. `--frame-band` is now `card width x
 * FRAME_BAND_SHARE`, so every face wears the printed card's proportion at
 * whatever size it is drawn, and `styles/board/slot.ts` is where a board face
 * publishes the width it was actually laid out at.
 *
 * **And the band is one band.** The ground used to show as a second ring of
 * equal width just inside the border — `--frame` is a different color from
 * `--identity`, so a face read as two borders, which is what the hover zoom (a
 * 320px face wearing 7px of border over 8px of ground) made impossible to miss.
 * The printed face has no such ring: its content starts at the band and the
 * ground shows between the regions, which is what `gap` already draws here. So
 * the padding stopped being `--frame` and the face keeps that color where the
 * printed one keeps it. The padding itself came back with `mtg-d4g`, carrying
 * the identity rather than the ground: a ring of the border's own color reads
 * as part of the border, which is the whole point of dividing the band.
 */
/**
 * Everything the face draws besides the rules text, as a ratio of the rules
 * text's own size.
 *
 * `mtg-dcxg.13`. Each of these was a token: 6px between the regions, 8px inside
 * the text box, 0.6875rem on the type line. A token is a fixed number of pixels
 * and the card is not, so at a 366px phone face the chrome stayed put while the
 * card grew and the rules box, which is the residual, took the whole difference.
 * The printed face has never had this problem — `@mtg/card-render` draws in user
 * units and scales whole — and these ratios are how the DOM face says the same
 * thing. Every one of them is its old token over `--mtg-text-sm`, so a face at
 * the reference width draws exactly what it drew before.
 */
const TEXT_XS_RATIO = 0.6875 / RULES_TEXT_REM;
const SPACE_1_RATIO = 0.25 / RULES_TEXT_REM;
const SPACE_2_RATIO = 0.5 / RULES_TEXT_REM;
/** 6px between regions, 3px above and below the title bar, at a 13px channel. */
const FACE_GAP_RATIO = 6 / 16 / RULES_TEXT_REM;
const BAR_PAD_RATIO = 3 / 16 / RULES_TEXT_REM;
const BAR_MIN_RATIO = 1.6 / RULES_TEXT_REM;
const SEAL_RATIO = 0.95 / RULES_TEXT_REM;

const FACE = `
.mtg-card {
  --pad: calc(var(--frame-band) - var(--card-edge-band));
  --card-w: ${cssNumber(FULL_FACE_WIDTH_REM)}rem;
  /* The size the rules text is set at before the fit ladder scales it. The
     --mtg-text-sm token was the whole answer until mtg-dcxg.13: everything else
     on a face is a share of --card-w, so a phone column's 366px face grew a
     191px box around 42px of type. The larger of the two rather than the share
     alone, so a face narrower than the reference keeps the readable token
     instead of setting a board slot's rules text at 8px. */
  --rules-type: max(var(--mtg-text-sm), calc(var(--card-w) * ${cssNumber(RULES_TEXT_SHARE)}));
  /* Everything else the face sets in type or in space, as a ratio of that one
     channel rather than as its own token. The rules text alone was not enough:
     the rules box is the residual after the bar, the window and the foot, so a
     face whose chrome stayed 13px while the card grew handed the box more than
     its share of the extra height and the slack came back at a third of its
     old size. Scaled together, the face is the printed card's own rule -- one
     drawing at whatever size it is drawn at. */
  --face-xs: calc(var(--rules-type) * ${cssNumber(TEXT_XS_RATIO)});
  --face-space-1: calc(var(--rules-type) * ${cssNumber(SPACE_1_RATIO)});
  --face-space-2: calc(var(--rules-type) * ${cssNumber(SPACE_2_RATIO)});
  --frame-band: calc(var(--card-w) * ${cssNumber(FRAME_BAND_SHARE)});
  --card-edge-band: max(1px, calc(var(--card-w) * ${cssNumber(CARD_EDGE_SHARE)}));
  --shield-w: calc(100cqw * ${cssNumber(LOYALTY_SHIELD_SHARE.width)});
  --shield-h: calc(100cqw * ${cssNumber(LOYALTY_SHIELD_SHARE.height)});
  position: relative;
  display: flex; flex-direction: column; gap: calc(var(--rules-type) * ${cssNumber(FACE_GAP_RATIO)});
  width: var(--card-w); padding: var(--pad);
  background: linear-gradient(var(--frame), var(--frame)) content-box,
    linear-gradient(var(--identity), var(--identity)) padding-box;
  border: var(--card-edge-band) solid var(--mtg-card-edge);
  border-radius: var(--mtg-radius-card);
  box-shadow: var(--mtg-shadow-card);
  color: var(--mtg-ink);
  container-type: inline-size;
}
.mtg-card[data-size='compact'] { --card-w: ${cssNumber(COMPACT_FACE_WIDTH_REM)}rem; gap: 4px; border-radius: var(--mtg-radius-md); }
.mtg-card[data-interactive='true'] {
  cursor: pointer; text-align: left; appearance: none; font: inherit;
  transition: transform var(--mtg-duration) var(--mtg-ease), box-shadow var(--mtg-duration) var(--mtg-ease);
}
.mtg-card[data-interactive='true']:hover { transform: translateY(-2px); }
.mtg-card[data-selected='true'] { outline: 2px solid var(--mtg-accent); outline-offset: 2px; }

/* The cost pip on a title row is the row's own line box: the name's text size
   times its leading, both read off the tokens rather than restated, so a
   re-valued type scale moves the pip with the words. TITLE_PIP_TO_TEXT in
   ../card/anatomy.ts is the printed face's copy of the same rule, and
   test/card.test.ts fails when the two stop agreeing. */
.mtg-card__bar {
  --pip-box: calc(var(--rules-type) * var(--mtg-leading-tight));
  display: flex; align-items: center; gap: var(--face-space-2);
  padding: calc(var(--rules-type) * ${cssNumber(BAR_PAD_RATIO)}) var(--face-space-2);
  background: var(--panel);
  border: 1px solid var(--edge); border-radius: var(--mtg-radius-sm);
  min-height: calc(var(--rules-type) * ${cssNumber(BAR_MIN_RATIO)});
}
/* The name shrinks to fit its bar before it is ever cut, and --name-scale is
   how: the ladder below sets the channel off the card's own data-fit, and
   every face's own font-size rule multiplies by it rather than restating it. A
   channel rather than five font-size rules because the three sizes each size the
   name off a different token — sm here, xs on a small face, a container query on
   the board — and a rule keyed to [data-fit] would outrank all three on
   specificity and flatten them into one. ../card/anatomy.ts's nameFitStepOf
   has the column the ladder is calibrated against and what its floor cannot
   reach. */
.mtg-card__name {
  flex: 1; min-width: 0;
  font-family: var(--mtg-font-card); font-size: calc(var(--rules-type) * var(--name-scale, 1));
  font-weight: 700;
  line-height: var(--mtg-leading-tight);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* The type line is the one printed field with no length limit — "Legendary
   Artifact Creature — Golem" — and it takes one line at every size rather than
   growing the bar it sits in. On a full face that is what keeps the rules box
   below it the same box on every card (see FACE_TRIM); at the smaller sizes the
   bar cannot grow at all. It shrinks by typeFitStep first and ends in an
   ellipsis only past that ladder's floor, and faceDetailText carries the whole
   line into the face's title either way. */
.mtg-card__type {
  flex: 1; min-width: 0;
  font-family: var(--mtg-font-card); font-size: var(--face-xs); font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mtg-card__seal { width: calc(var(--rules-type) * ${cssNumber(SEAL_RATIO)}); height: calc(var(--rules-type) * ${cssNumber(SEAL_RATIO)}); flex: none; display: block; overflow: visible; }
${SEAL_INK_RULES}
${SEAL_ICON_RULES}

/* The text box, and the white space above its first line.
 *
 * mtg-p3p. the playtester, 2026-08-14: "there needs to be a buffer of white space
 * above text in the text box particularly for cards that only have a little bit
 * of text like a single keyword ability." Measured before the change in
 * chrome-headless-shell 151.0.7922.47 over the flagship set at 1440x900: the box
 * is 100.94px tall on every full face and the first line starts 9px down it —
 * 8px of padding and 1px of border — so a card whose whole text is Vigilance
 * printed one 18.85px line hard against the top of the box and left 72px of
 * empty panel under it.
 *
 * The buffer is justify-content: safe center rather than a larger top padding,
 * and both halves of that are load-bearing.
 *
 * **Centering, because the printed face has centered all along.**
 * @mtg/card-render's renderRules sets its block at
 * inner.y + max(0, (inner.height - layout.height) / 2), so the two faces were
 * already disagreeing about this and the DOM one was the odd face out. It is
 * also the proportion the reference shows: on Wind Drake (KLD 070) the keyword
 * and the flavor text under it sit as one block a little above the middle of the
 * box, with clear panel above and below, and on Vastwood Gorger (M12 200), whose
 * whole box is flavor text, centering degenerates to the padding because the
 * block fills the box. That is read off the reference as a *layout rule* and not
 * as a pixel measurement, which ADR-0001 5.6 forbids of any frame asset.
 * A fixed larger inset would answer neither card: it would push the single
 * keyword down without closing the gap under it, and it would take room from the
 * card that has none to spare.
 *
 * **safe, because this box clips.** overflow-y: clip clips at the padding
 * box, so a plain center on an overflowing box would push the *first* line out
 * of the top — the one region of a centered flex container that can never be
 * scrolled back to. safe falls back to start exactly when the content
 * overflows, so an over-budget card degrades to the behavior it has today and
 * loses its last line rather than its first. ../../test/card-text-box.test.ts
 * pins the keyword safe in this rule for that reason.
 */
.mtg-card__text {
  display: flex; flex-direction: column; justify-content: safe center;
  padding: var(--face-space-2);
  background: var(--panel);
  border: 1px solid var(--edge); border-radius: var(--mtg-radius-sm);
  font-family: var(--mtg-font-card); font-size: var(--rules-type); line-height: var(--mtg-leading-normal);
}
.mtg-card__line { display: block; }
.mtg-card__line + .mtg-card__line { margin-top: var(--face-space-1); }
/* Imported oracle text can descend below the generated-card readability floor.
   Its paragraph spacing and inset descend with it, so fixed chrome cannot take
   more of the box than the immutable words at the final rungs. */
.mtg-card[data-presentation='printed-card'] .mtg-card__text {
  --face-space-1: 0.3077em;
  --face-space-2: 0.6154em;
}
/* Reminder text and flavor text are set in italics, which is the whole of how a
   reader tells them from the rules text; the parentheses do the rest for a
   reminder. Keyed off the block kind the face publishes (../card/Card.ts,
   textBox) rather than off a position, because "the last line is the flavor
   text" stops being true on the first card that has none. */
.mtg-card__line[data-block='reminder'],
.mtg-card__line[data-block='flavor'] { font-style: italic; }
/* Except the keyword the reminder explains, which is rules text and is set in
   the rules face: Trample roman, its parenthetical italic, the way a printing
   sets it (mtg-vsv). The run is a nested span rather than a line of its own
   because the two are one sentence and wrap into each other; where it ends is
   ../card/text-box.ts's roman run, so both faces cut it in one place. */
.mtg-card__reminder-keyword { font-style: normal; }
/* And the same boundary the other way up: a rules line whose sentence carries
   reminder text is roman to the parenthesis and italic after it, the way a
   printing sets "Put a gloom counter on target creature. (A creature with a
   gloom counter gets -1/-1.)". The block's face is roman here, so it is the
   gloss that departs from it. */
.mtg-card__gloss { font-style: italic; }
/* The flavor text is the foot of the box and gets the gap a printed card gives
   it: more than the space between two rules paragraphs, because it is a change
   of voice rather than a second sentence about the same card. */
.mtg-card__line[data-block='flavor'] { margin-top: var(--face-space-2); }
/* A planeswalker's text box is ruled into ability rows, and each loyalty
   ability's cost stands in a badge at the left of its own row rather than as
   "[+1]:" at the head of the sentence. Two columns, so the ability wraps in a
   column of its own instead of running back under the badge on its second line
   — which is the whole reason the cost is a field on the block and not three
   characters of its text (../card/text-box.ts, TextBlock.loyaltyCost).

   The rule above the row is the divider a printed planeswalker draws between
   abilities. It is charged to the row below it, so the first row of a box is
   never ruled off from the top of the box it already sits inside, and
   RULES_LOYALTY_GAP_PX in @mtg/card-geometry is this margin, this border and
   this padding added up — 4 + 1 + 4 — because the fit ladder has to know what
   a divided row costs before any browser lays one out.

   The leading is the printed card's rather than the sheet's, which is where a
   third of the room this box needs came from. --mtg-leading-normal is 1.45,
   web body leading; a printed planeswalker sets its abilities at about 1.17 and
   fits eight lines in a box this shape. RULES_LOYALTY_LINE_PX in
   @mtg/card-geometry is 13 x 1.2 for the same reason, and the two have to be
   the same number or the ladder is sizing a box no browser draws.

   Keyed off [data-loyalty] rather than off the card's kind, because a
   planeswalker prints rows with no cost at all — its flavor text, and the
   second line of any ability that prints on two — and each of those is set
   across the whole box at the leading every other card's paragraphs get. The
   printed card's third uncosted row, a static or triggered ability, would land
   here unchanged; @mtg/dsl refuses one on a planeswalker today. */
.mtg-card__line[data-loyalty] {
  display: flex; align-items: baseline; column-gap: ${LOYALTY_BADGE_GAP};
  padding-top: var(--face-space-1);
  border-top: 1px solid var(--edge);
  line-height: var(--mtg-leading-tight);
}
.mtg-card__text > .mtg-card__line[data-loyalty]:first-child {
  padding-top: 0; border-top: 0;
}
/* The cost badge: a flattened hexagon pointing into the sentence it pays for,
   dark ground and inverse ink, the way a printed card sets it. The silhouette
   is LOYALTY_BADGE_POINTS, the same array @mtg/card-render scales into a
   <polygon>, so the two faces cannot round a corner differently.

   flex-shrink is 0 and the basis is a share of the box: the badge holds three
   glyphs at most ("−20") and must not give width back to a long ability. */
.mtg-card__loyalty {
  flex: 0 0 ${LOYALTY_BADGE_WIDTH};
  box-sizing: border-box;
  padding: ${LOYALTY_BADGE_PAD} 0;
  clip-path: ${outlineClipPath(LOYALTY_BADGE_POINTS)};
  background: var(--mtg-ink); color: var(--mtg-ink-inverse);
  text-align: center;
  /* A share of the card rather than the rules token the sentence beside it is
     set in, because the two quantities answer to different things. This must be
     a container unit and not a share of the card-width custom property: galleries, stacked deck cards
     and draft rails publish that width as 100%, and a percentage reached from
     font-size is resolved against the inherited type rather than against the
     card. Jace, the Mind Sculptor therefore kept four correctly sized badge
     grounds while their numeral ink collapsed to 0px in a full-card builder
     column; the fixed-rem hover face was the only one that remained readable.
     The card is already an inline-size container, so cqw names the rendered
     quantity directly at every surface.

     The sentence shrinks down the fit ladder as a walker gets wordier; the
     badge holds three glyphs at every rung and its ground is a fixed fraction
     of the box, so type that shrank with the sentence stayed inside its ground
     and type that did not, did not. At 0.045 the widest cost ("−10", about
     1.57em of tabular figures) clears the silhouette's taper at every width the
     face is drawn at -- which is the arithmetic LOYALTY_BADGE_SHARE states, and
     ../../test/card-loyalty.browser.test.ts measures rather than trusts.

     The share is capped by the surrounding sentence, while 7px is the measured
     ink floor at which a multi-glyph cost remains distinguishable in the
     narrow stacked-card view. A
     loyalty row is a baseline-aligned flex line and is therefore as tall as its
     tallest ascent plus its tallest descent, so a badge set larger than the
     sentence beside it makes the row taller than the lines in it -- and
     textBoxCost charges the rung's own line height. Uncapped, this rule put
     the flagship's Hero of the Wild 0.8px over its estimate at rung 5, which is
     the ladder losing its upper bound. Below the cap the badge shrinks with the
     sentence and the row is exactly as tall as it was. */
  font-size: max(7px, min(1em, ${cssNumber(LOYALTY_BADGE_TYPE_SHARE * 100)}cqw));
  font-weight: 700; font-variant-numeric: tabular-nums; font-style: normal;
}

.mtg-card__foot { display: flex; align-items: center; gap: var(--face-space-2); }
/* The footnote bar, which is all this row carries besides the P/T now that the
   collector line has left the face (FACE_REGIONS in ../card/anatomy.ts). It
   keeps its own panel ground rather than being set on the card: the ground is
   the identity band, which is 1.3:1 for muted ink on green and 1.5:1 on blue,
   and the panel is the only surface on a face that clears AA for all seven
   identities in both themes. */
.mtg-card__collector {
  flex: 1; min-width: 0;
  padding: 1px var(--face-space-2);
  background: var(--panel);
  border: 1px solid var(--edge); border-radius: var(--mtg-radius-sm);
  font-family: var(--mtg-font-mono); font-size: var(--face-xs); color: var(--mtg-ink-muted);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mtg-card__pt {
  padding: 1px var(--face-space-2);
  background: var(--panel); border: 1px solid var(--edge);
  border-radius: var(--mtg-radius-sm);
  font-family: var(--mtg-font-card); font-size: var(--rules-type); font-weight: 700;
  font-variant-numeric: tabular-nums;
}
/* Starting loyalty, which is not the P/T badge in a different number. It is a
   shield — flat across the top, tapering to a point — set larger than the cost
   badges inside the box and painted in the same dark ground, because it is the
   number a reader of a planeswalker looks for first. LOYALTY_SHIELD_POINTS is
   the outline and @mtg/card-render draws the same one.

   Sized off the card's container width rather than in em, and the difference is
   the whole of what the ladder can be told. An em box is a function of the font
   size the shield happens to inherit, which no arithmetic in
   @mtg/card-geometry can see; a share of the card's width is a number that file
   already holds, so the band the box has to give up for the shield is derivable
   rather than guessed. The container unit is load-bearing in grids where
   --card-w is 100%: carrying that percentage into the absolutely positioned,
   shrink-wrapped stats box makes the shield's width depend on itself and
   collapses it into a vertical line.
   LOYALTY_SHIELD_SHARE is the one declaration, and the printed face scales the
   same pair into user units.

   The number is pushed off the bottom padding so it sits in the flat upper part
   rather than centered on a point that has no room for a glyph. The padding is
   the taper's own height, LOYALTY_SHIELD_FLAT, so a change to the silhouette
   moves the glyph with it instead of leaving it hanging over the point. */
.mtg-card__shield {
  display: grid; place-items: center;
  inline-size: var(--shield-w); block-size: var(--shield-h);
  padding-block-end: calc(var(--shield-h) * ${cssNumber(1 - LOYALTY_SHIELD_FLAT)});
  clip-path: ${outlineClipPath(LOYALTY_SHIELD_POINTS)};
  background: var(--mtg-ink); color: var(--mtg-ink-inverse);
  font-family: var(--mtg-font-card); font-size: var(--mtg-text-sm); font-weight: 700;
  font-variant-numeric: tabular-nums;
}
/* The full face's P/T, in the card's own bottom-right corner and out of flow,
   which is what let that face drop its footer row: a badge costing the column
   no height is not a region the rules box is competing with. It sits over the
   foot of the text box the way a printed card's does, offset by the face's own
   padding so it lines up with the box's corner rather than the card's.

   The offsets here are the full face's. A board face hands the same badge to
   its art window instead and re-offsets it there (BOARD_FACE), because at that
   size the corner this rule aims at is the foot of a three-line rules box;
   mtg-kcv2 and the BOARD_FACE comment carry the measurement. What is shared is
   everything below: a badge is absolute, above the frame, and never the thing a
   click lands on, wherever it is drawn.

   pointer-events: none because the face is a button at every size that can be
   played, and a badge drawn over it must not be the thing a click lands on. */
.mtg-card__stats {
  position: absolute; z-index: 1; pointer-events: none;
  inset-block-end: var(--pad); inset-inline-end: var(--pad);
}
`;

/**
 * The trim, as a shape rather than as a floor — and which region gives inside
 * it, which is the half that changed.
 *
 * This block used to be one line inside `FACE`,
 * `min-height: calc(var(--card-w) * 88 / 63)`, and a floor is exactly wrong for
 * a card: it guaranteed a face was never *shorter* than the trim and permitted
 * it to be as much taller as its rules box wanted. the playtester, 2026-08-13, found
 * both ends of that in one sitting — "the cards also seem to be different sizes
 * based on the amount of text in the textbox, and when hovering over to see the
 * full card while playing it shows a border that extends further vertically". A
 * gallery row was a row of different heights, and the hover zoom, which has no
 * neighbor to be measured against, drew its 7px identity border down whatever
 * box the text had grown to.
 *
 * `aspect-ratio` at the same trim answers both — with `min-height: 0` beside it,
 * which is not housekeeping. A box with a preferred aspect ratio takes its
 * *content* as its automatic minimum size (CSS Sizing 4), so the ratio alone
 * changed nothing at all: measured over the 80-card flagship set, the faces
 * still came out at three heights, 340.8, 343.3 and 388.9, against the 340.8 the
 * trim allows. Only the pair together pins it, and then all 80 measure 340.8 and
 * 0.716. That pair has not moved and must not.
 *
 * **The picture no longer gives, and this docblock used to argue that it
 * should.** The rule here was a `flex: 100 100 auto` bias on the window — "the
 * picture gives before the words do" — and the playtester reversed it the same day:
 * "the dimensions of the card art should be consistent across cards but we can
 * adjust the text size within the box to make that content more legible."
 * Re-measured under the old rule over the flagship set plus its five basics, the
 * window came out at **thirteen heights between 64.1px and 197.7px** on one
 * 340.8px face. The bias was doing more than absorbing a shortfall: `flex-grow`
 * was in it too, so a laconic card blew the window up to 198px and a talkative
 * one crushed it to 64, and a gallery of cards was a gallery of differently
 * shaped pictures. Two cards still overflowed their rules box after all that.
 *
 * So the window is `flex: none` and takes exactly the height its shared ratio
 * gives it — 214 x 140.7px on every full face, measured — and the rules box
 * takes the residual, which is bigger than it was because the collector bar left
 * the face (`../card/anatomy.ts`, `FACE_REGIONS`). What gives is the *text*:
 * `rulesFitStep` puts each card on a step of `RULES_FIT_STEPS` and the rule
 * below sets the box's font size from it.
 *
 * **`overflow-y` is `clip`, not `auto`, and that is a decision rather than a
 * tidy-up.** There is no scrollbar to reach for now: the ladder is deterministic
 * and its floor is stated, so a box that overflows is a card past the floor
 * rather than a card the reader should scroll. `auto` would answer that with a
 * scrollbar the hover zoom cannot use anyway — the panel is `pointer-events:
 * none` so it can never swallow the click that plays a card — and would hide the
 * defect behind an affordance instead of leaving it visible. What catches the
 * case instead is `../card/ZoomPanel.ts`, which draws the whole face larger and
 * sets its rules box back at step 0, and `faceDetailText`, which carries every
 * printed line into the face's `title` at every size. `tools/face-census.ts` is
 * how it is checked: no card in the flagship set overflows, and the wordiest
 * reaches step 2 of 3.
 *
 * `clip` also decides where the defect starts, which is one thing further than
 * this paragraph used to say: it clips at the *padding* box, so the 8px under
 * the last line is room the text may use before a glyph is sliced. Three faces
 * spent it and then some — the ladder had read them as fitting at full size —
 * and what a reader saw was the bottom half of a last line, not a scrollbar and
 * not a tidy elision. The budget those three broke, and the slack under it, are
 * `RULES_BOX_BUDGET_PX` in `@mtg/card-geometry`.
 *
 * **The type line takes one line, and that is what makes the rules box one
 * box.** With the window fixed the rules box is the residual, so anything above
 * it that grows is height the ladder is not told about: a wrapped type line put
 * three of the eighty faces on an 86.7px box while the rest had 100.9px, and one
 * of the two cards that still overflowed was a card the ladder had sized
 * correctly for the wrong box. `typeFitStep` sizes that line the way
 * `rulesFitStep` sizes the rules text, and `white-space: nowrap` is what makes
 * the step the whole answer. Both faces now agree here — `@mtg/card-render`
 * shrinks its type line and never wraps it either.
 *
 * Emitted straight after `FACE`, whose `.mtg-card` it narrows.
 */
/*
 * The rungs, emitted off the *longer* of the two ladders.
 *
 * `PRINTED_RULES_FIT_STEPS` is the longest ladder and shares every upper rung
 * with the generated-card ladders, so one run covers all three. Its final
 * selector only matches immutable official oracle text that needed it.
 */
const RULES_FIT_RULES = PRINTED_RULES_FIT_STEPS.map(
  (scale, step) =>
    `.mtg-card__text[data-fit='${cssNumber(step)}']` +
    ` { font-size: calc(var(--rules-type) * ${cssNumber(scale)}); }`,
).join('\n');

const TYPE_FIT_RULES = RULES_FIT_STEPS.map(
  (scale, step) =>
    `.mtg-card__type[data-fit='${cssNumber(step)}']` +
    ` { font-size: calc(var(--face-xs) * ${cssNumber(scale)}); }`,
).join('\n');

/**
 * The name's ladder, which sets a channel rather than a size.
 *
 * The other two ladders name the token they scale, because the rules box and the
 * type line are set off one token at every size a face is drawn at. The name is
 * not: `--mtg-text-sm` on a full face, `--mtg-text-xs` on a compact one, a
 * container query on the board. So this publishes the *scale* and each face
 * multiplies its own token by it — which is also what keeps the ladder from
 * winning a specificity fight it should lose, since an attribute selector
 * outranks the class-only rules those three faces are written as.
 *
 * `../card/anatomy.ts`'s `NAME_FIT_STEPS` is one rung longer than
 * `RULES_FIT_STEPS` and says why.
 */
const NAME_FIT_RULES = NAME_FIT_STEPS.map(
  (scale, step) => `.mtg-card__name[data-fit='${cssNumber(step)}'] { --name-scale: ${cssNumber(scale)}; }`,
).join('\n');

/**
 * The printed-text ladder when a whole face is opened specifically to be read.
 *
 * The source `data-fit` remains the conservative 214px gallery decision. A
 * hover face is wider and taller, so repeating that exact scale wastes the
 * added rules-box area: Vivien, Monsters' Advocate stayed at 5.2px in a 244px
 * preview with 32px of empty space above and below four rows. These rungs spend
 * that measured capacity while retaining the original rung as provenance.
 * The complete-catalog browser census checks the result at both reading widths.
 */
const PRINTED_READING_FIT_STEPS: readonly number[] = [1, 1, 1, 1, 1, 1, 0.92, 0.85, 0.78, 0.77];

/**
 * The three faces opened to be read: the deckbuilder's peek, the board's hover
 * zoom, and the rail's own reading face (the play rail's Info tab, the draft
 * rail's chosen card). The peek and the zoom are drawn at one width and take
 * the token-based ladder above; the rail's width varies and takes its own,
 * below. What the three share is the dense-planeswalker spacing.
 */
const READING_FACES = [
  '.mtg-cardpeek > .mtg-card',
  '.mtg-zoom > .mtg-card',
  '.mtg-rail__body > .mtg-card',
] as const;

const PRINTED_READING_FIT_RULES = PRINTED_READING_FIT_STEPS.map(
  (scale, step) =>
    `.mtg-cardpeek > .mtg-card[data-presentation='printed-card'] .mtg-card__text[data-fit='${cssNumber(step)}'],` +
    ` .mtg-zoom > .mtg-card[data-presentation='printed-card'] .mtg-card__text[data-fit='${cssNumber(step)}']` +
    ` { font-size: calc(var(--rules-type) * ${cssNumber(scale)}); }`,
).join('\n');

/**
 * The official-text ladder on the draft's full-card face.
 *
 * The imported-text estimator remains deliberately conservative because it has
 * to fit unusual Oracle paragraphs without measuring a browser. A draft pack
 * does have one fixed 214px minimum and can spend less of its rules rectangle
 * on ornamental inset. These rungs reclaim that measured room without changing
 * the source fit decision or the hover face's larger ladder. The complete
 * 600-position browser census below this rule is the safety boundary.
 */
const PRINTED_DRAFT_FIT_STEPS: readonly number[] = [1, 1, 0.92, 0.85, 0.78, 0.68, 0.62, 0.58, 0.5, 0.46];

const PRINTED_DRAFT_FIT_RULES = PRINTED_DRAFT_FIT_STEPS.map(
  (scale, step) =>
    `.mtg-draft .mtg-work__scroll > .mtg-thumbs > .mtg-card[data-presentation='printed-card'][data-inline-reminder='true']:not([data-loyalty-frame='true']) .mtg-card__text[data-fit='${cssNumber(step)}']` +
    ` { font-size: calc(var(--rules-type) * ${cssNumber(scale)}); }`,
).join('\n');

/**
 * The official-text ladder on whole cards in the shared deckbuilder and gallery.
 *
 * The imported-text estimator records a conservative fit step for a 214px
 * standalone face. Limited deckbuilding used to squeeze the same face to 194px
 * at the reference 1280px workbench, where falling back to the generic ladder
 * made its final rungs 5.2–6.8px. The builder now preserves the face's 244px
 * reading width and these rungs spend that room while retaining the estimator's
 * step and monotonic ordering: denser cards still step down, but no printed
 * rules text falls below 9.5px. Compact bars, paragraph gaps and 1.1 print
 * leading recover space around the text, leaving the shared art-window
 * proportions and card trim unchanged.
 * The live shared-builder browser test holds the named regression cohort, and
 * the complete-catalog browser census holds the Cube and AKH/HOU positions to the
 * no-overflow boundary.
 *
 * Builder styling is scoped to the pane scrollport, so the sibling `.mtg-cardpeek`
 * reading surface continues to use its wider reading ladder rather than
 * inheriting the inline one.
 */
const PRINTED_BUILDER_FIT_STEPS: readonly number[] = [1, 1, 1, 0.96, 0.9, 0.84, 0.78, 0.74, 0.74, 0.74];
const PRINTED_READABLE_CONTEXT = ':is(.mtg-builder-screen .mtg-deck__pane-scroll, .mtg-gallery)';

/**
 * The rail's reading face is the one reading surface whose width is not a
 * constant: the draft rail is `RAIL_REM` wide and the play board's split
 * handle can double it, and a stack card clicked to be read on a wide board
 * came up as a full-width frame with a large empty rules box and a 13px
 * paragraph in it. So its rules type is a share of the face's own width
 * (`cqi`, the face being its own inline-size container) rather than the token,
 * stepped down the pack's ladder for the dense positions and set on the text
 * region rather than on `--rules-type`, which the face's geometry reads. The
 * ladder is the rail's own, steeper at the top than the pack's, because the
 * dense positions at its floor are what bound the share the sparse ones get:
 * the pack's floor of 0.74 held the share to 4.9, and 0.66 lets the ordinary
 * card read at 5.5. Both numbers are the largest that the two-width rail
 * census in test/card/printed-card-face.browser.test.ts holds to the
 * no-overflow boundary over the Cube and AKH/HOU positions.
 */
const RAIL_RULES_CQI = 5.5;
const RAIL_FIT_STEPS: readonly number[] = [1, 1, 1, 1, 1, 0.95, 0.88, 0.8, 0.72, 0.66];
const RAIL_FACE = ".mtg-rail__body > .mtg-card[data-presentation='printed-card']";
const RAIL_READING_FIT_RULES = RAIL_FIT_STEPS.map(
  (scale, step) =>
    `${RAIL_FACE} .mtg-card__text[data-fit='${cssNumber(step)}'] { font-size: calc(${cssNumber(RAIL_RULES_CQI)}cqi * ${cssNumber(scale)}); }`,
).join('\n');

const PRINTED_BUILDER_FIT_RULES = PRINTED_BUILDER_FIT_STEPS.map(
  (scale, step) =>
    `${PRINTED_READABLE_CONTEXT} .mtg-card[data-presentation='printed-card'][data-size='full'] .mtg-card__text[data-fit='${cssNumber(step)}']` +
    ` { font-size: calc(var(--rules-type) * ${cssNumber(scale)}); }`,
).join('\n');

const PRINTED_BUILDER_TEXT_RULES = `
${PRINTED_READABLE_CONTEXT} .mtg-card[data-presentation='printed-card'][data-size='full'] {
  gap: calc(var(--rules-type) * ${cssNumber(BAR_PAD_RATIO)});
}
${PRINTED_READABLE_CONTEXT} .mtg-card[data-presentation='printed-card'][data-size='full'] > .mtg-card__bar {
  min-height: 0;
  padding-block: 1px;
}
${PRINTED_READABLE_CONTEXT} .mtg-card[data-presentation='printed-card'][data-size='full'] .mtg-card__text {
  --face-space-1: 0.1em;
  --face-space-2: 0.25em;
  line-height: 1.1;
}
${PRINTED_READABLE_CONTEXT} .mtg-card[data-presentation='printed-card'][data-size='full'][data-loyalty-frame='true'] .mtg-card__text {
  --face-space-1: 0.08em;
  --face-space-2: 0.12em;
  margin-block-end: 0;
}
${PRINTED_READABLE_CONTEXT} .mtg-card[data-presentation='printed-card'][data-size='full'][data-loyalty-frame='true'] .mtg-card__line:last-child {
  padding-inline-end: calc(var(--shield-w) + var(--face-space-2));
}
${PRINTED_READABLE_CONTEXT} .mtg-card[data-presentation='printed-card'][data-size='full'][data-loyalty-frame='true'] .mtg-card__line[data-loyalty] {
  column-gap: 1.5%;
  line-height: 1.1;
}
${PRINTED_READABLE_CONTEXT} .mtg-card[data-presentation='printed-card'][data-size='full'][data-loyalty-frame='true'] .mtg-card__loyalty {
  flex-basis: 11.5%;
}`;

/**
 * Planeswalker rows are already compact, ruled records rather than ordinary
 * prose paragraphs. Applying the imported prose floor to them made Vivien's
 * four rows 5.2px high while leaving a conspicuous band above and below the
 * table. This draft-only ladder spends that measured capacity on type. At the
 * wide draft size the text box also stops reserving the shield's height across
 * its full width: only the final row gives up the corner the shield occupies.
 * The complete-catalog browser census remains the overflow and collision
 * boundary for every official walker.
 */
const PRINTED_DRAFT_LOYALTY_FIT_STEPS: readonly number[] = [1, 1, 1, 0.92, 0.85, 0.78, 0.7, 0.62, 0.56, 0.5];
const PRINTED_DRAFT_WIDE_LOYALTY_FIT_STEPS: readonly number[] = [
  1, 1, 1, 1, 0.95, 0.9, 0.86, 0.83, 0.8, 0.77,
];

const PRINTED_DRAFT_LOYALTY_FIT_RULES = PRINTED_DRAFT_LOYALTY_FIT_STEPS.map(
  (scale, step) =>
    `.mtg-draft .mtg-work__scroll > .mtg-thumbs > .mtg-card[data-presentation='printed-card'][data-loyalty-frame='true'] .mtg-card__text[data-fit='${cssNumber(step)}']` +
    ` { font-size: calc(var(--rules-type) * ${cssNumber(scale)}); }`,
).join('\n');

const PRINTED_DRAFT_WIDE_LOYALTY_FIT_RULES = PRINTED_DRAFT_WIDE_LOYALTY_FIT_STEPS.map(
  (scale, step) =>
    `.mtg-draft .mtg-work__scroll > .mtg-thumbs > .mtg-card[data-presentation='printed-card'][data-loyalty-frame='true'] .mtg-card__text[data-fit='${cssNumber(step)}']` +
    ` { font-size: calc(var(--rules-type) * ${cssNumber(scale)}); }`,
).join('\n');

const PRINTED_DRAFT_CONCISE_RULES = `
.mtg-draft .mtg-work__scroll > .mtg-thumbs > .mtg-card[data-presentation='printed-card'][data-inline-reminder='true'][data-concise-rules='true']:not([data-loyalty-frame='true']) .mtg-card__text[data-fit='5'] {
  font-size: calc(var(--rules-type) * 0.74);
}
.mtg-draft .mtg-work__scroll > .mtg-thumbs > .mtg-card[data-presentation='printed-card'][data-inline-reminder='true'][data-concise-rules='true']:not([data-loyalty-frame='true']) .mtg-card__text[data-fit='7'] {
  font-size: calc(var(--rules-type) * 0.66);
}`;

const FACE_TRIM = `
.mtg-card[data-size='full'] {
  aspect-ratio: ${cssNumber(CARD_TRIM_MM.width)} / ${cssNumber(CARD_TRIM_MM.height)};
  min-height: 0;
}
.mtg-card[data-size='full'] > * { flex: none; }
.mtg-card[data-size='full'] > [data-region='rules'] { flex: 1 1 auto; min-height: 0; overflow-y: clip; }
${RULES_FIT_RULES}
${PRINTED_BUILDER_FIT_RULES}
${PRINTED_BUILDER_TEXT_RULES}
${PRINTED_DRAFT_FIT_RULES}
${PRINTED_DRAFT_LOYALTY_FIT_RULES}
${PRINTED_DRAFT_CONCISE_RULES}
.mtg-draft .mtg-work__scroll > .mtg-thumbs > .mtg-card .mtg-card__text {
  --face-space-1: 0.2em;
  --face-space-2: 0.25em;
}
.mtg-draft .mtg-work__scroll > .mtg-thumbs > .mtg-card[data-presentation='printed-card'][data-loyalty-frame='true'] .mtg-card__text {
  justify-content: space-around;
}
.mtg-draft .mtg-work__scroll > .mtg-thumbs > .mtg-card[data-presentation='printed-card'][data-inline-reminder='true'][data-concise-rules='true']:not([data-loyalty-frame='true']) .mtg-card__text {
  justify-content: space-around;
}
.mtg-draft .mtg-work__scroll > .mtg-thumbs > .mtg-card[data-presentation='printed-card'][data-loyalty-frame='true'] .mtg-card__line {
  line-height: 1.15;
}
@container (min-width: 14rem) {
  ${PRINTED_DRAFT_WIDE_LOYALTY_FIT_RULES}
  .mtg-draft .mtg-work__scroll > .mtg-thumbs > .mtg-card[data-presentation='printed-card'][data-loyalty-frame='true'] .mtg-card__text {
    --face-space-1: 0.08em;
    --face-space-2: 0.12em;
    margin-block-end: 0;
  }
  .mtg-draft .mtg-work__scroll > .mtg-thumbs > .mtg-card[data-presentation='printed-card'][data-loyalty-frame='true'] .mtg-card__line[data-loyalty] {
    column-gap: 1.5%;
    line-height: 1.05;
  }
  .mtg-draft .mtg-work__scroll > .mtg-thumbs > .mtg-card[data-presentation='printed-card'][data-loyalty-frame='true'] .mtg-card__line:last-child {
    padding-inline-end: calc(var(--shield-w) + var(--face-space-2));
  }
  .mtg-draft .mtg-work__scroll > .mtg-thumbs > .mtg-card[data-presentation='printed-card'][data-loyalty-frame='true'] .mtg-card__loyalty {
    flex-basis: 11.5%;
  }
}
${TYPE_FIT_RULES}
${NAME_FIT_RULES}
`;

export const ART_LOADING_LABEL = 'Loading art';

/*
 * The art window, and the one surface on the face that does not take the card's
 * identity.
 *
 * A window holding a picture is the identity's well. A window saying there is no
 * picture yet keeps `surface-sunken`, because what is printed on it is a
 * production notice in `--mtg-pending` amber and a `--mtg-ink-muted` card id
 * rather than art: the amber sits at 2.9:1 on the neutral sunken ground it has
 * always had, and a tinted well takes that to 2.2:1. Losing contrast on the one
 * label that exists to be noticed is the wrong trade, so the pending frame is
 * stated as the exception in both renderers —
 * `packages/card-render/src/palette.ts` pins the same rule on the printed face.
 */
const ART = `
.mtg-art {
  display: block; position: relative; overflow: hidden;
  aspect-ratio: ${cssNumber(ART_WINDOW.width)} / ${cssNumber(ART_WINDOW.height)};
  border: 1px solid var(--edge); border-radius: var(--mtg-radius-sm);
  background: var(--well);
}
.mtg-card[data-size='full'][data-large-art='true'] > .mtg-art {
  aspect-ratio: ${cssNumber(LAND_ART_WINDOW.width)} / ${cssNumber(LAND_ART_WINDOW.height)};
}
.mtg-art__image {
  display: block; position: relative; width: 100%; height: 100%; object-fit: cover;
}
.mtg-art[data-art-state='ready'] {
  background-image: repeating-linear-gradient(
    135deg,
    var(--mtg-hatch) 0 1px,
    transparent 1px 9px
  );
}
.mtg-art[data-art-state='ready']::before {
  content: '${ART_LOADING_LABEL}' / '';
  position: absolute; inset: 0; margin: auto;
  width: max-content; height: max-content;
  ${MICRO_LABEL}
  color: var(--mtg-ink-muted);
  background: var(--mtg-surface-raised);
  padding: 2px var(--mtg-space-2); border-radius: var(--mtg-radius-pill);
  border: 1px solid var(--mtg-line);
}
.mtg-card[data-size='board'] .mtg-art::before,
.mtg-card[data-size='art'] .mtg-art::before {
  content: none;
}
.mtg-art[data-art-state='pending'] {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: var(--mtg-space-1);
  background-color: var(--mtg-surface-sunken);
  background-image: repeating-linear-gradient(
    135deg,
    var(--mtg-hatch) 0 1px,
    transparent 1px 9px
  );
}
.mtg-art__pending-label {
  ${MICRO_LABEL}
  color: var(--mtg-pending);
  background: var(--mtg-surface-raised);
  padding: 2px var(--mtg-space-2); border-radius: var(--mtg-radius-pill);
  border: 1px solid var(--mtg-line);
}
/*
   The card id under the pending pill is production metadata, and this is the
   surface a set is played on. It read \`slc-skywatch-sentinel\` in the draft
   rail, six inches under the same card's printed name, which is the one place
   the name is not what a player wants to see.

   Hidden rather than removed: the element is what \`@mtg/card-render\`'s parity
   suite holds the two renderers to, and the id stays where it is useful — the
   art window's own \`aria-label\` (\`../card/ArtSlot.ts\`), the SVG proof sheet
   that the art pipeline reads, and \`npm run verify:art\`, which names every
   surface still waiting. What the played face keeps is the pill, which says
   the state without naming a row.

   One rule rather than one per size: it was already hidden at \`board\` (a
   label across a P/T badge) and at \`art\` (two labels in a 42px tile), and the
   sizes that still drew it — \`compact\` and \`full\` — are the two with room
   for the id to be legible, which is the whole complaint.
*/
.mtg-art__pending-note { display: none; }
`;

/**
 * The width under which a face stops trying to be drawn at its designed scale.
 *
 * A compact face is specified at `COMPACT_FACE_WIDTH_REM`, and its three bars
 * carry a `min-height` of one line at that scale. A played table gives a card
 * whatever height the viewport had left, so on a 1280x800 screen the face is
 * drawn about 66px wide and 93px tall — and at that size the bars' minimums add
 * up to more than the box, so they overflowed each other and the name, type and
 * P/T printed on top of one another. This is the width at which that starts, in
 * this checkout, measured in chromium.
 */
const SMALL_FACE_MAX_REM = 7;

/**
 * The full planeswalker face: its ruled rows and shield reservation.
 *
 * Two defects produced this block and they are the same defect seen from two
 * ends. the playtester, 2026-08-18, looking at Vessari, Hero of Hours in the Cards tab:
 * "the loyalty is covering up too much text" — the shield was mounted in
 * `.mtg-card__stats`, which is absolute and reserves nothing, so it landed on
 * the last ability and made it unreadable. The second was under it: that
 * ability's own text ran past the bottom of the card. Moving the shield off the
 * words would have left the words cut off by the frame instead, so both are
 * answered here or neither is.
 *
 * The illustration stays the same size as every other nonland. The dense
 * ability table instead uses the printed-text ladder and tighter ornamental
 * gaps on its small full face; the enlarged reading face restores comfortable
 * type without changing the crop.
 *
 * **The shield's band is a margin, not padding.** The box is `overflow-y: clip`
 * and clip cuts at the *padding* box, so a bottom padding is room an
 * over-budget card paints straight through — the shield would go on covering
 * the last ability exactly as reported, and only a card that already fit would
 * look fixed. A margin moves the clip edge itself. The band is the shield minus
 * the frame it hangs into, so the reservation is exactly the part of the shield
 * that stands over the box and not one pixel more.
 *
 * **`:has(.mtg-card__shield)` rather than a card-kind attribute**, because
 * `faceAttributes` publishes no kind and the shield is the thing these rules
 * are actually about: a face that prints one needs the room, and there is no
 * second way to print one. Scoped to `data-size='full'` throughout, so the
 * compact face (badge in the foot row, in flow) and the board face (badge in
 * the art window, re-offset by its own rule) are untouched, and so is every
 * creature's `.mtg-card__pt`.
 */
/* See the rule below: the share of the cropped height taken off the top. */
const PLANESWALKER_ART_TOP_BIAS = 0.15;

const PLANESWALKER = `
.mtg-card[data-size='full']:has(.mtg-card__shield) > .mtg-art {
  aspect-ratio: ${cssNumber(PLANESWALKER_ART_WINDOW.width)} / ${cssNumber(PLANESWALKER_ART_WINDOW.height)};
}
/* Art-forward full faces recover their text room from ornamental chrome, not
   from differently sized nonland illustrations or unreadable rules type. */
.mtg-card[data-size='full']:has(.mtg-card__shield) {
  gap: 0;
}
.mtg-card[data-size='full'][data-large-art='true'] {
  gap: 1px;
}
.mtg-card[data-size='full']:has(.mtg-card__shield) > .mtg-card__bar,
.mtg-card[data-size='full'][data-large-art='true'] > .mtg-card__bar {
  padding-block: 0;
}
/* Where the shorter window takes its crop from, and the reason it is not the
   middle. A cover fit centers by default, so a window at 578/300
   against a Scryfall art crop at about 626/457 drops a fifth of the picture's
   height off the top and the same off the bottom -- and a portrait's head is
   in the top third of it. Reported on Jace Beleren, 2026-08-24: "the art is too
   cut off (Jace's head isn't showing)."

   ${cssNumber(PLANESWALKER_ART_TOP_BIAS * 100)}% aligns that line of the image with the same line of the
   window, so the crop comes almost entirely off the bottom. Only this window
   states it: every other face's window is close enough to the source's aspect
   that a centered crop takes a sliver from each edge, which is what a centered
   crop is for. */
.mtg-card[data-size='full']:has(.mtg-card__shield) > .mtg-art > .mtg-art__image {
  object-position: 50% ${cssNumber(PLANESWALKER_ART_TOP_BIAS * 100)}%;
}
.mtg-card[data-size='full']:has(.mtg-card__shield) > .mtg-card__text {
  margin-block-end: calc(var(--shield-h) - var(--frame-band));
}
.mtg-card[data-size='full'] .mtg-card__stats:has(.mtg-card__shield) {
  /* One device pixel inward keeps the pointed shield inside the trim after the
     reading face's percentage geometry is rounded. Without it the point crosses
     the card by 0.6px and clips the loyalty numeral on every walker. */
  inset-block-end: calc(var(--pad) - var(--frame-band) + 5px);
}
`;

/*
 * A face drawn smaller than it was designed for.
 *
 * Not a fourth size a caller can ask for: nothing that draws a card knows how
 * much room the viewport had left, which is the whole reason the played table
 * hands the slot a share of a budget instead of a number. So the face asks
 * itself, through the `container-type: inline-size` it already declares. Above
 * `SMALL_FACE_MAX_REM` nothing here applies and the gallery, the replay board
 * and any full face are untouched.
 *
 * What gives is the type scale and the chrome around it, in that order, because
 * a name at 11px that fits is legible and a name at 13px that is printed over
 * the type line is not. Their *order* never gives: that is
 * `../card/anatomy.ts`'s and it is shared with the printed face.
 *
 * Which regions are drawn did not give either, until `mtg-bc2.142`. The
 * sentence here read "a thumbnail that dropped a region would no longer be the
 * same card", and it was answering a face that had run out of type scale. It
 * does not answer a face that has run out of *height*, where the alternative to
 * dropping a region is a picture two pixels tall — which is also no longer the
 * same card, and is the version nobody can see. `BOARD_TYPE_LINE_MIN_REM` is
 * that case and carries the argument; it is a board-size rule and this block is
 * not, so the small compact face in hand still draws all three of its bars.
 */
const SMALL_FACE = `
@container (max-width: ${cssNumber(SMALL_FACE_MAX_REM)}rem) {
  .mtg-card__bar {
    min-height: 0; padding: 1px var(--mtg-space-1); gap: var(--mtg-space-1);
    line-height: var(--mtg-leading-tight);
  }
  .mtg-card__name { font-size: calc(var(--mtg-text-xs) * var(--name-scale, 1)); }
  .mtg-card__pt { font-size: var(--mtg-text-xs); padding: 0 var(--mtg-space-1); }
  .mtg-card__type, .mtg-card__collector { font-size: var(--mtg-text-xs); }
  .mtg-card__seal { width: 0.8rem; height: 0.8rem; }
  .mtg-pip { width: 0.8rem; height: 0.8rem; }
  .mtg-swatch { width: 0.5rem; height: 0.5rem; }
}
`;

/*
 * The art tile: the picture, one keyline, and no words at all.
 *
 * The mana base's face (`../card/anatomy.ts`, `ART_REGIONS`). the playtester,
 * 2026-08-13: "I want the lands to show up a little nicer so they are in a row
 * below the cards in play and that they just show their art no thick border and
 * no text".
 *
 * **What was drawing the thick border**, since the answer was not obvious: the
 * face's own `border: 7px solid var(--identity)` in `FACE`, narrowed to 4px by
 * `BOARD_FACE`. At the 42px land face the band used to draw, 4px a side was a
 * fifth of the card's width, and the window inside it carried a second keyline
 * of its own. The tile takes one 1px edge and the window's goes, so there is
 * exactly one line round a land. It stays in the identity color rather than
 * going neutral: on a row of pictures with no words, the edge is the only thing
 * left saying which color the land makes.
 *
 * **The title region is hidden unconditionally, and that is `mtg-dgv3`.** It
 * used to be revealed under `:has([data-art-state='pending'])`, written as an
 * answer to the degenerate case — a tile whose art is missing is a blank square,
 * and while most of the set was uncovered by any manifest that was the common
 * state rather than an edge. What that rule actually said is that a land is
 * labeled when, and only when, an art run has not reached it yet.
 * `out/art/xmp-canon-v18` covers all 368 of the flagship's surfaces including
 * the five basics, so the whole mana base changed appearance the day an art run
 * finished, and every reading ever taken of the tile before that was taken on a
 * board of pending frames. Nobody decided that, which is the defect: not which
 * way it drew, but that the answer came from the state of an output directory.
 *
 * **It resolves toward no name, on her instruction and on the type size.**
 * The playtester, 2026-08-13, quoted in `mtg-ghv`: "I want the lands to show up a
 * little nicer so they are in a row below the cards in play and that they just
 * show their art no thick border and no text". The name was never a design
 * decision weighed against that sentence; it was the degenerate case leaking
 * through a selector, and the leak is what made it look like one. The
 * measurements say the same thing: a name in this box draws at about 8px upright
 * and about 6.7px on a tapped tile, since `board/lands.ts`'s `TAPPED_TILE_SCALE`
 * takes the whole face to 0.658 — and it was spending 15.2px of a 56px tile to
 * do it. Type nobody can read is not identification. The tile says what it is
 * with its picture, its identity keyline and its mana pip
 * (`../card/Card.ts`, `landPip`), all three of which survive being small.
 *
 * **What the degenerate case draws instead is the frame's own pill**, which is
 * the half of the old rule that was doing real work. A hatched square with
 * nothing on it would be worse than either version of the name, and at 368/368
 * covered this is a rare state rather than a gone one, so it has to be right
 * without being loud. The pill keeps its amber and its words and is sized to
 * this box rather than to a full face's art window: left at its printed
 * typography it is wider than an 83px window, so it clamped to the full width
 * and broke "ART PENDING" across two stretched lines. `width: min-content` and
 * the tighter padding make it 61.6 x 30.4 in an 83.2 x 54 window, measured in
 * chrome-headless-shell over `../../test/land-tile-name.browser.test.ts`. The
 * card id below it still goes: two labels do not fit here and the pill is the
 * one that says what the state is. Its `role="img"` and its
 * "Art pending for <id>" label stay in the accessibility tree either way, so the
 * art governance rule loses nothing.
 *
 * The picture now takes the tile less its keyline — 54px of 56 — which is what
 * the same file holds, and it is the same 54 whether the raster resolved or not.
 * That equality is the acceptance criterion; the direction it settled on is
 * `mtg-ghv`'s answer.
 *
 * **`mtg-9k0` asks for one more state and it is unreachable**, which is worth
 * recording here because the next reader will ask the same question. That bead
 * argues a nonbasic land drawn as a wordless picture is unidentifiable, and it
 * is right about the tile. There are no nonbasic lands: `@mtg/dsl`'s
 * `checkSupertypes` refuses a land that does not carry the `basic` supertype,
 * so every land any set here can print is one of five cards a player already
 * knows by its picture — which is the premise the tile was built on and the one
 * the bead's own text concedes. A rule for a card the generator cannot emit was
 * written and then removed rather than shipped with nothing to run it.
 *
 * **What makes it obviously a land, which is the 2026-08-14 revision.** The tile
 * grew (`board/lands.ts`, `LAND_TILE_HEIGHT_REM`) and it carries the mana it
 * makes, drawn over the lower-left of the window the way
 * `references/CleanShot 2026-08-14 at 07.21.27@2x.png` floats a full-art land's
 * own symbol over its picture. Positioned rather than laid out, for
 * `.mtg-card__corner`'s reason exactly: the window is `overflow: hidden`, so
 * the symbol is clipped by the picture rather than escaping onto whatever is
 * under it, and it costs the tile no height at all — which is what lets a tile
 * gain a fact and still be nothing but a picture.
 *
 * Sized in `cqw` so it tracks the tile the way every other label on this surface
 * does, and stated as a `font-size` rather than a width because a symbol is
 * `0.94em` (`./symbols.ts`): one declaration then sizes the box, its disc and
 * its glyph together. The floor is `--mtg-text-base`, which is where a symbol
 * stops reading as a shape at all, and the ceiling stops a wide tile from
 * turning its picture into a backdrop for a pip.
 *
 * Emitted after `BOARD_FACE` and after `ART`, because it re-declares rules both
 * of them own — the window's keyline, the pending frame's label — at equal
 * specificity, and source order is the whole mechanism.
 */
const LAND_PIP_CQW = 24;

const ART_TILE = `
.mtg-card[data-size='art'] {
  --pad: 0;
  gap: 0; padding: 0; overflow: hidden;
  border: 1px solid var(--identity); border-radius: var(--mtg-radius-md);
  background: none; box-shadow: none;
}
.mtg-card[data-size='art'] > [data-region='art'] {
  flex: 1 1 auto; min-height: 0; aspect-ratio: auto;
  border: 0; border-radius: 0;
}
.mtg-card[data-size='art'] > [data-region='title'] { display: none; }
/* The tracking is DESIGN.md's 0.06em, inherited: this block used to retrack the
   pill to 0.03em, half the Micro-Label Rule, and the argument for it would have
   been fit — the tile is small and the pill is width: min-content. Rendered both
   ways over the crowded board at all six combat viewports, the two arms differ by
   2.3px on the widest pill and change no fit outcome anywhere: nothing overflows
   at five of the six, and at 1440x560 the same eight tiles overflow under both.
   mtg-bc2.155, and mtg-90x.3's method. */
.mtg-card[data-size='art'] .mtg-art__pending-label {
  width: min-content; padding: 1px 3px;
  line-height: var(--mtg-leading-tight);
}
.mtg-card__mana {
  position: absolute; z-index: 1; pointer-events: none;
  inset-block-start: 3px; inset-inline-end: 3px;
  display: flex; align-items: flex-start; gap: 1px; line-height: 1;
  font-size: clamp(var(--mtg-text-base), ${cssNumber(LAND_PIP_CQW)}cqw, 1.75rem);
}
`;

/**
 * How wide the hover zoom draws the whole face.
 *
 * It used to be 15.25rem, the full face's own designed width — 244 x 341px at a
 * 16px root, the size `docs/research/prior-art-board-layout.md` recommends and
 * within a few pixels of Magic Online's 177 x 250 hand card. That was the right
 * number while the zoom's only job was to make a battlefield thumbnail readable.
 * It is not the right number now that the rules box shrinks its text to fit
 * (`FACE_TRIM`), because a zoom at the same width shrinks it by exactly the same
 * step and a card at the ladder's floor is as small in the zoom as on the table.
 *
 * 24rem is 384 x 536px, and the size is derived rather than picked. The zoom
 * sets its rules text at 15.6px, so it has to hold at that size what a
 * 15.25rem face holds at the floor. Room is characters per line times lines:
 * at 15.25rem the box is 196 x 82.9px, which is 4.40 lines at 13px and 5.64 at
 * the floor's 10.1px, so the floor case needs about 1.6x the room step 0 has
 * there. Scaling both the 320px reading face and its 13px type by 1.2 preserves
 * the calibrated line length while the taller trim adds the reading room the
 * imported-card census verifies below.
 *
 * It is a ceiling rather than the size. A 447px face does not fit a landscape
 * phone, and the part of it that goes under the fold is the rules box this
 * paragraph is about, so `../styles/mobile.ts` derives a smaller one from the
 * viewport on a short table and re-runs the arithmetic above against it.
 */
export const ZOOM_FACE_WIDTH_REM = READING_FACE_WIDTH_REM;

/*
 * The zoom: the whole card, on hover, over the corner of the window.
 *
 * `position: fixed`, which is what keeps it out of the well that would
 * otherwise clip it — every zone body on the played table is `overflow: auto`.
 * A fixed box is clipped only by an ancestor that is a containing block for it,
 * so nothing between the shell and a slot may carry a transform, a filter, or
 * layout containment; `../board/CardSlot.ts` records the rule and `board.ts`
 * centers a face with flexbox rather than a translate because of it.
 *
 * `pointer-events: none` is the promise that it never swallows the click that
 * plays the card. Bottom-right rather than Magic Online's upper-left, because
 * our upper-left is the opponent's board.
 *
 * The rest of that sentence used to read "and our bottom-right is the graveyard
 * pile, which is the least load-bearing thing on the screen", and `mtg-bc2.137`
 * made it false in the same commit that wrote it: the move list moved into that
 * column. Measured at 1280x800, the panel then covered 239 x 341px of the rail
 * and five choice buttons. `board.ts` moves it left of the rail on the play
 * route (`ZOOM_CLEARANCE`) and this is the default the replay board keeps, where
 * the rail holds a stack and two graveyards and nothing is pressed.
 *
 * A trigger per input device, so all three reach it: `:hover` for a pointer,
 * `:focus-visible` for a keyboard on the board face, which is a button, and on a
 * coarse pointer the slot's own focus, which is what a tap leaves behind. The
 * file used to say a touch screen had none of them and wanted none; it has two
 * and wants one, and the comments on the rules below carry the measurement.
 */
const ZOOM = `
.mtg-zoom {
  display: none;
  position: fixed; z-index: 40;
  inset-block-end: max(var(--mtg-space-4), env(safe-area-inset-bottom));
  inset-inline-end: max(var(--mtg-space-4), env(safe-area-inset-right));
  pointer-events: none;
}
/* Three triggers over two rules, and none of them is the pair this started as.

   the playtester, 2026-08-22, playing on a phone: "currently when I select a card to
   play it it shows a big view of another card next to it which is annoying".
   Measured at 844x390 under \`pointer: coarse\` with a real
   \`Input.dispatchTouchEvent\` rather than a synthesized one, a tap on a card in
   hand put a 320 x 447px face on a 390px-tall viewport: wider than a third of
   the screen and taller than all of it, over the card she was trying to play.

   Both halves of the old pair fired on that tap, and the diagnosis the file had
   was the wrong one. \`:focus-within\` is broader than the keyboard it exists for,
   since the tap that selects a card focuses it too — so it narrows to
   \`:focus-visible\`, which is the browser's own answer to this exact question
   and is true for a Tab and false for a tap or a click. Measured both ways: after
   a real tap the face is \`:focus-visible\` false, after a real Tab it is true.

   But the trigger that actually drew the panel is \`:hover\`, and a touch screen
   has one: Chrome leaves the tapped element hovered until something else is
   touched, so on a phone \`:hover\` does not mean "being pointed at", it means
   "last pressed". Hence the exception below.
*/
.mtg-slot:hover > .mtg-zoom, .mtg-slot:has(:focus-visible) > .mtg-zoom { display: block; }
/* And on a coarse pointer, being hovered is not evidence of anything.

   Written as the exception rather than as a \`(pointer: fine)\` gate on the rule
   above, and the reason is that only one of those two can be measured.
   chrome-headless-shell reports \`(hover: none)\` and \`(pointer: none)\` at every
   viewport — it has no mouse — and \`Emulation.setEmulatedMedia\` overrides
   neither back to a desktop's answer; only the narrowing to \`coarse\` takes.
   A rule gated on \`(pointer: fine)\` would therefore be off in every browser rig
   in this repo, so the desktop half of the behavior would go untested and any
   rig that leaned on the hover zoom would start failing for the wrong reason.
   Stated this way the desktop path is the unconditional one and the phone is the
   exception, which is also the order the two were argued in.

   The suppression is \`:not(:focus-within)\` rather than
   \`:not(:has(:focus-visible))\`, which is the second half of the pair below and
   is why it is written that way: on a coarse pointer the slot a finger is
   actually on is the focused one, so a hover that is not also this slot's focus
   is by construction a stale one. It keeps a keyboard driving a touch-primary
   tablet, for free and for the same reason.

   And the reveal a finger does get. the playtester, later the same day: "when you
   click a card you should be able to see the full version of its card text".
   Focus is the gesture's own record of which card was tapped, and it moves when
   the next card is tapped, which the sticky hover above does not — so tapping a
   second card takes the first one's panel down instead of leaving two on the
   table. That was the whole of the complaint this pair answers; the panel was
   never drawing a card other than its own slot's, it was the last card's panel
   still up beside the card being played.

   \`:focus-within\` rather than \`:has(:focus-visible)\` here, because on this arm
   the tap is the gesture being served and \`:focus-visible\` is false for one.
   The unconditional rule above still carries the keyboard on both arms. */
@media (pointer: coarse) {
  .mtg-slot:hover:not(:focus-within) > .mtg-zoom { display: none; }
  .mtg-slot:focus-within > .mtg-zoom { display: block; }
  /* Except on the played table, where the rail reads the tapped card instead
     (mtg-aqxi.1, and it supersedes the tap-to-read panel the rule above landed
     as). Two answers to one tap is one too many, and this is the answer that
     does not cover the board a phone is already short of. Scoped rather than
     replacing the rule, because the Cards gallery and the deck tabs have no rail
     to hand the reading to and the panel is all they have.

     .mtg-board, not .mtg-play: the sealed builder's root carries .mtg-play too,
     and it is a screen of card faces with no rail beside them. The rail belongs
     to the board, so the board is what stands the panel down. */
  .mtg-board .mtg-slot:focus-within > .mtg-zoom { display: none; }
}
.mtg-zoom > .mtg-card {
  --card-w: ${cssNumber(ZOOM_FACE_WIDTH_REM)}rem;
  /* This face grew from 20rem to 24rem so the reading surface could use more of
     the available screen. Its type grows by the same 1.2 ratio: keeping the old
     13px token made the enlarged face a larger thumbnail rather than a better
     reading surface. The complete imported-card census below holds the larger
     type to the same no-overflow boundary. */
  --rules-type: calc(var(--mtg-text-sm) * 1.2);
  box-shadow: var(--mtg-shadow-table);
}
/* Deckbuilding uses a different inert wrapper but the same reading face. The
   wrapper's placement arithmetic reads this shared width as well, so its box
   and the card inside it cannot disagree. */
.mtg-cardpeek > .mtg-card {
  --card-w: ${cssNumber(READING_FACE_WIDTH_REM)}rem;
  --rules-type: calc(var(--mtg-text-sm) * 1.2);
}
/* Generated text stays inside the generator's measured ceiling, so its zoom can
   spend the extra width on restoring the ordinary type size. Official oracle
   text is immutable and can be substantially denser: those faces retain their
   printed-text fit rung even in the zoom, where the wider box makes that rung
   easier to read without allowing the text to leave the frame. Written at four
   class/attribute selectors so the generated override beats the data-fit rules
   by specificity rather than sheet order. */
.mtg-zoom > .mtg-card:not([data-presentation='printed-card']) .mtg-card__text {
  font-size: var(--rules-type);
}
${PRINTED_READING_FIT_RULES}
/* The rail's reading face: print leading and paragraph gaps, as the builder's
   readable context sets them, under the width-scaled ladder above. */
${RAIL_FACE} .mtg-card__text {
  --face-space-1: 0.1em;
  --face-space-2: 0.25em;
  line-height: 1.1;
}
${RAIL_READING_FIT_RULES}
/* The floor rung contains three especially dense planeswalkers. Space-around
   spends any remainder between their ability sections instead of leaving two
   conspicuous empty bands. */
${READING_FACES.map((face) => `${face}[data-presentation='printed-card']:has(.mtg-card__shield) .mtg-card__text`).join(',\n')} {
  justify-content: space-around;
}
/* And its name, for the same reason and on the same terms. The name box is the
   bar less the cost run and the paddings, all of which are fixed, so the whole
   of the zoom's extra 140px goes to the name: 137px at the narrowest on a 15.25rem
   face becomes 277px here, which is 44 characters at 6.23px each against the 22
   the ladder is calibrated on. 44 covers the ladder's own floor column of 31, so
   every name it claims to fit fits here at full size; a name past that floor is
   cut at either size and this is the size that shows more of it. */
.mtg-zoom > .mtg-card .mtg-card__name { --name-scale: 1; }
`;

/**
 * The foil sheen, and the one decision in it that is not decoration.
 *
 * A swept highlight over the whole face: two stops crossing a transparent
 * gradient at 115deg, on a background box more than twice the element so the
 * band has somewhere to travel from and to. `mtg-jpbv` names
 * the prior-project champion shimmer as the reference and
 * this is its arithmetic, with the colors taken from tokens rather than written
 * out and the alpha carried by the tokens themselves: the sheen is painted over
 * a finished card and has to let the card through.
 *
 * **The reduced-motion arm holds a static tint rather than turning the treatment
 * off**, which is the part worth copying and the part easiest to get wrong. A
 * foil face is telling the reader something the pool measured and the card
 * cannot say -- which of two identical copies came off the foil sheet -- so a
 * rule that removed the paint under `reduce` would remove the information along
 * with the animation. It stops the sweep at the middle of its travel and thins
 * it, which is a mark you can still see and cannot mistake for movement.
 *
 * It says `animation-name` rather than the shorthand on purpose. `./base.ts`
 * clamps every animation on the page to `1ms !important` under the same query,
 * and a shorthand's duration would lose to that while its name would not; naming
 * the longhand makes the two rules agree instead of racing. The clamp is a
 * backstop for anything that forgets this block, and this block is what keeps
 * the frame it stops on from being whichever one 1ms lands in.
 */
const SHEEN = `
.${FOIL_SHEEN_CLASS} {
  position: absolute;
  inset: 0;
  z-index: 1;
  border-radius: inherit;
  pointer-events: none;
  background-image: linear-gradient(
    115deg,
    transparent 32%,
    var(--mtg-sheen-pearl) 45%,
    var(--mtg-sheen-amber) 55%,
    transparent 68%
  );
  background-size: 220% 220%;
  background-position: 0% 0%;
  animation: mtg-sheen-sweep 2400ms var(--mtg-ease) infinite;
}
@keyframes mtg-sheen-sweep {
  from { background-position: 0% 0%; }
  to { background-position: 100% 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .${FOIL_SHEEN_CLASS} {
    animation-name: none;
    background-position: 50% 50%;
    opacity: 0.4;
  }
}
`;

export const CARD_CSS = `${IDENTITY}${PIPS}${FACE}${FACE_TRIM}${ART}${PLANESWALKER}${BOARD_FACE}${ART_TILE}${SMALL_FACE}${ZOOM}${SHEEN}`;
