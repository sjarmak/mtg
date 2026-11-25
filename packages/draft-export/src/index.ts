/**
 * `@mtg/draft-export` — draft loops and the DSL -> Draftmancer export.
 *
 * Draftmancer (MIT) is the lab's draft surface, adopted rather than built:
 * `docs/research/prior-art-tooling.md` §1.1 records why, and it is the only
 * open format found that describes custom cards *and* booster collation. This
 * package is the offline compile target for it — it writes a file, and nothing
 * here clones, installs, configures or talks to Draftmancer itself.
 * `physical-cube-draft.ts` is the representation-neutral sibling: it deals a
 * singleton population once by physical id and needs neither DSL cards nor
 * rarity sheets.
 *
 * Draftmancer receives only the static rating each custom card carries, because
 * no external bot service handles cards without oracle ids; ADR-0003 settles
 * that scale. Native drafts instead use the separately versioned, pool-aware
 * policy exported below.
 */

export {
  communityPickOrderRating,
  evaluatorRating,
  mapSeventeenLandsWinRates,
  playDataRating,
  RATING_MAX,
  RATING_MIN,
  RATING_RANGE_IN_COLOR_CARDS,
  rateCards,
  ratingValueOf,
  resolveCardRating,
  seventeenLandsRating,
  SIMPLE_BOT_COLOR_BONUS,
} from './rating';
export type {
  CardRating,
  CommunityPickOrderRating,
  EvaluatorRating,
  PlayDataRating,
  RatedCard,
  RatingSource,
  SeventeenLandsCardWinRate,
  SeventeenLandsRating,
} from './rating';

export { toCustomCard, toCustomCards } from './custom-cards';
export type { DraftmancerCustomCard } from './custom-cards';

export {
  buildLayouts,
  buildSheets,
  collationReport,
  DEFAULT_LAYOUT_NAME,
  formatCollationReport,
  sheetName,
} from './collation';
export type {
  CollationReport,
  DraftmancerLayout,
  DraftmancerLayouts,
  DraftmancerSheet,
  ShortSlot,
} from './collation';

export { DraftExportError, exportDraftmancerSet } from './emit';
export type { DraftExportOptions, DraftmancerExport } from './emit';

export { DraftError } from './errors';

export { countPickedColors, simpleBotPick, simpleBotScore, simpleBotScores } from './simple-bot';
export type { ColorCounts } from './simple-bot';

export { openPack, openPackFromLayouts } from './packs';

export { printedCards, printedLayouts, printedSheets, printingNotes } from './printing';
export type { PrintedSheet } from './printing';

export { collationPackSource, layoutPackSource } from './pack-source';
export type { PackSource } from './pack-source';

export {
  DEFAULT_DRAFT_SEED,
  DEFAULT_PACKS_PER_SEAT,
  DEFAULT_SEATS,
  passDirection,
  runDraft,
  runHumanDraft,
  runSeatedDraft,
} from './draft';

export { completedDraftEvidence, draftDecisionEvidence, draftEvidenceIdentity } from './draft-evidence';
export type {
  CompletedDraftOutcome,
  DraftDecisionEvidence,
  DraftEvidenceRequest,
  DraftPickObservation,
} from './draft-evidence';
export {
  LimitedConstructionEvidenceError,
  limitedSelectionEvidenceConfig,
  suggestLimitedDeckWithEvidence,
} from './limited-construction-evidence';
export type {
  LimitedConstructionEvidenceRequest,
  LimitedConstructionEvidenceResult,
} from './limited-construction-evidence';
export type {
  DraftOptions,
  DraftPick,
  DraftResult,
  DraftSeat,
  HumanDraftChoice,
  HumanDraftOptions,
  HumanDraftProgress,
  PassDirection,
  SeatedDraftChoice,
  SeatedDraftOptions,
  SeatedDraftProgress,
} from './draft';

export {
  PHYSICAL_CUBE_DEFAULT_PACK_SIZE,
  PHYSICAL_CUBE_DEFAULT_ROUNDS,
  PHYSICAL_CUBE_DEFAULT_SEATS,
  PHYSICAL_CUBE_DEFAULT_SEED,
  runPhysicalCubeDraft,
  runPhysicalPackDraft,
} from './physical-cube-draft';
export type {
  PhysicalCubeCard,
  PhysicalCubeChoose,
  PhysicalCubeChooseInput,
  PhysicalCubeDraftChoice,
  PhysicalCubeDraftOptions,
  PhysicalCubeDraftPick,
  PhysicalCubeDraftProgress,
  PhysicalCubeDraftResult,
  PhysicalCubeDraftSeat,
  PhysicalCubePack,
  PhysicalCubeScore,
  PhysicalCubeScoreInput,
  PhysicalPackDraftOptions,
} from './physical-cube-draft';

export { draftedPool, draftedPools } from './pool';
export {
  DEFAULT_NATIVE_DRAFT_BOT_POLICY,
  DRAFTMANCER_SIMPLE_BOT_POLICY,
  NATIVE_DECK_CONDITIONED_BOT_POLICY,
  nativeDraftPick,
  nativeDraftScores,
} from './native-draft-bot';
export type { NativeDraftBotPolicy, NativeDraftScoreOptions } from './native-draft-bot';
export {
  preparePrintedLimitedFormat,
  runPrintedLimitedDraft,
  resumePrintedLimitedDraft,
} from './printed-limited';
export type {
  PreparedPrintedLimitedFormat,
  PrintedBoosterCopy,
  PrintedBoosterPayload,
  PrintedLimitedDraftOptions,
  PrintedTextDigest,
} from './printed-limited';

export { evaluateDraft } from './advisor/evaluate';
export type { DraftAdvice, Recommendation } from './advisor/evaluate';
export type { AdvisorCard, ObservedDraft } from './advisor/state';
export { readDraftMemory } from './advisor/state';
export type { AdvisorModel, Reason } from './advisor/evidence';
export { reasonsForPath } from './advisor/evidence';
export type { CardAssessment } from './advisor/cards';
export type { ArchetypeAssessment } from './advisor/pool';
export { LEGACY_CUBE_ADVISOR_MODEL } from './advisor/legacy';
export { validateAdvisorMetadata } from './advisor/validate';
export { DEFAULT_ADVISOR_WEIGHTS, parseAdvisorWeights } from './advisor/weights';
export type { AdvisorWeights } from './advisor/weights';
export { advisorModelIdentityText, readAdvisorCalibration } from './advisor/calibration';
export type { AdvisorCalibration } from './advisor/calibration';

export { planLimitedPool } from './limited-evaluation/deck';
export { allocateMana as allocateLimitedMana } from './limited-evaluation/mana';
export type { EvaluationCard, CardProfile } from './limited-evaluation/model';
export {
  evaluatePrintedCard,
  hasPrintedEvaluation,
  printedPickValue,
  printedSourceFingerprint,
  PRINTED_EVALUATION_POLICY,
} from './limited-evaluation/printed';
export {
  PrintedCardRolesSchema,
  printedCardRolesOf,
  printedRolesPolicy,
  validatePrintedCardRoles,
  withPrintedCardRoles,
} from './limited-evaluation/printed-roles';
export type { PrintedCardRoles } from './limited-evaluation/printed-roles';
export { CARD_ROLES } from './limited-evaluation/model';
export type { CardRole } from './limited-evaluation/model';
export {
  evaluateStructuralPrintedCard,
  planStructuralPrintedPool,
  structuralPrintedFacts,
  structuralPrintedPickValue,
  structuralPrintedScore,
  STRUCTURAL_PRINTED_EVALUATION_POLICY,
} from './limited-evaluation/structural-printed';
