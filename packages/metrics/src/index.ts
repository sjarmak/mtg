/**
 * `@mtg/metrics` — format-health metrics over self-play logs, and the CI gates
 * that assert them.
 *
 * Four things live here:
 *
 *  1. The metric suite from `docs/research/prior-art-playability-metrics.md`
 *     §7 that DSL v0 can actually produce: game-length distribution (A1),
 *     on-the-play advantage (A2), mana screw and flood against Karsten's
 *     hypergeometric priors (A4), stall and decisiveness (A5), and per-color-
 *     pair win rate with the no-dominant-strategy guard (C1). Each module cites
 *     its source definition.
 *  2. Sample-size discipline. Every statistic carries the number of *distinct*
 *     game trajectories behind it, and returns `null` below its floor instead
 *     of being asserted on — because seeded bots replaying one line a thousand
 *     times is one sample, not a thousand (report §10.7).
 *  3. `report()`, and the 17lands join contract that says exactly how these
 *     numbers will be compared against human ones when a real set exists.
 *  4. The native Draft calibration harness, which carries deterministic bot
 *     picks through legal decks and kernel games into physical-card evidence.
 */

export type {
  AbilityUsageBands,
  DeckShape,
  Band,
  SampleFloors,
  LengthBands,
  BalanceBands,
  DecisivenessBands,
  ManaBands,
  ManaCheckpoint,
  MetricsConfig,
  MetricsConfigInput,
} from './config';
export {
  DEFAULT_ABILITY_USAGE_BANDS,
  DEFAULT_BALANCE_BANDS,
  DEFAULT_DECISIVENESS_BANDS,
  DEFAULT_LENGTH_BANDS,
  DEFAULT_MANA_BANDS,
  DEFAULT_MANA_CHECKPOINTS,
  DEFAULT_METRICS_CONFIG,
  DEFAULT_ON_PLAY_BAND,
  DEFAULT_SAMPLE_FLOORS,
  LIMITED_DECK_SHAPE,
  metricsConfig,
} from './config';

export type { Interval, Summary } from './stats';
export {
  cumulativeShare,
  histogram,
  intervalHalfWidth,
  mean,
  quantileSorted,
  share,
  summarize,
  wilsonInterval,
} from './stats';

export type { Sampled, SampleCount } from './sample';
export {
  countFingerprints,
  countGames,
  duplicateShare,
  emptyCount,
  gameFingerprint,
  sampled,
  unsampled,
} from './sample';

export type { EndReason, GameFacts } from './game';
export {
  cardsSeenBy,
  colorsOf,
  gameFacts,
  isInertTurn,
  landsInPlayAt,
  otherSide,
  ownTurn,
  ownTurns,
  roundsFromPlayerTurns,
  SIDE_LIST,
} from './game';

export type { GameLengthDistribution, OnPlayResult } from './game-length';
export { gameLengthDistribution, onPlayWinRate } from './game-length';

export type { ManaCheckpointResult } from './mana';
export { checkpointId, checkpointLabel, karstenPrior, manaCheckpoint, manaCheckpoints } from './mana';

export type { DecisivenessResult } from './decisiveness';
export { decisiveness } from './decisiveness';

export type { AbilityPool, AbilityUsageReport, AbilityUsageResult } from './ability-usage';
export { abilityPool, abilityUsage } from './ability-usage';

export type { ColorPairRecord, ColorPairReport, MatchupRecord } from './win-rate';
export { colorPairWinRates, matchupMatrix, winRateSpread } from './win-rate';

export type { DominanceFinding, DominanceReason, DominanceResult, OutOfBandFinding } from './dominance';
export { evaluateDominance } from './dominance';

export type { GateBand, GateInputs, GateMargin, GateResult, GateStatus, SeedNoiseAbstention } from './gates';
export {
  abstainWithinNoise,
  evaluateGates,
  failedGates,
  formatGates,
  gateMargin,
  gateStatusLabel,
  notApplicableGates,
  seedNoiseAbstention,
  underSampledGates,
  withinNoiseGates,
} from './gates';

export type {
  Fairness,
  FairnessFinding,
  FairnessQuestion,
  FairnessReading,
  FairnessVerdict,
  UnjudgedGate,
} from './fairness';
export {
  DEVIATION_MEASURED_AT_GAMES,
  FAIRNESS_ASKS,
  FAIRNESS_QUESTIONS,
  NOT_ASKED,
  fairness,
  fairnessVerdictLabel,
  findingLine,
  formatFairness,
  questionOf,
  scaledSeedDeviation,
  seedDeviation,
} from './fairness';

export type { FormatHealth, FormatHealthOptions } from './health';
export {
  formatHealth,
  healthFailures,
  healthNotApplicable,
  healthUnderSampled,
  healthWithinNoise,
} from './health';

export { report } from './report';

export type {
  CorrectionEntry,
  CorrectionTable,
  JoinCaveat,
  JoinCompatibility,
  JoinContract,
} from './calibration';

export type {
  DraftCalibrationArtifact,
  DraftCalibrationCliArgs,
  DraftCalibrationDeck,
  DraftCalibrationGame,
  DraftCalibrationOptions,
  DraftCardUncertainty,
  DraftCollation,
  DraftUncertaintySample,
} from './draft-calibration';
export {
  DEFAULT_DRAFT_CARD_FLOOR,
  DEFAULT_DRAFT_GAMES_PER_SEAT_ORDER,
  DEFAULT_DRAFT_PACKS_PER_SEAT,
  DRAFT_CALIBRATION_ARTIFACT_VERSION,
  DRAFT_CALIBRATION_PRODUCER,
  DRAFT_CALIBRATION_SEATS,
  DRAFT_COLLATION_VERSION,
  DraftCalibrationArtifactSchema,
  DraftCollationSchema,
  MAX_DRAFT_CARD_FLOOR,
  MAX_DRAFT_GAMES_PER_SEAT_ORDER,
  MAX_DRAFT_PACK_SIZE,
  MAX_DRAFT_PACKS_PER_SEAT,
  MAX_DRAFT_PAIRINGS,
  MAX_DRAFT_PATH_LENGTH,
  MAX_DRAFT_RECIPE_SLOT_COUNT,
  MAX_DRAFT_SEED_LENGTH,
  MAX_DRAFT_SET_SIZE,
  MAX_DRAFT_WORKERS,
  clusteredDraftUncertainty,
  parseDraftCalibrationArgs,
  parseDraftCollation,
  readDraftCalibrationArtifact,
  runDraftCalibration,
  runDraftCalibrationCli,
  successfulResolutionEventIndexes,
  writeDraftCalibrationArtifactAtomic,
} from './draft-calibration';

export type {
  AggregateDraftCalibrationCampaignOptions,
  DraftAssociationSample,
  DraftCalibrationCampaign,
  DraftCalibrationCampaignCliArgs,
  DraftCalibrationCampaignOptions,
  DraftCampaignStrengthFloor,
  DraftCardStrength,
} from './draft-campaign';
export {
  DEFAULT_DRAFT_CAMPAIGN_PODS,
  DEFAULT_DRAFT_CAMPAIGN_STRENGTH_FLOOR,
  DRAFT_CALIBRATION_CAMPAIGN_PRODUCER,
  DRAFT_CALIBRATION_CAMPAIGN_VERSION,
  DraftCalibrationCampaignSchema,
  DraftCampaignStrengthFloorSchema,
  MAX_DRAFT_CAMPAIGN_PODS,
  MAX_DRAFT_CAMPAIGN_SEED_LENGTH,
  MAX_DRAFT_CAMPAIGN_STRENGTH_FLOOR,
  aggregateDraftCalibrationCampaign,
  parseDraftCalibrationCampaignArgs,
  readDraftCalibrationCampaign,
  runDraftCalibrationCampaign,
  runDraftCalibrationCampaignCli,
  stratifiedDraftAssociation,
  writeDraftCalibrationCampaignAtomic,
} from './draft-campaign';
export {
  applyCorrection,
  CALIBRATION_CANDIDATE_SETS,
  correctionFor,
  EMPTY_CORRECTION_TABLE,
  formatJoinContract,
  JOIN_CAVEATS,
  joinContract,
  SEVENTEEN_LANDS_ATTRIBUTION,
  SEVENTEEN_LANDS_EVENT_TYPES,
  SEVENTEEN_LANDS_URL_PATTERN,
  seventeenLandsTurnColumn,
  verifyJoinCompatibility,
} from './calibration';

export type {
  SealedCalibrationArtifact,
  SealedCalibrationCliArgs,
  SealedCalibrationDeck,
  SealedCalibrationGame,
  SealedCalibrationOptions,
  SealedCollationInput,
} from './sealed-calibration';
export {
  DEFAULT_SEALED_CARD_FLOOR,
  DEFAULT_SEALED_GAME_FLOOR,
  DEFAULT_SEALED_GAMES_PER_SEAT_ORDER,
  DEFAULT_SEALED_POOL_PAIRS,
  MAX_SEALED_CARD_FLOOR,
  MAX_SEALED_GAME_FLOOR,
  MAX_SEALED_GAMES,
  MAX_SEALED_GAMES_PER_SEAT_ORDER,
  MAX_SEALED_PATH_LENGTH,
  MAX_SEALED_POOL_PAIRS,
  MAX_SEALED_COLLATION_BYTES,
  MAX_SEALED_SEED_LENGTH,
  MAX_SEALED_SET_BYTES,
  MAX_SEALED_SET_SIZE,
  MAX_SEALED_WORKERS,
  SEALED_BOOSTERS_PER_POOL,
  SEALED_CALIBRATION_ARTIFACT_VERSION,
  SEALED_CALIBRATION_PRODUCER,
  SEALED_COLLATION_VERSION,
  SealedCalibrationArtifactSchema,
  parseSealedCalibrationArgs,
  readSealedCalibrationArtifact,
  runSealedCalibration,
  runSealedCalibrationCli,
  writeSealedCalibrationArtifactAtomic,
} from './sealed-calibration';
