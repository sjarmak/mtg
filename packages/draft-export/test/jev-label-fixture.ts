/**
 * Shared inputs for the labeler study's tests: real decisions read out of a real
 * (tiny) seeded draft, and the gateway's answer body built for any pack.
 *
 * Nothing here calls anything. `scriptedClient` stands in for the gateway so the
 * runner and the CLI can be driven through every stop condition without a
 * network, and `answerBody` is the same body shape the gateway sends, so a
 * record built from it goes through the same parsers a real one does.
 */
import { EXAMPLE_SET } from '@mtg/dsl';
import { podDecisions } from '../tools/jev-label/decisions';
import type { LabelDecision } from '../tools/jev-label/decisions';
import type { EvaluateRequest, EvaluateResult, JevClient } from '../tools/jev-label/jev-client';
import { EvaluateResponseSchema } from '../tools/jev-label/jev-client';
import { QUESTION_ID } from '../tools/jev-label/questions';
import type { AnswerRecord } from '../tools/jev-label/record';

export const SET = EXAMPLE_SET;

/** The first `count` studied decisions of one seeded pod. */
export function decisionsOf(count: number, podSeed = 'fixture/pod/0'): readonly LabelDecision[] {
  const decisions = podDecisions(SET, podSeed);
  if (decisions.length < count)
    throw new Error(`fixture pod holds ${String(decisions.length)} decisions, wanted ${String(count)}`);
  return decisions.slice(0, count);
}

export interface BodyOptions {
  /** The option given half the probability; the rest share the other half. Defaults to the first. */
  readonly favor?: string;
  /** What the gateway states it charged. */
  readonly cost?: string | null;
  readonly confidence?: number;
  /** Replaces the computed probabilities outright. */
  readonly probabilities?: Readonly<Record<string, number>>;
  readonly choice?: string;
}

/** A gateway body for a pack: `favor` gets 0.5 and the others split the rest, to two places. */
export function answerBody(ids: readonly string[], options: BodyOptions = {}): Record<string, unknown> {
  const favor = options.favor ?? (ids[0] as string);
  const others = ids.filter((id) => id !== favor);
  const share = Math.round((0.5 / Math.max(1, others.length)) * 100) / 100;
  const probabilities =
    options.probabilities ?? Object.fromEntries(ids.map((id) => [id, id === favor ? 0.5 : share]));
  const gateway = options.cost === null ? {} : { cost: options.cost ?? '0', marketCost: '0.001' };
  return {
    answers: { [QUESTION_ID]: { type: 'choice', choice: options.choice ?? favor, probabilities } },
    usage: { inputTokens: 100, outputTokens: 2 },
    providerMetadata: { typesafe: { confidence: { [QUESTION_ID]: options.confidence ?? 0.6 } }, gateway },
  };
}

export function packIdsOf(request: EvaluateRequest): readonly string[] {
  const question = request.questions[QUESTION_ID];
  if (question === undefined) throw new Error('request carries no pick question');
  return Object.keys(question.criteria);
}

/** A stored answer record for a decision, its raw body built by `answerBody`. */
export function recordOf(decision: LabelDecision, repeat: number, options: BodyOptions = {}): AnswerRecord {
  const packIds = decision.pack.map((card) => card.id);
  return {
    kind: 'answer',
    key: decision.key,
    repeat,
    podSeed: decision.podSeed,
    round: decision.round,
    pickNumber: decision.pickNumber,
    botPickId: decision.botPickId,
    packIds,
    poolIds: decision.pool.map((card) => card.id),
    at: '2026-01-01T00:00:00.000Z',
    latencyMs: 5,
    request: {},
    raw: answerBody(packIds, options),
  };
}

/** What a scripted call does: answer with a body, or throw. */
export type Step = (request: EvaluateRequest, call: number) => Record<string, unknown>;

/** A client whose n-th call runs `script(n)`; `calls` lists every request it saw. */
export function scriptedClient(script: Step): JevClient & { readonly calls: EvaluateRequest[] } {
  const calls: EvaluateRequest[] = [];
  return {
    calls,
    evaluate(request): Promise<EvaluateResult> {
      calls.push(request);
      try {
        const raw = script(request, calls.length);
        return Promise.resolve({ response: EvaluateResponseSchema.parse(raw), raw, latencyMs: 5 });
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
  };
}

/** A body that favors the first option of whatever pack was asked. */
export const favorFirst: Step = (request) => answerBody(packIdsOf(request));
