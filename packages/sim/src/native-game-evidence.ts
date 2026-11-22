import type { BotEvidenceEpisode, JsonValue } from '@mtg/bot-evidence';
import { BotEvidenceEpisodeSchema } from '@mtg/bot-evidence';
import type { GameEndReason, PlayerId } from '@mtg/kernel';
import type { NativeGameplayDecisionEvidence } from './native-evidence';

type EvidenceIdentity = BotEvidenceEpisode['episode'];

/** Provenance supplied by a caller; the driver owns stage, runtime kind, and game seed. */
export type NativeGameplayEvidenceRequest = Omit<EvidenceIdentity, 'stage' | 'seed' | 'runtime'> & {
  readonly runtime: Omit<EvidenceIdentity['runtime'], 'kind'>;
};

/** Validate provenance before spending the work required to play a game. */
export function nativeGameplayEvidenceIdentity(
  request: NativeGameplayEvidenceRequest,
  seed: string,
): EvidenceIdentity {
  return BotEvidenceEpisodeSchema.parse({
    schemaVersion: 1,
    episode: {
      ...request,
      stage: 'gameplay',
      seed,
      runtime: { ...request.runtime, kind: 'native' },
    },
    decisions: [],
    outcome: { status: 'incomplete', error: 'identity validation only' },
  }).episode;
}

interface CompletedNativeGame {
  readonly winner: PlayerId | null;
  readonly reason: GameEndReason;
  readonly turns: number;
  readonly decisions: number;
  readonly startingPlayer: PlayerId;
}

function completedOutcomeValue(outcome: CompletedNativeGame): JsonValue {
  return {
    winner: outcome.winner,
    reason: outcome.reason,
    turns: outcome.turns,
    decisions: outcome.decisions,
    startingPlayer: outcome.startingPlayer,
  };
}

/** Close a completed native game over the exact decisions observed during play. */
export function completedNativeGameplayEvidence(
  episode: EvidenceIdentity,
  decisions: readonly NativeGameplayDecisionEvidence[],
  outcome: CompletedNativeGame,
): BotEvidenceEpisode {
  return BotEvidenceEpisodeSchema.parse({
    schemaVersion: 1,
    episode,
    decisions,
    outcome: { status: 'completed', value: completedOutcomeValue(outcome) },
  });
}

export type NativeGameplayFailureStatus = Exclude<
  BotEvidenceEpisode['outcome'],
  { status: 'completed' }
>['status'];

/** Close a native game that failed without dropping its partial decision history. */
export function failedNativeGameplayEvidence(
  episode: EvidenceIdentity,
  decisions: readonly NativeGameplayDecisionEvidence[],
  status: NativeGameplayFailureStatus,
  error: string,
): BotEvidenceEpisode {
  return BotEvidenceEpisodeSchema.parse({
    schemaVersion: 1,
    episode,
    decisions,
    outcome: { status, error },
  });
}

/** A failed evidence-enabled game, carrying the schema-valid partial episode. */
export class NativeGameplayEvidenceError extends Error {
  constructor(
    readonly evidence: BotEvidenceEpisode,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'NativeGameplayEvidenceError';
  }
}
