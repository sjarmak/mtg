/**
 * `@mtg/deckbuild` — deterministic pool-to-deck construction.
 *
 * Tier 0 of the deck lab: pure code, no LLM. Given a sealed or draft pool of
 * DSL cards it returns the best 40-card Limited deck the pool supports (17
 * lands + 23 spells by default), together with everything needed to argue with
 * the result — the color-pair ranking, per-card scores, the achieved curve
 * against the target, the mana split with Karsten-style castability numbers,
 * and every shortfall the pool forced.
 *
 * The later LLM deck-building tier sits on top of this, not instead of it: this
 * package is both its fallback and the baseline it is measured against.
 */

export {
  CURVE_BUCKETS,
  curveBucket,
  curveBucketLabel,
  curveTotal,
  emptyCurveHistogram,
  TOP_CURVE_BUCKET,
} from './curve-bucket';
export type { CurveBucket, CurveHistogram } from './curve-bucket';

export {
  DEFAULT_CURVE_PRIORITY,
  DEFAULT_DECK_BUILD_CONFIG,
  DEFAULT_KEYWORD_ABILITY_VALUE,
  DEFAULT_KEYWORD_BASE,
  DEFAULT_KEYWORD_POWER_SCALE,
  DEFAULT_MANA_BASE_CONFIG,
  DEFAULT_SCORE_WEIGHTS,
  DEFAULT_TARGET_CURVE,
  DEFAULT_TRIGGER_FIRE_COUNT,
  resolveConfig,
  spellCount,
} from './config';
export { checkUnknownConfigKeys } from './config-unknown-keys';
export type {
  CardScoreWeights,
  CardScoreWeightsInput,
  EffectWeight,
  KeywordAbilityWeight,
  DeckBuildConfig,
  DeckBuildConfigInput,
  ManaBaseConfig,
} from './config';

export {
  conditionSupply,
  counterSupply,
  deckContextOf,
  deckContextWith,
  deckDraws,
  subtypeShare,
  subtypeSupply,
} from './deck-context';
export type { DeckContext } from './deck-context';

export { priceAgainstDeck, readsTheDeck } from './deck-pricing';

export {
  abilityValue,
  bodyEffectValue,
  bodyValue,
  cardColors,
  comparePoolCards,
  DEFAULT_EFFECT_VALUE,
  DEFAULT_TOP_END_REACHABILITY,
  EFFECT_PRICING,
  effectMagnitude,
  evaluateCard,
  evaluatePool,
  isRemovalCard,
  reachabilityOf,
  removalPremiumFor,
} from './evaluate';
export type { CardEvaluation, EffectPricing, EffectPricingTable, PoolCard, ScoreComponent } from './evaluate';

export {
  COLOR_PAIRS,
  colorPairKey,
  countPlayablesByColor,
  isPlayableIn,
  playablesFor,
  rankColorPairs,
} from './color-pair';
export type { ColorPair, ColorPairEvaluation, PoolColorCounts } from './color-pair';

export { selectSpells } from './select-spells';
export type { SpellSelection } from './select-spells';

export { hypergeometricAtLeast, hypergeometricExact, logChoose, minSourcesFor } from './hypergeometric';

export {
  buildChosenManaBase,
  buildManaBase,
  demandedColors,
  dominantSetCode,
  measureDemand,
} from './mana-base';
export type {
  BasicLandCounts,
  ColorDemand,
  ColorRequirement,
  ColorSourceReport,
  ManaBase,
} from './mana-base';

export { formatShortfall, formatShortfalls, hasShortfall, isComplete } from './shortfall';
export type { Shortfall, ShortfallKind } from './shortfall';

export { buildDeck, deckColors } from './build';
export type { CurveReport, CurveSlotReport, DeckBuildResult } from './build';

export { buildDeckForPair, PairDeckError } from './build-pair';

export { buildFromSpells } from './build-manual';
export type { ManualDeck } from './build-manual';

export {
  CONSTRUCTED_COPY_LIMIT,
  CONSTRUCTED_DECK_SIZE,
  CONSTRUCTED_LAND_COUNT,
  CONSTRUCTED_TARGET_CURVE,
  constructedConfig,
  copyExcesses,
  formatCopyExcess,
} from './constructed';
export type { CopyExcess } from './constructed';

export {
  buildPrecon,
  curveOf,
  parsePreconFile,
  preconDeck,
  PreconError,
  PreconDeckSchema,
  PreconFileSchema,
  PRECON_FORMAT_VERSION,
  resolvePreconSpells,
} from './precon';
export type { PreconDeck, PreconFile } from './precon';

export {
  boosterRecipeFor,
  boosterSlotRarityWeights,
  boosterSize,
  DEFAULT_BOOSTER_COUNT,
  openSealedPool,
  SealedPoolError,
  SLICE_BOOSTER,
  SLICE_BOOSTER_WITH_RARE,
  SLICE_BOOSTER_WITH_RARE_MYTHIC,
  SLICE_BOOSTER_WITH_MYTHIC,
} from './sealed';
export type { BoosterRarityWeight, BoosterRecipe, BoosterSlot, SealedOptions, SealedPool } from './sealed';

// The other pack opener: a printing's own sheets, for a caller that has them.
// `collation.ts` argues why it is a second function rather than an option.
export { collatedBoosterSize, DEFAULT_COLLATED_BOOSTER_COUNT, openCollatedPool } from './collation';
export type { CollatedOptions, CollationBooster, CollationSheet, PackCollation } from './collation';

export { formatDeckReport } from './report';
