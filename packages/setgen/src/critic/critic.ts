/**
 * The semantic critic: one model call judging one card against its slot's
 * design intent.
 *
 * Shaped after `critiqueSet` (`../critique.ts`): a schema-constrained call
 * through `@mtg/llm`, a `schema_validation` failure turned into a call record
 * carrying `error` rather than an exception, so a harness running this over a
 * whole sample keeps going past one bad response instead of losing the batch.
 * The one addition `critiqueSet` does not need is `coversExpectedCriteria`
 * (`./rubric.ts`): a model asked for five possible criteria but told which
 * apply can still name the wrong set, and that is a structural defect in the
 * response, checked here rather than trusted.
 */
import { isLlmError, ZERO_USAGE } from '@mtg/llm';
import type { CostSource, LlmProvider, TokenUsage } from '@mtg/llm';
import type { SetBrief } from '../brief';
import type { RevisionRecord } from '../report';
import type { Entry } from '../validate/index';
import { buildCriticPrompt, CRITIC_SYSTEM } from './prompts';
import { coversExpectedCriteria, criteriaFor, CriticVerdictSchema } from './rubric';
import type { CriticVerdict, FaithfulnessCriterion } from './rubric';

export const DEFAULT_CRITIC_MAX_TOKENS = 1200;

export interface CriticCallRecord {
  readonly slotId: string;
  readonly cardName: string;
  readonly criteria: readonly FaithfulnessCriterion[];
  readonly provider: string;
  readonly model: string;
  readonly attempts: number;
  readonly durationMs: number;
  readonly usage: TokenUsage;
  readonly costUsd: number;
  readonly costSource: CostSource;
  /** Present when the model produced no schema-valid or no criteria-complete answer. */
  readonly error?: string;
}

export interface CriticOutcome {
  /** Absent when the critic could not produce a usable verdict. */
  readonly verdict?: CriticVerdict;
  readonly call: CriticCallRecord;
}

export interface JudgeFaithfulnessRequest {
  readonly provider: LlmProvider;
  readonly brief: SetBrief;
  readonly entry: Entry;
  /** The full report revision list; only `applied` entries affect this call. See `intent.ts`. */
  readonly revisions?: readonly RevisionRecord[];
  readonly maxTokens?: number;
}

export async function judgeFaithfulness(request: JudgeFaithfulnessRequest): Promise<CriticOutcome> {
  const revisions = request.revisions ?? [];
  const revisedSlotIds = new Set(
    revisions.filter((revision) => revision.outcome === 'applied').map((revision) => revision.slotId),
  );
  const criteria = criteriaFor(request.entry, revisedSlotIds);
  const prompt = buildCriticPrompt({ entry: request.entry, brief: request.brief, criteria, revisions });
  const started = Date.now();
  const identity = { slotId: request.entry.slot.id, cardName: request.entry.card.name, criteria };

  let completion;
  try {
    completion = await request.provider.complete({
      system: CRITIC_SYSTEM,
      prompt,
      schema: CriticVerdictSchema,
      maxTokens: request.maxTokens ?? DEFAULT_CRITIC_MAX_TOKENS,
    });
  } catch (error: unknown) {
    if (!isLlmError(error) || error.code !== 'schema_validation') throw error;
    return {
      call: {
        ...identity,
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

  const meta = completion.meta;
  const verdict = completion.value;
  if (!coversExpectedCriteria(verdict, criteria)) {
    const seen = verdict.criteria.map((item) => item.criterion).join(', ');
    return {
      call: {
        ...identity,
        provider: meta.provider,
        model: meta.model,
        attempts: meta.attempts,
        durationMs: meta.durationMs,
        usage: meta.usage,
        costUsd: meta.costUsd,
        costSource: meta.costSource,
        error: `judged {${seen}}, expected exactly {${criteria.join(', ')}}`,
      },
    };
  }

  return {
    verdict,
    call: {
      ...identity,
      provider: meta.provider,
      model: meta.model,
      attempts: meta.attempts,
      durationMs: meta.durationMs,
      usage: meta.usage,
      costUsd: meta.costUsd,
      costSource: meta.costSource,
    },
  };
}
