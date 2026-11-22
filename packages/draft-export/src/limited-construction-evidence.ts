import type { BotEvidenceEpisode, JsonValue } from '@mtg/bot-evidence';
import { BotEvidenceEpisodeSchema, botEvidenceSha256 } from '@mtg/bot-evidence';
import type { LimitedDeck, LimitedSelectionOptions, LimitedSelectionResult } from '@mtg/limited';
import { suggestLimitedDeckWithReport, validateLimitedDeck } from '@mtg/limited';

type EvidenceIdentity = BotEvidenceEpisode['episode'];

/** Provenance for one deterministic build from a physical Limited pool. */
export type LimitedConstructionEvidenceRequest = Omit<
  EvidenceIdentity,
  'stage' | 'seed' | 'runtime' | 'splitGroup'
> & {
  readonly runtime: Omit<EvidenceIdentity['runtime'], 'kind'>;
  readonly splitGroup:
    { readonly kind: 'pool'; readonly id: string } | { readonly kind: 'draft'; readonly id: string };
};

export interface LimitedConstructionEvidenceResult<Payload> extends LimitedSelectionResult<Payload> {
  readonly evidence: BotEvidenceEpisode;
}

/** Canonical policy input stored beside the evidence behavior hash. */
export function limitedSelectionEvidenceConfig(
  deck: Pick<LimitedDeck<unknown>, 'minimumDeckSize' | 'suggestedBasicLands'>,
  options: LimitedSelectionOptions = {},
): JsonValue {
  return {
    policy: options.policy ?? 'score-ranked/v1',
    minimumDeckSize: deck.minimumDeckSize,
    suggestedBasicLands: deck.suggestedBasicLands,
    ...(options.colors === undefined ? {} : { colors: [...options.colors] }),
    ...(options.targets === undefined ? {} : { targets: { ...options.targets } }),
  };
}

function errorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.trim() === '' ? 'unknown Limited construction failure' : message;
}

function jsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function evidenceIdentity(request: LimitedConstructionEvidenceRequest): EvidenceIdentity {
  if (request.splitGroup.kind !== 'pool' && request.splitGroup.kind !== 'draft') {
    throw new Error('Limited construction evidence must use a pool or draft split group');
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

function completedEvidence<Payload>(
  episode: EvidenceIdentity,
  input: LimitedDeck<Payload>,
  result: LimitedSelectionResult<Payload>,
): BotEvidenceEpisode {
  const value = jsonValue({
    input: {
      pool: input.pool.map((card) => ({ physicalId: card.physicalId, facts: card.facts })),
      minimumDeckSize: input.minimumDeckSize,
      suggestedBasicLands: input.suggestedBasicLands,
    },
    deck: {
      selectedPhysicalIds: result.deck.selectedPhysicalIds,
      basics: result.deck.basics,
    },
    selection: result.report,
    validation: validateLimitedDeck(result.deck),
  });
  return BotEvidenceEpisodeSchema.parse({
    schemaVersion: 1,
    episode,
    decisions: [],
    outcome: { status: 'completed', value },
  });
}

function failedEvidence(episode: EvidenceIdentity, cause: unknown): BotEvidenceEpisode {
  return BotEvidenceEpisodeSchema.parse({
    schemaVersion: 1,
    episode,
    decisions: [],
    outcome: { status: 'engine-failure', error: errorMessage(cause) },
  });
}

/** A failed evidence-enabled build carrying its schema-valid episode. */
export class LimitedConstructionEvidenceError extends Error {
  constructor(
    readonly evidence: BotEvidenceEpisode,
    cause: unknown,
  ) {
    super(errorMessage(cause), { cause });
    this.name = 'LimitedConstructionEvidenceError';
  }
}

/** Select a physical Limited deck and retain its exact attributable outcome. */
export function suggestLimitedDeckWithEvidence<Payload>(
  deck: LimitedDeck<Payload>,
  options: LimitedSelectionOptions,
  request: LimitedConstructionEvidenceRequest,
): LimitedConstructionEvidenceResult<Payload> {
  const policy = options.policy ?? 'score-ranked/v1';
  if (request.behavior.policyId !== policy) {
    throw new Error('Limited construction evidence policy does not match the selection policy');
  }
  const config = limitedSelectionEvidenceConfig(deck, options);
  if (request.behavior.configSha256 !== botEvidenceSha256(config)) {
    throw new Error('Limited construction evidence configuration does not match the selection options');
  }
  const episode = evidenceIdentity(request);
  try {
    const result = suggestLimitedDeckWithReport(deck, options);
    return { ...result, evidence: completedEvidence(episode, deck, result) };
  } catch (cause: unknown) {
    throw new LimitedConstructionEvidenceError(failedEvidence(episode, cause), cause);
  }
}
