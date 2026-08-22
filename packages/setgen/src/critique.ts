/**
 * The design-critique pass: one model call over the assembled set.
 *
 * This is the only place in the pipeline where semantic judgment lives.
 * Everything the deterministic validators can decide has already been decided
 * before this runs, and the critique is told so, so the reviewer spends its
 * attention on cohesion, archetype support, flavor and power outliers instead
 * of re-deriving curve arithmetic (ZFC).
 *
 * Its output does not edit cards directly. It produces per-slot revision
 * instructions that go back through the same fill path, so a revised card is
 * validated exactly as strictly as the card it replaces.
 */
import { z } from 'zod';
import { DEFAULT_SLICE_TARGET_SIZE } from '@mtg/design-data';
import type { LlmProvider } from '@mtg/llm';
import { isLlmError, ZERO_USAGE } from '@mtg/llm';
import type { Entry } from './validate/index';
import type { SetBrief } from './brief';
import type { CallRecord } from './fill';
import { buildCritiquePrompt, CRITIQUE_SYSTEM } from './prompts';

export const CRITIQUE_CATEGORIES = ['cohesion', 'archetype', 'flavor', 'powerLevel', 'duplication'] as const;

export const CritiqueRevisionSchema = z.object({
  slotId: z.string().min(1),
  category: z.enum(CRITIQUE_CATEGORIES),
  severity: z.enum(['minor', 'major']),
  observation: z.string().min(1).max(300),
  /** An instruction a designer could act on without seeing the reasoning. */
  instruction: z.string().min(1).max(300),
});

/**
 * The set size the base caps below were written for, and are still exactly right
 * for: the slice's own default, and the size of both recorded runs.
 */
export const CRITIQUE_BASE_SIZE = DEFAULT_SLICE_TARGET_SIZE;
const BASE_PROSE_CHARS = 800;
const BASE_REVISIONS = 10;
export const DEFAULT_CRITIQUE_MAX_TOKENS = 4000;

/**
 * How much answer this pass is allowed, given how many cards it is reviewing.
 *
 * The pass did not scale, and the reason it did not is worth stating precisely,
 * because the obvious diagnosis is wrong. It is **not** the token budget. The
 * recorded 90-card review came back at 6,403 characters — roughly 1,700 output
 * tokens against a 4,000-token allowance — so the reviewer stopped well short of
 * the budget. What it did do was saturate every cap in the schema: four
 * paragraphs of 725, 645, 686 and 633 characters against a limit of 800, and
 * exactly ten revisions against a limit of ten. Raising `maxTokens` on its own
 * would therefore have bought a 250-card run nothing at all; the schema is the
 * binding constraint and always was.
 *
 * So the caps scale with the set and the token allowance follows them, rather
 * than the other way round. A review of 250 cards that may name ten cards is
 * naming four percent of the set, and it was already writing to the edge of what
 * it was allowed at 90.
 *
 * The floor is the base rather than the scaled value, so a set smaller than the
 * default is reviewed through exactly the schema every recorded fixture was
 * keyed against. That is not only a courtesy to the fixtures: a smaller set does
 * not need a smaller review, and the caps are a ceiling on an answer rather than
 * a quota to fill.
 *
 * This is a budget, which is the layer's own business (ZFC). It scores nothing
 * and judges nothing; the reviewer still decides what is worth saying and which
 * cards are worth changing.
 */
export interface CritiqueBudget {
  readonly proseChars: number;
  readonly revisions: number;
  readonly maxTokens: number;
}

export function critiqueBudget(cards: number): CritiqueBudget {
  const scale = Math.max(1, cards / CRITIQUE_BASE_SIZE);
  return {
    proseChars: Math.round(BASE_PROSE_CHARS * scale),
    revisions: Math.round(BASE_REVISIONS * scale),
    maxTokens: Math.round(DEFAULT_CRITIQUE_MAX_TOKENS * scale),
  };
}

function buildCritiqueSchema(budget: CritiqueBudget) {
  return z.object({
    cohesion: z.string().min(1).max(budget.proseChars),
    archetypeSupport: z.string().min(1).max(budget.proseChars),
    flavorConsistency: z.string().min(1).max(budget.proseChars),
    powerOutliers: z.string().min(1).max(budget.proseChars),
    revisions: z.array(CritiqueRevisionSchema).max(budget.revisions).default([]),
  });
}

/**
 * The base schema, and the one a set at or under the base size is shown.
 *
 * Built through the same factory as the widened one so the two cannot drift, and
 * exported because it is the shape every consumer of a `Critique` reads. A
 * fixture key is `hash(system, prompt, schema)`, so this object's JSON Schema is
 * load-bearing on the four recorded critique fixtures in this repository:
 * `critiqueSchemaFor` hands back this exact instance below the base size, which
 * is what keeps the recorded runs replaying for free.
 */
export const CritiqueSchema = buildCritiqueSchema(critiqueBudget(CRITIQUE_BASE_SIZE));

export function critiqueSchemaFor(cards: number): typeof CritiqueSchema {
  const budget = critiqueBudget(cards);
  if (budget.proseChars === BASE_PROSE_CHARS && budget.revisions === BASE_REVISIONS) return CritiqueSchema;
  return buildCritiqueSchema(budget);
}

export type Critique = z.infer<typeof CritiqueSchema>;
export type CritiqueRevision = z.infer<typeof CritiqueRevisionSchema>;

export interface CritiqueRequest {
  readonly provider: LlmProvider;
  readonly brief: SetBrief;
  readonly entries: readonly Entry[];
  readonly archetypePairs: readonly string[];
  readonly maxTokens?: number;
}

export interface CritiqueOutcome {
  /** Absent when the reviewer could not produce a schema-valid reply. */
  readonly critique?: Critique;
  readonly call: CallRecord;
}

export async function critiqueSet(request: CritiqueRequest): Promise<CritiqueOutcome> {
  const prompt = buildCritiquePrompt({
    brief: request.brief,
    entries: request.entries,
    archetypePairs: request.archetypePairs,
  });
  const started = Date.now();
  const budget = critiqueBudget(request.entries.length);
  try {
    // Both the schema and the allowance are chosen from the set's own size, the
    // way a fill batch's schema is chosen from the batch (`filled.ts`): a set at
    // or under the base size is shown the exact schema every recorded critique
    // fixture was keyed against, and hashes to the key it always did.
    const result = await request.provider.complete({
      system: CRITIQUE_SYSTEM,
      prompt,
      schema: critiqueSchemaFor(request.entries.length),
      maxTokens: request.maxTokens ?? budget.maxTokens,
    });
    return {
      critique: result.value,
      call: {
        purpose: 'critique',
        round: 0,
        slotIds: [],
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
      call: {
        purpose: 'critique',
        round: 0,
        slotIds: [],
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

/** A major revision this run will not spend a regeneration on, and why not. */
export interface DroppedRevision {
  readonly revision: CritiqueRevision;
  readonly reason: string;
}

export interface RevisionTriage {
  /** Major revisions the revision pass will act on, in the reviewer's order. */
  readonly actionable: readonly CritiqueRevision[];
  /** Major revisions the pass will not act on, each carrying its reason. */
  readonly dropped: readonly DroppedRevision[];
}

/**
 * Which of the reviewer's asks this run will act on, and which it will not.
 *
 * Only majors are acted on: the reviewer decides which of its own notes is
 * major, and a minor note is kept in the report and left alone, because every
 * revision is a fresh chance to break a card that already passes.
 *
 * The two drops are the reason this returns both halves rather than just the
 * actionable one. A major that names a slot this set never printed and a second
 * major on a slot already being revised are both asks the finished set does not
 * carry, and both used to be filtered away with nothing recorded — the run then
 * reported a critique it had partly ignored. They are dropped here and stated in
 * the report (`critiqueFindings`), never silently.
 */
export function triageRevisions(critique: Critique, knownSlotIds: ReadonlySet<string>): RevisionTriage {
  const actionable: CritiqueRevision[] = [];
  const dropped: DroppedRevision[] = [];
  const taken = new Set<string>();
  for (const revision of critique.revisions) {
    if (revision.severity !== 'major') continue;
    if (!knownSlotIds.has(revision.slotId)) {
      dropped.push({
        revision,
        reason: `the critique names ${revision.slotId}, which this set did not print`,
      });
      continue;
    }
    if (taken.has(revision.slotId)) {
      dropped.push({
        revision,
        reason: `a second major revision for ${revision.slotId}; one slot is revised once per run`,
      });
      continue;
    }
    taken.add(revision.slotId);
    actionable.push(revision);
  }
  return { actionable, dropped };
}

export function revisionInstructions(revisions: readonly CritiqueRevision[]): Map<string, string> {
  return new Map(
    revisions.map((revision) => [revision.slotId, `${revision.observation} Change: ${revision.instruction}`]),
  );
}
