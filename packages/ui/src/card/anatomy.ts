/**
 * The face specification: the one description of a card face that both
 * renderers build from.
 *
 * The lab draws a card twice — `@mtg/ui`'s DOM face for the board, and
 * `@mtg/card-render`'s SVG face for print — and ADR-0002 keeps that split for a
 * stated reason. The price of the split is this module. Everything here is a
 * *design decision about what a card looks like*, so it is declared once and
 * both renderers derive from it; everything the medium decides (row heights
 * against a fixed trim, measured text with a committed `textLength`, button
 * semantics) stays in the renderer that owns it.
 *
 * **The measurements are no longer declared here.** The trim, the art window,
 * the pip ratio and the three fit ladders live in `@mtg/card-geometry`, which
 * depends on `@mtg/dsl` and nothing else, and are handed on at the foot of this
 * file. What stays is everything that needs a drawing to mean anything: the
 * region lists, the pip glyphs and their tokens, the rarity seals, the frame
 * treatment and the collector line.
 *
 * The enforcement is `packages/card-render/test/parity.test.ts`, which renders
 * the same DSL card through both and fails when they disagree on anything
 * declared below. A visual change that lands in one renderer and not the other
 * is therefore a red test rather than a discovery six weeks later.
 *
 * Three earlier shared sources belong to the same contract and live where they
 * already were: the palette and theme (`../styles/tokens.ts`), color identity
 * (`./identity.ts`), and the pending-art label (`./ArtSlot.ts`). All of the
 * printed *words* come from `@mtg/dsl` — `renderTypeLine`, `renderOracleText`,
 * `formatManaCost` — and neither renderer re-derives them.
 *
 * Every measurement in `@mtg/card-geometry` carries an explicit `number`
 * annotation rather than taking the literal type its initializer infers, and
 * that is load-bearing rather than decoration. The stylesheets in `../styles/`
 * interpolate those numbers into template literals that become the text of a
 * `<style>` element, so the day one of them is re-derived from a set's own
 * configuration — a per-set anatomy is not a stretch, the art pipeline already
 * reads a style guide into typed specs — a string-typed source has to fail at
 * its declaration rather than reach live CSS. `../styles/number.ts` is the
 * runtime half of the same guard and explains what a `}` in one of those values
 * would do.
 */
import type { Card, Color, ManaCost, Rarity } from '@mtg/dsl';
import { cardManaValue, colorPips, isArtifact, isCastable } from '@mtg/dsl';
import { LOYALTY_SHIELD_FLAT } from '@mtg/card-geometry';
import { cardColors, colorToIdentity, colorsToIdentity } from './identity';
import { coord } from './path';
import type { ColorIdentity } from '../styles/tokens';

/**
 * Every region a face of any size can lay out, in printed order. The vocabulary
 * rather than any one face's list: which of them a size draws is the four lists
 * below, and no size draws all five.
 */
export const CARD_REGIONS = ['title', 'art', 'type', 'rules', 'footer'] as const;
export type FaceRegion = (typeof CARD_REGIONS)[number];

/**
 * The regions of a full face, in printed order, top to bottom.
 *
 * **There is no collector bar, and that is `mtg-ceq`.** The playtester,
 * 2026-08-13: "instead of having such a large bar at the bottom for XMP number
 * rarity etc just remove that so more of the area can be used for the card
 * text." Measured over the 80 flagship faces, the bar and its gap cost 21px of
 * a 340.8px face and the rules box was the region paying for it: two cards
 * overflowed their box outright and every wordy card was reading a scrollbar.
 * The bar is gone and the rules box has all 21px.
 *
 * **Where the collector line went**, because it is still a fact a proxy sheet
 * and a board screenshot have to carry. `collectorLine` is unchanged and has
 * two homes now instead of one:
 *
 *  * every DOM face's `title` attribute, through `faceDetailText` in
 *    `./Card.ts` — including the `full` face, which had no detail text at all
 *    while it printed the bar. Hover a card anywhere in the lab and the line is
 *    there, and a screen reader reads it as the face's description.
 *  * the printed face, which keeps the bar (`@mtg/card-render`'s
 *    `renderFooter`). Paper has no hover, and a proxy that cannot be traced back
 *    to a printing is not a proxy. That makes the footer a *print-only* region,
 *    which is a shape ADR-0002 §2.2 already has: the P/T badge and the
 *    multicolor border ramp are print-only too, and `FACE_REGIONS` is the list
 *    of regions **both** faces lay out rather than everything either one draws.
 *
 * The rarity survives the move twice over. It is in the collector line the
 * hover carries, and the seal in the type bar now announces itself on every
 * face rather than only when a footnote displaced the line (`./Card.ts`).
 */
export const FACE_REGIONS: readonly FaceRegion[] = ['title', 'art', 'type', 'rules'];

/**
 * The regions a compact face keeps. A battlefield thumbnail is card-shaped
 * shorthand, not a small card: it drops the art window and the rules box and
 * keeps the three things that identify the permanent at a glance.
 *
 * The footer stays here and on the board face while it leaves the full one, and
 * the reason is arithmetic rather than consistency: **the footer is where the
 * P/T lives**, and a permanent whose power and toughness are not on it is not
 * readable at a glance. Neither of these two faces has a rules box, so nothing
 * on them is competing for the bar's height — the full face's whole complaint —
 * and the bar itself is now one badge wide, because the collector line left it.
 * A non-creature draws no footer at all at either size and that height goes to
 * the region above.
 */
export const COMPACT_REGIONS: readonly FaceRegion[] = ['title', 'type', 'footer'];

/**
 * The regions a face on the played table keeps, and the order it draws them in.
 *
 * Compact is the deckbuilding face. The table is a different problem: a player
 * has to recognize a permanent across the mat, and the illustration is what
 * carries that, so the window is the first region rather than a dropped one
 * (`mtg-bc2.137`; "I always want to be able to see the art on the battlefield").
 * The rules box still goes, because it is the one region a hover can replace
 * without costing anything on screen.
 *
 * **The title is first, and the arithmetic that put art there had already
 * expired.** This docblock argued art-first from a cost run sharing the title
 * row: at the 68.47px face `ui/board-face` (7737dbd) measured mid-game, the
 * bar's inner width was 32.47px and a two-pip run took 27.6px, leaving 0.87px
 * for the name, so the cost moved into the art window's corner and the
 * conclusion drawn was that "putting art anywhere else puts the cost back over
 * words". Both halves of that were re-checked before this list was reordered
 * and neither survives.
 *
 * The premise is gone: `./Card.ts`'s `costOnTitleRow` is `full` and `compact`
 * only, so on this face the cost is *not* on the title row and reordering the
 * regions cannot put it back there. It is drawn inside `.mtg-art`, which is
 * `overflow: hidden`, and what makes that corner free is the window's own
 * clipping rather than the window's position in the column — a fact about which
 * element the badge is a child of, which no ordering changes.
 *
 * The measurement is gone too. 68.47px was the face `ui/board-face` measured
 * before `../styles/board/hand.ts`'s `BOARD_FACE_MIN_REM` floored a board face
 * at 4.25rem. Re-read in chrome-headless-shell 151 over
 * `../../tools/card-uniformity.ts` on the flagship set at four permanents a
 * side, the face is 99.2px at 1440x900, 82.6 at 1280x800 and 68 at 1024x768,
 * and the name has the whole bar at every one of them: 83.2, 66.6 and 52px of
 * inner width against the 32.47 the old sentence was written about.
 *
 * So the order is the printed one, which is what the playtester asked for on
 * 2026-08-14 — "the title of a card needs to be at the top of the card art" —
 * and what `references/CleanShot 2026-08-14 at 07.20.15@2x.png` shows: title
 * bar, then art, then type line. It is also `FACE_REGIONS`'s order, so the
 * readable face, the printed face and the played table finally agree on where a
 * card's name goes.
 *
 * **The footer is in the list and a creature no longer draws one**, which is
 * the second thing paying for the window. The P/T is out of flow here now, in
 * the card's own bottom-right corner, exactly as it is on the full face and for
 * the argument that face already made: a badge that costs the column no height
 * is not a region the picture is competing with, and it is where a printed card
 * has drawn its power and toughness since 1993. So `footRow` is left with the
 * caller's footnote alone (`Equipping <name>`, which almost no permanent
 * carries) and returns nothing at all for the ordinary creature. The region
 * stays listed because the row is still laid out when there *is* a footnote;
 * what left is its unconditional cost. `COMPACT_REGIONS` above keeps the older
 * arrangement, because a deckbuilding thumbnail has no picture to protect.
 *
 * **The rules box is back, and this docblock used to argue it out.** The
 * sentence above read "the rules box still goes, because it is the one region a
 * hover can replace without costing anything on screen", and `mtg-u69` is what
 * that premise cost when somebody played with it. Measured in a real browser on
 * the flagship set: every card on the battlefield and every card in hand wears
 * this face, so the rules text of every object a player can see was reachable
 * only by hovering it, one at a time, with a pointer. Deciding a block meant
 * hovering each attacker and each blocker in turn. A creature with vigilance
 * did not say so anywhere on the screen.
 *
 * Two things the hover cannot be, which is why the answer is a region and not a
 * better zoom. It is **pointer-only** — there is no hover on a touch screen and
 * a tap on a board face plays the card — and it is **one card at a time**, which
 * is exactly the wrong shape for a decision taken across a board.
 *
 * So the words are on the card, and the picture is what pays, because the
 * picture is the one region on this face that can give (`../styles/card.ts`,
 * `BOARD_FACE`) and it is already how every other region on the table is
 * afforded. What the box holds at a battlefield thumbnail's size is not a whole
 * card's text and does not pretend to be: it is line-quantized and clips, and
 * the *order* is what makes that acceptable — the keyword line is printed first
 * (`./Card.ts`, `textBox`), so the line that survives the clip is the one
 * combat turns on. `BOARD_RULES_MIN_REM` in the sheet is where it stops being
 * worth any height at all, and it carries the measurement.
 */
export const BOARD_REGIONS: readonly FaceRegion[] = ['title', 'art', 'type', 'rules', 'footer'];

/**
 * The regions an art tile keeps: the picture, and a name it draws only when
 * there is no picture.
 *
 * The mana base's face. the playtester, 2026-08-13: "I want the lands to show up a
 * little nicer so they are in a row below the cards in play and that they just
 * show their art no thick border and no text". A land in play says one thing
 * and a player recognizes it by its illustration, so the tile is the window and
 * the frame around it comes down to a keyline.
 *
 * **And on 2026-08-14 she revised it**: "I want the lands to show up a bit
 * bigger too so it's obvious they're lands". The two asks pull against each
 * other only if "obvious" has to be spelled in words, and the reference she
 * filed with the revision says it does not — `references/CleanShot 2026-08-14 at
 * 07.21.27@2x.png` is a full-art land, where the picture is the whole card and
 * the two things that make it a land float *over* it rather than taking rows of
 * their own. So the region list is unchanged and the signal is an overlay: the
 * mana the land makes, drawn large in the window's lower-left corner from the
 * one symbol registry every other face reads (`./symbols.ts`, `landPip` in
 * `./Card.ts`). It costs the tile no height, it is the same mechanism as the
 * board face's corner cost, and a blue drop on a picture is a land in a way no
 * keyline is. The other reference, `CleanShot 2026-08-14 at 07.21.00@2x.png`,
 * answers the same question with the same symbol in a text box the tile does not
 * have; the symbol is what the two have in common and the box is what the tile
 * refuses.
 *
 * The name is in the list rather than dropped, and `../styles/card.ts` reveals
 * it exactly when `ArtSlot` drew the pending frame instead of an image. An
 * art-only tile with no art is a blank square, and most of the flagship set is
 * currently uncovered by any art manifest, so the degenerate case is the common
 * one. A tile that cannot be identified is worse than a tile with a word on it.
 *
 * DOM-only, like `COMPACT_FACE_WIDTH_REM` and for the same reason (ADR-0002
 * §2.1): nothing is *printed* at tile size, so this is a decision about the
 * played table rather than about what a card looks like, and it is not
 * re-exported from the package index for `@mtg/card-render` to compare against.
 */
export const ART_REGIONS: readonly FaceRegion[] = ['art', 'title'];

/**
 * The measurements and the fit ladders moved to `@mtg/card-geometry` and are
 * handed on here (mtg-plgg). Four packages wanted numbers about a rectangle and
 * three of them are not a UI; that package depends on `@mtg/dsl` and nothing
 * else, while this one depends on the kernel, the simulator and React. The
 * names are re-exported rather than re-declared, so this module stays the one
 * path `@mtg/ui` and its tests read the face specification through and there is
 * exactly one declaration of each.
 */
export {
  ART_WINDOW,
  CARD_TRIM_MM,
  COMPACT_FACE_WIDTH_REM,
  FRAME_BAND_MM,
  FULL_FACE_WIDTH_REM,
  LOYALTY_BADGE_GUTTER,
  LOYALTY_BADGE_PAD_PX,
  LOYALTY_BADGE_SHARE,
  LOYALTY_FIT_STEPS,
  LOYALTY_SHIELD_FLAT,
  LOYALTY_SHIELD_SHARE,
  NAME_FIT_STEPS,
  PLANESWALKER_ART_WINDOW,
  RULES_FIT_STEPS,
  TITLE_PIP_TO_TEXT,
  artWindow,
  nameFitScale,
  nameFitStep,
  nameFitStepOf,
  rulesBoxCost,
  rulesFitScale,
  rulesFitStep,
  rulesFitStepOf,
  rulesFitSteps,
  rulesTextBlocks,
  textBoxBlocks,
  textBoxCost,
  typeFitStep,
  typeFitStepOf,
} from '@mtg/card-geometry';

/** The engine rarity a seal can be painted for. */
export type SealRarity = Rarity;

/**
 * The ink each rarity's seal is painted in: black, a metallic pale blue, gold,
 * red-orange. the playtester, 2026-08-13, and it is the convention a printed Magic
 * card has used since Exodus — one set symbol, colored by rarity.
 *
 * **One shape for the whole set, and the rarity is the color.** This replaces a
 * shape-per-rarity map (`disc` / `diamond` / `star`) drawn in the card's own
 * identity color, which asked the seal to carry two facts at once and made
 * commons — the bulk of a set — the one rarity with no ink at all. A single
 * silhouette also means a set symbol can be *drawn* rather than enumerated,
 * which is what lets `./set-seal.ts` give every set a mark without anybody
 * authoring one per set. One shape per set; one ink per rarity; the two axes
 * never trade places.
 *
 * Token names rather than colors, because `../styles/tokens.ts` is the only
 * file in `@mtg/ui` that chooses one and both stylesheets generate their rules
 * from this record — `../styles/card.ts` for the DOM face and
 * `@mtg/card-render`'s `palette.ts` for the printed one. A rarity added here
 * paints on both faces or on neither.
 *
 * The four are theme-valued, which is forced rather than stylistic. The seal
 * sits on a `-panel` bar, which is lightness 0.902 on paper and 0.342–0.360 in
 * the dark; a single fixed value clearing 3:1 against both would have to be
 * darker than 0.60 and lighter than 0.62 at once. So "black" is the light
 * palette's darkest neutral and the dark palette's palest one — the ramp's
 * *neutral end*, which is what the word is doing in a list whose other three
 * entries are hues. `packages/ui/test/card-surfaces.test.ts` holds all eight
 * values to WCAG AA non-text contrast (3:1) against every panel of every
 * identity in both palettes; measured worst case 3.24.
 */
export const RARITY_SEAL_INK: Readonly<Record<SealRarity, string>> = {
  common: '--mtg-rarity-common',
  uncommon: '--mtg-rarity-uncommon',
  rare: '--mtg-rarity-rare',
  mythic: '--mtg-rarity-mythic',
};

/** A closed star polygon, alternating between the two reaches. One caller: the white pip's sun. */
function starOutline(points: number, outer: number, inner: number, cx: number, cy: number): string {
  const parts: string[] = [];
  for (let index = 0; index < points * 2; index += 1) {
    const reach = index % 2 === 0 ? outer : inner;
    const angle = (Math.PI * index) / points - Math.PI / 2;
    const x = Number((cx + Math.cos(angle) * reach).toFixed(2));
    const y = Number((cy + Math.sin(angle) * reach).toFixed(2));
    parts.push(`${index === 0 ? 'M' : 'L'} ${coord(x)} ${coord(y)}`);
  }
  return `${parts.join(' ')} Z`;
}

/**
 * The two shapes a loyalty number is set in, each as a closed outline over the
 * unit square: the cost badge that opens a planeswalker's ability row, and the
 * larger shield that prints its starting loyalty in the bottom-right corner.
 *
 * **Two shapes rather than one scaled shape**, because the printed card uses
 * two and they say different things. The ability badge is a flattened hexagon
 * pointing left and right — it sits *inside* the text box at the head of a row,
 * and its points lead the eye into the sentence it pays for. The starting
 * loyalty is a shield: flat across the top, tapering to a point at the bottom,
 * hanging off the corner of the frame. A reader can tell at a glance which
 * number is a price and which is the total, before reading either.
 *
 * **Unit coordinates, because the two mediums scale them differently and
 * neither of them should be re-deriving a silhouette.** `@mtg/card-render`
 * multiplies them into a `points` attribute in user units;
 * `../styles/card.ts` turns the same pairs into percentages inside a
 * `clip-path: polygon(…)`. `outlinePoints` and `outlineClipPath` below are
 * those two projections, so a change to a corner moves both faces or neither —
 * which is `packages/card-render/test/parity.test.ts`'s standing condition,
 * asserted there against these arrays rather than against two drawings.
 *
 * Authored from arithmetic, like every other mark on this frame (ADR-0001
 * §5.6): six and five vertices placed by hand on a unit square, nothing traced.
 */
export type Outline = readonly (readonly [number, number])[];

export const LOYALTY_BADGE_POINTS: Outline = [
  [0, 0.5],
  [0.16, 0],
  [0.84, 0],
  [1, 0.5],
  [0.84, 1],
  [0.16, 1],
];

export const LOYALTY_SHIELD_POINTS: Outline = [
  [0, 0],
  [1, 0],
  [1, LOYALTY_SHIELD_FLAT],
  [0.5, 1],
  [0, LOYALTY_SHIELD_FLAT],
];

/** A unit outline as an SVG `points` attribute, scaled onto a box. */
export function outlinePoints(
  outline: Outline,
  box: Readonly<{ x: number; y: number; width: number; height: number }>,
): string {
  return outline
    .map(([x, y]) => `${coord(box.x + x * box.width)},${coord(box.y + y * box.height)}`)
    .join(' ');
}

/** The same outline as a CSS `clip-path` value, in percentages of the element. */
export function outlineClipPath(outline: Outline): string {
  const points = outline.map(([x, y]) => `${coord(x * 100)}% ${coord(y * 100)}%`).join(', ');
  return `polygon(${points})`;
}

/**
 * The set symbol and the register of sets that have a mark of their own.
 *
 * Re-exported rather than defined here: it grew a 36-glyph alphabet when the
 * mark stopped being one shape for the whole repository, and `./set-seal.ts`
 * carries both it and the argument for its shape. Nothing inside `@mtg/ui`
 * changes module path.
 */
export { SET_SEAL_MARKS, setSealPath } from './set-seal';
export type { SetSealMark } from './set-seal';

/** A single pip in a cost run: either a color symbol or a numeral. */
export type PipSpec =
  | { readonly kind: 'color'; readonly color: Color; readonly identity: ColorIdentity }
  | { readonly kind: 'variable' }
  | { readonly kind: 'generic'; readonly amount: number };

/**
 * The pips of a cost, in printed order: the generic amount first, then colored
 * pips in WUBRG order. `{0}` is a real pip — a free spell says so — which is
 * why the generic pip survives a cost with no color in it.
 */
export function costPips(cost: ManaCost): readonly PipSpec[] {
  const pips: PipSpec[] = [];
  const colored = colorPips(cost).reduce((sum, [, count]) => sum + count, 0);
  if (cost.hasX) pips.push({ kind: 'variable' });
  if (cost.generic > 0 || (!cost.hasX && colored === 0)) {
    pips.push({ kind: 'generic', amount: cost.generic });
  }
  for (const [color, count] of colorPips(cost)) {
    for (let index = 0; index < count; index += 1) {
      pips.push({ kind: 'color', color, identity: colorToIdentity(color) });
    }
  }
  return pips;
}

/**
 * Mana symbols, drawn rather than typeset.
 *
 * The obvious move is to depend on the Mana font (`andrewgioia/mana`), which is
 * OFL 1.1 and is what Scryfall and 17lands use. We deliberately do not:
 * `docs/research/prior-art-data-sources.md` section 5.2 records the layering
 * there — the font file is OFL but the *glyph designs* are Wizards' marks — and
 * section 5.4 records what happened to the one custom-card tool that reproduced
 * Wizards' art wholesale. Drawing our own symbols means no font to bundle, no
 * webfont to load in a standalone file, no fallback box when it is missing, and
 * no trademark question at all.
 *
 * So these are original shapes on the *category* each color has always used —
 * a sun, a drop, a crescent, a flame, a leaf, a cut stone — not traces of the
 * printed symbols. Each is authored in a local -50..50 square, so one drawing
 * fits any pip: the printed face scales it into a 15.5-unit disc, the DOM face
 * mounts the same square in a 1.05 rem one, and neither owns the shape.
 */

/** Half-extent of the local authoring square every glyph is drawn in. */
export const PIP_GLYPH_UNITS: number = 50;

/** The authoring square as a `viewBox`, for a face that mounts a glyph directly. */
export const PIP_GLYPH_VIEW_BOX = `${String(-PIP_GLYPH_UNITS)} ${String(-PIP_GLYPH_UNITS)} ${String(PIP_GLYPH_UNITS * 2)} ${String(PIP_GLYPH_UNITS * 2)}`;

/** Glyph extent as a fraction of the pip's width; leaves a ring of disc showing. */
export const PIP_GLYPH_SCALE: number = 0.66;

/** Weight of a glyph's detail lines, in authoring units. */
export const PIP_GLYPH_STROKE: number = 6;

/**
 * One drawn symbol. `fill` and `lines` are separate rather than one list with a
 * positional convention, because a convention about which path is the filled
 * one is a rule both renderers would otherwise have to know.
 */
export interface PipGlyph {
  /** The filled outline. */
  readonly fill: string;
  /** Detail lines stroked over the outline, never filled. */
  readonly lines: readonly string[];
}

const SUN: PipGlyph = {
  fill: starOutline(8, 46, 21, 0, 0),
  lines: ['M 0 -19 A 19 19 0 1 0 0 19 A 19 19 0 1 0 0 -19 Z'],
};

const DROP: PipGlyph = {
  fill: 'M 0 -46 C 20 -18 33 2 33 16 A 33 33 0 1 1 -33 16 C -33 2 -20 -18 0 -46 Z',
  lines: [],
};

/**
 * Outer disc r=43 with a disc of r=36 bitten out of it, offset 18 to the right.
 * The two endpoints are the circles' intersection points, computed once by hand
 * so both arcs are drawn at their true radii — an arc whose chord exceeds its
 * diameter is silently enlarged by the SVG spec, which turns a crescent into a
 * lens without any renderer complaining.
 */
const CRESCENT: PipGlyph = {
  fill: 'M 24.36 -35.44 A 43 43 0 1 0 24.36 35.44 A 36 36 0 1 1 24.36 -35.44 Z',
  lines: [],
};

const FLAME: PipGlyph = {
  fill:
    'M 2 -47 C 16 -25 31 -16 31 3 A 31 31 0 0 1 -31 3 C -31 -11 -19 -16 -13 -28 ' +
    'C -10 -13 -3 -9 1 -16 C 6 -25 5 -35 2 -47 Z',
  lines: [],
};

const LEAF: PipGlyph = {
  fill: 'M 4 -46 C 28 -28 40 -2 32 25 C 8 41 -18 32 -30 11 C -38 -10 -20 -34 4 -46 Z',
  lines: ['M 4 -46 C -4 -20 -10 4 -14 30'],
};

const STONE: PipGlyph = {
  fill: 'M 0 -44 L 31 -12 L 18 40 L -18 40 L -31 -12 Z',
  lines: ['M -31 -12 L 31 -12', 'M 0 -44 L 0 40'],
};

/** The six drawn symbols, one per mana identity the DSL can express. */
export const PIP_GLYPHS: Readonly<Record<Exclude<ColorIdentity, 'm'>, PipGlyph>> = {
  w: SUN,
  u: DROP,
  b: CRESCENT,
  r: FLAME,
  g: LEAF,
  c: STONE,
};

/** Symbol per DSL color. Multicolor is a frame treatment, never a pip. */
export const PIP_GLYPH_FOR_COLOR: Readonly<Record<Color, PipGlyph>> = {
  W: SUN,
  U: DROP,
  B: CRESCENT,
  R: FLAME,
  G: LEAF,
};

/** What a pip is drawn as: a symbol, or a numeral inside the disc. */
export type PipArt =
  { readonly kind: 'glyph'; readonly glyph: PipGlyph } | { readonly kind: 'numeral'; readonly text: string };

/**
 * The artwork for one pip of a run — the decision `costPips` deliberately does
 * not make, kept next to it so that "which pips" and "what they look like" are
 * one description rather than two.
 *
 * Total over `PipSpec`, which is the point: a pip kind the cost vocabulary
 * learns to express — a hybrid symbol, say, which `@mtg/dsl`'s `ManaCost`
 * cannot state today — stops compiling here, in the specification, instead of
 * reaching two renderers that would each invent a drawing for it.
 */
/**
 * The brace token one pip of a cost run prints as: `W` for a white pip, `3` for
 * a generic three.
 *
 * This is what joins the title bar to the rules box. `symbols.ts`'s registry is
 * keyed by token, and the cost line used to bypass it entirely — it asked
 * `pipArt` for a drawing whatever set the face was painting with, so one card
 * could show a drawn `{2}` in its title bar over a referenced `{1}` in its
 * rules text. Both faces now ask this what a pip is called and the registry
 * what that token looks like, so a cost run and a line of rules text are one
 * vocabulary rather than two that happen to agree in one set.
 *
 * Exhaustive over `PipSpec` for the reason `pipArt` is: a pip kind the cost
 * vocabulary learns to express stops compiling here rather than reaching a
 * renderer that would name it something.
 */
export function pipToken(spec: PipSpec): string {
  switch (spec.kind) {
    case 'color':
      return spec.color;
    case 'generic':
      return String(spec.amount);
    case 'variable':
      return 'X';
    default: {
      const never: never = spec;
      throw new Error(`anatomy: unknown pip kind ${String(never)}`);
    }
  }
}

export function pipArt(spec: PipSpec): PipArt {
  switch (spec.kind) {
    case 'color':
      return { kind: 'glyph', glyph: PIP_GLYPH_FOR_COLOR[spec.color] };
    case 'generic':
      return { kind: 'numeral', text: String(spec.amount) };
    case 'variable':
      return { kind: 'numeral', text: 'X' };
    default: {
      const never: never = spec;
      throw new Error(`anatomy: unknown pip kind ${String(never)}`);
    }
  }
}

/**
 * What the frame is painted from: which of the seven identities the face wears,
 * the colors standing behind that identity, and whether the card is a plate.
 *
 * The derivation is shared; the painting is not. The printed face runs a
 * gradient across `colors` and tiles a hatch over an artifact, and the DOM face
 * keys a stylesheet rule off the same facts and paints them its own way — for
 * reasons ADR-0002 §2.2 records. What neither may do is work the facts out for
 * itself, which is how the two came to disagree about artifacts in the first
 * place.
 *
 * `colors` is WUBRG-sorted by `cardColors`, and the order is load-bearing: the
 * printed ramp places its stops at `index / (length - 1)`, so a resorted list
 * is a different picture.
 */
export interface FrameTreatment {
  readonly identity: ColorIdentity;
  readonly colors: readonly Color[];
  readonly artifact: boolean;
}

export function frameTreatment(card: Card): FrameTreatment {
  const colors = cardColors(card);
  return {
    identity: colorsToIdentity(colors),
    colors,
    artifact: isArtifact(card),
  };
}

/**
 * The vocabulary a face's root element publishes, as the exact strings both
 * renderers write. Every fact a stylesheet or a proof sheet might key off is
 * here, so a renderer that knows something about the card cannot keep it to
 * itself.
 *
 * Strings rather than the treatment's own types, and that is the whole point of
 * the function. `@mtg/card-render`'s serializer drops a `false` attribute
 * entirely while React writes it out, so a record carrying `artifact: boolean`
 * would publish `data-artifact` on one face and nothing on the other — exactly
 * the divergence this closes. The encoding also lives here rather than in either
 * component, so neither of them types a color letter (DESIGN.md, The Identity
 * Firewall Rule). A colorless card publishes the empty string rather than
 * omitting the attribute: both serializers agree on an empty string, and only
 * one of them can express omission.
 *
 * The treatment is an argument, required rather than defaulted: both renderers
 * hold one by the time they write the root, and a default would put a second
 * derivation on the path nothing exercises. Nothing here checks the treatment
 * belongs to this card, so a caller that hands in another card's publishes that
 * card's frame facts under this card's id.
 *
 * **There is no `data-basic` here, and that is a finding rather than an
 * oversight.** `mtg-9k0` argues that a *nonbasic* land drawn as an art tile with
 * no words on it would be unidentifiable, and it is right about what the tile
 * does — a tile prints no name at any art state (`mtg-dgv3`). What the
 * bead could not know is that no such card exists: `@mtg/dsl`'s `checkSupertypes`
 * refuses a land without the `basic` supertype outright ("DSL v0 lands are basic
 * lands"), so every land any set in this checkout can contain is a basic. A
 * supertype published for a stylesheet rule that no card can ever match is dead
 * weight on the shared contract, so neither was added.
 */
export function faceAttributes(card: Card, treatment: FrameTreatment): Readonly<Record<string, string>> {
  return {
    'data-identity': treatment.identity,
    'data-colors': treatment.colors.join('').toLowerCase(),
    'data-artifact': treatment.artifact ? 'true' : 'false',
    'data-rarity': card.rarity,
    'data-card-id': card.id,
  };
}

/**
 * Where the card came from, how rare it is, and what it costs to cast.
 *
 * It used to be the foot of every readable face and is now printed on paper and
 * spoken on screen: `@mtg/card-render`'s `renderFooter` draws it in the printed
 * face's own bar, and every DOM face carries it in `title` through
 * `faceDetailText`. `FACE_REGIONS` above has the argument. One function either
 * way, so a proxy and a board screenshot still identify the same printing.
 */
export function collectorLine(card: Card): string {
  const number = String(card.set.collectorNumber).padStart(3, '0');
  const value = isCastable(card) ? `MV ${String(cardManaValue(card))}` : 'Land';
  return `${card.set.code} ${number} · ${card.rarity} · ${value}`;
}
