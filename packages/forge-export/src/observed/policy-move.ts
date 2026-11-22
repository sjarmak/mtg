import {
  textValueOf,
  type MoveId,
  type MoveOption,
  type PendingDecision,
  type TextDecisionInput,
} from '@mtg/engine';

export type OfferedPolicyMove =
  | { readonly kind: 'option'; readonly option: MoveOption }
  | { readonly kind: 'text'; readonly input: TextDecisionInput; readonly value: string };

/** Resolves a policy move through the exact action channel exposed by the backend. */
export function offeredPolicyMove(decision: PendingDecision, move: MoveId): OfferedPolicyMove | null {
  const option = decision.options.find((candidate) => candidate.id === move);
  if (option !== undefined) return { kind: 'option', option };
  if (decision.input?.kind !== 'text') return null;
  const value = textValueOf(decision.input, move);
  return value === null ? null : { kind: 'text', input: decision.input, value };
}
