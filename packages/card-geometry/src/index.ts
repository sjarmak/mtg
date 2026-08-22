/**
 * The card face's measurements and its fit ladders, hosted where nothing draws.
 *
 * `./anatomy.ts` argues why this is a package rather than a module of
 * `@mtg/ui` or of `@mtg/card-render`. The floor is `@mtg/dsl` and stays there.
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
  LOYALTY_ROW_GAP_EM,
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
} from './anatomy';
export { composeTextBox, lineRuns, oracleBlocks, remindedBlocks } from './text-box';
export type { BoxFits, LineRuns, TextBlock } from './text-box';
