/**
 * `@mtg/dsl` — the typed mechanics DSL.
 *
 * This package is the lab's load-bearing contract: the set generator emits
 * cards in these types, and the kernel enforces exactly what these types can
 * express. Every other package consumes this module.
 */

export {
  ABILITY_KINDS,
  AbilityKindSchema,
  assertNever,
  BASIC_LAND_COLOR,
  BASIC_LAND_FOR_COLOR,
  BASIC_LAND_TYPES,
  BasicLandTypeSchema,
  CARD_ID_PATTERN,
  CARD_KINDS,
  CardKindSchema,
  COLOR_CAST_TRIGGER_CONDITIONS,
  COLOR_ORDER,
  COLOR_WORDS,
  COLORS,
  ColorSchema,
  ALL_EFFECT_KINDS,
  EFFECT_KINDS,
  EFFECT_SCOPE_SUBJECT,
  EFFECT_SCOPES,
  EffectKindSchema,
  EffectScopeSchema,
  isSpaceScope,
  FLAVOR_TEXT_FORBIDDEN,
  FLAVOR_TEXT_MAX_LENGTH,
  GRANTABLE_KEYWORD_ABILITY_KINDS,
  GRANTABLE_KEYWORD_PRINT_NAMES,
  GRANTABLE_KEYWORDS,
  GrantableKeywordSchema,
  isGrantableKeywordAbilityKind,
  KEYWORD_ABILITY_KINDS,
  KEYWORD_PRINT_NAMES,
  KEYWORDS,
  KeywordSchema,
  MANA_COLORS,
  ManaColorSchema,
  MODEL_TARGET_KINDS,
  MODEL_TRIGGER_CONDITIONS,
  ModelTriggerConditionSchema,
  PERMANENT_CARD_KINDS,
  PLAYER_SCOPES,
  PlayerScopeSchema,
  PT_COUNT_PRINT_TEXT,
  PT_COUNT_SOURCES,
  PtCountSourceSchema,
  RARITIES,
  RaritySchema,
  SET_CODE_PATTERN,
  sortColors,
  sortKeywords,
  SPELL_CARD_KINDS,
  STATIC_MODIFICATION_KINDS,
  STATIC_SCOPES,
  StaticModificationKindSchema,
  StaticScopeSchema,
  SUBTYPE_PATTERN,
  SUPERTYPES,
  SupertypeSchema,
  UNPRICED_EFFECT_KINDS,
  TARGET_COMBAT_ROLES,
  TARGET_KINDS,
  TargetCombatRoleSchema,
  TargetKindSchema,
  TOKEN_NAME_MAX_LENGTH,
  TOKEN_NAME_PATTERN,
  TRIGGER_CONDITIONS,
  TRIGGER_POWER_THRESHOLD,
  TRIGGER_PRINT_TEMPLATES,
  TRIGGERING_CREATURE_CONDITIONS,
  TriggerConditionSchema,
} from './vocabulary';
export type {
  AbilityKind,
  BasicLandType,
  CardKind,
  Color,
  EffectScope,
  EffectScopeSubject,
  GrantableKeyword,
  GrantableKeywordAbilityKind,
  Keyword,
  ManaColor,
  ModelTriggerCondition,
  PlayerScope,
  PtCountSource,
  Rarity,
  ScopesWithSubject,
  SpaceScope,
  StaticModificationKind,
  StaticScope,
  Supertype,
  TargetedPlayerScope,
  TargetCombatRole,
  TriggerCondition,
  TriggeringCreatureCondition,
} from './vocabulary';

export {
  AbilitySchema,
  abilityFromModel,
  exaltedAbility,
  flurryRushAbility,
  flurryRushRank,
  gloomAbility,
  gloomRank,
  ActivationCostSchema,
  LoyaltyCostSchema,
  AttachingMechanicModelAbilitySchema,
  AttachingModelAbilitySchema,
  ATTACH_MODIFICATION_LIMITS,
  AttachSchema,
  EQUIPMENT_SUBTYPE,
  hasAbilityEffects,
  isAttachingAbility,
  isExaltedAbility,
  isModelAbilityKind,
  isLoyaltyAbility,
  isOptionalTrigger,
  isRegenerationAbility,
  LoyaltyModelAbilitySchema,
  loyaltyAbilityFromModel,
  MechanicModelAbilitySchema,
  MODEL_ABILITY_KINDS,
  ModelAbilitySchema,
  ModelAttachSchema,
  OptionalTriggerSchema,
  sortAbilities,
  triggerChoosesTargets,
  StaticModificationSchema,
  LayeredStaticModificationSchema,
  AttachModificationSchema,
  CombatModificationSchema,
} from './abilities';
export type {
  Ability,
  AbilityInput,
  AbilityOf,
  ActivatedAbility,
  ActivationCost,
  ActivationCostInput,
  LoyaltyCost,
  LoyaltyAbility,
  LoyaltyModelAbility,
  LoyaltyModelAbilityInput,
  Attach,
  AttachingAbility,
  AttachingMechanicModelAbility,
  AttachingModelAbility,
  AttachingModelAbilityInput,
  AttachingModelAbilityIsMechanicAbility,
  EffectBearingAbility,
  ExaltedAbility,
  FlurryRushAbility,
  GloomAbility,
  MechanicModelAbility,
  ModelAbility,
  ModelAbilityInput,
  ModelAbilityIsAbility,
  ModelAbilityKind,
  ModelAttach,
  OptionalTrigger,
  RegenerationAbility,
  SacrificeOther,
  StaticAbility,
  StaticModification,
  StaticModificationOf,
  TriggeredAbility,
  LayeredStaticModification,
  AttachModification,
  CombatModification,
} from './abilities';

export {
  classifyStaticModification,
  isLayeredStaticModification,
  isCombatStaticModification,
} from './static-modification-class';
export type { ReplacementStaticModification, StaticModificationClass } from './static-modification-class';

export {
  colorPips,
  colorsFromCost,
  formatManaCost,
  isColorless,
  mana,
  MAX_CHOSEN_X,
  ManaCostSchema,
  ModelManaCostSchema,
  manaValue,
  resolveX,
  ZERO_MANA_COST,
} from './mana';
export type { ManaCost, ManaCostInput, ModelManaCost } from './mana';

export { CharacteristicPowerToughnessSchema } from './characteristic-values';
export type { CharacteristicPowerToughness } from './characteristic-values';

export { CostReductionSchema, describeCostReduction } from './cost-reduction';
export type { CostReduction, CostReductionInput } from './cost-reduction';

export {
  AmountSchema,
  amountOrAssume,
  ComputedAmountSchema,
  PermanentTallySchema,
  CountFilterSchema,
  CountMatchingOpponentSchema,
  CountWithCounterSchema,
  isLiteralAmount,
  isRateAmount,
  LandsWithSubtypeSchema,
  PumpAmountSchema,
  RatePerSchema,
} from './amount';
export type {
  Amount,
  ComputedAmount,
  CountFilter,
  CountWithCounter,
  PermanentTally,
  PumpAmount,
  RatePer,
} from './amount';

export {
  AnyCreatureHasCounterConditionSchema,
  ConditionSchema,
  ControlsSubtypeConditionSchema,
  LifeAtLeastConditionSchema,
  NoOpponentDealtDamageThisTurnConditionSchema,
  OpponentGraveyardAtLeastConditionSchema,
} from './condition';
export type {
  AnyCreatureHasCounterCondition,
  Condition,
  ControlsSubtypeCondition,
  LifeAtLeastCondition,
  NoOpponentDealtDamageThisTurnCondition,
  OpponentGraveyardAtLeastCondition,
} from './condition';

export {
  ANY_TARGET,
  ATTACK_TRIGGER_ONLY_TARGETS,
  CARD_TYPE_FILTERABLE_TARGETS,
  MAX_TARGET_COUNT,
  MAX_TARGET_RESTRICTION_POWER,
  cardTypeFilterFitsTargetKind,
  filterFitsTargetKind,
  isAttackTriggerOnlyTarget,
  isReferentTarget,
  isSourceBodyOnlyTarget,
  NO_TARGET,
  REFERENT_TARGETS,
  referentSourceSpace,
  requiresDistinctTarget,
  SELF_CREATURE,
  SELF_PERMANENT,
  SOURCE_BODY_ONLY_TARGETS,
  TARGET_CREATURE,
  TARGET_CREATURE_YOU_CONTROL,
  TARGET_CREATURE_YOU_DONT_CONTROL,
  TARGET_OPPONENT,
  TARGET_PERMANENT,
  TARGET_PLAYER,
  TARGET_PLAYER_OR_PLANESWALKER,
  THAT_CREATURE,
  THAT_CREATURES_CONTROLLER,
  THAT_PLAYER,
  TRIGGERING_CREATURE,
  restrictionFitsTargetKind,
  targetCountOf,
  targetFilterIsEmpty,
  targetFilterOf,
  targetKindNamesACreature,
  targetKindNamesAPlayer,
  targetRestrictionOf,
  TargetFilterSchema,
  TargetRestrictionSchema,
  TargetSpecSchema,
} from './targets';
export type {
  ModelTargetKind,
  TargetFilter,
  TargetKind,
  TargetRestriction,
  TargetRestrictionKind,
  TargetSpec,
} from './targets';

export {
  COUNTER_DECLARATIONS,
  COUNTER_KINDS,
  counterGrantedKeywords,
  CounterKindSchema,
  counterPhrase,
  counterReminderText,
  counterStatBonus,
} from './counters';
export type { CounterDeclaration, CounterKind, StatBonus } from './counters';

export { RETIRED_VOCABULARY, retiredNames } from './retired-vocabulary';
export type { RetiredNames } from './retired-vocabulary';

export {
  CardEffectSchema,
  effectAllowsTargetCount,
  effectChoosesTarget,
  EffectSchema,
  FuseAbilitySchema,
  hasTarget,
  isCreatureTokenSpec,
  isModelEffectKind,
  isPricedEffectKind,
  isManaEffect,
  isSourceBodyEffect,
  MANA_EFFECT_KINDS,
  referentSourceIndex,
  SOURCE_BODY_EFFECT_KINDS,
  TARGET_COUNT_EFFECT_KINDS,
  MAX_MANA_PRODUCED,
  MAX_SCRY_COUNT,
  MAX_SEARCH_COUNT,
  MODEL_EFFECT_KINDS,
  ModelEffectSchema,
  ModelTokenSpecSchema,
  PartBearingModelEffectSchema,
  PartTokenSpecSchema,
  tokenAbilities,
  TokenAbilitySchema,
  TokenEffectSchema,
  TokenSpecSchema,
  ZONE_REACHING_MODEL_EFFECT_KINDS,
  ZoneReachingModelEffectSchema,
  CardFilterSchema,
  GRAVEYARD_OWNERS,
  GraveyardOwnerSchema,
  LIBRARY_POSITIONS,
  LibraryPositionSchema,
  MAX_REVEAL_COUNT,
  RETURN_DESTINATIONS,
  ReturnDestinationSchema,
  SEARCH_DESTINATIONS,
  SearchDestinationSchema,
  MAX_DISCARD_COUNT,
  GRAVEYARD_CHOICE_DESTINATIONS,
  GraveyardChoiceDestinationSchema,
  GRAVEYARD_CHOICE_CONTROLLERS,
  GraveyardChoiceControlSchema,
  GraveyardArrivalGrantSchema,
} from './effects';
export type {
  AnyEffectKind,
  CreatureTokenSpec,
  Effect,
  EffectInput,
  EffectKind,
  EffectOf,
  FuseAbility,
  ModelEffect,
  ModelEffectKind,
  PartBearingModelEffect,
  PartBearingModelEffectIsEffect,
  PartTokenSpec,
  PartTokenSpecIsTokenSpec,
  TargetedEffect,
  TokenAbility,
  TokenEffect,
  TokenSpec,
  TokenSpecInput,
  ZoneReachingModelEffect,
  ZoneReachingModelEffectIsEffect,
  CardFilter,
  GraveyardOwner,
  LibraryPosition,
  ReturnDestination,
  SearchDestination,
  GraveyardChoiceDestination,
  GraveyardChoiceControl,
  GraveyardArrivalGrant,
} from './effects';

export { isManaAbility, manaAbilityOf, manaSourceColors } from './mana-ability';

export { effectsFor, MAX_MODES, MIN_MODES, ModeSchema, ModesSchema } from './modal';
export type { Mode, ModalCard, Modes } from './modal';

export { MayChooserSchema } from './may';
export type { MayChooser } from './may';
export {
  UNLESS_PAYER_TARGETS,
  UnlessClauseSchema,
  unlessPayerPhrase,
  UnlessPayerSchema,
  withUnlessClause,
} from './unless';
export type { UnlessClause, UnlessPayer } from './unless';

export { TOKEN_SET_CODE, tokenCard, tokenReferenceName, tokenSlug } from './token';

export {
  printedEffects,
  setTokenCards,
  setTokens,
  tokenNameConflicts,
  tokenSlugCollisions,
  validateTokenNames,
  validateTokenSlugCollisions,
} from './set-tokens';
export type { SetToken, TokenNameConflict, TokenNameShape, TokenSlugCollision } from './set-tokens';

export { FALLBACK_SET_CODE, dominantSetCode, setBasics } from './set-basics';

export { CARD_SHAPES, cardShapes, missingShapes, shapeCounts, shapesIn } from './card-shape';
export type { CardShape } from './card-shape';

export {
  ArtifactCardSchema,
  cardManaValue,
  CardSchema,
  CreatureCardSchema,
  InstantCardSchema,
  isArtifact,
  isBasicLand,
  isCastable,
  isCreature,
  isLand,
  isPlaneswalker,
  isPermanentCard,
  isSpellCard,
  printedCardTypes,
  printedEntryReplacement,
  printedPowerToughness,
  LandCardSchema,
  LandEntryReplacementSchema,
  KeywordAbilitySchema,
  PermanentEntryReplacementSchema,
  PlaneswalkerCardSchema,
  ProtectionQualitySchema,
  SetRefSchema,
  SorceryCardSchema,
} from './card';
export type {
  ArtifactCard,
  Aura,
  AuraLandwalkModification,
  AuraModification,
  AuraModificationKind,
  ModelAuraModificationKind,
  Card,
  CardInput,
  CastableCard,
  CreatureCard,
  EnchantmentCard,
  InstantCard,
  LandCard,
  LandEntryReplacement,
  KeywordAbility,
  PermanentEntryReplacement,
  PlaneswalkerCard,
  ProtectionQuality,
  SetRef,
  SorceryCard,
} from './card';

export {
  AURA_MODIFICATION_KINDS,
  AURA_MODIFICATION_LIMITS,
  AuraCombatModificationSchema,
  AuraLandwalkModificationSchema,
  AuraModificationSchema,
  AuraSchema,
  AuraUntapModificationSchema,
  EnchantmentCardSchema,
  isAuraCard,
  isEnchantment,
  isStaticAuraModification,
  ModelAuraModificationSchema,
  ModelAuraSchema,
} from './card';

export {
  ENCHANTED_DOES_NOT_UNTAP,
  keywordRowText,
  loyaltyCostText,
  oracleRows,
  renderAbility,
  renderCard,
  renderEffect,
  renderEffectList,
  renderAuraModificationClause,
  renderOracleText,
  renderTokenOracleText,
  renderTypeLine,
  typeLineParts,
  withRenderedOracleText,
} from './oracle';
export type { OracleRow, TypeLineParts } from './oracle';

export {
  ABILITY_LINE_REMINDER_TEXT,
  abilityLineReminder,
  bareKeywordLine,
  bareKeywords,
  KEYWORD_REMINDER_TEXT,
  keywordLines,
  keywordReminder,
  keywordReminderLine,
  remindedKeywords,
} from './reminder';
export type { KeywordReminder } from './reminder';

export { apportion } from './apportion';
export { canonicalJson } from './canonical-json';
export { cardFingerprint, mechanicalFingerprint } from './fingerprint';

export { formatPath, formatViolations, hasViolation, violation, VIOLATION_CODES } from './violations';
export type { Violation, ViolationCode } from './violations';

export {
  HAND_AUTHORED_TARGETS,
  isValidCard,
  LEGAL_TARGETS,
  legalScopesFor,
  legalTargetsFor,
  schemaIssuesToViolations,
  validateCard,
  validateCardRecord,
} from './validate/index';
export type { SchemaIssue } from './validate/index';
export { validateCards, validateSetUniqueness } from './validate/set';

export {
  CardValidationError,
  parseCard,
  parseCardJson,
  parseCards,
  parseCardsDocumentJson,
  parseCardsJson,
  safeParseCard,
  serializeCard,
  serializeCards,
} from './parse';
export type { SafeParseResult } from './parse';

export {
  basicLand,
  BASIC_LANDS,
  EXAMPLE_CARDS,
  EXAMPLE_CARDS_BY_ID,
  EXAMPLE_SET,
  exampleCard,
} from './examples';

export type {
  AbilityKindsCovered,
  CardKindsCovered,
  EffectKindsCovered,
  GrantableKeywordAbilitiesAreParameterless,
  KeywordAbilityKindsCovered,
  KeywordsCovered,
  ModelTargetKindsAreTargetKinds,
  MutuallyAssignable,
  PricedEffectKindsAreEffectKinds,
  StaticModificationsCovered,
  TargetKindsCovered,
} from './exhaustive';
