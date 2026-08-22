/**
 * The human-readable format-health summary.
 *
 * Two conventions are borrowed straight from 17lands' own presentation, so a
 * reader who already reads their card pages reads ours the same way:
 *
 *  - **Null means under-sampled, not zero.** Their `card_ratings` endpoint
 *    returns null for cards below the sample threshold (metrics report §2.5);
 *    this report prints `n/a (under-sampled: N distinct / floor F)`.
 *  - **Outliers are marked at 1.5 standard deviations.** Their outlier arrows
 *    mark "any value that is at least 1.5 standard deviations away from the
 *    mean" (§3.2, adopted explicitly in the report's outlier note); the
 *    color-pair table flags pairs at that distance from the pair mean.
 */
import type { Fairness, FairnessReading } from './fairness';
import { NOT_ASKED, fairness, fairnessVerdictLabel, findingLine } from './fairness';
import type { FormatHealth } from './health';
import { gateStatusLabel } from './gates';
import { checkpointLabel } from './mana';
import type { ColorPairRecord } from './win-rate';

const OUTLIER_SIGMA = 1.5;

function percent(value: number | null): string {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function number(value: number | null, digits = 1): string {
  return value === null ? 'n/a' : value.toFixed(digits);
}

function standardDeviation(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - average) * (value - average), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function outlierFlags(records: readonly ColorPairRecord[]): ReadonlyMap<string, string> {
  const rates = records.flatMap((entry) => (entry.winRate.value === null ? [] : [entry.winRate.value]));
  const deviation = standardDeviation(rates);
  const flags = new Map<string, string>();
  if (deviation === null || deviation === 0) return flags;
  const average = rates.reduce((sum, value) => sum + value, 0) / rates.length;
  for (const entry of records) {
    const rate = entry.winRate.value;
    if (rate === null) continue;
    const z = (rate - average) / deviation;
    if (z >= OUTLIER_SIGMA) flags.set(entry.pair, `+${z.toFixed(1)}σ`);
    else if (z <= -OUTLIER_SIGMA) flags.set(entry.pair, `${z.toFixed(1)}σ`);
  }
  return flags;
}

function sampleNote(sample: { readonly distinctSamples: number; readonly floor: number }): string {
  return `under-sampled: ${sample.distinctSamples} distinct / floor ${sample.floor}`;
}

function overviewSection(health: FormatHealth): readonly string[] {
  const failures = health.gates.filter((gate) => gate.status === 'fail').length;
  const unsampled = health.gates.filter((gate) => gate.status === 'underSampled').length;
  const notApplicable = health.gates.filter((gate) => gate.status === 'notApplicable').length;
  // Three ways to not answer, all three subtracted from the pass count. A
  // status left out of this arithmetic reads as green in the one line most
  // people read (`./gates` on why none of the three is a pass).
  const insideNoise = health.gates.filter((gate) => gate.status === 'withinNoise').length;
  return [
    `# Format health — ${health.label}`,
    '',
    `- games: **${health.games}** (${health.distinctGames} distinct trajectories, ` +
      `${percent(health.duplicateShare)} duplicated)`,
    `- gates: ${health.gates.length - failures - unsampled - notApplicable - insideNoise} pass, ` +
      `**${failures} fail**, ${unsampled} under-sampled, ${notApplicable} n/a, ` +
      `${insideNoise} inside the seed noise`,
    '',
    health.duplicateShare > 0.1
      ? '> Duplicate trajectories exceed 10% of the run. Confidence intervals below are computed over ' +
        'distinct games, but the run is buying less evidence per game than it looks like ' +
        '(metrics report §10.7).'
      : '',
  ].filter((line) => line !== '');
}

function lengthSection(health: FormatHealth): readonly string[] {
  const lines = ['', '## Game length', ''];
  const value = health.gameLength.value;
  if (value === null) {
    lines.push(`n/a (${sampleNote(health.gameLength)})`);
    return lines;
  }
  lines.push(
    '| statistic | rounds | player turns |',
    '| --- | ---: | ---: |',
    `| median | ${number(value.rounds.median)} | ${number(value.playerTurns.median)} |`,
    `| mean | ${number(value.rounds.mean)} | ${number(value.playerTurns.mean)} |`,
    `| p25 / p75 | ${number(value.rounds.p25)} / ${number(value.rounds.p75)} | ${number(value.playerTurns.p25)} / ${number(value.playerTurns.p75)} |`,
    `| IQR | ${number(value.rounds.iqr)} | ${number(value.playerTurns.iqr)} |`,
    `| p10 / p90 | ${number(value.rounds.p10)} / ${number(value.rounds.p90)} | ${number(value.playerTurns.p10)} / ${number(value.playerTurns.p90)} |`,
    `| min / max | ${number(value.rounds.min, 0)} / ${number(value.rounds.max, 0)} | ${number(value.playerTurns.min, 0)} / ${number(value.playerTurns.max, 0)} |`,
    '',
    `Modal round ${value.modalRound}. Long games (round ${health.config.length.longGameRound}+): ` +
      `${percent(value.longGameShare)}. Four rounds or fewer: ${percent(value.blowoutShare)}.`,
    '',
    'Cumulative share finished by round: ' +
      value.finishedByRound
        .map((cumulative, round) => (round === 0 ? '' : `r${round} ${percent(cumulative)}`))
        .filter((text) => text !== '')
        .slice(0, 20)
        .join(', '),
  );
  const onPlay = health.onPlay.value;
  lines.push(
    '',
    onPlay === null
      ? `On the play: n/a (${sampleNote(health.onPlay)})`
      : `On the play: ${percent(onPlay.winRate)} over ${onPlay.decided} decided games ` +
          `(${(onPlay.advantage * 100).toFixed(1)}pp advantage).`,
  );
  return lines;
}

function manaSection(health: FormatHealth): readonly string[] {
  const lines = [
    '',
    '## Mana development vs Karsten priors',
    '',
    '| checkpoint | observed | hypergeometric prior | delta | side-games |',
    '| --- | ---: | ---: | ---: | ---: |',
  ];
  for (const result of health.mana) {
    const observed = result.observed.value;
    lines.push(
      `| ${checkpointLabel(result.checkpoint)} | ${observed === null ? `n/a (${sampleNote(result.observed)})` : percent(observed)} | ` +
        `${percent(result.prior)} | ${result.delta === null ? 'n/a' : `${(result.delta * 100).toFixed(1)}pp`} | ` +
        `${result.observedSides} / ${result.eligibleSides} |`,
    );
  }
  lines.push(
    '',
    'The prior is what the draws alone imply for a ' +
      `${health.config.mana.shape.lands}-land, ${health.config.mana.shape.size}-card deck. The gap also carries ` +
      'the bots’ land-drop policy, land removal, and the survivorship of games that reached the ' +
      'checkpoint at all — the last of which biases screw rates downward whenever screwed players lose early.',
  );
  return lines;
}

function decisivenessSection(health: FormatHealth): readonly string[] {
  const lines = ['', '## Stall and decisiveness', ''];
  const value = health.decisiveness.value;
  if (value === null) {
    lines.push(`n/a (${sampleNote(health.decisiveness)})`);
    return lines;
  }
  lines.push(
    `- turn-cap stalls: ${percent(value.stallRate)}`,
    `- deck-outs: ${percent(value.deckOutRate)}`,
    `- draws (any reason): ${percent(value.drawRate)}`,
    `- decided by round ${value.decisiveRound}: ${percent(value.decidedByRound)}`,
    `- inert turns: ${percent(value.inertTurnRate)} (${value.inertTurns} of ${value.totalTurns}, ` +
      `${value.inertTurnsPerGame.toFixed(1)} per game)`,
  );
  return lines;
}

/**
 * Ability usage: two rates, two floors, and a pool line under both.
 *
 * The pool line is there so "the abilities never fire" and "the pool has no
 * abilities" read as the different findings they are. The halves stay apart
 * because an activation is a bot decision and a trigger is not
 * (`src/ability-usage.ts` says why), so one live half cannot carry a dead one.
 */
function abilitySection(health: FormatHealth): readonly string[] {
  const usage = health.abilityUsage;
  if (usage === null) return [];
  const lines = [
    '',
    '## Ability usage',
    '',
    `- pool: ${usage.pool.withActivatedAbility} of ${usage.pool.cards} cards carry an activated ability ` +
      `(${percent(usage.poolShare)}); ${usage.pool.withTriggeredAbility} carry a triggered one ` +
      `(${percent(usage.triggeredPoolShare)})`,
  ];
  const value = usage.usage.value;
  if (value === null) {
    lines.push(
      `- activations: n/a (${sampleNote(usage.usage)})`,
      `- triggers: n/a (${sampleNote(usage.usage)})`,
    );
  } else {
    lines.push(
      `- activations: ${value.activations} over ${value.cardsDrawn} cards drawn ` +
        `(${value.activationsPerGame.toFixed(2)} per game)`,
      `- games in which either seat activated something: ${percent(value.gamesWithActivationShare)}`,
      `- activation rate: ${value.perCardDrawn.toExponential(2)} per card drawn, floor ` +
        `${usage.floorPerCardDrawn === null ? 'n/a' : usage.floorPerCardDrawn.toExponential(2)}`,
      `- triggers: ${value.triggers} over ${value.cardsDrawn} cards drawn ` +
        `(${value.triggersPerGame.toFixed(2)} per game)`,
      `- games in which either seat had something trigger: ${percent(value.gamesWithTriggerShare)}`,
      `- trigger rate: ${value.triggersPerCardDrawn.toExponential(2)} per card drawn, floor ` +
        `${usage.floorTriggersPerCardDrawn === null ? 'n/a' : usage.floorTriggersPerCardDrawn.toExponential(2)}`,
    );
  }
  lines.push(
    '',
    'The two halves are counted apart, from `abilityActivated` and `abilityTriggered` in the kernel ' +
      'event log. A pool that prints only one kind leaves the other gate not-applicable rather than ' +
      'failing it.',
  );
  return lines;
}

function colorPairSection(health: FormatHealth): readonly string[] {
  const flags = outlierFlags(health.colorPairs.records);
  const lines = [
    '',
    '## Color-pair win rates',
    '',
    '| pair | W | L | D | win rate | 95% CI | median rounds | fast wins |',
    '| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: |',
  ];
  const sorted = [...health.colorPairs.records].sort(
    (a, b) => (b.winRate.value ?? -1) - (a.winRate.value ?? -1),
  );
  for (const entry of sorted) {
    const interval = entry.interval.value;
    const flag = flags.get(entry.pair);
    lines.push(
      `| ${entry.pair}${flag === undefined ? '' : ` ${flag}`} | ${entry.wins} | ${entry.losses} | ${entry.draws} | ` +
        `${entry.winRate.value === null ? `n/a (${sampleNote(entry.winRate)})` : percent(entry.winRate.value)} | ` +
        `${interval === null ? 'n/a' : `${percent(interval.low)}-${percent(interval.high)}`} | ` +
        `${number(entry.medianRounds)} | ${percent(entry.fastWinShare)} |`,
    );
  }
  lines.push(
    '',
    `Spread across measured pairs: ${percent(health.colorPairs.spread)}. ` +
      `Mirror games excluded: ${health.colorPairs.mirrorGames}. ` +
      `Outlier marks follow 17lands' 1.5σ convention. ` +
      `"Fast wins" = share of a pair's wins closed by round ${health.config.balance.fastWinRound}.`,
  );
  if (health.dominance.dominant.length > 0) {
    lines.push('', '**Dominant strategies:**');
    for (const finding of health.dominance.dominant) lines.push(`- ${finding.detail}`);
  }
  if (health.dominance.underSampled.length > 0) {
    lines.push('', `Pairs not judged for want of evidence: ${health.dominance.underSampled.join(', ')}.`);
  }
  return lines;
}

function gateSection(health: FormatHealth): readonly string[] {
  const lines = [
    '',
    '## Gates',
    '',
    '| gate | status | observed | bound | detail |',
    '| --- | --- | ---: | --- | --- |',
  ];
  for (const gate of health.gates) {
    lines.push(
      `| \`${gate.id}\` | ${gateStatusLabel(gate.status)} | ${gate.observed === null ? 'n/a' : gate.observed.toFixed(3)} | ` +
        `${gate.bound} | ${gate.detail} |`,
    );
  }
  lines.push('', '### Sources', '');
  for (const source of [...new Set(health.gates.map((gate) => gate.source))]) lines.push(`- ${source}`);
  return lines;
}

/**
 * The answer, above the evidence for it.
 *
 * This section exists because the gate table below it is twenty-five rows and
 * the question anybody opened the file with was one. It states nothing the
 * table does not already contain — `./fairness` is a pure function of
 * `health.gates` — it just says it in the order somebody reads.
 */
function fairnessSection(result: Fairness): readonly string[] {
  const lines: string[] = [
    `## Is the set fair? **${fairnessVerdictLabel(result.verdict)}**`,
    '',
    '| Question | Answer | Gates |',
    '| --- | --- | --- |',
  ];
  for (const reading of result.readings) {
    const census =
      reading.gates.length === 0 ? NOT_ASKED : `${reading.passed} of ${reading.gates.length} passed`;
    lines.push(`| ${reading.asks} | ${fairnessVerdictLabel(reading.verdict)} | ${census} |`);
  }
  const missed = result.readings.flatMap((reading: FairnessReading) => reading.findings);
  if (missed.length > 0) {
    lines.push('', '**Missed bands, worst first:**', '');
    for (const finding of result.findings) lines.push(`- ${findingLine(finding)}`);
  }
  const unjudged = result.readings.flatMap((reading) => reading.unjudged);
  if (unjudged.length > 0) {
    lines.push('', '**Not judged:**', '');
    for (const entry of unjudged) lines.push(`- \`${entry.gate}\` ${entry.reason}`);
  }
  if (result.unattributed.length > 0) {
    lines.push(
      '',
      `**Gates no question reads**, so this run cannot be called fair: ${result.unattributed
        .map((id) => `\`${id}\``)
        .join(', ')}`,
    );
  }
  return [...lines, ''];
}

/** Renders a whole `FormatHealth` as markdown. */
export function report(health: FormatHealth): string {
  return [
    ...overviewSection(health),
    ...fairnessSection(fairness(health)),
    ...lengthSection(health),
    ...manaSection(health),
    ...decisivenessSection(health),
    ...abilitySection(health),
    ...colorPairSection(health),
    ...gateSection(health),
    '',
  ].join('\n');
}
