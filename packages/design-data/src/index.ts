/**
 * `@mtg/design-data` — published set-design canon as versioned, cited data.
 *
 * Two data files, both loaded and validated from JSON at import time:
 *
 * - `data/skeleton-play-booster-2024.json` — the play-booster set skeleton
 *   (set sizes, per-color curves, creature shares, keyword budgets, spell
 *   slots, archetype mixes, as-fan targets), every number carrying the article
 *   URL and the line it was read from.
 * - `data/color-pie-2021.json` — the mechanical color pie restricted to the
 *   pinned slice vocabulary: an (effect|keyword, color) -> level lookup.
 *
 * Nothing here decides anything about a specific card. It answers "what does
 * published design canon say", and `classify` turns that into a pass/warn/fail
 * gate the generator and validators can assert on.
 */

export { apportionPair, midpoint, roundHalfUp, seatFromTop } from './apportion';

export {
  CITATION_CONFIDENCES,
  CitationConfidenceSchema,
  CitationSchema,
  CitedDocumentHeaderSchema,
  citationForPath,
  coversPath,
  danglingCitationKeys,
  ISO_DATE_PATTERN,
  IsoDateSchema,
  numericPaths,
  resolvePath,
  SOURCE_KINDS,
  SourceKindSchema,
  SourceSchema,
  uncitedNumericPaths,
  unknownCitationSources,
} from './citations';
export type { Citation, CitationConfidence, Source, SourceKind } from './citations';

export { CanonDataError, loadCanon } from './load';

export {
  ColorlessProfileSchema,
  ColorProfileSchema,
  CommonColorProfileSchema,
  CreatureShareSchema,
  CurveBucketSchema,
  isSkeletonKeyword,
  KeywordBudgetSchema,
  SKELETON_KEYWORDS,
  SKELETON_ONLY_KEYWORDS,
  SkeletonDataSchema,
  SkeletonProfileDocumentSchema,
  UncommonColorProfileSchema,
} from './skeleton-schema';
export type {
  ColorlessProfile,
  ColorProfile,
  CommonColorProfile,
  CurveBucket,
  SkeletonData,
  SkeletonKeyword,
  SkeletonProfileDocument,
  UncommonColorProfile,
} from './skeleton-schema';

export {
  asFan,
  auditSkeletonCitations,
  commonSlotsForColor,
  derivedCommonCreatureShare,
  derivedUncommonCreatureShare,
  pinnedKeywordBudget,
  PLAY_BOOSTER_2024,
  rareMythicShares,
  skeletonCitation,
  skeletonData,
  skeletonSource,
  totalCommonSlots,
  uncommonSlotsForColor,
  unpinnedKeywordNames,
} from './skeleton';
export type { CitationAudit, KeywordBudgetEntry } from './skeleton';

export {
  allGroupPlans,
  atLeastRarity,
  cycleRoles,
  DEFAULT_SLICE_TARGET_SIZE,
  deriveSkeletonLite,
  MAX_SLICE_TARGET_SIZE,
  MIN_SLICE_TARGET_SIZE,
  RARITY_ORDER,
  rarityRank,
  SKELETON_LITE,
  SLICE_PROFILE_VERSION,
  SLICE_RARITIES,
  totalSliceCards,
  totalSliceCreatures,
  totalSliceSpells,
} from './skeleton-lite';
export type {
  SkeletonLiteOptions,
  SkeletonLiteProfile,
  SliceGroupPlan,
  SliceKeywordBudget,
  SliceRarity,
  SliceRarityPlans,
  SliceRarityRules,
} from './skeleton-lite';

export {
  COLOR_PIE_SUBJECTS,
  ColorPieDocumentSchema,
  ColorPieRowSchema,
  ColorPieSubjectSchema,
  isColorPieSubject,
  PIE_LEVEL_VERDICT,
  PIE_LEVELS,
  PIE_VERDICTS,
  PieLevelSchema,
  subjectKindOf,
  SUBJECT_KINDS,
} from './color-pie-schema';
export type {
  ColorPieDocument,
  ColorPieRow,
  ColorPieSubject,
  ColorPieSubjectKind,
  PieLevel,
  PieVerdict,
} from './color-pie-schema';

export {
  bestVerdict,
  classify,
  classifyForColors,
  COLOR_PIE_2021,
  colorPieCitations,
  colorPieRow,
  colorsAtLevel,
  inferredSubjects,
  levelFor,
  missingCoverage,
  subjectsForColor,
  verdictForLevel,
} from './color-pie';
export type { ColorPieClassification } from './color-pie';
