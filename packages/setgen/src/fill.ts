/**
 * Slot fill: turn allocated slots into DSL cards via the model.
 *
 * Batches are per skeleton group (one color, one rarity) and capped, so a call
 * sees a coherent design problem ("ten white commons") rather than a shuffled
 * pile, and so one bad batch cannot cost the whole set. Batches run in a fixed
 * order because each prompt carries the cards printed before it: the run is
 * reproducible, which is what makes the recorded fixtures replayable in CI.
 *
 * The accumulation is what lets a bomb-tier batch be told about the other
 * colors' bombs. Grouping by `(rarity, color)` is right for the design problem
 * and wrong for one rule: "do not print two rares on one idea" is a fact about
 * the tier and a batch is one color of it. Because the batches are sequential
 * and `printed` grows across them, the tier so far is already in hand here and
 * only needs handing to the prompt.
 *
 * A batch that exhausts the provider's own schema retries is recorded and left
 * unfilled; the caller's validate-retry round picks those slots up. Transport
 * failures are not caught here - a broken provider should stop the run, not
 * quietly produce a short set.
 */
import type { Card, Violation } from '@mtg/dsl';
import type { SliceRarityRules } from '@mtg/design-data';
import type { CostSource, LlmProvider, TokenUsage } from '@mtg/llm';
import { isLlmError, ZERO_USAGE } from '@mtg/llm';
import type { ArchetypePlan } from './archetype/index';
import { assembleCard } from './assemble';
import type { SetBrief } from './brief';
import type { FilledCard } from './filled';
import { fillSchemaFor } from './filled';
import { buildFillPrompt, FILL_SYSTEM } from './prompts';
import { rarityPolicy } from './rarity';
import type { Slot } from './slot';

export const DEFAULT_BATCH_SIZE = 10;
export const DEFAULT_FILL_MAX_TOKENS = 8000;

export interface CallRecord {
  readonly purpose: 'fill' | 'critique' | 'flavor';
  readonly round: number;
  readonly slotIds: readonly string[];
  readonly provider: string;
  readonly model: string;
  readonly attempts: number;
  readonly durationMs: number;
  readonly usage: TokenUsage;
  readonly costUsd: number;
  readonly costSource: CostSource;
  /** Present when the call failed schema validation and produced no cards. */
  readonly error?: string;
}

export interface FillRequest {
  readonly provider: LlmProvider;
  readonly brief: SetBrief;
  readonly round: number;
  readonly slots: readonly Slot[];
  /**
   * Every slot the allocator built, which is not the same list as `slots`: a
   * retry round asks for a handful of slots while `printed` holds cards from
   * every slot the first round filled. Reading a printed card's tier off its
   * slot needs the whole allocation, so the whole allocation is what arrives.
   */
  readonly allSlots: readonly Slot[];
  /** The profile's rarity rules; the prompt shows a batch what its tier is for. */
  readonly rarityRules: SliceRarityRules;
  /** The ten color-pair plans; the prompt shows the ones this batch was reserved for. */
  readonly archetypes: readonly ArchetypePlan[];
  /** Cards kept from earlier rounds and batches; used for dedup and cohesion. */
  readonly printed: ReadonlyMap<string, Card>;
  readonly corrections: ReadonlyMap<string, readonly string[]>;
  readonly revisions: ReadonlyMap<string, string>;
  readonly batchSize?: number;
  readonly maxTokens?: number;
}

export interface FillOutcome {
  /** Cards that assembled and passed the DSL's own validators, by slot id. */
  readonly cards: ReadonlyMap<string, Card>;
  /** Why a slot produced no card this round. */
  readonly rejected: ReadonlyMap<string, readonly Violation[]>;
  readonly calls: readonly CallRecord[];
  /** Repeated effects assembly dropped this round; see `assembleCard`. */
  readonly duplicateEffectsDropped: number;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new RangeError(`chunk: size must be >= 1, got ${size}`);
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

/** Batches: grouped by (rarity, color) in slot order, then capped by size. */
export function batchSlots(slots: readonly Slot[], size: number): Slot[][] {
  const groups = new Map<string, Slot[]>();
  for (const slot of slots) {
    const key = `${slot.rarity}:${slot.color ?? 'A'}`;
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [slot]);
    else bucket.push(slot);
  }
  return [...groups.values()].flatMap((group) => chunk(group, size));
}

export async function fillSlots(request: FillRequest): Promise<FillOutcome> {
  const batchSize = request.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxTokens = request.maxTokens ?? DEFAULT_FILL_MAX_TOKENS;
  const printed = new Map(request.printed);
  const cards = new Map<string, Card>();
  const rejected = new Map<string, readonly Violation[]>();
  const calls: CallRecord[] = [];
  let duplicateEffectsDropped = 0;

  const bombSlotIds = new Set(
    request.allSlots
      .filter((slot) => rarityPolicy(slot.rarity, request.rarityRules).bomb)
      .map((slot) => slot.id),
  );

  for (const batch of batchSlots(request.slots, batchSize)) {
    const call = await fillBatch({ request, batch, printed, bombSlotIds, maxTokens });
    calls.push(call.record);
    duplicateEffectsDropped += call.duplicateEffectsDropped;
    for (const [slotId, card] of call.cards) {
      cards.set(slotId, card);
      printed.set(slotId, card);
    }
    for (const [slotId, violations] of call.rejected) rejected.set(slotId, violations);
  }

  return { cards, rejected, calls, duplicateEffectsDropped };
}

interface BatchInput {
  readonly request: FillRequest;
  readonly batch: readonly Slot[];
  readonly printed: ReadonlyMap<string, Card>;
  /** Slot ids at or above `bombsMinRarity`, so the tier so far can be read off `printed`. */
  readonly bombSlotIds: ReadonlySet<string>;
  readonly maxTokens: number;
}

interface BatchOutcome extends AssembledBatch {
  readonly record: CallRecord;
}

async function fillBatch(input: BatchInput): Promise<BatchOutcome> {
  const { request, batch, printed, bombSlotIds, maxTokens } = input;
  const slotIds = batch.map((slot) => slot.id);
  const color = batch[0]?.color ?? null;
  const priorCards = [...printed.values()];
  // The other colors' bombs only: this batch's own color is already rendered
  // in full under `<already_printed>`, whatever tier it sits at.
  const tierCards = [...printed]
    .filter(([slotId, card]) => bombSlotIds.has(slotId) && !sameColor(card, color))
    .map(([, card]) => card);

  const prompt = buildFillPrompt({
    brief: request.brief,
    slots: batch,
    rarityRules: request.rarityRules,
    archetypes: request.archetypes,
    priorNames: priorCards.map((card) => card.name),
    sameColorCards: priorCards.filter((card) => sameColor(card, color)),
    tierCards,
    corrections: subsetMap(request.corrections, slotIds),
    revisions: subsetMap(request.revisions, slotIds),
  });

  const started = Date.now();
  try {
    // The schema is chosen per batch, exactly as the prompt's slot lines are:
    // a batch holding no ability slot is shown the schema it was always shown,
    // and hashes to the fixture key it always did (`filled.ts`).
    const result = await request.provider.complete({
      system: FILL_SYSTEM,
      prompt,
      schema: fillSchemaFor(batch),
      maxTokens,
    });
    return {
      ...assembleBatch(batch, result.value.cards, request.brief.setCode),
      record: {
        purpose: 'fill',
        round: request.round,
        slotIds,
        provider: result.meta.provider,
        model: result.meta.model,
        attempts: result.meta.attempts,
        durationMs: result.meta.durationMs,
        usage: result.meta.usage,
        costUsd: result.meta.costUsd,
        costSource: result.meta.costSource,
      },
    };
  } catch (error: unknown) {
    if (!isLlmError(error) || error.code !== 'schema_validation') throw error;
    return {
      cards: new Map(),
      rejected: new Map(),
      duplicateEffectsDropped: 0,
      record: {
        purpose: 'fill',
        round: request.round,
        slotIds,
        provider: request.provider.name,
        model: request.provider.model,
        attempts: 0,
        durationMs: Date.now() - started,
        usage: ZERO_USAGE,
        costUsd: 0,
        costSource: 'unknown',
        error: error.message,
      },
    };
  }
}

function sameColor(card: Card, color: string | null): boolean {
  if (color === null) return card.colors.length === 0;
  return card.colors.length === 1 && card.colors[0] === color;
}

function subsetMap<T>(source: ReadonlyMap<string, T>, keys: readonly string[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const key of keys) {
    const value = source.get(key);
    if (value !== undefined) out.set(key, value);
  }
  return out;
}

interface AssembledBatch {
  readonly cards: Map<string, Card>;
  readonly rejected: Map<string, readonly Violation[]>;
  /** Repeated effects dropped across every card this batch proposed. */
  readonly duplicateEffectsDropped: number;
}

/**
 * Matches returned cards to their slots by `slotId`. A card for an unknown slot
 * is dropped (the batch is authoritative, not the model), and a slot the model
 * skipped simply stays unfilled for the next round.
 */
function assembleBatch(
  batch: readonly Slot[],
  filled: readonly FilledCard[],
  setCode: string,
): AssembledBatch {
  const bySlot = new Map(batch.map((slot) => [slot.id, slot]));
  const cards = new Map<string, Card>();
  const rejected = new Map<string, readonly Violation[]>();
  let duplicateEffectsDropped = 0;

  for (const candidate of filled) {
    const slot = bySlot.get(candidate.slotId);
    if (slot === undefined) continue;
    const assembly = assembleCard(slot, candidate, setCode);
    duplicateEffectsDropped += assembly.duplicateEffectsDropped;
    if (assembly.card === undefined) rejected.set(slot.id, assembly.violations);
    else cards.set(slot.id, assembly.card);
  }
  return { cards, rejected, duplicateEffectsDropped };
}
