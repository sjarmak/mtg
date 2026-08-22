/**
 * The printed memo.
 *
 * Same facts as `summary.json`, laid out for the person reading a CI log. The
 * ordering is deliberate: the loop's status first, then the four ADR inputs
 * (throughput, fork cost, retry counts, metrics verdict), then the Forge gate
 * status — because a reader who stops after the first screen should still have
 * the numbers the engine bet is judged on.
 */
import { STAGE_LABELS } from './errors';
import type { SliceStage } from './errors';
import type { SliceSummary } from './summary';
import { REVISION_GAME_COUNT } from './summary';

function seconds(value: number | null): string {
  return value === null ? 'unmeasured' : `${value.toFixed(1)} s`;
}

function nanos(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(2)} µs` : `${value.toFixed(1)} ns`;
}

/**
 * Thousands separators, computed rather than delegated to `toLocaleString`.
 *
 * Token counts run to seven figures and are unreadable unbroken, and the memo
 * is a CI artifact that has to come out byte-identical wherever it runs — which
 * rules out a locale-sensitive formatter.
 */
function grouped(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * The two token/cost lines.
 *
 * They are two lines and not one because the interesting fact is the shape of
 * the spend: on a prompt-cached run the fresh-input count is near zero and the
 * cache lines carry everything, so a memo that prints only "N in / N out" both
 * hides the real volume and makes the dollar figure look like it was charged
 * against the output tokens alone.
 */
function tokenLines(gen: SliceSummary['setgen']): readonly string[] {
  const t = gen.tokens;
  const rate =
    gen.usdPerMillionTokens === null
      ? ''
      : `, $${gen.usdPerMillionTokens.toFixed(2)} per million billed tokens`;
  const cost =
    gen.costSource === 'unknown'
      ? 'unpriced — the provider reported no cost and no price table covers this model'
      : `$${gen.costUsd.toFixed(4)} (${gen.costSource})${rate}`;
  return [
    `  tokens                ${grouped(t.billed)} billed — ${grouped(t.input)} fresh input, ${grouped(t.cacheWrite)} cache write, ${grouped(t.cacheRead)} cache read, ${grouped(t.output)} output`,
    `  cost                  ${cost}`,
    ...(gen.provider === 'fixture'
      ? [
          '  spend                 nothing — fixtures were replayed; the cost above is what recording them cost',
        ]
      : []),
  ];
}

function statusLine(summary: SliceSummary): string {
  const forge = `forge ${summary.forge.status}`;
  const verdict = `metrics ${summary.metrics.verdict}`;
  return summary.status === 'green'
    ? `SLICE GREEN — every stage completed (${verdict}, ${forge})`
    : `SLICE NO-GO — every stage completed but ${verdict} (${forge})`;
}

function setgenSection(summary: SliceSummary): readonly string[] {
  const gen = summary.setgen;
  const rounds =
    gen.retryRounds.length === 0
      ? 'none'
      : gen.retryRounds
          .map(
            (round) =>
              `round ${round.round}: ${round.slots} slot(s), ${round.repaired} repaired (${round.causes.join(', ')})`,
          )
          .join('; ');
  return [
    '',
    '## Set generation',
    `  provider              ${gen.provider}`,
    `  set                   ${summary.set.name} (${summary.set.code}), ${gen.cardsPrinted}/${gen.targetSize} slots printed, ${gen.legalCards} legal`,
    `  enforceable           ${gen.enforceable ? 'yes' : 'NO'}`,
    `  validator retries     ${gen.slotsNeedingRetry} slot(s) needed a second fill; worst slot took ${gen.maxAttemptsForOneSlot} attempt(s)`,
    `  retry rounds          ${rounds}`,
    `  critique              ${gen.critiqueRan ? `${gen.critiqueApplied} applied, ${gen.critiqueReverted} reverted on a second validation` : 'skipped'}`,
    `  model calls           ${gen.calls} (${gen.failedCalls} failed)`,
    ...tokenLines(gen),
    ...(gen.warnings.length === 0
      ? []
      : [`  warnings              ${gen.warnings.length}`, ...gen.warnings.map((line) => `    - ${line}`)]),
  ];
}

function deckSection(summary: SliceSummary): readonly string[] {
  const complete = summary.decks.filter((deck) => deck.complete).length;
  return [
    '',
    '## Deck construction',
    `  decks                 ${summary.decks.length} (one per color pair), ${complete} met every target`,
    ...summary.decks.map(
      (deck) =>
        `    ${deck.pair.padEnd(3)} ${String(deck.creatures).padStart(2)} creatures, ${String(deck.removal).padStart(2)} removal, ` +
        `${String(deck.massTwoToFour).padStart(2)} at MV 2-4` +
        (deck.shortfalls.length === 0 ? '' : ` — ${deck.shortfalls.join(', ')}`),
    ),
  ];
}

function throughputSection(summary: SliceSummary): readonly string[] {
  const sim = summary.sim;
  const kernel = summary.kernel;
  return [
    '',
    '## Throughput and fork cost (ADR kill-test inputs)',
    `  sim workload          ${sim.gamesPerSecond.toFixed(1)} games/sec — ${sim.games} games over ${sim.matchups} matchups in ${(sim.elapsedMillis / 1000).toFixed(1)} s, ${sim.workers > 1 ? `${sim.workers} workers` : 'single-threaded'}, greedy bots, replay logging on`,
    `  raw kernel            ${kernel.kernelGamesPerSecond.toFixed(1)} games/sec — ${kernel.benchGames} games, single-threaded, no logging, ${kernel.meanTurnsPerGame.toFixed(1)} turns and ${kernel.meanDecisionsPerGame.toFixed(0)} decisions per game`,
    `  ${REVISION_GAME_COUNT}-game revision    ${seconds(sim.secondsPerRevision)} at the workload rate, ${seconds(kernel.secondsPerRevision)} at the raw kernel rate`,
    `  fork(state)           ${nanos(kernel.forkNanos)}/op vs ${nanos(kernel.deepCopyNanos)}/op for a detached deep copy — ${kernel.forkSpeedup.toFixed(0)}x cheaper`,
    `  first branch reduce   ${nanos(kernel.branchReduceNanos)}/op`,
    `  forked position       turn ${kernel.positionTurn}, ${kernel.positionObjects} objects, ${kernel.positionBytes} bytes of JSON`,
    '  threshold             unwritten — decision-synthesis.md §7.3 leaves the games/sec gate to the go/no-go memo',
  ];
}

function metricsSection(summary: SliceSummary): readonly string[] {
  const metrics = summary.metrics;
  return [
    '',
    '## Format-health verdict',
    `  verdict               ${metrics.verdict.toUpperCase()} — ${metrics.passed} pass, ${metrics.failed} fail, ` +
      `${metrics.underSampled} under-sampled, ${metrics.notApplicable} n/a, ${metrics.withinNoise} inside ` +
      `the seed noise, of ${metrics.gates} gates`,
    ...(metrics.failed === 0
      ? []
      : metrics.failures.map((gate) => `    FAIL ${gate.id}: ${gate.detail} [bound: ${gate.bound}]`)),
    ...(metrics.underSampled === 0
      ? []
      : [`  under-sampled gates report no verdict; raise --games to buy more distinct trajectories`]),
    ...(metrics.withinNoise === 0
      ? []
      : [`  ${metrics.withinNoise} gate(s) missed inside this run's own seed noise; not a pass, not a fail`]),
    ...(metrics.notApplicable === 0
      ? []
      : [`  ${metrics.notApplicable} gate(s) had nothing in the pool to measure`]),
    `  report                ${metrics.reportPath}`,
  ];
}

function forgeSection(summary: SliceSummary): readonly string[] {
  const forge = summary.forge;
  const detail =
    forge.status === 'passed'
      ? `Forge ${forge.forgeVersion ?? 'unknown'} loaded all ${forge.cardCount} cards and played ${forge.gamesPlayed} game(s)`
      : forge.reason;
  // A `skipped` status is only ever reached after `transpileSet` returned no
  // rejections, because the gate transpiles before it looks for an engine. So
  // the DSL-to-Forge half of the conformance claim did hold; only the boot did
  // not run. Saying so keeps "skipped" from reading as "nothing was checked".
  const transpiled =
    forge.skippedByRequest || forge.status === 'failed'
      ? []
      : [`  transpile             all ${forge.cardCount} cards mapped to Forge scripts with no rejections`];
  return [
    '',
    '## Forge boot gate',
    `  status                ${forge.status.toUpperCase()}${forge.status === 'skipped' ? ' (not a pass: the boot is unproven)' : ''}`,
    ...transpiled,
    `  detail                ${detail}`,
    ...(forge.problemCards.length === 0 ? [] : [`  problem cards         ${forge.problemCards.join(', ')}`]),
  ];
}

export function formatSummary(summary: SliceSummary): string {
  return [
    statusLine(summary),
    `  run seed              ${summary.runSeed}`,
    `  duration              ${(summary.durationMs / 1000).toFixed(1)} s`,
    `  metrics gate          ${summary.metricsGate}`,
    ...setgenSection(summary),
    ...deckSection(summary),
    ...throughputSection(summary),
    ...metricsSection(summary),
    ...forgeSection(summary),
    '',
    '## Artifacts',
    ...Object.entries(summary.artifacts).map(([name, path]) => `  ${name.padEnd(21)} ${path}`),
    ...(summary.storePath === null ? [] : [`  ${'labStore'.padEnd(21)} ${summary.storePath}`]),
  ].join('\n');
}

/** One line naming the stage that broke the run, for the CLI's stderr. */
export function formatStageFailure(stage: SliceStage, reason: string): string {
  return `SLICE FAILED at stage "${stage}" — ${STAGE_LABELS[stage]}\n  ${reason}`;
}
