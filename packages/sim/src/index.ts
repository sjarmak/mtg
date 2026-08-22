/**
 * `@mtg/sim` — tier-1 bots, the seeded mass-sim runner, and the replay log.
 *
 * Three things live here and nothing else does:
 *
 *  1. Greedy heuristic bots behind the kernel's `PlayerAgent` seam, with every
 *     weight in an inspectable profile object and a random-policy bot shipped
 *     alongside to keep the seam honest.
 *  2. A seeded runner that plays N games of deck A vs deck B across worker
 *     threads, with per-game budgets that fail loudly, and aggregates that are
 *     a pure function of the run seed.
 *  3. A log exporter that emits a superset of the 17lands replay columns under
 *     their own names, so calibrating bot play against human play is a join.
 */

export type {
  ActivatePolicyConfig,
  AttackPolicyConfig,
  BlockPolicyConfig,
  CastPolicyConfig,
  DeepPartialConfig,
  DiscardPolicyConfig,
  GreedyBotConfig,
  LandPolicyConfig,
  MulliganPolicyConfig,
  RacePolicyConfig,
  TargetPolicyConfig,
} from './config';
export { DEFAULT_GREEDY_CONFIG, DEFAULT_KEYWORD_VALUE, DEFAULT_RACE_CONFIG, greedyConfig } from './config';

export type { CombatExchange } from './evaluate';
export {
  boardCreatureValue,
  cardOf,
  isLethalDamage,
  keywordValue,
  opponentThreat,
  printedAbilityValue,
  printedCardValue,
  printedCreatureValue,
  resolveExchange,
  totalPower,
  untappedCreatures,
} from './evaluate';

export { chooseLandDrop } from './policies/land';
export type { RaceAssessment } from './policies/race';
export { assessRace } from './policies/race';
export { scoreEffectTargets, scoreTargets } from './policies/target';
export { chooseActivation } from './policies/activate';
export type { CastCandidate } from './policies/cast';
export {
  bestSpendPlan,
  bestTargetingPerCard,
  castTimingAllows,
  chooseCast,
  MAX_EXHAUSTIVE_PLAN_CANDIDATES,
} from './policies/cast';
export type { AttackContext } from './policies/attack';
export {
  attackContext,
  attackValue,
  chooseAttackers,
  holdBackBlockers,
  lethalSwing,
} from './policies/attack';
export { chooseBlocks } from './policies/block';
export { chooseBlockerOrder, chooseDiscards } from './policies/misc';
// CR 103.4: the opening hand, kept or sent back on a land count.
export type { MulliganDecision, OpeningHandAction } from './policies/mulligan';
export { castsSomething, chooseMulligan, keepsHand, landsIn, landsWantedFor } from './policies/mulligan';
export type { CastabilityReading, LandSources } from './policies/castability';
export { costPayable, landSourcesOf, readCastability } from './policies/castability';
export { answerOptionalTrigger, chooseTriggerTargets } from './policies/trigger';

export { decideGreedy, greedyBot } from './greedy-bot';
export { randomBot } from './random-bot';

export type { AgentFactory, BotKind, BotSpec } from './bots';
export { createBot, greedySpec, randomSpec } from './bots';

export { agentSeed, gameSeed, startingPlayerFor } from './seeds';

export type { EnumerationCaps, GameBudget, GameOutcome, LogRequest, PlayGameOptions } from './driver';
export {
  DEFAULT_BUDGET,
  DEFAULT_CAPS,
  DEFAULT_MAXIMUM_TURNS,
  FAST_CAPS,
  GameBudgetExceededError,
  playSimGame,
} from './driver';

export type { MatchSpec, ResolvedMatchSpec } from './match';
export { DEFAULT_EVENT_TYPE, DEFAULT_EXPANSION, resolveMatchSpec } from './match';
export { playIndex } from './play-index';

export type { MatchAggregate } from './aggregate';
export { aggregateFingerprint, aggregateOutcomes, decidedWinRate, END_REASONS } from './aggregate';

export type { ActivationArm, ActivationArmCensus, ActivationCensus } from './activation-census';
export {
  ACTIVATION_ARMS,
  activationArm,
  censusGameActivations,
  emptyActivationCensus,
  hostsPerInstance,
  mergeActivationCensus,
  sumActivationCensus,
  tapFactor,
  usesPerInstance,
} from './activation-census';
export type { TriggerCensus, TriggerConditionCensus } from './trigger-census';
export {
  censusGameTriggers,
  emptyTriggerCensus,
  firesPerInstance,
  mergeTriggerCensus,
  sumTriggerCensus,
} from './trigger-census';

export type { MatchRun } from './match-run';
export { finishRun, retime, shardIndices } from './match-run';

export type { RunOptions } from './runner';
export { runMatch, runMatchSerial } from './runner';

export type { SimPool, SimPoolOptions } from './pool';
export { createSimPool, poolSize, withSimPool } from './pool';

export type { PoolCensus, PoolCensusRecord } from './pool-census';
export { censusOf, parseCensus, POOL_CENSUS_ENV, recordPoolEvent } from './pool-census';

export type { DefaultPoolInput } from './pool-size';
export {
  defaultSimWorkers,
  insideTestWorker,
  MIN_TEST_WORKER_POOL,
  TEST_WORKER_CORE_SHARE,
} from './pool-size';

export type { PooledRoundRobinOptions, RoundRobinOptions, RoundRobinRun } from './round-robin';
export {
  gamesPerMatchupFor,
  matchupCount,
  PINNED_SWEEP_GAMES,
  roundRobinSpecs,
  runRoundRobin,
  runRoundRobinSerial,
} from './round-robin';

export type {
  GameMetadata,
  ReplayRow,
  ReplayValue,
  Side,
  SideTotals,
  SideTurnStats,
  SimExtras,
  SimGameLog,
  TurnRecord,
} from './log/schema';
export {
  emptySideTotals,
  emptySideTurnStats,
  eotColumn,
  GameMetadataSchema,
  ownerColumn,
  REPLAY_GAME_COLUMNS,
  REPLAY_TOTAL_FIELDS,
  SIDES,
  sideColumn,
  SIM_LOG_SCHEMA_VERSION,
  SimGameLogSchema,
  totalColumn,
  TURN_OWNER_FIELDS,
  TURN_SIDE_EOT_FIELDS,
  TURN_SIDE_FIELDS,
  TurnRecordSchema,
} from './log/schema';
export type { LogInputs } from './log/collect';
export { buildGameLog } from './log/collect';
export type { MetadataInputs } from './log/metadata';
export { buildExtras, buildMetadata, deckColorString } from './log/metadata';
export { expectedReplayColumns, replayRow } from './log/row';
export type { JsonlHeader } from './log/jsonl';
export { appendReplayJsonl, jsonlHeader, parseReplayJsonl, writeReplayJsonl } from './log/jsonl';

export type { FixtureDeckOptions } from './fixtures';
export {
  DEFAULT_DECK_SIZE,
  DEFAULT_LAND_COUNT,
  FIXTURE_DECK_GW,
  FIXTURE_DECK_RW,
  FIXTURE_DECK_UB,
  fixtureDeck,
} from './fixtures';
