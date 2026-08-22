/**
 * The generation report: everything a designer needs to trust or distrust a
 * generated set, without rerunning it.
 *
 * Three things are load-bearing here. Retry counts per slot say where the model
 * fought the skeleton. The critique record says what semantic judgment asked
 * for and which of those asks survived a second validation. The token/cost totals say
 * what the set cost, with the accounting source labeled rather than assumed.
 */
import type { Card, TriggerCondition } from '@mtg/dsl';
import { TRIGGER_CONDITIONS } from '@mtg/dsl';
import type { CostSource, TokenUsage } from '@mtg/llm';
import { addUsage, describeUsage, worstCostSource, ZERO_USAGE } from '@mtg/llm';
import type { ArchetypePlan, PairViability } from './archetype/index';
import type { Critique, CritiqueRevision } from './critique';
import type { CallRecord } from './fill';
import type { SetFinding } from './validate/index';
import { finding } from './validate/index';

export interface UsageTotals {
  readonly calls: number;
  readonly failedCalls: number;
  readonly usage: TokenUsage;
  readonly costUsd: number;
  readonly costSource: CostSource;
  readonly durationMs: number;
}

export function totalUsage(calls: readonly CallRecord[]): UsageTotals {
  return {
    calls: calls.length,
    failedCalls: calls.filter((call) => call.error !== undefined).length,
    usage: calls.reduce<TokenUsage>((sum, call) => addUsage(sum, call.usage), ZERO_USAGE),
    costUsd: calls.reduce((sum, call) => sum + call.costUsd, 0),
    costSource: worstCostSource(calls.map((call) => call.costSource)),
    durationMs: calls.reduce((sum, call) => sum + call.durationMs, 0),
  };
}

export interface RetryRound {
  readonly round: number;
  /** Slots this round tried to fix. */
  readonly slotIds: readonly string[];
  /** The errors that caused the round, by finding code. */
  readonly causes: readonly string[];
  readonly slotsRepaired: number;
}

/** `applied` is the only outcome in which the set carries what the reviewer asked. */
export type RevisionOutcome = 'applied' | 'reverted' | 'unfilled' | 'dropped';

export interface RevisionRecord {
  readonly slotId: string;
  readonly category: CritiqueRevision['category'];
  readonly observation: string;
  readonly instruction: string;
  readonly outcome: RevisionOutcome;
  /** Present on every outcome but `applied`: why the set does not carry the ask. */
  readonly reason?: string;
}

export interface CritiqueRecord {
  readonly ran: boolean;
  readonly critique?: Critique;
  /** One record per major revision the reviewer named; minor notes stay in `critique`. */
  readonly revisions: readonly RevisionRecord[];
  /** Present when the reviewer produced no schema-valid answer. */
  readonly error?: string;
}

/**
 * The design critique's asks that the finished set does not carry.
 *
 * This is the answer to a report that read green over a set its own reviewer
 * failed (`mtg-rz5h`): the critique was stored and consulted by nothing, so a
 * run could revert or drop a major revision and still print `findings: []`.
 *
 * Warnings, deliberately. The split is a division of authority, not a ranking:
 * the deterministic gates own whether the kernel can run these cards and they
 * fail the run, while the reviewer owns design judgment and annotates it. A
 * reverted revision was reverted precisely because taking it would have broken a
 * card the gates pass, so failing the run on it would punish the run for
 * protecting the set; and one model call should not be able to fail a 249-card
 * paid run with no appeal. What the warning does buy is that the ask is in
 * `findings`, which every consumer of the report already reads.
 *
 * The reviewer's prose verdict is not turned into findings at all. Deciding
 * whether a paragraph of design criticism amounts to a failure is semantic
 * judgment, and inferring it from the text in code is exactly the keyword
 * matching ZFC forbids. It is stated instead, in full and labeled unenforced, by
 * `formatReport`.
 */
export function critiqueFindings(record: CritiqueRecord): SetFinding[] {
  return record.revisions
    .filter((revision) => revision.outcome !== 'applied')
    .map((revision) =>
      finding(
        'CRITIQUE_UNRESOLVED',
        'warning',
        `the design critique asked (${revision.category}, ${revision.outcome}) for ${revision.slotId}: ` +
          revision.instruction +
          (revision.reason === undefined ? '' : ` — ${revision.reason}`),
        [revision.slotId],
      ),
    );
}

/** One color pair's structure, as printed rather than as planned. */
export interface ArchetypeSummary {
  readonly pair: string;
  readonly identity: string;
  /**
   * Cards a drafter could read this pair off, which takes a card the other nine
   * archetypes cannot play. Empty on a set that prints no gold, and empty is the
   * whole point: the reserved slot is named in `shortfalls` with the number of
   * rival pairs that take it, where nothing can mistake it for a signpost.
   */
  readonly signpostSlotIds: readonly string[];
  readonly playables: number;
  /** Playables no other pair can play; zero on a set that prints no gold cards. */
  readonly own: number;
  readonly creatures: number;
  readonly removal: number;
  /** Answers a Limited deck drafted out of this pool would hold. */
  readonly answersInDeck: number;
  /** Playables that resolve without touching the battlefield. */
  readonly inert: number;
  readonly ok: boolean;
  readonly shortfalls: readonly string[];
}

export function summariseArchetypes(
  plans: readonly ArchetypePlan[],
  reports: readonly PairViability[],
): ArchetypeSummary[] {
  return reports.map((report): ArchetypeSummary => {
    const plan = plans.find((item) => item.pair === report.pair);
    return {
      pair: report.pair,
      identity: plan?.identity ?? report.pair,
      signpostSlotIds: report.signpostSlotIds,
      playables: report.playables,
      own: report.own,
      creatures: report.creatures,
      removal: report.removal,
      answersInDeck: report.answersInDeck,
      inert: report.inert,
      ok: report.ok,
      shortfalls: report.shortfalls.map((item) => item.detail),
    };
  });
}

/**
 * How many triggers the set printed on each CR 603 condition, all three named
 * whether or not the set used them.
 *
 * A zero is the whole point, and it is why the row is a total `Record` rather
 * than a tally of what turned up. the flagship set printed seventeen triggers
 * and not one of them was an enters trigger - the most common triggered ability
 * in real Limited - across two builds and two live runs, and nothing in the
 * pipeline said so. A designer read the set by eye and noticed (`mtg-itf`).
 * Counted here, a monotonous trigger half is a line in the report the run that
 * caused it prints, next to the retries and the cost.
 *
 * Reported, never failed. How many enters triggers a set wants is a design
 * judgment about that set; how many it printed is arithmetic.
 */
export function censusTriggerConditions(cards: readonly Card[]): Readonly<Record<TriggerCondition, number>> {
  const census = Object.fromEntries(TRIGGER_CONDITIONS.map((condition) => [condition, 0])) as Record<
    TriggerCondition,
    number
  >;
  for (const card of cards) {
    for (const ability of card.abilities) {
      if (ability.kind === 'triggered') census[ability.condition] += 1;
    }
  }
  return census;
}

export interface GenerationReport {
  readonly setCode: string;
  readonly setName: string;
  readonly seed: string;
  readonly targetSize: number;
  readonly profile: { readonly name: string; readonly version: number; readonly derivedFrom: string };
  readonly slots: number;
  readonly cardsPrinted: number;
  /**
   * Cards the brief handed the pipeline finished, appended after the generated
   * ones (`authored.ts`). Counted separately from `cardsPrinted` because they
   * fill no slot: the set on disk holds `cardsPrinted + authoredCards` cards.
   */
  readonly authoredCards: number;
  /** Cards that pass `validateCard` with zero violations; measured, not assumed. */
  readonly legalCards: number;
  /** Fill attempts per slot: 1 means it was right the first time. */
  readonly attemptsPerSlot: Readonly<Record<string, number>>;
  readonly slotsNeedingRetry: readonly string[];
  /**
   * Repeated effects assembly dropped before the DSL saw the card, across every
   * fill call including the ones whose cards were then rejected. A nonzero count
   * is the generator proposing cards `DUPLICATE_EFFECT` would have refused; it
   * is reported rather than swallowed so the rate is visible without diffing
   * fixtures card by card.
   */
  readonly duplicateEffectsDropped: number;
  /** Triggers printed per CR 603 condition; all three conditions, zeros kept. */
  readonly triggerConditions: Readonly<Record<TriggerCondition, number>>;
  readonly retryRounds: readonly RetryRound[];
  readonly critique: CritiqueRecord;
  /** Per-color-pair viability, ten rows in canonical pair order. */
  readonly archetypes: readonly ArchetypeSummary[];
  readonly findings: readonly SetFinding[];
  /**
   * True when every slot printed a card that passes every deterministic gate.
   *
   * Its scope is the name: whether the engine can enforce this set. It says
   * nothing about whether the set is the set the brief asked for — that is the
   * critique's question, and `critique` is where the answer is. A run can be
   * enforceable and still carry `CRITIQUE_UNRESOLVED` warnings and a reviewer
   * who says the set misses its own brief; `formatReport` prints both, because
   * a green line above a hidden verdict is how this report last lied.
   */
  readonly enforceable: boolean;
  readonly usage: UsageTotals;
  /** Allocation judgment calls and DSL v0 substitutions, verbatim. */
  readonly notes: readonly string[];
}

/** Slots that took more than one fill call, in allocation order. */
export function slotsNeedingRetry(attempts: ReadonlyMap<string, number>): string[] {
  return [...attempts.entries()].filter(([, count]) => count > 1).map(([slotId]) => slotId);
}

/** The four prose fields of a critique, in the order the reviewer writes them. */
const CRITIQUE_PROSE = [
  ['cohesion', 'cohesion'],
  ['archetypeSupport', 'archetype support'],
  ['flavorConsistency', 'flavor consistency'],
  ['powerOutliers', 'power outliers'],
] as const;

/**
 * What the reviewer said, printed rather than counted.
 *
 * The report used to print two numbers here — revisions applied and reverted —
 * and nothing else, so a reviewer that opened with "the set does not yet read as
 * the set the brief describes" reached the JSON and no reader. The prose is
 * printed in full and labeled as an opinion nothing enforces, which is the
 * honest thing to do with judgment the pipeline has no gate for.
 */
function critiqueLines(record: CritiqueRecord): string[] {
  if (!record.ran) return ['critique: skipped'];
  if (record.critique === undefined)
    return [`critique: ran, no usable answer — ${record.error ?? 'unknown'}`];
  const applied = record.revisions.filter((item) => item.outcome === 'applied').length;
  const unresolved = record.revisions.length - applied;
  const lines = [
    `critique: ${applied}/${record.revisions.length} major revision(s) applied, ${unresolved} unresolved`,
    'critique verdict (design judgment; nothing here fails the run):',
  ];
  for (const [key, label] of CRITIQUE_PROSE) lines.push(`  ${label}: ${record.critique[key]}`);
  return lines;
}

export function formatReport(report: GenerationReport): string {
  const lines = [
    `${report.setName} (${report.setCode}): ${report.cardsPrinted}/${report.slots} slots printed, ${report.legalCards} legal`,
    `seed: ${report.seed}; profile: ${report.profile.name} v${report.profile.version} from ${report.profile.derivedFrom}`,
    `enforceable: ${report.enforceable ? 'yes' : 'NO'} (deterministic gates only; the design critique is not one of them)`,
    `retries: ${report.slotsNeedingRetry.length} slot(s) over ${report.retryRounds.length} round(s)`,
    ...critiqueLines(report.critique),
    `calls: ${report.usage.calls} (${report.usage.failedCalls} failed); tokens: ${describeUsage(report.usage.usage)}; cost: $${report.usage.costUsd.toFixed(4)} (${report.usage.costSource})`,
  ];
  if (report.authoredCards > 0) {
    lines.push(`authored: ${report.authoredCards} card(s) printed from the brief, after the generated ones`);
  }
  if (report.duplicateEffectsDropped > 0) {
    lines.push(
      `normalized: ${report.duplicateEffectsDropped} repeated effect(s) dropped before parsing ` +
        '(the model asked for a card the DSL would reject)',
    );
  }
  const triggers = Object.values(report.triggerConditions).reduce((sum, count) => sum + count, 0);
  if (triggers > 0) {
    const spread = TRIGGER_CONDITIONS.map(
      (condition) => `${condition} ${report.triggerConditions[condition]}`,
    ).join(', ');
    lines.push(`triggers: ${triggers} on ${spread}`);
  }
  if (report.archetypes.length > 0) {
    const total = report.archetypes.length;
    const failing = report.archetypes.filter((item) => !item.ok);
    lines.push(`archetypes: ${total - failing.length}/${total} viable`);
    // The qualifier belongs next to the verdict, not buried in the findings: a
    // pair with no card of its own is counted as viable off a pool every other
    // pair counts too, and a green line above that fact is how this report last
    // claimed ten distinct archetypes from ten identical numbers.
    const shared = report.archetypes.filter((item) => item.own === 0);
    if (shared.length > 0) {
      lines.push(
        `  ${shared.length} of those ${total} hold no card another pair cannot play, so their playables ` +
          "figure is the set's color balance and cannot tell one archetype from another",
      );
    }
    for (const item of report.archetypes) {
      const shortfalls = item.shortfalls.length === 0 ? '' : ` — ${item.shortfalls.join('; ')}`;
      lines.push(
        `  ${item.pair}: ${item.playables} playables (${item.own} of its own), ${item.creatures} bodies, ` +
          `${item.removal} answers (${item.answersInDeck} per deck), ${item.inert} inert, ` +
          `signpost ${item.signpostSlotIds.join('/') || 'none'}${shortfalls}`,
      );
    }
  }
  if (report.findings.length > 0) {
    lines.push('findings:');
    for (const item of report.findings) {
      lines.push(`  [${item.severity}] ${item.code}: ${item.message}`);
    }
  }
  return lines.join('\n');
}
