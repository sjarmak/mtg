/**
 * The run summary — the go/no-go memo's inputs, as data.
 *
 * `decision-synthesis.md` §5 ends the thin slice on "both throughput numbers
 * exist; a go/no-go memo confirms or revises the engine bet on evidence", and
 * §4.2 names the evidence: TS-kernel games/sec, fork cost, and the metrics
 * verdict. §7.3 adds the validator-retry story, because a set that only
 * validated after three regeneration rounds is a different bet from one that
 * validated first time.
 *
 * Everything below is measured in the run that writes it. Nothing is estimated,
 * and the throughput *threshold* is deliberately absent: `decision-synthesis`
 * §7.3 lists it as an unwritten gate, so the memo publishes the number and the
 * derived cost of a 10^4-game revision rather than inventing a bound to pass.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CostSource, TokenUsage } from '@mtg/llm';
import { totalTokens } from '@mtg/llm';
import type { BenchStageResult } from './stages/bench';
import type { DeckStageResult } from './stages/decks';
import type { ForgeStageResult } from './stages/forge';
import type { SetgenStageResult } from './stages/setgen';
import type { SimStageResult } from './stages/simulate';
import type { SliceVerdict, VerdictStageResult } from './stages/verdict';
import type { SliceOptions } from './options';

/**
 * Bumped to 3 when the pass count stopped folding two abstentions into it.
 *
 * v2 published `passed`/`failed`/`underSampled` and nothing else, so a
 * `notApplicable` gate (nothing in the pool to measure) and a `withinNoise`
 * gate (a miss the run's own dice cannot be told apart from) were both
 * counted as passes by the arithmetic that built `passed` — `gates.length -
 * failed - underSampled` has no term for either. v3 adds `notApplicable` and
 * `withinNoise` alongside the existing three, and `passed` now subtracts all
 * four (`@mtg/metrics`'s own `report.ts` does the same subtraction over
 * `health.gates`, and `censusGates` in `./stages/verdict` mirrors it here).
 *
 * v1 published `inputTokens`/`outputTokens` only. On a prompt-cached run those
 * two fields are a rounding error — the recorded Tideglass fixtures bill 84
 * plain input tokens against 1.27M cache writes and 1.11M cache reads — so the
 * memo read "84 in / 191257 out" beside a real $36 bill and implied an absurd
 * per-output-token price. v2 replaces the pair with `tokens`, which carries all
 * four billed components plus their total, and adds the effective blended rate.
 */
export const SUMMARY_FORMAT_VERSION = 3;

/** Games a single set revision is sized at (`decision-synthesis.md` §5, §7.3). */
export const REVISION_GAME_COUNT = 10_000;

export type SliceStatus = 'green' | 'no-go';

/**
 * Every token the run was billed for, kept apart because they bill apart.
 *
 * Cache writes and cache reads are input tokens at different rates (writes
 * 1.25x or 2x the base input rate depending on TTL, reads 0.1x), so collapsing
 * them into one "input" number destroys the only figures that explain the bill.
 */
export interface TokenSummary {
  /** Uncached input: what the model read fresh, at the base input rate. */
  readonly input: number;
  /** Input written into the prompt cache, billed above the base input rate. */
  readonly cacheWrite: number;
  /** Input served from the prompt cache, billed at a tenth of the base rate. */
  readonly cacheRead: number;
  readonly output: number;
  /** input + cacheWrite + cacheRead + output — the number the bill is over. */
  readonly billed: number;
}

export interface SetgenSummary {
  readonly provider: string;
  readonly briefSeed: string;
  readonly targetSize: number;
  readonly cardsPrinted: number;
  readonly legalCards: number;
  readonly enforceable: boolean;
  readonly calls: number;
  readonly failedCalls: number;
  readonly tokens: TokenSummary;
  readonly costUsd: number;
  readonly costSource: CostSource;
  /**
   * `costUsd` divided by the billed tokens, in dollars per million.
   *
   * The sanity check on the two numbers above: a caching-heavy run lands well
   * under the model's headline input rate, and a figure near the output rate
   * means the accounting lost the cache lines again. `null` when nothing was
   * billed or the provider could not price the run, because a rate derived from
   * a zero or a guess is worse than an absent one.
   */
  readonly usdPerMillionTokens: number | null;
  /** Slots that took more than one fill call: where the model fought the skeleton. */
  readonly slotsNeedingRetry: number;
  readonly maxAttemptsForOneSlot: number;
  readonly retryRounds: readonly {
    readonly round: number;
    readonly slots: number;
    readonly repaired: number;
    readonly causes: readonly string[];
  }[];
  readonly critiqueRan: boolean;
  readonly critiqueApplied: number;
  readonly critiqueReverted: number;
  readonly warnings: readonly string[];
}

export interface DeckSummary {
  readonly pair: string;
  readonly creatures: number;
  readonly removal: number;
  readonly massTwoToFour: number;
  readonly complete: boolean;
  readonly shortfalls: readonly string[];
}

export interface SimSummary {
  readonly matchups: number;
  readonly gamesPerMatchup: number;
  readonly games: number;
  readonly workers: number;
  readonly elapsedMillis: number;
  /** Greedy bots with replay logging: the configuration a balance revision pays. */
  readonly gamesPerSecond: number;
  /** Wall clock for a 10^4-game set revision at this rate; `null` if unmeasured. */
  readonly secondsPerRevision: number | null;
  readonly logPath: string;
}

export interface MetricsSummary {
  readonly verdict: SliceVerdict;
  readonly gates: number;
  readonly passed: number;
  readonly failed: number;
  readonly underSampled: number;
  /** Gates with nothing in the subject to measure. Reported, never asserted on. */
  readonly notApplicable: number;
  /** Gates that missed their band by less than this run's own seed noise. Not a pass. */
  readonly withinNoise: number;
  readonly failures: readonly { readonly id: string; readonly detail: string; readonly bound: string }[];
  readonly reportPath: string;
  readonly gatesPath: string;
}

export interface SliceSummary {
  readonly formatVersion: typeof SUMMARY_FORMAT_VERSION;
  readonly status: SliceStatus;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly runSeed: string;
  readonly metricsGate: SliceOptions['metricsGate'];
  readonly set: { readonly code: string; readonly name: string; readonly cards: number };
  readonly setgen: SetgenSummary;
  readonly decks: readonly DeckSummary[];
  readonly sim: SimSummary;
  readonly metrics: MetricsSummary;
  readonly kernel: BenchStageResult & { readonly secondsPerRevision: number | null };
  readonly forge: ForgeStageResult;
  readonly artifacts: Readonly<Record<string, string>>;
  readonly storePath: string | null;
}

export interface SummaryInputs {
  readonly options: SliceOptions;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly setgen: SetgenStageResult;
  readonly decks: DeckStageResult;
  readonly sim: SimStageResult;
  readonly metrics: VerdictStageResult;
  readonly bench: BenchStageResult;
  readonly forge: ForgeStageResult;
  readonly storePath: string | null;
}

/**
 * Wall-clock cost of one 10^4-game set revision at a measured rate.
 *
 * `null` rather than `Infinity` when nothing was measured: `JSON.stringify`
 * turns `Infinity` into `null` anyway, and a field that means "unmeasured"
 * should say so in its type rather than in a reader's head.
 */
export function secondsPerRevision(gamesPerSecond: number): number | null {
  return gamesPerSecond <= 0 ? null : REVISION_GAME_COUNT / gamesPerSecond;
}

/** Flatten a provider usage record into the four billed lines plus their total. */
export function tokenSummary(usage: TokenUsage): TokenSummary {
  return {
    input: usage.inputTokens,
    cacheWrite: usage.cacheCreationInputTokens,
    cacheRead: usage.cacheReadInputTokens,
    output: usage.outputTokens,
    billed: totalTokens(usage),
  };
}

/**
 * The run's blended rate, from the billed total and the billed dollars.
 *
 * Derived from what the provider reported, not from a price table: the report
 * the slice is handed carries no model id, so the slice has no honest way to
 * re-price the run itself and does not pretend to.
 */
export function usdPerMillionTokens(costUsd: number, billed: number, source: CostSource): number | null {
  if (source === 'unknown' || billed <= 0) return null;
  return (costUsd * 1_000_000) / billed;
}

function setgenSummary(inputs: SummaryInputs): SetgenSummary {
  const { report } = inputs.setgen;
  const attempts = Object.values(report.attemptsPerSlot);
  const tokens = tokenSummary(report.usage.usage);
  return {
    provider: inputs.options.provider,
    briefSeed: report.seed,
    targetSize: report.targetSize,
    cardsPrinted: report.cardsPrinted,
    legalCards: report.legalCards,
    enforceable: report.enforceable,
    calls: report.usage.calls,
    failedCalls: report.usage.failedCalls,
    tokens,
    costUsd: report.usage.costUsd,
    costSource: report.usage.costSource,
    usdPerMillionTokens: usdPerMillionTokens(report.usage.costUsd, tokens.billed, report.usage.costSource),
    slotsNeedingRetry: report.slotsNeedingRetry.length,
    maxAttemptsForOneSlot: attempts.length === 0 ? 0 : Math.max(...attempts),
    retryRounds: report.retryRounds.map((round) => ({
      round: round.round,
      slots: round.slotIds.length,
      repaired: round.slotsRepaired,
      causes: round.causes,
    })),
    critiqueRan: report.critique.ran,
    critiqueApplied: report.critique.revisions.filter((item) => item.outcome === 'applied').length,
    critiqueReverted: report.critique.revisions.filter((item) => item.outcome === 'reverted').length,
    warnings: report.findings
      .filter((finding) => finding.severity === 'warning')
      .map((finding) => `${finding.code}: ${finding.message}`),
  };
}

/**
 * The run's status.
 *
 * A stage that broke never reaches here — it threw. So the only question left
 * is whether a red band ends the run, and that is policy: `strict` says a
 * format that fails its own bands is a no-go, `advisory` records the verdict
 * and leaves the bands to the job that is sized to assert them.
 */
export function sliceStatus(gate: SliceOptions['metricsGate'], verdict: SliceVerdict): SliceStatus {
  return gate === 'strict' && verdict === 'fail' ? 'no-go' : 'green';
}

export function buildSummary(inputs: SummaryInputs): SliceSummary {
  const { setgen, sim, metrics, bench, forge } = inputs;
  const first = setgen.cards[0];
  const status = sliceStatus(inputs.options.metricsGate, metrics.verdict);

  return {
    formatVersion: SUMMARY_FORMAT_VERSION,
    status,
    startedAt: inputs.startedAt,
    durationMs: inputs.durationMs,
    runSeed: inputs.options.runSeed,
    metricsGate: inputs.options.metricsGate,
    set: {
      code: first?.set.code ?? setgen.brief.setCode,
      name: setgen.brief.setName,
      cards: setgen.cards.length,
    },
    setgen: setgenSummary(inputs),
    decks: inputs.decks.decks.map((deck) => ({
      pair: deck.key,
      creatures: deck.creatureCount,
      removal: deck.removalCount,
      massTwoToFour: deck.massTwoToFour,
      complete: deck.complete,
      shortfalls: deck.shortfalls.map((shortfall) => `${shortfall.kind} missing ${shortfall.missing}`),
    })),
    sim: {
      matchups: sim.matchups,
      gamesPerMatchup: sim.gamesPerMatchup,
      games: sim.games,
      workers: sim.workers,
      elapsedMillis: sim.elapsedMillis,
      gamesPerSecond: sim.gamesPerSecond,
      secondsPerRevision: secondsPerRevision(sim.gamesPerSecond),
      logPath: sim.logPath,
    },
    metrics: {
      verdict: metrics.verdict,
      gates: metrics.health.gates.length,
      passed: metrics.passed,
      failed: metrics.failures.length,
      underSampled: metrics.underSampled.length,
      notApplicable: metrics.notApplicable.length,
      withinNoise: metrics.withinNoise.length,
      failures: metrics.failures.map((gate) => ({
        id: gate.id,
        detail: gate.detail,
        bound: gate.bound,
      })),
      reportPath: metrics.reportPath,
      gatesPath: metrics.gatesPath,
    },
    kernel: { ...bench, secondsPerRevision: secondsPerRevision(bench.kernelGamesPerSecond) },
    forge,
    artifacts: {
      set: setgen.setPath,
      setReport: setgen.reportPath,
      slots: setgen.slotsPath,
      replayLog: sim.logPath,
      formatHealth: metrics.reportPath,
      gates: metrics.gatesPath,
    },
    storePath: inputs.storePath,
  };
}

export function writeSummary(path: string, summary: SliceSummary): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return path;
}
