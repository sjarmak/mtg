/**
 * The card face's measurements and its fit ladders, hosted where nothing draws.
 *
 * `./anatomy.ts` argues why this is a package rather than a module of
 * `@mtg/ui` or of `@mtg/card-render`. The floor is `@mtg/dsl` and stays there.
 *
 * ## Which of the two packages a new constant goes in (mtg-tniy)
 *
 * `@mtg/render-spec` is the neighbor this gets confused with: it was created
 * one bead later for the same renderer pair, it depends on this package, and it
 * hands on most of the names below so a caller does not have to know which of
 * the two declares what. The line between them is the question the constant
 * answers.
 *
 *  - **A question about a rectangle is answered here.** How wide the trim is,
 *    where the art window sits, which rung of a ladder a string is set at.
 *    Every answer can be checked with a ruler, and something that will never
 *    draw anything can still need it.
 *  - **A question about a face is answered in `@mtg/render-spec`.** Which ink a
 *    rare seal is painted in, which glyph `{T}` is, which regions a compact
 *    face lays out, how long a flip takes. Every answer is a decision somebody
 *    could disagree with on taste, and none of them means anything without a
 *    drawing.
 *
 * That is a rule about consumers rather than about tidiness. `@mtg/setgen` asks
 * a fit ladder whether a card has room left for flavor text and `@mtg/dsl-coverage`
 * asks the oracle chunker what a reminder-text row looks like; both declare this
 * package and not `@mtg/render-spec`, and the last test in
 * `../test/geometry.test.ts` fails on the day that stops being true.
 */
export {
  ART_WINDOW,
  CARD_EDGE_MM,
  CARD_TRIM_MM,
  COMPACT_FACE_WIDTH_REM,
  FRAME_BAND_MM,
  FULL_FACE_WIDTH_REM,
  READING_FACE_WIDTH_REM,
  RULES_TEXT_REM,
  RULES_TEXT_SHARE,
  ZOOM_RULES_CHARACTER_CAPACITY,
  faceTextScale,
  textBoxCostAtWidth,
  LOYALTY_BADGE_GUTTER,
  LOYALTY_BADGE_PAD_PX,
  LOYALTY_BADGE_SHARE,
  LOYALTY_FIT_STEPS,
  LOYALTY_ROW_GAP_EM,
  LAND_ART_WINDOW,
  LOYALTY_SHIELD_FLAT,
  LOYALTY_SHIELD_SHARE,
  NAME_FIT_STEPS,
  PLANESWALKER_ART_WINDOW,
  PRINTED_RULES_FIT_STEPS,
  RULES_FIT_STEPS,
  TITLE_PIP_TO_TEXT,
  artWindow,
  nameFitScale,
  nameFitStep,
  nameFitStepOf,
  rulesBoxCost,
  rulesFitScale,
  printedRulesFitStepOf,
  printedRulesTextBlocks,
  rulesFitStep,
  rulesFitStepOf,
  rulesFitSteps,
  rulesTextBlocks,
  textBoxBlocks,
  textBoxCost,
  typeFitStep,
  typeFitStepOf,
  usesLargeLandArt,
  zoomRulesCharacterCapacity,
} from './anatomy';
export { composeTextBox, lineRuns, oracleBlocks, remindedBlocks } from './text-box';
export type { BoxFits, LineRuns, TextBlock } from './text-box';
