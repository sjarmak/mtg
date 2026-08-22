/**
 * The pipeline: brief -> allocation -> slot fill -> validate/retry -> critique
 * -> revise -> report.
 *
 * The loop is deliberately bounded in every direction. Retries only ever
 * regenerate the slots a finding blames, never the set. The critique runs once.
 * A revision that fails its second validation is reverted to the card it replaced, so a
 * design note can improve a set but can never make it illegal.
 */
import type { Card, Violation } from '@mtg/dsl';
import { validateCard } from '@mtg/dsl';
import type { SkeletonLiteProfile } from '@mtg/design-data';
import type { LlmProvider } from '@mtg/llm';
import type { Allocation } from './allocate';
import { allocateSlots } from './allocate';
import { checkAuthoredCards, printAuthoredCards } from './authored';
import { derivePins } from './pins';
import type { SetBrief } from './brief';
import { tertiaryBudgetFor } from './brief';
import type { Critique, CritiqueRevision } from './critique';
import { critiqueSet, revisionInstructions, triageRevisions } from './critique';
import type { CallRecord } from './fill';
import { fillSlots } from './fill';
import { applyFlavor, writeFlavor } from './flavor';
import type { CritiqueRecord, GenerationReport, RetryRound, RevisionRecord } from './report';
import {
  censusTriggerConditions,
  critiqueFindings,
  slotsNeedingRetry,
  summariseArchetypes,
  totalUsage,
} from './report';
import { substitutionNotes } from './roles';
import type { Slot } from './slot';
import type { SetValidation } from './validate/index';
import {
  checkSlotFillability,
  errors,
  feedbackForSlot,
  formatFindings,
  unfillableSlots,
  validateGeneratedSet,
} from './validate/index';

export const DEFAULT_MAX_RETRY_ROUNDS = 2;

/** Thrown when the allocation contains a slot no card can fill (`validate/fillable.ts`). */
export class UnfillableSlotsError extends Error {
  readonly slotIds: readonly string[];

  constructor(message: string, slotIds: readonly string[]) {
    super(message);
    this.name = 'UnfillableSlotsError';
    this.slotIds = slotIds;
  }
}

const NO_CORRECTIONS: ReadonlyMap<string, readonly string[]> = new Map();
const NO_REVISIONS: ReadonlyMap<string, string> = new Map();

export interface GenerateOptions {
  readonly provider: LlmProvider;
  readonly brief: SetBrief;
  readonly profile?: SkeletonLiteProfile;
  /** Validation-driven regeneration rounds after the first pass. */
  readonly maxRetryRounds?: number;
  readonly batchSize?: number;
  readonly maxTokens?: number;
  /** Set false to skip the design-review call (used by allocation-only runs). */
  readonly critique?: boolean;
  readonly critiqueMaxTokens?: number;
  /**
   * Set false to skip the flavor-text call.
   *
   * On by default, so a live generation comes back with flavor text on the cards
   * that have room for it without anybody asking. A run that cannot reach a
   * writer — every test in this repository, which runs on recorded fixtures and
   * has none for this pass — produces a set with no flavor text and records why
   * on the call, which is the state every committed set is already in
   * (`flavor.ts`).
   */
  readonly flavor?: boolean;
  readonly flavorMaxTokens?: number;
}

export interface GenerationResult {
  readonly allocation: Allocation;
  /** Printed cards in collector-number order, the brief's authored ones last. */
  readonly cards: readonly Card[];
  readonly validation: SetValidation;
  readonly report: GenerationReport;
}

export async function generateSet(options: GenerateOptions): Promise<GenerationResult> {
  const { provider } = options;
  // Pins are derived against the size actually being run, never taken from the
  // file as written: the skeleton's rare tier exists only above a size floor, so
  // a rarity hand-written for one set size refuses the whole brief at another
  // (`pins.ts`, `mtg-mj5m`). A brief whose stated pins this size can hold comes
  // back unchanged, which is what keeps a recorded run replaying.
  const pins = derivePins(options.brief, options.profile);
  const brief = pins.brief;
  const allocation = allocateSlots(brief, options.profile);
  // Before the first call, because this is the one finding no round of calls can
  // clear: a slot with no keyword, no effect kind and no ability kind permits one
  // card whatever the model is asked, and asking is what costs money.
  // `validateGeneratedSet` raises the same findings so a set validated on its own
  // still reports them; here they stop the run instead of being billed for.
  const unfillable = unfillableSlots(allocation.slots);
  if (unfillable.length > 0) {
    throw new UnfillableSlotsError(
      `generateSet: the allocation contains ${unfillable.length} slot(s) no card can fill; ` +
        `no card was asked for.\n${formatFindings(checkSlotFillability(allocation.slots))}`,
      unfillable.map((slot) => slot.id),
    );
  }
  const tertiaryBudget = tertiaryBudgetFor(brief);
  const maxRetryRounds = options.maxRetryRounds ?? DEFAULT_MAX_RETRY_ROUNDS;

  const cards = new Map<string, Card>();
  const rejected = new Map<string, readonly Violation[]>();
  const attempts = new Map<string, number>();
  const calls: CallRecord[] = [];
  let duplicateEffectsDropped = 0;

  const runFill = async (
    round: number,
    slots: readonly Slot[],
    corrections: ReadonlyMap<string, readonly string[]>,
    revisions: ReadonlyMap<string, string>,
  ): Promise<void> => {
    for (const slot of slots) attempts.set(slot.id, (attempts.get(slot.id) ?? 0) + 1);
    const outcome = await fillSlots({
      provider,
      brief,
      round,
      slots,
      allSlots: allocation.slots,
      rarityRules: allocation.profile.rarityRules,
      archetypes: allocation.archetypes,
      printed: cards,
      corrections,
      revisions,
      ...(options.batchSize === undefined ? {} : { batchSize: options.batchSize }),
      ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
    });
    calls.push(...outcome.calls);
    duplicateEffectsDropped += outcome.duplicateEffectsDropped;
    for (const [slotId, card] of outcome.cards) {
      cards.set(slotId, card);
      rejected.delete(slotId);
    }
    for (const [slotId, violations] of outcome.rejected) {
      if (!cards.has(slotId)) rejected.set(slotId, violations);
    }
  };

  const validate = (): SetValidation => validateGeneratedSet({ allocation, cards, rejected, tertiaryBudget });

  await runFill(0, allocation.slots, NO_CORRECTIONS, NO_REVISIONS);

  let validation = validate();
  const retryRounds: RetryRound[] = [];
  for (let round = 1; round <= maxRetryRounds && !validation.ok; round += 1) {
    const failing = validation.failingSlotIds;
    if (failing.length === 0) break;
    const corrections = new Map(
      failing.map((slotId) => [slotId, feedbackForSlot(validation.findings, slotId)] as const),
    );
    const causes = [...new Set(errors(validation.findings).map((item) => item.code))];
    await runFill(round, slotsFor(allocation, failing), corrections, NO_REVISIONS);
    validation = validate();
    const stillFailing = new Set(validation.failingSlotIds);
    retryRounds.push({
      round,
      slotIds: failing,
      causes,
      slotsRepaired: failing.filter((slotId) => !stillFailing.has(slotId)).length,
    });
  }

  const critiqueRunner = options.critique ?? true;
  let critiqueRecord: CritiqueRecord = { ran: false, revisions: [] };
  if (critiqueRunner && validation.entries.length > 0) {
    const result = await runCritique({
      provider,
      brief,
      allocation,
      validation,
      cards,
      round: maxRetryRounds + 1,
      runFill,
      validate,
      ...(options.critiqueMaxTokens === undefined ? {} : { maxTokens: options.critiqueMaxTokens }),
    });
    calls.push(...result.calls);
    critiqueRecord = result.record;
    validation = result.validation;
  }

  const printed = allocation.slots.flatMap((slot) => {
    const card = cards.get(slot.id);
    return card === undefined ? [] : [card];
  });

  // Last, and after validation, because flavor text is written about a finished
  // card and can make no card illegal: `applyFlavor` re-validates each card it
  // touches and keeps the card over the sentence. `validation` is therefore
  // still the answer for this set.
  let ordered: readonly Card[] = printed;
  const flavorNotes: string[] = [];
  if ((options.flavor ?? true) && printed.length > 0) {
    const outcome = await writeFlavor({
      provider,
      brief,
      cards: printed,
      ...(options.flavorMaxTokens === undefined ? {} : { maxTokens: options.flavorMaxTokens }),
    });
    calls.push(...outcome.calls);
    flavorNotes.push(...outcome.notes);
    ordered = applyFlavor(printed, outcome.lines);
  }
  // The authored cards, last of all and after flavor. Last because they are
  // finished: the flavor pass writes about a card and would rewrite text a human
  // chose, the critique pass proposes revisions to slots and these have none,
  // and the retry loop regenerates slots and these can never be regenerated.
  // Appending here is the only thing the pipeline does to them, so a brief that
  // states none produces exactly the run it produced before this existed.
  // One past the highest number the generator printed, not one past the card
  // count: a slot that never produced a usable card leaves a gap in the run's
  // numbering, and reusing that gap would print two cards at one number.
  const authored = printAuthoredCards(
    brief,
    ordered.reduce((highest, card) => Math.max(highest, card.set.collectorNumber), 0) + 1,
  );
  const authoredFindings = checkAuthoredCards(brief, ordered, authored);
  const printedCards: readonly Card[] = [...ordered, ...authored];
  const legalCards = printedCards.filter((card) => validateCard(card).length === 0).length;

  const report: GenerationReport = {
    setCode: brief.setCode,
    setName: brief.setName,
    seed: brief.seed,
    targetSize: brief.targetSize,
    profile: {
      name: allocation.profile.profile,
      version: allocation.profile.version,
      derivedFrom: `${allocation.profile.derivedFrom.profile} v${allocation.profile.derivedFrom.version}`,
    },
    slots: allocation.slots.length,
    cardsPrinted: ordered.length,
    authoredCards: authored.length,
    legalCards,
    attemptsPerSlot: Object.fromEntries([...attempts.entries()].sort(([a], [b]) => (a < b ? -1 : 1))),
    slotsNeedingRetry: slotsNeedingRetry(attempts),
    duplicateEffectsDropped,
    triggerConditions: censusTriggerConditions(printedCards),
    retryRounds,
    critique: critiqueRecord,
    archetypes: summariseArchetypes(allocation.archetypes, validation.archetypes),
    // Three sources, one list. The deterministic validators, the authored-card
    // check, and the design reviewer's asks this set does not carry — the last
    // as warnings, so the critique annotates the run rather than failing it
    // (`critiqueFindings` argues the split). A report whose findings could not
    // hold the third is what shipped a green XMP over a set its own critic
    // failed (`mtg-rz5h`).
    findings: [...validation.findings, ...authoredFindings, ...critiqueFindings(critiqueRecord)],
    enforceable:
      validation.ok &&
      authoredFindings.length === 0 &&
      ordered.length === allocation.slots.length &&
      legalCards === printedCards.length,
    usage: totalUsage(calls),
    notes: [
      ...pins.notes,
      ...allocation.notes,
      ...substitutionNotes(allocation.slots.map((slot) => slot.role)),
      ...flavorNotes,
    ],
  };

  return { allocation, cards: printedCards, validation, report };
}

function slotsFor(allocation: Allocation, slotIds: readonly string[]): Slot[] {
  const wanted = new Set(slotIds);
  return allocation.slots.filter((slot) => wanted.has(slot.id));
}

interface CritiqueRunInput {
  readonly provider: LlmProvider;
  readonly brief: SetBrief;
  readonly allocation: Allocation;
  readonly validation: SetValidation;
  readonly cards: Map<string, Card>;
  readonly round: number;
  readonly maxTokens?: number;
  readonly runFill: (
    round: number,
    slots: readonly Slot[],
    corrections: ReadonlyMap<string, readonly string[]>,
    revisions: ReadonlyMap<string, string>,
  ) => Promise<void>;
  readonly validate: () => SetValidation;
}

interface CritiqueRunResult {
  readonly record: CritiqueRecord;
  readonly validation: SetValidation;
  readonly calls: readonly CallRecord[];
}

async function runCritique(input: CritiqueRunInput): Promise<CritiqueRunResult> {
  const outcome = await critiqueSet({
    provider: input.provider,
    brief: input.brief,
    entries: input.validation.entries,
    archetypePairs: input.allocation.profile.archetypePairs,
    ...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
  });
  const calls: CallRecord[] = [outcome.call];

  if (outcome.critique === undefined) {
    return {
      record: {
        ran: true,
        revisions: [],
        error: outcome.call.error ?? 'the reviewer produced no schema-valid critique',
      },
      validation: input.validation,
      calls,
    };
  }

  const critique: Critique = outcome.critique;
  const { actionable, dropped } = triageRevisions(critique, new Set(input.cards.keys()));
  // Every major the reviewer named gets a record, including the ones no
  // regeneration will be spent on. A dropped ask is still an ask this set does
  // not carry, and leaving it out is what let a run report a critique it had
  // partly discarded.
  const droppedRecords: RevisionRecord[] = dropped.map((item) => ({
    slotId: item.revision.slotId,
    category: item.revision.category,
    observation: item.revision.observation,
    instruction: item.revision.instruction,
    outcome: 'dropped',
    reason: item.reason,
  }));
  if (actionable.length === 0) {
    return {
      record: { ran: true, critique, revisions: droppedRecords },
      validation: input.validation,
      calls,
    };
  }

  const snapshot = new Map(input.cards);
  const instructions = revisionInstructions(actionable);
  await input.runFill(
    input.round,
    slotsFor(input.allocation, [...instructions.keys()]),
    NO_CORRECTIONS,
    instructions,
  );

  let validation = input.validate();
  const failing = new Set(validation.failingSlotIds);
  let reverted = false;
  const records: RevisionRecord[] = actionable.map((revision) =>
    settleRevision(revision, input.cards, snapshot, failing, validation, () => {
      reverted = true;
    }),
  );
  if (reverted) validation = input.validate();

  return { record: { ran: true, critique, revisions: [...records, ...droppedRecords] }, validation, calls };
}

function settleRevision(
  revision: CritiqueRevision,
  cards: Map<string, Card>,
  snapshot: ReadonlyMap<string, Card>,
  failing: ReadonlySet<string>,
  validation: SetValidation,
  markReverted: () => void,
): RevisionRecord {
  const base = {
    slotId: revision.slotId,
    category: revision.category,
    observation: revision.observation,
    instruction: revision.instruction,
  };
  const current = cards.get(revision.slotId);
  const original = snapshot.get(revision.slotId);
  if (current === undefined || current === original) {
    return { ...base, outcome: 'unfilled', reason: 'the revision produced no usable replacement card' };
  }
  if (failing.has(revision.slotId)) {
    if (original !== undefined) cards.set(revision.slotId, original);
    markReverted();
    return {
      ...base,
      outcome: 'reverted',
      reason: feedbackForSlot(validation.findings, revision.slotId).join('; '),
    };
  }
  return { ...base, outcome: 'applied' };
}
