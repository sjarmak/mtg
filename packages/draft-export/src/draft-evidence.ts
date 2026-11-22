import type { BotEvidenceEpisode, JsonValue } from '@mtg/bot-evidence';
import { BotEvidenceEpisodeSchema, botEvidenceSha256 } from '@mtg/bot-evidence';
import type { Card } from '@mtg/dsl';
import { canonicalJson } from '@mtg/dsl';
import type { PassDirection } from './draft-structure';
import type { PhysicalCubeCard, PhysicalCubeDraftResult } from './physical-cube-draft';

type EvidenceIdentity = BotEvidenceEpisode['episode'];
export type DraftDecisionEvidence = BotEvidenceEpisode['decisions'][number];

/** Provenance supplied by a caller; the draft loop owns its stage, runtime kind, and seed. */
export type DraftEvidenceRequest = Omit<EvidenceIdentity, 'stage' | 'seed' | 'runtime' | 'splitGroup'> & {
  readonly runtime: Omit<EvidenceIdentity['runtime'], 'kind'>;
  readonly splitGroup: { readonly kind: 'draft'; readonly id: string };
};

/** The complete information available to one bot when it makes one pick. */
export interface DraftPickObservation {
  readonly round: number;
  readonly pickNumber: number;
  readonly seat: number;
  readonly openedBy: number;
  readonly pack: readonly Card[];
  readonly pool: readonly Card[];
}

/** The complete information available to a physical-card scorer for one seat. */
export interface PhysicalDraftPickObservation<Payload> {
  readonly seatId: string;
  readonly round: number;
  readonly pickNumber: number;
  readonly openedBy: string;
  readonly pack: readonly PhysicalCubeCard<Payload>[];
  readonly pool: readonly PhysicalCubeCard<Payload>[];
}

/** Convert an already-typed domain value at the evidence serialization boundary. */
function jsonValue(value: unknown): JsonValue {
  return JSON.parse(canonicalJson(value)) as JsonValue;
}

function assertNonnegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative integer, received ${String(value)}`);
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer, received ${String(value)}`);
  }
}

/** Map one bot pick from the exact pack and pool visible to that seat. */
export function draftDecisionEvidence(
  observation: DraftPickObservation,
  chosen: Card,
  sequence: number,
): DraftDecisionEvidence {
  assertNonnegativeInteger(sequence, 'draft evidence sequence');
  assertPositiveInteger(observation.round, 'draft round');
  assertPositiveInteger(observation.pickNumber, 'draft pick number');
  assertNonnegativeInteger(observation.seat, 'draft seat');
  assertNonnegativeInteger(observation.openedBy, 'draft pack opener');

  const candidateIds = observation.pack.map((card) => card.id);
  if (new Set(candidateIds).size !== candidateIds.length) {
    throw new Error('draft pack exposed duplicate card identities');
  }
  if (!candidateIds.includes(chosen.id)) {
    throw new Error(`chosen card is absent from the observed draft pack: ${chosen.id}`);
  }

  const value = jsonValue(observation);
  return {
    sequence,
    observation: { sha256: botEvidenceSha256(value), value },
    candidates: {
      status: 'complete',
      values: observation.pack.map((card) => ({ id: card.id, value: jsonValue(card) })),
    },
    choice: { status: 'chosen', candidateId: chosen.id },
  };
}

/** Map one printed or Cube bot pick while keeping repeated printings distinct. */
export function physicalDraftDecisionEvidence<Payload>(
  observation: PhysicalDraftPickObservation<Payload>,
  chosen: PhysicalCubeCard<Payload>,
  sequence: number,
): DraftDecisionEvidence {
  assertNonnegativeInteger(sequence, 'physical draft evidence sequence');
  assertPositiveInteger(observation.round, 'physical draft round');
  assertPositiveInteger(observation.pickNumber, 'physical draft pick number');

  const candidateIds = observation.pack.map((card) => card.physicalId);
  if (new Set(candidateIds).size !== candidateIds.length) {
    throw new Error('physical draft pack exposed duplicate card identities');
  }
  if (!candidateIds.includes(chosen.physicalId)) {
    throw new Error(`chosen physical card is absent from the observed draft pack: ${chosen.physicalId}`);
  }

  const value = jsonValue(observation);
  return {
    sequence,
    observation: { sha256: botEvidenceSha256(value), value },
    candidates: {
      status: 'complete',
      values: observation.pack.map((card) => ({ id: card.physicalId, value: jsonValue(card) })),
    },
    choice: { status: 'chosen', candidateId: chosen.physicalId },
  };
}

/** Validate provenance before opening and drafting packs. */
export function draftEvidenceIdentity(request: DraftEvidenceRequest, seed: string): EvidenceIdentity {
  const identity = BotEvidenceEpisodeSchema.parse({
    schemaVersion: 1,
    episode: {
      ...request,
      stage: 'draft',
      seed,
      runtime: { ...request.runtime, kind: 'native' },
    },
    decisions: [],
    outcome: { status: 'incomplete', error: 'identity validation only' },
  }).episode;
  if (identity.splitGroup.kind !== 'draft') {
    throw new Error('draft evidence must use a draft split group');
  }
  return identity;
}

export interface CompletedDraftOutcome {
  readonly rounds: number;
  readonly directions: readonly PassDirection[];
  readonly seats: readonly {
    readonly seat: number;
    readonly picks: readonly string[];
  }[];
}

/** Close a draft over its ordered decisions and final pools. */
export function completedDraftEvidence(
  episode: EvidenceIdentity,
  decisions: readonly DraftDecisionEvidence[],
  outcome: CompletedDraftOutcome,
): BotEvidenceEpisode {
  return BotEvidenceEpisodeSchema.parse({
    schemaVersion: 1,
    episode,
    decisions,
    outcome: { status: 'completed', value: jsonValue(outcome) },
  });
}

/** Close a completed physical-card draft without exposing its original hidden packs. */
export function completedPhysicalDraftEvidence<Payload>(
  episode: EvidenceIdentity,
  decisions: readonly DraftDecisionEvidence[],
  result: PhysicalCubeDraftResult<Payload>,
): BotEvidenceEpisode {
  return BotEvidenceEpisodeSchema.parse({
    schemaVersion: 1,
    episode,
    decisions,
    outcome: {
      status: 'completed',
      value: jsonValue({
        rounds: result.rounds,
        packSize: result.packSize,
        directions: result.directions,
        seats: result.seats.map((seat) => ({
          seatId: seat.seatId,
          picks: seat.picks.map((pick) => ({
            round: pick.round,
            pickNumber: pick.pickNumber,
            openedBy: pick.openedBy,
            physicalId: pick.card.physicalId,
            card: pick.card,
          })),
        })),
        undealt: result.undealt,
      }),
    },
  });
}

/** Preserve bot decisions when a replay pauses for human input. */
export function incompleteDraftEvidence(
  episode: EvidenceIdentity,
  decisions: readonly DraftDecisionEvidence[],
  error: string,
): BotEvidenceEpisode {
  return BotEvidenceEpisodeSchema.parse({
    schemaVersion: 1,
    episode,
    decisions,
    outcome: { status: 'incomplete', error },
  });
}
