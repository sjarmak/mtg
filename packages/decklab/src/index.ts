/**
 * `@mtg/decklab` — stated criteria into an explained deck, built from the real
 * 38,623-card store.
 *
 * The package is one worked example of the project's ZFC line. Code owns the
 * facts: what is legal in a format, what a color identity contains, what a
 * card costs in mana and in dollars, how a land slot splits into basics of each
 * color, and how often a color arrives on curve. The model owns the
 * judgments: which cards serve an archetype, what supports a theme, what
 * belongs in a power band, and how large that land slot should be in the first
 * place. Neither side is asked to do the other's work.
 *
 * ```ts
 * const { report } = await buildInformedDeck({
 *   store: openStore('data/store/mtg.sqlite', { readonly: true }),
 *   provider: resolveProvider(),
 *   criteria: {
 *     prompt: 'aggressive red burn under $50',
 *     format: 'modern',
 *     colors: ['R'],
 *     archetype: 'aggro',
 *     budget: { maxDeckUsd: 50 },
 *   },
 * });
 * ```
 */

export { DECK_ARTIFACT_VERSION, toDeckArtifact } from './artifact';
export type {
  DeckArt,
  DeckArtifact,
  DeckArtifactCheck,
  DeckArtifactColor,
  DeckArtifactEntry,
  DeckArtifactManaBase,
} from './artifact';

export { auditDeck } from './audit';
export type { DeckAudit, DeckEntry, Violation, ViolationKind } from './audit';

export { assembleDeck, CASTABILITY_TARGET, HEAVY_CASTABILITY_TARGET, resolveDeckColors } from './assemble';

export { BaselineDeckSchema, buildBaselineDeck } from './baseline';
export type { BaselineDeck, BaselineEntry, BaselineResult } from './baseline';

export { formatEvalReport, runEval } from './eval';
export type { EvalResult, EvalSummary, RunEvalInput, Scenario, ScenarioOutcome, TraceSummary } from './eval';

export {
  ConstructedGameplayComparisonSchema,
  parseConstructedGameplayComparison,
  serializedConstructedGameplayComparison,
  summarizeConstructedGameplayComparison,
} from './constructed-evaluation';
export type { ConstructedCandidateSummary, ConstructedGameplayComparison } from './constructed-evaluation';

export { compareConstructedPromotion } from './constructed-promotion';
export type { ConstructedTrialGameOptions } from './constructed-runtime';
export { constructedDeckList, constructedPoolSha256, runConstructedTrialGames } from './constructed-runtime';

export {
  CONSTRUCTED_FORMAT_CONTRACT,
  constructedFormatContract,
  constructedSelectionPolicy,
  DECKLAB_MODEL_REPAIR_SELECTION_POLICY,
  DECKLAB_VERIFIED_PARTIAL_FALLBACK_POLICY,
} from './constructed-policy';
export type {
  ConstructedFormatContract,
  ConstructedPoolSource,
  ConstructedSelectionPolicy,
} from './constructed-policy';

export { traceCriteria } from './trace';
export type { CriterionTrace, TraceFinding, TraceFindingKind } from './trace';

export { judgeBlind, VerdictSchema } from './judge';
export type { Blinding, JudgeInput, JudgeResult, Side, Verdict } from './judge';

export { DEFAULT_SCENARIOS } from './scenarios';
export type {
  AssembledDeck,
  CastabilityCheck,
  ConstructedColorSourceReport,
  ConstructedCurveReport,
  ConstructedManaBase,
} from './assemble';

export { buildInformedDeck, EmptyUniverseError } from './build';
export type { BuildDeckInput, BuiltDeck } from './build';

export { DeckbuildingEvidenceError } from './deck-evidence';
export type { DeckbuildingEvidenceRequest } from './deck-evidence';

export {
  candidateFromDslCard,
  ConflictingReprintError,
  DuplicateSetCardError,
  DuplicateSetCardIdError,
  FormatlessStoreBuildError,
  FormatOverSetPoolError,
  setDeckPool,
  SetsOverStorePoolError,
  storeDeckPool,
  UnpricedPoolError,
} from './pool';
export type { DeckPool, PoolSet, PrintedFormatPool, SetPool, StorePool } from './pool';

export { printedFormatDeckPool, toPrintedConstructedDeck } from './printed-format-pool';
export type { PrintedPoolCatalog } from './printed-format-pool';

export {
  isCreatureCard,
  isLandCard,
  loadKnownNames,
  normalizeName,
  outsideColorsGlob,
  selectUniverse,
} from './candidates';
export type { CandidateCard, CandidateUniverse } from './candidates';

// `ColorSchema` is not here either: this package's is `z.enum(COLORS)` over
// `@mtg/dsl`'s own `COLORS`, which is what `@mtg/dsl` already exports under that
// exact name. Two barrels spelling one schema is the collision
// `packages/slice/test/package-surfaces.test.ts` gates; `@mtg/cube` shows the
// other way out of it and calls its own `CubeColorSchema`.
export {
  BudgetSchema,
  criterionIds,
  DECK_FORMATS,
  DECK_SIZES,
  DeckCriteriaSchema,
  enumerateCriteria,
  OpponentPopulationSchema,
} from './criteria';
// `ResolvedCriteria` is a class, and it is exported here as a type on purpose:
// under `export type` a caller can name one and hold one, and `new` is not on
// the surface at all. Its `#private` fields are what refuse `{ ...criteria,
// size: 100 }` as well as `{ ...criteria, landCount: 24 }` (mtg-bc2.93).
export type {
  Budget,
  Criterion,
  CriterionKind,
  DeckCriteria,
  DeckCriteriaInput,
  DeckFormat,
  OpponentPopulation,
  ResolvedCriteria,
} from './criteria';

// `resolveCriteria` is not here on purpose: it is the mint, and a public mint is
// a public way to attach any count in the band to any criteria. See land-plan.ts.
//
// Nor are `planLandCount`, `landPlanSchema` and `describeLandCount`. They are the
// stages of one internal pipeline `buildInformedDeck` already runs end to end, and
// nothing outside this package has ever called them (mtg-bc2.94). The two names
// below stay because the barrel's own exports spell them: `BuiltDeck.landPlan` is
// a `LandPlan`, and `DeckArtifact.landPlan.source` is a `LandCountSource`, so a
// caller that receives either needs the name to write the type down.
export type { LandCountSource, LandPlan } from './land-plan';

export { parseManaCost, pipDemand, requiredColors } from './mana-cost';
export type { HybridPip, ParsedManaCost } from './mana-cost';

export { formatConstructedDeckReport } from './report';
export type { DeckReportInput } from './report';

export {
  DEFAULT_MAX_ROUNDS,
  DeckProposalSchema,
  defaultMaxSpendUsd,
  ROUND_COST_USD,
  roundsCeiling,
  selectCards,
} from './select';
export type { DeckProposal, SelectionOptions, SelectionResult, SelectionStop } from './select';

export {
  cardCount,
  copyLimit,
  deckPrice,
  enforceDeckBudget,
  statedCopyLimit,
  verifyProposals,
} from './verify';
export type {
  Adjustment,
  AdjustmentCode,
  Inclusion,
  Proposal,
  Rejection,
  RejectionCode,
  UniverseLookup,
  VerifyResult,
} from './verify';
