/**
 * The card face's measurements and its fit ladders: how big a card is, how big
 * its art window is, and how far the words shrink before they stop shrinking.
 *
 * **Why this is a package of its own rather than a module of `@mtg/ui` or of
 * `@mtg/card-render`.** These numbers describe a rectangle. Four packages want
 * them and only one of the four draws anything: `@mtg/card-render` sizes the
 * printed face, `@mtg/setgen` shows the flavor model which cards have room
 * left, `@mtg/design-data` cites the seal table, and `@mtg/ui` lays out the DOM
 * face. They used to live in `@mtg/ui`, which depends on `@mtg/deckbuild`,
 * `@mtg/kernel`, `@mtg/metrics`, `@mtg/netplay` and `@mtg/sim`, so asking for
 * one number about a rectangle pulled the simulation engine and React into the
 * asker's graph. `@mtg/setgen` carried exactly that dependency for two
 * constants.
 *
 * `@mtg/card-render` is the candidate the name suggests and it is the wrong
 * host, because the arrow it would have to reverse is not the only arrow it
 * has. That package reads the symbol registry, the oracle chunker, the theme
 * tokens, `frameTreatment`, `faceAttributes` and `costPips` from `@mtg/ui`, and
 * its parity suite renders `@mtg/ui`'s React face against its own. Putting the
 * geometry there would make `@mtg/ui` depend on `@mtg/card-render` while
 * `@mtg/card-render` still depends on `@mtg/ui`: a real cycle, created to
 * remove one. It would also put React into `@mtg/setgen`'s graph, which is the
 * cost the move exists to remove. Hosting the geometry where nothing draws
 * settles it for every importer at once, and leaves the rest of the face
 * specification free to migrate later without a cycle in the meantime.
 *
 * The dependency floor is `@mtg/dsl` and nothing else. Anything added here that
 * needs a browser, a renderer or a simulation belongs in the package that has
 * one.
 *
 * `@mtg/ui`'s `card/anatomy.ts` keeps everything the *drawing* decides — the
 * region lists, the pip glyphs, the rarity seals, the frame treatment — and
 * re-exports what is here, so its own modules and its tests read one module
 * path as they always did.
 *
 * Every measurement below carries an explicit `number` annotation rather than
 * taking the literal type its initializer infers, and that is load-bearing
 * rather than decoration. `@mtg/ui`'s stylesheets interpolate these into
 * template literals that become the text of a `<style>` element, so the day one
 * of them is re-derived from a set's own configuration a string-typed source
 * has to fail here, at the declaration, rather than reach live CSS.
 */
import type { Card } from '@mtg/dsl';
import { isPlaneswalker, renderTypeLine } from '@mtg/dsl';
import { composeTextBox, oracleBlocks, remindedBlocks } from './text-box';
import type { TextBlock } from './text-box';

/**
 * How wide a compact face is drawn, in rem.
 *
 * The one number here the printed face has no use for — nothing is printed at
 * thumbnail size — and it is in the specification anyway, because it decides
 * whether a card in hand reads as a card and it is the first thing a
 * play-surface pass will want to move. Two stylesheets interpolate it: the
 * face's own width in `@mtg/ui`'s `styles/card.ts`, and the width of the slot a zone lays
 * that face out in (`@mtg/ui`'s `styles/board/slot.ts`).
 *
 * Not re-exported from `@mtg/ui`'s package index. `@mtg/card-render` is the
 * only consumer out there and has nothing to compare it against, so publishing
 * it on the face contract's own barrel would advertise a DOM-only number as
 * part of that contract (ADR-0002 §2.1, §6.2). It is on this package's barrel
 * because this package is a bag of measurements rather than the contract, and
 * `@mtg/ui`'s board stylesheets have to reach it somehow.
 */
export const COMPACT_FACE_WIDTH_REM: number = 9.5;

/**
 * How wide a full face is drawn, in rem — the width every pixel measurement in
 * this file was read at.
 *
 * It was a literal in `@mtg/ui`'s `styles/card.ts` and is here now because the
 * arithmetic below needs it: a planeswalker's box is the ordinary box plus what
 * its art window gives up and minus the band its loyalty shield stands in, and
 * both of those are shares of the card's width. A share times a width is a
 * number of pixels, and the width has to be the same one the sheet writes or
 * the budget is a budget for a card nobody draws.
 */
export const FULL_FACE_WIDTH_REM: number = 15.25;

/**
 * Trimmed card size in millimeters. The printed face is exactly this; the DOM
 * face is at least this shape, so a card on screen and a card in the hand have
 * the same silhouette.
 */
export const CARD_TRIM_MM: Readonly<{ width: number; height: number }> = { width: 63, height: 88 };

/**
 * The art window as a width : height ratio, written as the printed window in
 * tenths of a millimeter. The SVG face sizes its window from it directly; the
 * DOM face hands the same pair to `aspect-ratio`.
 */
/**
 * The frame band around the printed content, in millimeters.
 *
 * A card's frame is one band of a stated width, and every face draws it as a
 * share of the card rather than as a count of pixels: 2.6 mm of 63 is 4.13% of
 * the card's width, whatever the card is drawn at. `@mtg/card-render` starts
 * its printed content at exactly this inset; `@mtg/ui`'s `styles/card.ts` makes
 * it the DOM face's border width, computed from the width that face is actually
 * rendered at, which is what keeps a 320 px hover zoom and an 88 px card in the
 * combat band wearing the same frame rather than the same pixel count.
 */
export const FRAME_BAND_MM: number = 2.6;

export const ART_WINDOW: Readonly<{ width: number; height: number }> = { width: 578, height: 380 };

/**
 * The art window a planeswalker gets instead, and why one card type is allowed
 * its own.
 *
 * `RULES_FIT_STEPS` below states the rule the rest of the set obeys: the window
 * is one shape on every card and the *text* gives. A planeswalker is where that
 * rule runs out. Its box is not one paragraph and a flavor line — it is three or
 * four abilities, each ruled off from the next, each carrying a cost badge that
 * narrows the column it wraps in, and the flagship's wordiest walker asks for
 * ten lines where the wordiest creature asks for six. No step of the shared
 * ladder holds that, and the two ways out that were on the table are both
 * refused elsewhere in this file: clipping the last ability (a planeswalker
 * whose ultimate is unreadable is not a planeswalker) and shrinking the type
 * past the point where text stops being text.
 *
 * So the picture gives, on this card type only, which is what a printed
 * planeswalker does: measured off `references/planeswalkers.png`, a real
 * walker's text box runs from 29% to 40% of the card's height against a
 * creature's 25%, and the height comes out of the window above it. 300 against
 * 380 hands the box 31px of a 341px face and leaves the window 111px — still a
 * landscape window, still the same width, and every planeswalker in a set is
 * the same shape as every other.
 *
 * `@mtg/ui`'s sheet keys this off `:has(.mtg-card__shield)` and
 * `@mtg/card-render`'s `cardGeometry` off `isPlaneswalker`, so the two faces
 * take the height from the same place.
 */
export const PLANESWALKER_ART_WINDOW: Readonly<{ width: number; height: number }> = {
  width: 578,
  height: 300,
};

/** The art window a card's face is drawn with. */
export function artWindow(card: Card): Readonly<{ width: number; height: number }> {
  return isPlaneswalker(card) ? PLANESWALKER_ART_WINDOW : ART_WINDOW;
}

/**
 * The starting-loyalty shield, as a share of the card's *width* on both axes.
 *
 * Width on both axes rather than width and height, because a card's two
 * dimensions are fixed against each other and one reference frame makes the
 * shield the same object on a 244px face, a 320px hover zoom and a 630-unit
 * printed sheet without a second conversion. Read off `references/planeswalkers.png`:
 * Ajani Goldmane's `4` is about a tenth of the card wide and slightly taller
 * than it is wide, which is what makes it read as a shield rather than a chip.
 *
 * It is deliberately larger than the cost badges inside the box —
 * `LOYALTY_BADGE_SHARE` gives those 9.2% of a box that is itself 88% of the
 * card — because it is the number a reader of a planeswalker looks for first.
 */
export const LOYALTY_SHIELD_SHARE: Readonly<{ width: number; height: number }> = {
  width: 0.1,
  height: 0.115,
};

/**
 * Where the shield stops being flat and starts tapering to its point, as a
 * share of its own height.
 *
 * One number rather than a shape, because three things have to agree about it:
 * the outline `@mtg/ui` clips the badge to, the polygon `@mtg/card-render`
 * draws, and the bottom padding that keeps the printed number inside the flat
 * part instead of centered on a point too narrow to hold a glyph. At 0.62 the
 * flat upper part is 17px of a 28px shield, which holds `--mtg-text-sm` with
 * room on both sides.
 */
export const LOYALTY_SHIELD_FLAT: number = 0.62;

/**
 * A title-row cost pip's box, as a multiple of the title text's size.
 *
 * The playtester, 2026-08-13: "the mana symbol in the upper right is a bit too large
 * it should be smaller, around the same vertical height as the title text." So
 * the pip is the title's own *line box* — the text size times its leading —
 * which is the tallest thing the row already contains and therefore the largest
 * a pip can be without making the bar taller than its words.
 *
 * 1.2 is `--mtg-leading-tight`, which is what `.mtg-card__name` sets as its
 * `line-height`. The DOM sheet interpolates neither number: it writes
 * `calc(var(--mtg-text-sm) * var(--mtg-leading-tight))`, so a re-valued token
 * moves the pip with the text. This constant is the printed face's copy of the
 * same rule, and `packages/ui/test/card.test.ts` fails when the two stop being
 * the same number.
 *
 * Measured before: a 16.8px pip beside a 15.6px line. After: 15.6 and 15.6.
 */
export const TITLE_PIP_TO_TEXT: number = 1.2;

/**
 * The rules text shrinks to fit; the picture never does.
 *
 * **This reverses `FACE_TRIM`'s `WINDOW_SHRINK_BIAS`**, whose docblock in
 * `@mtg/ui`'s `styles/card.ts` argued that "the picture gives before the words do".
 * The playtester, 2026-08-13: "can we make the text smaller for the longer text
 * instead of adding a scroll bar? the dimensions of the card art should be
 * consistent across cards but we can adjust the text size within the box to
 * make that content more legible." Measured over the 80 flagship faces under
 * the old rule, the art window came out at **thirteen different heights**
 * between 64.1px and 197.7px on one 340.8px face, because the window both grew
 * and shrank to whatever the rules box left — a gallery of cards whose pictures
 * were all different shapes. The window is now `flex: none` and every full face
 * measures one window; the rules box takes the residual and the text steps down
 * inside it.
 *
 * **A ladder rather than a measurement**, because jsdom lays nothing out: a fit
 * that asks the DOM for a box is a fit no vitest test can see, and this is the
 * decision the whole face rests on. `rulesFitStep` is arithmetic over the
 * printed oracle text, so both faces reach the same answer with no browser and
 * no font, and `packages/ui/test/card-fit.test.ts` can hold it to cases written
 * out by hand. The DOM face publishes the step as `data-fit` and the sheet
 * keys a font size off it; `@mtg/card-render` caps its measured scan at the
 * same step, so a card that shrinks on screen shrinks on paper.
 *
 * What the printed face keeps that this cannot give it: a real measurement.
 * `fitParagraphs` wraps against a metrics table and `checkSvgOverflow` fails a
 * face whose ink escapes its box, so the cap only ever lowers the size print
 * starts from and print's own guarantee is unchanged.
 */
export const RULES_FIT_STEPS: readonly number[] = [1, 0.92, 0.85, 0.78];

/**
 * The rules box as a browser lays it out, in the unit every one of these
 * numbers was read in: CSS pixels of rendered height.
 *
 * The arithmetic below used to work in "lines of the box at step 0", which is a
 * unit nothing measures. Everything here was measured in pixels, the sheet's
 * paragraph margins *are* pixels and do not scale with the type, so the cost of
 * a text box is now a height in pixels and the budget is a height in pixels.
 *
 * **The box.** `clientHeight` is 99px on every one of the 84 flagship faces:
 * 83px of content between 8px of padding above and below. `overflow-y: clip`
 * clips at the *padding* edge, so 91px of content is where a glyph is first
 * sliced, and the 8px between 83 and 91 is room the text may use before a reader
 * loses anything. The budget is **87px — the content box plus half that bottom
 * padding**. A face that reaches into the first half prints its last line low in
 * the box and still whole; the second half is the margin the estimate's own
 * error gets, and it is the only margin it gets, because a wrap the estimate
 * missed costs a whole line and no plausible budget survives that.
 *
 * **The shape: a line holds `RULES_BOX_COLUMN / scale` characters, and the
 * shape was never the bug.** Every face was re-rendered at all four rungs in
 * chrome-headless-shell 151 and every paragraph's height divided by its line
 * box, 432 rendered paragraphs in all. The largest column that never falls under
 * the rendered line count is 35.75, 37.75, 41.25 and 45.5 at the four rungs;
 * multiplied by each rung's own scale those are 35.75, 34.73, 35.06 and 35.49 —
 * flat to within 3%, which is what "the column is inversely proportional to the
 * scale" means measured. So `/ scale` is right and **38 was the number that was
 * wrong**, sitting above a measured bound of 34.7 and under-counting 23 of the
 * 432 paragraphs. 34 is one character inside that bound.
 *
 * `ceil(chars / column)` is therefore an upper bound on the wrapped line count
 * rather than a fit, which is the direction that matters: a line breaks on a
 * word and ends short, so a character count that is allowed to run under bounds
 * nothing at all, and that is exactly how this went wrong at 42 (`mtg-4mw`) and
 * again at 38. It costs what an upper bound costs. It over-counts 53 of the 432
 * paragraphs, four faces are set one rung smaller than the browser would let
 * them have, and one 108-character flavor line is refused at an estimated 102px
 * against 83.4px rendered. A column wide enough to keep that line is a column
 * that leaves the set's wordiest face clipped, and the two are 0.3 characters
 * apart: this corpus does not admit a single character count that does both.
 *
 * **A paragraph gap is the sheet's own margin, and there are two of them.**
 * `.mtg-card__line + .mtg-card__line` is 4px and a flavor line is 8px. The old
 * model charged one uniform 0.21 of a line for both, which is 4px, so a flavor
 * block was under-charged by exactly the extra margin it asks for.
 *
 * These are numbers about a layout, so they are checked against the layout, by a
 * browser rather than by another number in this file:
 * `packages/ui/test/card-fit.browser.test.ts` renders all 84 faces at all four rungs
 * and fails when a rules box clips or when this estimate comes in under the
 * height the browser gave it.
 */
const RULES_BOX_LINE_PX: number = 18.85;
const RULES_BOX_BUDGET_PX: number = 87;
const RULES_BOX_COLUMN: number = 34;
const RULES_PARAGRAPH_GAP_PX: number = 4;
const RULES_FLAVOR_GAP_PX: number = 8;

/**
 * How much of the text box's width a loyalty ability's cost badge takes, badge
 * and gutter together, as a share of that width.
 *
 * A planeswalker's row is two columns — the badge, then the ability — and the
 * ability's column is the narrower one by exactly this much. Both renderers
 * read it: `@mtg/card-render` turns it into a per-paragraph inset in user
 * units, `@mtg/ui`'s sheet turns it into a percentage of the flex row, and the
 * fit ladder below charges the narrower column against it. One share rather
 * than three widths, because the printed face is 538 user units across and the
 * DOM face is whatever a viewport gave it, and a badge that is a fixed share of
 * the box is the only description both of those can obey.
 *
 * A share rather than a character count for the same reason the column is
 * inversely proportional to the scale: the badge is a fixed fraction of the box
 * at every rung — it holds three glyphs at most (`−20`) and its silhouette
 * must not change shape when the sentence beside it shrinks — so the *fraction
 * of the box* it occupies is what stays fixed across the ladder, and dividing by
 * the scale afterwards is what turns that fraction back into characters.
 *
 * **0.12, read off the reference rather than guessed.** It was 0.18 for one
 * revision and that was a sixth of the box spent on two glyphs: measured on
 * Ajani Goldmane in `references/planeswalkers.png`, the badge is 9.3% of the
 * text box's width and the gutter after it 2.3%, so a printed walker gives the
 * cost column 11.6% and the sentence the other 88%. Six percent of the column
 * back is a wrapped line back on the flagship's longest ability, which is 12px
 * of a 100px box, so the difference between reading the reference and eyeballing
 * it is a whole line of a card.
 */
export const LOYALTY_BADGE_SHARE: number = 0.12;

/**
 * The part of that share that is empty: the gutter between the badge and the
 * first character of the ability.
 *
 * Split out rather than folded into one number because the two renderers need
 * different halves of it. The badge is drawn `SHARE - GUTTER` wide and the text
 * starts at `SHARE`, so the gutter is the one measurement that keeps a long
 * cost from touching the sentence it pays for on either face.
 */
export const LOYALTY_BADGE_GUTTER: number = 0.028;

/**
 * The margin above a loyalty row, in pixels of rendered height: the rule
 * between two abilities plus the air on both sides of it.
 *
 * A planeswalker's box is divided rather than merely spaced, so a loyalty row
 * costs more than the 4px between two ordinary paragraphs. It is charged to the
 * row *below* the rule, which is where the sheet puts the border, so the first
 * row of a box is never charged for a divider that is not drawn above it.
 */
const RULES_LOYALTY_GAP_PX: number = 9;

/**
 * The block padding on a loyalty cost badge, in pixels — and the reason a
 * loyalty row is taller than the lines inside it.
 *
 * The row is `display: flex` with `align-items: baseline`, and the badge is a
 * flex item that carries this much padding above and below its single line. A
 * baseline-aligned row is as tall as the largest ascent above the shared
 * baseline plus the largest descent below it, so the badge's top padding hangs
 * over the sentence's first line box and the row comes out a pixel taller than
 * the lines it holds. A one-line row pays both edges, because then the badge is
 * the tallest item on both sides of the baseline.
 *
 * `rulesFitCost` charges both edges on every costed row rather than branching on
 * the line count, and that is the direction the whole estimate leans: it is an
 * upper bound on rendered height, so being a pixel over on a two-line row is
 * free and being a pixel under is the defect. It was under by exactly this much
 * per row until `mtg-ypz` — three rows of one walker, three pixels of a hundred,
 * measured in a browser and invisible to every arithmetic test in the suite.
 *
 * Not scaled by the rung. The sheet writes it as a pixel count that does not
 * move with the type, exactly like the two paragraph gaps above, so the estimate
 * must not scale it either.
 *
 * Exported so `@mtg/ui`'s `styles/card.ts` interpolates this number into the
 * badge's own `padding` instead of restating it. Two numbers that must agree, in
 * two packages, is two numbers that will not agree — which is how a pixel of
 * padding went four months without being charged.
 */
export const LOYALTY_BADGE_PAD_PX: number = 1;

/**
 * The same gap as a multiple of the type size, which is the unit the printed
 * face works in.
 *
 * The DOM face states the gap in pixels because the sheet does, and the printed
 * face has no pixels — its rules text is set at whatever size fits a 538-unit
 * box, and every leading it uses is a multiple of that size. Dividing by the
 * 13px `--mtg-text-sm` the pixel figures are quoted against turns one into the
 * other, so `@mtg/card-render` charges the same *relative* gap between two
 * ability rows that the sheet charges, and the divider rule it draws in the
 * middle of that gap has the same air on both sides on paper as on screen.
 *
 * Exported rather than restated in the printed renderer for the reason every
 * other measurement here is: two numbers that must agree, in two packages, is
 * two numbers that will not agree.
 */
const RULES_BOX_TEXT_PX: number = 13;
export const LOYALTY_ROW_GAP_EM: number = RULES_LOYALTY_GAP_PX / RULES_BOX_TEXT_PX;

/**
 * A loyalty row's line box, in pixels of rendered height at scale 1 — tighter
 * than the 18.85px an ordinary paragraph gets, and tighter on purpose.
 *
 * `RULES_BOX_LINE_PX` is `--mtg-text-sm` times `--mtg-leading-normal`, 13 x 1.45,
 * which is web body leading: generous, because a paragraph of body text is read
 * left to right and the eye needs the return sweep. A printed card's rules box
 * is not set that way. Measured off `references/planeswalkers.png`, Ajani
 * Goldmane prints eight lines of rules text in a box that is 28.8% of the card's
 * height, which scaled onto a 341px face is 12.25px a line against a type size
 * that scales to about 10.5px — leading of roughly 1.17.
 *
 * 1.2 is `--mtg-leading-tight`, the token the sheet already has, and the sheet
 * sets it on `.mtg-card__line[data-loyalty]` rather than on the box, so an
 * ordinary card's paragraphs are untouched and a walker's un-costed row — a
 * static ability, or its flavor text — keeps the normal leading it shares with
 * every other card. 13 x 1.2 is the 15.6 below.
 *
 * This is worth 3.25px a line, which over the ten lines the flagship's wordiest
 * walker needs is 32px: a third of the box, found without shrinking one glyph.
 */
const RULES_LOYALTY_LINE_PX: number = 15.6;

/**
 * The ladder a planeswalker's rules box shrinks down, which is the shared one
 * with two more rungs under it.
 *
 * `RULES_FIT_STEPS` stops at 0.78 and says why: 10.1px is under the design
 * system's smallest size and text that keeps shrinking stops being text. That
 * floor is right for a creature and wrong for a planeswalker, and the reason is
 * on the printed cards rather than in a preference. A real walker's rules text
 * is set visibly smaller than a real creature's, because it is three or four
 * abilities in a box the same size — Ajani Goldmane's eight lines scale to about
 * 10.5px on a 341px face, and our own 0.78 rung is 10.14px, so the shared floor
 * is already *at* a printed walker's ordinary size rather than below it. Two
 * rungs further down are 9.1px and 8.06px, which are 2.35mm and 2.08mm at trim:
 * a printed card sets its rules text at about 2.3mm, so the last rung is the
 * first one that is genuinely denser than print, and it exists for the one card
 * in the flagship whose ultimate runs to 170 characters.
 *
 * A second array rather than four more rungs on the shared one, for the reason
 * `NAME_FIT_STEPS` is a second array: extending `RULES_FIT_STEPS` would take
 * every over-budget creature in every set down with it, and the floor those
 * cards are held to is a decision this file has already made. The first four
 * rungs are the same four numbers, so a card's step index means the same size
 * whichever ladder it came off, which is what lets `@mtg/ui`'s sheet emit one
 * run of `data-fit` rules for both.
 */
export const LOYALTY_FIT_STEPS: readonly number[] = [1, 0.92, 0.85, 0.78, 0.7, 0.62];

/**
 * How much room a planeswalker's box has that an ordinary card's does not, and
 * how much of it the loyalty shield takes back.
 *
 * Both are shares of the card's width turned into pixels of the face the budget
 * was measured on, because that is the only unit the rest of this file is in.
 * The window gives `(380 - 300) / 578` of the content column, which is 31px; the
 * shield stands in a band of its own at the foot of the box, and the band is the
 * part of the shield that is not already paid for by the frame the shield hangs
 * into, which is 18px. The box nets 13px and the budget goes from 87 to 100.
 *
 * **The shield's band is a `margin` on the box rather than `padding` inside
 * it**, and that distinction is the whole defect it was written to fix. The box
 * is `overflow-y: clip` and clip cuts at the *padding* box, so a reservation
 * made as padding is room an over-budget card paints straight through: the
 * shield would go on covering the last ability exactly as before, and only a
 * card that already fit would look fixed. A margin moves the clip edge itself,
 * so the band is a region no glyph can reach whatever the card does.
 */
const FRAME_BAND_SHARE = FRAME_BAND_MM / CARD_TRIM_MM.width;
const FULL_FACE_WIDTH_PX = FULL_FACE_WIDTH_REM * 16;
const FULL_FACE_CONTENT_PX = FULL_FACE_WIDTH_PX * (1 - 2 * FRAME_BAND_SHARE);
const LOYALTY_ART_GIFT_PX =
  (FULL_FACE_CONTENT_PX * (ART_WINDOW.height - PLANESWALKER_ART_WINDOW.height)) / ART_WINDOW.width;
const LOYALTY_SHIELD_BAND_PX = FULL_FACE_WIDTH_PX * (LOYALTY_SHIELD_SHARE.height - FRAME_BAND_SHARE);
const RULES_BOX_LOYALTY_BUDGET_PX = RULES_BOX_BUDGET_PX + LOYALTY_ART_GIFT_PX - LOYALTY_SHIELD_BAND_PX;

/**
 * A rules box's ladder and the budget it is measured against, in one value.
 *
 * The two travel together and always have: a step index is meaningless without
 * the array it indexes, and a cost is meaningless without the budget it is
 * compared with. They used to be two module constants because there was one of
 * each; there are two of each now, and passing them as a pair is what stops a
 * planeswalker being measured against a creature's box or a creature being
 * offered a planeswalker's rungs.
 */
interface RulesLadder {
  readonly steps: readonly number[];
  readonly budgetPx: number;
}

const ORDINARY_LADDER: RulesLadder = { steps: RULES_FIT_STEPS, budgetPx: RULES_BOX_BUDGET_PX };
const LOYALTY_LADDER: RulesLadder = { steps: LOYALTY_FIT_STEPS, budgetPx: RULES_BOX_LOYALTY_BUDGET_PX };

/** The ladder a card's rules box is fitted on. */
function cardLadder(card: Card): RulesLadder {
  return isPlaneswalker(card) ? LOYALTY_LADDER : ORDINARY_LADDER;
}

/** The scale at a step, refusing a step the ladder does not have. */
function ladderScale(ladder: RulesLadder, step: number): number {
  const scale = ladder.steps[step];
  if (scale === undefined) throw new Error(`anatomy: no rules fit step ${String(step)}`);
  return scale;
}

/**
 * The scale a card's rules box is set at, at one step of *its* ladder.
 *
 * `@mtg/card-render` caps its measured scan with this rather than indexing
 * `RULES_FIT_STEPS` itself, which it did until a planeswalker had rungs that
 * array does not carry: an index of 5 came back `undefined` and the printed
 * face threw on the one card type this whole lane exists for.
 */
export function rulesFitScale(card: Card, step: number): number {
  return ladderScale(cardLadder(card), step);
}

/** How many rungs a card's ladder has, for a caller enumerating them. */
export function rulesFitSteps(card: Card): readonly number[] {
  return cardLadder(card).steps;
}

/**
 * What a run of text blocks costs at a scale, in pixels of rendered height:
 * every block's wrapped lines, whatever its box is drawn taller than those lines
 * by, plus the margin the sheet puts above each block after the first.
 *
 * It takes blocks rather than strings because all three of those depend on the
 * kind — a flavor block asks for twice the gap, a costed row is set at a tighter
 * leading in a narrower column and stands a badge beside itself — and a caller
 * holding only the text cannot supply that.
 */
function rulesFitCost(blocks: readonly TextBlock[], scale: number): number {
  let height = 0;
  for (const [index, block] of blocks.entries()) {
    const column = blockColumn(block) / scale;
    const lines = Math.max(1, Math.ceil(block.text.length / column));
    height += lines * blockLinePx(block) * scale + blockOverhangPx(block);
    if (index > 0) height += blockGapPx(block);
  }
  return height;
}

/**
 * How much taller than its own lines a block's box is drawn, in pixels — which
 * is nothing for a paragraph and the cost badge's padding for a loyalty row.
 * `LOYALTY_BADGE_PAD_PX` argues both halves.
 */
function blockOverhangPx(block: TextBlock): number {
  return block.loyaltyCost === undefined ? 0 : 2 * LOYALTY_BADGE_PAD_PX;
}

/**
 * The line box of one block at scale 1, in pixels. A loyalty row is set at the
 * printed card's leading and everything else at the sheet's; see
 * `RULES_LOYALTY_LINE_PX`.
 */
function blockLinePx(block: TextBlock): number {
  return block.loyaltyCost === undefined ? RULES_BOX_LINE_PX : RULES_LOYALTY_LINE_PX;
}

/**
 * How many characters of the box one line of a block holds, at scale 1.
 *
 * `RULES_BOX_COLUMN` for every ordinary paragraph, and less for a row whose
 * cost badge is standing in the left of the box: the ability wraps in the
 * column the badge left it, so charging it the whole width would under-count
 * exactly the rows most likely to wrap.
 */
function blockColumn(block: TextBlock): number {
  return block.loyaltyCost === undefined ? RULES_BOX_COLUMN : RULES_BOX_COLUMN * (1 - LOYALTY_BADGE_SHARE);
}

/** The margin the sheet puts above a block, in pixels; see the three constants. */
function blockGapPx(block: TextBlock): number {
  if (block.kind === 'flavor') return RULES_FLAVOR_GAP_PX;
  return block.loyaltyCost === undefined ? RULES_PARAGRAPH_GAP_PX : RULES_LOYALTY_GAP_PX;
}

/**
 * Which step of `RULES_FIT_STEPS` a card's rules box is set at: the first one
 * its text fits, or the floor.
 *
 * **The floor is the answer to "what about a card that needs more".** The last
 * step is 0.78 of `--mtg-text-sm`, which is 10.1px at a 16px root — under the
 * design system's smallest size and deliberately the end of the road, because
 * text that keeps shrinking stops being text. A card that would need to go
 * below it is drawn at the floor and may clip, and the two channels that catch
 * it are the hover zoom (`@mtg/ui`'s `card/ZoomPanel.ts`, which draws the whole face larger
 * and sets its rules box back at step 0) and `faceDetailText`, which carries
 * every printed line into the face's `title`. One card in this checkout reaches
 * it — the flagship's wordiest face, 210 characters in a single paragraph, which
 * a browser wraps onto six lines at every rung above the floor and five at it.
 */
export function rulesFitStepOf(oracleText: string): number {
  if (oracleText.length === 0) return 0;
  return rulesFitStepOfBlocks(
    oracleText.split('\n').map((text) => ({ kind: 'rules', text }) as const),
    ORDINARY_LADDER,
  );
}

/**
 * The same question asked of the text box's blocks rather than of one string,
 * for the callers that already hold them.
 *
 * `rulesFitStepOf` splits its argument on newlines into rules blocks and is
 * otherwise this function, so the two cannot disagree about a card.
 */
function rulesFitStepOfBlocks(blocks: readonly TextBlock[], ladder: RulesLadder): number {
  if (blocks.length === 0) return 0;
  const floor = ladder.steps.length - 1;
  for (let step = 0; step < floor; step += 1) {
    if (rulesFitCost(blocks, ladderScale(ladder, step)) <= ladder.budgetPx) return step;
  }
  return floor;
}

/**
 * The same question asked of a card. Two entry points rather than one because
 * both callers already hold what they need: the DOM face has a card and the
 * printed face has already rendered the oracle text by the time it fits the
 * box, and the split is also what lets the calibration be tested at the
 * character rather than only through whatever text a committed set happens to
 * contain (`packages/ui/test/card-fit.test.ts`).
 *
 * **It reads the text box rather than the oracle string**, which is the one
 * thing that changed when keywords started printing reminder text: a card with
 * trample prints three lines where its oracle string has one word, and a ladder
 * sized on the oracle string would set that box at a size its own contents
 * overflow. `./text-box.ts`'s `rulesBlocks` is what a face actually draws, minus
 * the flavor text — which is deliberate and is the whole of the flavor rule:
 * the step is decided by the rules text, and the flavor block is printed only if
 * it also fits at that step (`textBoxBlocks` below).
 */
export function rulesFitStep(card: Card): number {
  return rulesFitStepOfBlocks(rulesTextBlocks(card), cardLadder(card));
}

/**
 * What a card's rules text costs at one step of the ladder, in pixels of
 * rendered height.
 *
 * The quantity `rulesFitStep` is a function of, published because no simpler
 * measure predicts it, and because it is the estimate the browser gate holds
 * against a real layout. The estimate counts whole wrapped lines and charges a
 * margin per paragraph, so it is not monotone in the character count — two
 * paragraphs of twenty characters cost two lines and one of thirty-five plus one
 * of one costs three, on the same forty characters. It is not monotone in the
 * cost at any *single* step either, because shrinking the type unwraps a long
 * paragraph and does nothing at all for a paragraph that was already one line.
 * So a card is set smaller than another only when it costs more at **every**
 * step, and `packages/ui/test/card-fit.test.ts` states the property that way.
 */
export function rulesBoxCost(card: Card, step: number): number {
  return rulesFitCost(rulesTextBlocks(card), rulesFitScale(card, step));
}

/**
 * A card's rules text as the readable faces print it: with its keywords'
 * reminder text when the box can hold all of it, and bare when it cannot.
 *
 * The all-or-nothing test is made at the *bottom* of the ladder rather than at
 * the step the bare text needs, so a card that can afford its reminders by
 * stepping down one size does. What it refuses is the card no step can hold —
 * nine keywords is six reminders and about nine lines, which
 * `@mtg/card-render`'s stress corpus proved overflows the printed box at its
 * readability floor. Printing some of a card's reminders and not others would be
 * arbitrary; printing none of them is the decision a set designer makes about a
 * card with no room to explain anything.
 */
export function rulesTextBlocks(card: Card): readonly TextBlock[] {
  const ladder = cardLadder(card);
  const reminded = remindedBlocks(card);
  const floor = ladderScale(ladder, ladder.steps.length - 1);
  return rulesFitCost(reminded, floor) <= ladder.budgetPx ? reminded : oracleBlocks(card);
}

/**
 * Everything a full face's text box holds, in order: the rules text, the
 * reminder text its keywords print, and the flavor text when the card has room
 * left for it.
 *
 * The one entry point both renderers call, and the reason it lives here rather
 * than in `./text-box.ts` beside the composition is the ladder: whether the
 * flavor text is printed depends on the size the rules text put the box at, and
 * the ladder and its calibration are this file's. `./text-box.ts` holds the
 * decision and takes the arithmetic as an argument, so there is one copy of each.
 */
export function textBoxBlocks(card: Card): readonly TextBlock[] {
  const ladder = cardLadder(card);
  const blocks = rulesTextBlocks(card);
  const scale = ladderScale(ladder, rulesFitStepOfBlocks(blocks, ladder));
  return composeTextBox(card, blocks, (withFlavor) => rulesFitCost(withFlavor, scale) <= ladder.budgetPx);
}

/**
 * What the box a face actually draws costs at one step, in pixels of rendered
 * height — the rules and reminder blocks, plus the flavor block when the card
 * prints one.
 *
 * `rulesBoxCost` above is the quantity the *ladder* is a function of and stops
 * at the rules text on purpose. This is the quantity a *browser* can be held to:
 * what is in the box on screen is `textBoxBlocks`, so this is the only estimate
 * a measured height is comparable with, and it is the one
 * `packages/ui/test/card-fit.browser.test.ts` measures against.
 */
export function textBoxCost(card: Card, step: number): number {
  return rulesFitCost(textBoxBlocks(card), rulesFitScale(card, step));
}

/**
 * The type line takes one line at every size, and shrinks rather than wrapping.
 *
 * This is the printed face's rule, stated in `@mtg/card-render`'s `regions.ts`:
 * "The title wraps; the type line does not" — a type line is structured, and
 * "Legendary Creature — Ashen" over "Monk" reads as two facts rather than one.
 * The DOM face used to wrap it, and the wrap is what a constant art window turns
 * into a *second* variable: with the window fixed, the rules box takes whatever
 * the type bar leaves, so three of the eighty flagship faces got a 86.7px rules
 * box where the other seventy-seven got 100.9px, and the ladder — which is
 * arithmetic against one box — had no way to know which face it was sizing.
 * One line here is what makes the rules box the same box on every face.
 *
 * 30 characters is the same kind of measurement `RULES_BOX_COLUMN` is: the type
 * bar's inner width over the card serif's *widest* average advance at
 * `--mtg-text-xs`, read off `packages/ui/tools/face-census.ts` in chrome-headless-shell 151.
 * The bar is 173px wide inside its padding and the seal, and the densest line
 * the flagship prints averages 5.77px a character — "Legendary Artifact —
 * Equipment", 30 characters in exactly 173px. The column is that line rather
 * than the set's mean advance of 5.0, because a column is only useful if it is
 * the pessimistic one: at the mean it computes 34 and clips the two longest type
 * lines in the set outright.
 *
 * Below the floor the line is ellipsized rather than wrapped, which is the rule
 * the small faces in `@mtg/ui`'s `styles/card.ts` already applied for the same reason;
 * the whole line stays reachable through `faceDetailText`. No card in this
 * checkout reaches it — the longest flagship type line is 35 characters, which
 * is step 2, and the floor's column is 38.
 */
const TYPE_LINE_COLUMN: number = 30;

export function typeFitStepOf(typeLine: string): number {
  const floor = RULES_FIT_STEPS.length - 1;
  for (let step = 0; step < floor; step += 1) {
    if (typeLine.length <= TYPE_LINE_COLUMN / ladderScale(ORDINARY_LADDER, step)) return step;
  }
  return floor;
}

/** The same question asked of a card, for the same reason `rulesFitStep` is. */
export function typeFitStep(card: Card): number {
  return typeFitStepOf(renderTypeLine(card));
}

/**
 * The name shrinks to fit its bar; it is cut only past the floor.
 *
 * The playtester, 2026-08-13: "need to make sure that titles fit on the card and dont
 * wrap over extra letters". The DOM face used to have one answer for a name too
 * long for its bar — `text-overflow: ellipsis` — which is a cut rather than a
 * fit, and `mtg-acl` reports it from the other end: the flagship's longest name
 * "sets correctly in the printed sheet, so this is the DOM face only". The
 * printed face has always shrunk the title first (`@mtg/card-render`'s
 * `TITLE_SINGLE_LINE_FLOOR`), and this is the DOM face's copy of that rule.
 *
 * **A ladder of its own rather than `RULES_FIT_STEPS`, and the extra step is the
 * whole reason.** A name is one short string set large; a rules box is
 * paragraphs set small, and 0.78 of `--mtg-text-sm` is already 10.1px there. The
 * name starts at the same 13px and can afford one more step down before it
 * reaches the 9px floor that is the smallest type anywhere in `@mtg/ui`'s `styles/`, so
 * the ladder has five rungs where the other has four. Sharing one array would
 * have meant either denying the name its step or giving the rules box a size
 * `RULES_FIT_STEPS`'s own docblock rules out.
 */
export const NAME_FIT_STEPS: readonly number[] = [1, 0.92, 0.85, 0.78, 0.7];

/**
 * How many characters of the card serif fit one line of a full face's title bar
 * at step 0 — the same kind of measurement `RULES_BOX_COLUMN` and
 * `TYPE_LINE_COLUMN` are, and read the same way.
 *
 * `packages/ui/tools/face-census.ts` in chrome-headless-shell 151 over the flagship set plus
 * the five basics. The bar's inner width is not one number, because the cost run
 * shares the row: a land with no cost leaves the name 196px, a one-pip cost 172,
 * a two-pip 155 and a three-pip **137**. 137 is the column, because a column is
 * only useful if it is the pessimistic one — the same argument `TYPE_LINE_COLUMN`
 * makes about taking the densest line rather than the mean advance.
 *
 * The advance is 6.23px a character, read off the widest of the three names that
 * actually overflowed their bar (30 characters in 187px of content), and
 * 137 / 6.23 is the 22 below. The pip run is deliberately *not* scaled by the
 * ladder — `TITLE_PIP_TO_TEXT` sizes it from `--mtg-text-sm` directly and the
 * parity suite pins that — so the bar a shrunken name is measured against is the
 * same bar, and the arithmetic stays linear in the scale.
 */
const NAME_COLUMN: number = 22;

/** The scale at a step of the name ladder, refusing a step it does not have. */
export function nameFitScale(step: number): number {
  const scale = NAME_FIT_STEPS[step];
  if (scale === undefined) throw new Error(`anatomy: no name fit step ${String(step)}`);
  return scale;
}

/**
 * Which step of `NAME_FIT_STEPS` a card's name is set at: the first one it fits
 * one line at, or the floor.
 *
 * **What the floor does not reach, stated rather than glossed.** The floor is
 * 0.7, so its column is 31 characters, and `@mtg/setgen`'s
 * `CARD_NAME_MAX_LENGTH` is 40 — a name between 32 and 40 characters is a name
 * the generator may emit and this ladder cannot fit on one line of the narrowest
 * bar. It is ellipsized there, which is the rule `TYPE_LINE_COLUMN` already
 * states for the type line and for the same reason: the alternative is a scale
 * of 0.55, which is 7.2px, and text that keeps shrinking stops being text. The
 * whole name is still reachable — `faceDetailText` carries it into every face's
 * `title` and `faceAccessibleName` into its `aria-label` — and `@mtg/card-render`
 * wraps such a name onto a second line rather than cutting it, because print
 * measures where this arithmetic estimates.
 *
 * The flagship set has exactly one name past the floor,
 * 48 characters against a 40-character limit, and that name is `mtg-acl`'s own
 * subject rather than this ladder's: the bead is open on whether the fixture, the
 * limit or the brief is the thing that gives.
 */
export function nameFitStepOf(name: string): number {
  const floor = NAME_FIT_STEPS.length - 1;
  for (let step = 0; step < floor; step += 1) {
    if (name.length <= NAME_COLUMN / nameFitScale(step)) return step;
  }
  return floor;
}

/** The same question asked of a card, for the same reason `rulesFitStep` is. */
export function nameFitStep(card: Card): number {
  return nameFitStepOf(card.name);
}
