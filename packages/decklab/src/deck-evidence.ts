import type { BotEvidenceEpisode, JsonValue } from '@mtg/bot-evidence';
import { BotEvidenceEpisodeSchema, botEvidenceSha256 } from '@mtg/bot-evidence';
import { canonicalJson } from '@mtg/dsl';
import type { CompletionRequest, CompletionResult, LlmProvider } from '@mtg/llm';
import { DEFAULT_SCHEMA_ENCODING, toJsonSchema } from '@mtg/llm';
import type { BuiltDeck } from './build';

type EvidenceIdentity = BotEvidenceEpisode['episode'];
export type DeckbuildingDecisionEvidence = BotEvidenceEpisode['decisions'][number];

/** Provenance supplied by a caller; decklab owns its stage and runtime kind. */
export type DeckbuildingEvidenceRequest = Omit<
  EvidenceIdentity,
  'stage' | 'seed' | 'runtime' | 'splitGroup'
> & {
  readonly runtime: Omit<EvidenceIdentity['runtime'], 'kind'>;
  readonly splitGroup:
    { readonly kind: 'pool'; readonly id: string } | { readonly kind: 'set'; readonly id: string };
};

interface DecisionNode {
  readonly decision: DeckbuildingDecisionEvidence;
  readonly previous: DecisionNode | null;
}

export interface ModelEvidenceRecorder {
  readonly provider: LlmProvider;
  readonly decisions: () => readonly DeckbuildingDecisionEvidence[];
}

const INCOMPLETE_CANDIDATES_REASON = 'combinatorial deck proposal space is not enumerable';

/** Convert an already-typed domain value at the evidence serialization boundary. */
function jsonValue(value: unknown): JsonValue {
  return JSON.parse(canonicalJson(value)) as JsonValue;
}

function errorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.trim() === '' ? 'unknown deckbuilding failure' : message;
}

function requestObservation<T>(request: CompletionRequest<T>): JsonValue {
  return jsonValue({
    system: request.system,
    prompt: request.prompt,
    jsonSchema: toJsonSchema(request.schema, request.schemaEncoding),
    schemaEncoding: request.schemaEncoding ?? DEFAULT_SCHEMA_ENCODING,
    ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
  });
}

/** Record every completion at the provider seam without changing provider behavior. */
export function recordDeckbuildingModelEvidence(provider: LlmProvider): ModelEvidenceRecorder {
  let head: DecisionNode | null = null;
  let sequence = 0;

  function retain(decision: DeckbuildingDecisionEvidence): void {
    head = { decision, previous: head };
  }

  const wrapped: LlmProvider = {
    name: provider.name,
    model: provider.model,
    budget: provider.budget,
    async complete<T>(request: CompletionRequest<T>): Promise<CompletionResult<T>> {
      const currentSequence = sequence;
      sequence += 1;
      const observation = requestObservation(request);
      const observed = { sha256: botEvidenceSha256(observation), value: observation };

      try {
        const result = await provider.complete(request);
        const value = jsonValue(result.value);
        const candidateId = botEvidenceSha256(value);
        retain({
          sequence: currentSequence,
          observation: observed,
          candidates: {
            status: 'incomplete',
            reason: INCOMPLETE_CANDIDATES_REASON,
            values: [{ id: candidateId, value }],
          },
          choice: { status: 'chosen', candidateId },
        });
        return result;
      } catch (cause: unknown) {
        retain({
          sequence: currentSequence,
          observation: observed,
          candidates: {
            status: 'incomplete',
            reason: INCOMPLETE_CANDIDATES_REASON,
            values: [],
          },
          choice: { status: 'engine-failure', error: errorMessage(cause) },
        });
        throw cause;
      }
    },
  };

  return {
    provider: wrapped,
    decisions: () => {
      const retained: DeckbuildingDecisionEvidence[] = [];
      for (let node = head; node !== null; node = node.previous) retained.push(node.decision);
      return retained.toSorted((left, right) => left.sequence - right.sequence);
    },
  };
}

/** Validate pool/set provenance before any deckbuilding model call is made. */
export function deckbuildingEvidenceIdentity(request: DeckbuildingEvidenceRequest): EvidenceIdentity {
  if (request.splitGroup.kind !== 'pool' && request.splitGroup.kind !== 'set') {
    throw new Error('deckbuilding evidence must use a pool or set split group');
  }

  return BotEvidenceEpisodeSchema.parse({
    schemaVersion: 1,
    episode: {
      ...request,
      stage: 'deckbuilding',
      seed: null,
      runtime: { ...request.runtime, kind: 'analysis' },
    },
    decisions: [],
    outcome: { status: 'incomplete', error: 'identity validation only' },
  }).episode;
}

function inclusion(entry: BuiltDeck['deck']['spells'][number]): JsonValue {
  return jsonValue({
    id: entry.card.oracleId,
    name: entry.card.name,
    count: entry.count,
    criteria: entry.criteria,
    reason: entry.reason,
  });
}

function completedOutcome(deck: BuiltDeck): JsonValue {
  return jsonValue({
    criteria: deck.criteria,
    construction: deck.construction,
    landPlan: deck.landPlan,
    deck: {
      spells: deck.deck.spells.map(inclusion),
      lands: deck.deck.lands.map(inclusion),
      basics: deck.deck.manaBase.basics,
      manaBase: deck.deck.manaBase,
      curve: deck.deck.curve,
      totalCards: deck.deck.totalCards,
      shortfalls: deck.deck.shortfalls,
    },
    plan: deck.plan,
    rejections: deck.rejections,
    adjustments: deck.adjustments,
    universeSize: deck.universeSize,
    rounds: deck.rounds,
    spend: deck.spend,
    stop: deck.stop,
    shortBy: deck.shortBy,
  });
}

/** Close a successful constructed build over its exact ordered model calls. */
export function completedDeckbuildingEvidence(
  episode: EvidenceIdentity,
  decisions: readonly DeckbuildingDecisionEvidence[],
  deck: BuiltDeck,
): BotEvidenceEpisode {
  return BotEvidenceEpisodeSchema.parse({
    schemaVersion: 1,
    episode,
    decisions,
    outcome: { status: 'completed', value: completedOutcome(deck) },
  });
}

/** Close a failed constructed build without dropping completed or failed model calls. */
export function failedDeckbuildingEvidence(
  episode: EvidenceIdentity,
  decisions: readonly DeckbuildingDecisionEvidence[],
  cause: unknown,
): BotEvidenceEpisode {
  return BotEvidenceEpisodeSchema.parse({
    schemaVersion: 1,
    episode,
    decisions,
    outcome: { status: 'engine-failure', error: errorMessage(cause) },
  });
}

/** A failed evidence-enabled build carrying its schema-valid partial episode. */
export class DeckbuildingEvidenceError extends Error {
  constructor(
    readonly evidence: BotEvidenceEpisode,
    cause: unknown,
  ) {
    super(errorMessage(cause), { cause });
    this.name = 'DeckbuildingEvidenceError';
  }
}
