/**
 * The comparison itself: informed pipeline against generic agent, same model,
 * same requests, measured two ways.
 *
 * The deterministic half is the one that carries weight. Legality,
 * hallucination, color conformance, copy limits and budget are facts about the
 * store, they are checked identically for both decks, and the informed pipeline
 * should win them by construction — it verifies every card against the store
 * and the baseline verifies nothing. A result where it does not win those is a
 * bug in this package, not a close contest.
 *
 * The judged half is softer and is reported separately rather than blended into
 * one number. Averaging a legality rate with an opinion score produces a figure
 * that looks rigorous and means nothing.
 *
 * The third half — the one the acceptance criteria ask for and neither of those
 * measures — is that every card choice traces to a stated criterion. It is one
 * sided, so it is neither a conformance row nor a judgment: see `trace.ts`.
 *
 * A scenario a builder could not finish is counted, not skipped. The run of
 * 2026-08-11 timed out building one of six informed decks and the summary
 * printed "informed 4 · baseline 1 · tie 0", which is five judged scenarios
 * reading as six. A tally whose denominator is invisible is a tally that
 * overstates itself.
 */
import type { DataStore } from '@mtg/data';
import { BASIC_LAND_FOR_COLOR } from '@mtg/dsl';
import type { Color } from '@mtg/dsl';
import type { LlmProvider } from '@mtg/llm';
import { auditDeck, type DeckAudit, type DeckEntry } from './audit';
import { buildBaselineDeck } from './baseline';
import { buildInformedDeck } from './build';
import type { DeckCriteria, DeckCriteriaInput } from './criteria';
import { DeckCriteriaSchema } from './criteria';
import { judgeBlind, type JudgeResult } from './judge';
import { describeLandCount, type LandPlan } from './land-plan';
import { traceCriteria, type CriterionTrace } from './trace';

export interface Scenario {
  readonly id: string;
  readonly criteria: DeckCriteriaInput;
}

export interface ScenarioOutcome {
  readonly id: string;
  readonly criteria: DeckCriteria;
  /**
   * The land count the informed build ran and where it came from. Reported
   * because "the count varies with the archetype" is otherwise invisible: a
   * flattened decklist shows Mountains, not the decision behind them.
   */
  readonly informedLandPlan: LandPlan | undefined;
  readonly informed: { readonly entries: readonly DeckEntry[]; readonly audit: DeckAudit };
  readonly baseline: { readonly entries: readonly DeckEntry[]; readonly audit: DeckAudit };
  /** The tracing clause for this deck; undefined when nothing was built. */
  readonly informedTrace: CriterionTrace | undefined;
  readonly judgement: JudgeResult | undefined;
  /**
   * Set when that builder threw; the scenario still reports the other side.
   *
   * One field per side rather than the first error of either. A single field
   * hides a baseline failure behind an informed one, and in a comparison the
   * side that failed is most of what a failure says.
   */
  readonly informedError: string | undefined;
  readonly baselineError: string | undefined;
}

/** The tracing clause, summed over the informed decks that exist to trace. */
export interface TraceSummary {
  readonly decks: number;
  /** Of those, the decks where every choice traces. */
  readonly cleanDecks: number;
  readonly chosenEntries: number;
  readonly citedEntries: number;
  readonly findings: number;
  readonly derivedBasics: number;
}

export interface EvalSummary {
  readonly scenarios: number;
  /** Scenarios where that builder threw and produced no deck at all. */
  readonly informedFailures: number;
  readonly baselineFailures: number;
  /** Scenarios the judge actually scored: the denominator of the win tally. */
  readonly judgedScenarios: number;
  readonly tracing: TraceSummary;
  readonly informedCleanDecks: number;
  readonly baselineCleanDecks: number;
  readonly informedViolations: number;
  readonly baselineViolations: number;
  readonly informedUnknownCards: number;
  readonly baselineUnknownCards: number;
  readonly informedIllegalCards: number;
  readonly baselineIllegalCards: number;
  readonly informedWins: number;
  readonly baselineWins: number;
  readonly ties: number;
  readonly informedMeanScore: number;
  readonly baselineMeanScore: number;
}

export interface EvalResult {
  readonly outcomes: readonly ScenarioOutcome[];
  readonly summary: EvalSummary;
}

export interface RunEvalInput {
  readonly store: DataStore;
  readonly provider: LlmProvider;
  readonly scenarios: readonly Scenario[];
  /** Seeds the per-scenario A/B blinding. */
  readonly seed?: string;
  /** Skip the model judge and report only the deterministic audit. */
  readonly skipJudge?: boolean;
}

export async function runEval(input: RunEvalInput): Promise<EvalResult> {
  const seed = input.seed ?? 'decklab-eval';
  const outcomes: ScenarioOutcome[] = [];

  for (const scenario of input.scenarios) {
    const criteria = DeckCriteriaSchema.parse(scenario.criteria);

    // A builder that throws must not abort the run: the other side's result is
    // still evidence, and a scenario the informed pipeline refuses to build is
    // itself worth reporting.
    let informedEntries: readonly DeckEntry[] = [];
    let informedLandPlan: LandPlan | undefined;
    let informedTrace: CriterionTrace | undefined;
    let informedError: string | undefined;
    try {
      const built = await buildInformedDeck({
        store: input.store,
        provider: input.provider,
        criteria: scenario.criteria,
      });
      informedEntries = toEntries(built);
      informedLandPlan = built.landPlan;
      // Traced from the deck rather than from the flattened entries: the
      // citations live on the inclusions, and flattening drops them.
      informedTrace = traceCriteria(built.deck, criteria);
    } catch (reason: unknown) {
      informedError = `informed: ${reason instanceof Error ? reason.message : String(reason)}`;
    }

    let baselineEntries: readonly DeckEntry[] = [];
    let baselineError: string | undefined;
    try {
      const built = await buildBaselineDeck(input.provider, criteria);
      baselineEntries = built.entries.map((entry) => ({ name: entry.name, count: entry.count }));
    } catch (reason: unknown) {
      baselineError = `baseline: ${reason instanceof Error ? reason.message : String(reason)}`;
    }

    const informedAudit = auditDeck(input.store, informedEntries, criteria);
    const baselineAudit = auditDeck(input.store, baselineEntries, criteria);

    const judgeable = input.skipJudge !== true && informedEntries.length > 0 && baselineEntries.length > 0;

    const judgement = judgeable
      ? await judgeBlind({
          provider: input.provider,
          criteria,
          informed: informedEntries,
          baseline: baselineEntries,
          seed: `${seed}:${scenario.id}`,
        })
      : undefined;

    outcomes.push({
      id: scenario.id,
      criteria,
      informedLandPlan,
      informed: { entries: informedEntries, audit: informedAudit },
      baseline: { entries: baselineEntries, audit: baselineAudit },
      informedTrace,
      judgement,
      informedError,
      baselineError,
    });
  }

  return { outcomes, summary: summarize(outcomes) };
}

/** The informed build's spells, nonbasic lands and computed basics as one list. */
function toEntries(built: Awaited<ReturnType<typeof buildInformedDeck>>): DeckEntry[] {
  const entries: DeckEntry[] = [
    ...built.deck.spells.map((entry) => ({ name: entry.card.name, count: entry.count })),
    ...built.deck.lands.map((entry) => ({ name: entry.card.name, count: entry.count })),
  ];
  for (const [color, count] of Object.entries(built.deck.manaBase.basics)) {
    if (count > 0) entries.push({ name: BASIC_LAND_FOR_COLOR[color as Color] ?? color, count });
  }
  return entries;
}

function countKind(audit: DeckAudit, kind: string): number {
  return audit.violations.filter((violation) => violation.kind === kind).length;
}

function summarize(outcomes: readonly ScenarioOutcome[]): EvalSummary {
  const judged = outcomes.filter((outcome) => outcome.judgement !== undefined);
  const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);
  const traces = outcomes
    .map((outcome) => outcome.informedTrace)
    .filter((trace): trace is CriterionTrace => trace !== undefined);

  return {
    scenarios: outcomes.length,
    informedFailures: outcomes.filter((outcome) => outcome.informedError !== undefined).length,
    baselineFailures: outcomes.filter((outcome) => outcome.baselineError !== undefined).length,
    judgedScenarios: judged.length,
    tracing: {
      decks: traces.length,
      cleanDecks: traces.filter((trace) => trace.clean).length,
      chosenEntries: sum(traces.map((trace) => trace.chosenEntries)),
      citedEntries: sum(traces.map((trace) => trace.citedEntries)),
      findings: sum(traces.map((trace) => trace.findings.length)),
      derivedBasics: sum(traces.map((trace) => trace.derivedBasics)),
    },
    informedCleanDecks: outcomes.filter((outcome) => outcome.informed.audit.clean).length,
    baselineCleanDecks: outcomes.filter((outcome) => outcome.baseline.audit.clean).length,
    informedViolations: sum(outcomes.map((outcome) => outcome.informed.audit.violations.length)),
    baselineViolations: sum(outcomes.map((outcome) => outcome.baseline.audit.violations.length)),
    informedUnknownCards: sum(outcomes.map((o) => countKind(o.informed.audit, 'unknown-card'))),
    baselineUnknownCards: sum(outcomes.map((o) => countKind(o.baseline.audit, 'unknown-card'))),
    informedIllegalCards: sum(outcomes.map((o) => countKind(o.informed.audit, 'illegal-in-format'))),
    baselineIllegalCards: sum(outcomes.map((o) => countKind(o.baseline.audit, 'illegal-in-format'))),
    informedWins: judged.filter((outcome) => outcome.judgement?.winner === 'informed').length,
    baselineWins: judged.filter((outcome) => outcome.judgement?.winner === 'baseline').length,
    ties: judged.filter((outcome) => outcome.judgement?.winner === 'tie').length,
    informedMeanScore: mean(judged.map((outcome) => outcome.judgement?.informedScore ?? 0)),
    baselineMeanScore: mean(judged.map((outcome) => outcome.judgement?.baselineScore ?? 0)),
  };
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function formatEvalReport(result: EvalResult): string {
  const { summary } = result;
  const failures = describeFailures(summary);
  const lines: string[] = [
    '# Deck lab vs generic agent',
    '',
    `${summary.scenarios} scenarios, same model and same requests for both builders.`,
    ...(failures === null ? [] : [failures]),
    '',
    '## Deterministic conformance',
    '',
    '| measure | informed | baseline |',
    '| --- | --- | --- |',
    `| decks with nothing wrong | ${summary.informedCleanDecks}/${summary.scenarios} | ${summary.baselineCleanDecks}/${summary.scenarios} |`,
    // A build that threw is a deck that does not exist, and an empty deck breaks
    // no rule: it scores zero violations and would otherwise read as a flawless
    // one on every row below.
    `| builds that produced no deck | ${summary.informedFailures} | ${summary.baselineFailures} |`,
    `| total violations | ${summary.informedViolations} | ${summary.baselineViolations} |`,
    `| cards that do not exist | ${summary.informedUnknownCards} | ${summary.baselineUnknownCards} |`,
    `| cards illegal in format | ${summary.informedIllegalCards} | ${summary.baselineIllegalCards} |`,
    '',
    ...traceSection(summary.tracing),
  ];

  if (summary.judgedScenarios > 0) {
    lines.push(
      '## Blind judgment',
      '',
      `over ${summary.judgedScenarios} of ${summary.scenarios} scenarios: informed ${summary.informedWins} · baseline ${summary.baselineWins} · tie ${summary.ties}`,
      `mean score: informed ${summary.informedMeanScore.toFixed(1)}, baseline ${summary.baselineMeanScore.toFixed(1)}`,
      '',
    );
  }

  lines.push('## Per scenario', '');
  for (const outcome of result.outcomes) {
    lines.push(
      `### ${outcome.id}`,
      '',
      `> ${outcome.criteria.prompt}`,
      '',
      `- informed: ${outcome.informed.audit.totalCards} cards, ${outcome.informed.audit.violations.length} violations, $${outcome.informed.audit.deckPriceUsd.toFixed(2)}`,
      `- baseline: ${outcome.baseline.audit.totalCards} cards, ${outcome.baseline.audit.violations.length} violations, $${outcome.baseline.audit.deckPriceUsd.toFixed(2)}`,
    );
    if (outcome.informedLandPlan !== undefined) {
      lines.push(`- informed mana base: ${describeLandCount(outcome.informedLandPlan)}`);
    }
    const trace = outcome.informedTrace;
    if (trace !== undefined) {
      // The two numbers in this sentence are not the same unit: choices are
      // counted distinct (one card, whatever its copy count) and basics are
      // counted with multiplicity (every land run, per `derivedBasics`'s own
      // docblock in `trace.ts`). Neither side can adopt the other's unit
      // without losing what it measures — collapsing basics to "distinct
      // types" would erase how much of the deck they are, and inflating
      // choices to copy count would break the citation-rate fraction the
      // table above already reports under this same name — so both units are
      // named rather than picked (mtg-bc2.24.3).
      lines.push(
        `- informed tracing: ${trace.citedEntries}/${trace.chosenEntries} choices cite a stated criterion (distinct cards); ${trace.derivedBasics} basic-land cards run from them (counted with multiplicity)`,
      );
    }
    if (outcome.judgement !== undefined) {
      lines.push(
        `- judge: ${outcome.judgement.winner} (${outcome.judgement.informedScore} vs ${outcome.judgement.baselineScore}) — ${outcome.judgement.verdict.reason}`,
      );
    }
    if (outcome.informedError !== undefined) lines.push(`- error: ${outcome.informedError}`);
    if (outcome.baselineError !== undefined) lines.push(`- error: ${outcome.baselineError}`);
    for (const finding of trace?.findings ?? []) {
      lines.push(`  - INFORMED trace ${finding.kind}: ${finding.detail}`);
    }
    // Both sides' violations are printed. Showing only the baseline's would
    // hide exactly the result that matters most: the informed pipeline
    // breaking a rule it claims to make unrepresentable.
    for (const violation of outcome.informed.audit.violations) {
      lines.push(`  - INFORMED ${violation.kind}: ${violation.detail}`);
    }
    for (const violation of outcome.baseline.audit.violations.slice(0, 5)) {
      lines.push(`  - baseline ${violation.kind}: ${violation.detail}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * The sentence a reader needs before any tally below it. Without it, a run where
 * one side never built reads as a run where both sides were compared six times.
 */
function describeFailures(summary: EvalSummary): string | null {
  const total = summary.informedFailures + summary.baselineFailures;
  if (total === 0) return null;
  const sides: string[] = [];
  if (summary.informedFailures > 0) sides.push(`${summary.informedFailures} informed`);
  if (summary.baselineFailures > 0) sides.push(`${summary.baselineFailures} baseline`);
  return (
    `${sides.join(' and ')} ${total === 1 ? 'build' : 'builds'} produced no deck at all, ` +
    `so ${summary.judgedScenarios} of ${summary.scenarios} scenarios were judged.`
  );
}

function traceSection(tracing: TraceSummary): readonly string[] {
  const heading = ['## Criterion tracing', ''];
  if (tracing.decks === 0) {
    return [...heading, 'No informed deck was built, so the clause was not measured.', ''];
  }
  return [
    ...heading,
    'Every card the informed pipeline chose, against the ids its scenario stated.',
    'Basic lands are counted rather than cited: nobody picks them, they are',
    'apportioned from the pip demand of the cards that were picked.',
    '',
    '| measure | informed |',
    '| --- | --- |',
    `| decks where every choice traces | ${tracing.cleanDecks}/${tracing.decks} built |`,
    `| choices citing a stated criterion | ${tracing.citedEntries}/${tracing.chosenEntries} |`,
    `| choices with a broken trace | ${tracing.findings} |`,
    `| basic lands derived from those choices | ${tracing.derivedBasics} |`,
    '',
  ];
}
