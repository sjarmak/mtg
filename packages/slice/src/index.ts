/**
 * `@mtg/slice` — the thin end-to-end loop, as a library and as a CLI.
 *
 * One run takes a mechanics brief to a go/no-go memo without a human in the
 * middle: generate the set in the DSL, validate and critique it, build a deck
 * per color pair, play a seeded round robin, judge the format against the
 * metrics bands, measure the two numbers the engine ADR's kill-tests are
 * written against, and ask a real Forge whether it can boot the cards.
 *
 * The scope is `docs/research/decision-synthesis.md` §5. The package owns no
 * rules, no prompts and no metrics of its own — it is the wiring, and every
 * number it publishes was measured by the package that owns the thing measured.
 */

export {
  SLICE_STAGES,
  STAGE_LABELS,
  SliceStageError,
  failStage,
  isSliceStageError,
  runStage,
} from './errors';
export type { SliceStage } from './errors';

export {
  DEFAULT_BENCH_GAMES,
  DEFAULT_COPY_ITERATIONS,
  DEFAULT_FORK_ITERATIONS,
  DEFAULT_GAMES_PER_MATCHUP,
  DEFAULT_RUN_SEED,
  METRICS_GATES,
  absolutePath,
  defaultBriefPath,
  defaultFixtureDir,
  defaultOutDir,
  defaultSliceOptions,
  isMetricsGate,
  repoRoot,
  resolveSliceOptions,
} from './options';
export type { MetricsGate, SliceOptions, SliceOptionsInput } from './options';

export { USAGE, parseSliceArgs } from './args';
export type { ParsedArgs } from './args';

export { buildProvider, runSetgenStage } from './stages/setgen';
export type { SetgenStageResult } from './stages/setgen';

export { runDeckStage } from './stages/decks';
export type { DeckStageResult, SliceDeck } from './stages/decks';

export { runSimStage } from './stages/simulate';
export type { SimStageOptions, SimStageResult } from './stages/simulate';

export { censusGates, runVerdictStage } from './stages/verdict';
export type { GateCensus, SliceVerdict, VerdictStageResult } from './stages/verdict';

export { runBenchStage } from './stages/bench';
export type { BenchStageOptions, BenchStageResult } from './stages/bench';

export { runForgeStage } from './stages/forge';
export type { ForgeStageOptions, ForgeStageResult } from './stages/forge';

export { runStoreStage, toLabCard } from './stages/store';
export type { StoreStageResult } from './stages/store';

export {
  REVISION_GAME_COUNT,
  SUMMARY_FORMAT_VERSION,
  buildSummary,
  secondsPerRevision,
  sliceStatus,
  tokenSummary,
  usdPerMillionTokens,
  writeSummary,
} from './summary';
export type {
  DeckSummary,
  MetricsSummary,
  SetgenSummary,
  SimSummary,
  SliceStatus,
  SliceSummary,
  SummaryInputs,
  TokenSummary,
} from './summary';

export { formatStageFailure, formatSummary } from './format';

export { runSlice } from './run';
export type { SliceRunResult } from './run';

export { EXIT_OK, EXIT_STAGE_FAILED, EXIT_VERDICT_FAILED, main } from './cli';
