/**
 * `@mtg/setgen` — desired mechanics in, an enforceable mini-set out.
 *
 * The pipeline in five steps, three of which are model-free:
 *
 * 1. `allocateSlots` turns the skeleton-lite profile and a brief into concrete
 *    slots. Deterministic: same seed, same slots, forever.
 * 2. `fillSlots` asks the model for a card per slot, emitted directly in the DSL
 *    schema. No free text is generated, so no free text has to be parsed.
 * 3. `validateGeneratedSet` runs the DSL's structural validators plus the
 *    set-level gates (skeleton conformance, color pie, New World Order budget,
 *    duplication, mechanic coverage). Failures name the slots they blame.
 * 4. `critiqueSet` is the one semantic pass: cohesion, archetype support,
 *    flavor, power outliers, driving targeted revisions.
 * 5. `generateSet` runs all of it with bounded retries and returns the set plus
 *    a report of what it cost and what it had to fix.
 */

export {
  ColorSignatureSchema,
  DesiredMechanicSchema,
  parseBrief,
  RequiredCardSchema,
  RequiredPoolSchema,
  SetBriefSchema,
  tertiaryBudgetFor,
  TierSpellRolesSchema,
} from './brief';
export type {
  ColorSignature,
  DesiredMechanic,
  RequiredCard,
  RequiredCardInput,
  RequiredPool,
  SetBrief,
  SetBriefInput,
  TierSpellRoles,
} from './brief';

export { pinRequiredCards, UnplaceableRequiredCardsError } from './required';
export type { RequiredReservation } from './required';

export { reserveRequiredCards } from './required-demand';
export type { RequiredCardReservation } from './required-demand';

export { applyStatedSpellRoles } from './stated-roles';
export type { StatedRoleApplication } from './stated-roles';

export { addToCurve, dropFromCurve, rescaleKeywords } from './plan';
export type { CurveChange } from './plan';

export { createRng, hashSeed, shuffle } from './rng';
export type { Rng } from './rng';

export {
  allowedEffectKinds,
  ARTIFACT_ROLES,
  colorlessEffectKinds,
  isPlaneswalkerRole,
  isSpellPermanentRole,
  isSpellRole,
  isZoneReachingRole,
  roleAbilityKinds,
  roleAuraModifications,
  ROLE_PROFILES,
  roleProfile,
  SPELL_ROLE_NAMES,
  substitutionNotes,
  UnknownRoleError,
} from './roles';
export type { ManaValueRange, RoleProfile } from './roles';

export {
  describeSlot,
  groupKey,
  isCreatureSlot,
  isSpellSlot,
  poolLetter,
  printsNoText,
  slotById,
  slotGroupKey,
  slotId,
} from './slot';
export type { Slot } from './slot';

export { hasRarityInstruction, rarityPolicy } from './rarity';
export type { RarityPolicy } from './rarity';

export * from './archetype/index';

export {
  BOMB_COLORLESS_PERMANENT_MV,
  COLORLESS_PERMANENT_CENSUS,
  COLORLESS_PERMANENT_MV,
  colorlessPermanentWindow,
  SPELL_CURVE,
  SPELL_CURVE_WEIGHTS,
  spellCurve,
} from './curve';

export { allocateSlots } from './allocate';
export type { Allocation } from './allocate';

export { checkAuthoredCards, printAuthoredCards } from './authored';
export { derivePins } from './pins';
export type { PinDerivation } from './pins';

export {
  batchWantsAbilities,
  batchWantsEquip,
  batchWantsMechanics,
  batchWantsSpellPermanents,
  batchWantsZoneReach,
  CARD_NAME_MAX_LENGTH,
  FillBatchSchema,
  FillBatchWithAbilitiesAndSpellPermanentsAndZoneReachSchema,
  FillBatchWithAbilitiesAndSpellPermanentsSchema,
  FillBatchWithAbilitiesAndZoneReachSchema,
  FillBatchWithAbilitiesSchema,
  FillBatchWithEquipAndMechanicsSchema,
  FillBatchWithEquipSchema,
  FillBatchWithMechanicsAndSpellPermanentsAndZoneReachSchema,
  FillBatchWithMechanicsAndSpellPermanentsSchema,
  FillBatchWithMechanicsAndZoneReachSchema,
  FillBatchWithMechanicsSchema,
  FillBatchWithSpellPermanentsAndZoneReachSchema,
  FillBatchWithSpellPermanentsSchema,
  FillBatchWithZoneReachSchema,
  filledAbilities,
  FilledArtifactSchema,
  FilledArtifactWithAbilitiesSchema,
  FilledArtifactWithEquipAndMechanicsSchema,
  FilledArtifactWithEquipSchema,
  FilledArtifactWithMechanicsSchema,
  FilledAuraSchema,
  FilledCardSchema,
  FilledCardWithAbilitiesAndSpellPermanentsAndZoneReachSchema,
  FilledCardWithAbilitiesAndSpellPermanentsSchema,
  FilledCardWithAbilitiesAndZoneReachSchema,
  FilledCardWithAbilitiesSchema,
  FilledCardWithEquipAndMechanicsSchema,
  FilledCardWithEquipSchema,
  FilledCardWithMechanicsAndSpellPermanentsAndZoneReachSchema,
  FilledCardWithMechanicsAndSpellPermanentsSchema,
  FilledCardWithMechanicsAndZoneReachSchema,
  FilledCardWithMechanicsSchema,
  FilledCardWithSpellPermanentsAndZoneReachSchema,
  FilledCardWithSpellPermanentsSchema,
  FilledCardWithZoneReachSchema,
  FilledCreatureSchema,
  FilledCreatureWithAbilitiesSchema,
  FilledCreatureWithMechanicsSchema,
  FilledEnchantmentWithAbilitiesSchema,
  FilledEnchantmentWithMechanicsSchema,
  FilledInstantSchema,
  FilledInstantWithZoneReachSchema,
  FilledPlaneswalkerSchema,
  FilledSorcerySchema,
  FilledSorceryWithZoneReachSchema,
  fillSchemaFor,
  LOYALTY_ABILITY_LIMITS,
  STARTING_LOYALTY_LIMITS,
} from './filled';
export type { FillBatch, FilledCard, FilledCardInput } from './filled';

export { assembleCard, cardIdFor, slugify } from './assemble';
export type { AssemblyResult } from './assemble';

export {
  BOMB_STAT_BONUS_LIMIT,
  buildCritiquePrompt,
  buildFillPrompt,
  CRITIQUE_SYSTEM,
  EFFECT_RANGES,
  FILL_SYSTEM,
  STAT_BONUS_LIMIT,
} from './prompts';
export type { CritiquePromptInput, FillPromptInput } from './prompts';

export { batchSlots, chunk, DEFAULT_BATCH_SIZE, DEFAULT_FILL_MAX_TOKENS, fillSlots } from './fill';
export type { CallRecord, FillOutcome, FillRequest } from './fill';

export {
  CRITIQUE_BASE_SIZE,
  CRITIQUE_CATEGORIES,
  critiqueBudget,
  critiqueSchemaFor,
  critiqueSet,
  CritiqueRevisionSchema,
  CritiqueSchema,
  DEFAULT_CRITIQUE_MAX_TOKENS,
  revisionInstructions,
  triageRevisions,
} from './critique';
export type {
  Critique,
  CritiqueBudget,
  CritiqueOutcome,
  CritiqueRequest,
  CritiqueRevision,
  DroppedRevision,
  RevisionTriage,
} from './critique';
export {
  applyFlavor,
  cardsWithRoom,
  DEFAULT_FLAVOR_MAX_TOKENS,
  FLAVOR_BATCH_SIZE,
  FLAVOR_ROOM_SHARE,
  FlavorSchema,
  flavorRoom,
  writeFlavor,
} from './flavor';
export type { FlavorLine, FlavorOutcome, FlavorRequest } from './flavor';

export * from './validate/index';

export { createResumableRecorder, createResumableRecorderTransport } from './record';
export type { RecorderEvent, RecorderOptions, ResumableRecorderOptions } from './record';

export { DEFAULT_MAX_RETRY_ROUNDS, generateSet, UnfillableSlotsError } from './generate';
export type { GenerateOptions, GenerationResult } from './generate';

export {
  censusTriggerConditions,
  critiqueFindings,
  formatReport,
  slotsNeedingRetry,
  summariseArchetypes,
  totalUsage,
} from './report';
export type {
  ArchetypeSummary,
  CritiqueRecord,
  GenerationReport,
  RetryRound,
  RevisionOutcome,
  RevisionRecord,
  UsageTotals,
} from './report';

export {
  buildSetFile,
  parseSetFile,
  serializeReport,
  serializeSetCards,
  SET_FILE_VERSION,
  SetFileSchema,
  writeSetOutput,
} from './emit';
export type { EmittedPaths, SetFile } from './emit';

export { calibrationDecisions, evaluateSetCalibration } from './calibration';
export type {
  CalibrationBand,
  CalibrationDecisions,
  CalibrationMetricEvaluation,
  CalibrationMetricStatus,
  CalibrationProfileIdentity,
  SetCalibrationEvaluation,
} from './calibration';
