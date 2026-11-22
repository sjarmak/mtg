import { botEvidenceSha256 } from '@mtg/bot-evidence';
import { canonicalJson } from '@mtg/dsl';
import { textValueOf, type MoveId } from '@mtg/engine';
import type { ForgeObservedDecisionPolicy, ForgeObservedPolicyPosition } from './policy';

const NO_PROGRESS_RECOVERY =
  'exclude-accepted-move-with-bounded-repeatable-and-convoke-callbacks-on-reentered-observation-same-turn';
// Forge can expose one more identical local callback while a priority round
// settles. A third callback has not advanced and must fail instead of looping.
const MAX_IDENTICAL_PRIORITY_PASSES = 2;
const MAX_IDENTICAL_REPEATABLE_TARGETS = 3;
const MAX_IDENTICAL_CONVOKE_MOVES = 2;

export interface ForgePolicyProgressState {
  readonly turn: number;
  readonly attempts: readonly ForgePolicyObservationAttempts[];
}

export interface ForgePolicyProgressPosition {
  readonly turn: number;
  readonly observationSha256: string;
  readonly attemptedMoves: readonly MoveId[];
  readonly attempts: readonly ForgePolicyObservationAttempts[];
  readonly position: ForgeObservedPolicyPosition;
}

interface ForgePolicyObservationAttempts {
  readonly observationSha256: string;
  readonly moves: readonly MoveId[];
}

function observationSha256(position: ForgeObservedPolicyPosition): string {
  return botEvidenceSha256(JSON.parse(canonicalJson(position)));
}

export function policyUsesNoProgressRecovery(policy: ForgeObservedDecisionPolicy): boolean {
  const configuration = policy.identity.configuration;
  if (
    typeof configuration !== 'object' ||
    configuration === null ||
    Array.isArray(configuration) ||
    !('noProgressRecovery' in configuration)
  ) {
    return false;
  }
  return configuration.noProgressRecovery === NO_PROGRESS_RECOVERY;
}

/** Excludes moves that Forge accepted without changing the observable position. */
export function policyProgressPosition(
  position: ForgeObservedPolicyPosition,
  previous: ForgePolicyProgressState | null,
): ForgePolicyProgressPosition {
  const sha256 = observationSha256(position);
  const turn = position.view.turn.number;
  const attempts = previous?.turn === turn ? previous.attempts : [];
  const attemptedMoves = attempts.find((entry) => entry.observationSha256 === sha256)?.moves ?? [];
  if (attemptedMoves.length === 0) {
    return { turn, observationSha256: sha256, attemptedMoves, attempts, position };
  }
  const excluded = new Set(attemptedMoves);
  if (position.decision.kind === 'convoke-payment' && attemptedMoves.includes('convoke-payment-done')) {
    for (const move of attemptedMoves) {
      if (attemptedMoves.filter((attempted) => attempted === move).length < MAX_IDENTICAL_CONVOKE_MOVES) {
        excluded.delete(move);
      }
    }
  }
  const repeatableMove =
    position.decision.kind === 'priority'
      ? position.play?.passPriority
      : position.decision.kind === 'repeatable-target-selection'
        ? attemptedMoves.at(-1)
        : null;
  const repeatLimit =
    position.decision.kind === 'repeatable-target-selection'
      ? MAX_IDENTICAL_REPEATABLE_TARGETS
      : MAX_IDENTICAL_PRIORITY_PASSES;
  if (
    repeatableMove !== null &&
    repeatableMove !== undefined &&
    attemptedMoves.filter((move) => move === repeatableMove).length < repeatLimit
  ) {
    excluded.delete(repeatableMove);
  }
  const input = position.decision.input;
  const inputWasAttempted =
    input !== undefined && attemptedMoves.some((move) => textValueOf(input, move) !== null);
  const { input: _input, ...decisionWithoutInput } = position.decision;
  const decision = inputWasAttempted ? decisionWithoutInput : position.decision;
  return {
    turn,
    observationSha256: sha256,
    attemptedMoves,
    attempts,
    position: {
      ...position,
      decision: {
        ...decision,
        options: decision.options.filter((option) => !excluded.has(option.id)),
      },
    },
  };
}

export function acceptedPolicyMove(
  prepared: ForgePolicyProgressPosition,
  move: MoveId,
): ForgePolicyProgressState {
  const updated = {
    observationSha256: prepared.observationSha256,
    moves: [...prepared.attemptedMoves, move],
  };
  return {
    turn: prepared.turn,
    attempts: [
      updated,
      ...prepared.attempts.filter((entry) => entry.observationSha256 !== prepared.observationSha256),
    ],
  };
}

export function noProgressMessage(kind: string, attemptedMoves: readonly MoveId[], reason: string): string {
  return `Forge returned to the ${kind} observation after accepting ${attemptedMoves.join(', ')}; recovery failed: ${reason}`;
}
