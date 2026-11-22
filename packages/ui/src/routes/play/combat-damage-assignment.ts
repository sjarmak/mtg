import type { PlayCombatDamageAssignment } from '@mtg/engine';

export interface CombatDamageAssignmentState {
  readonly valid: boolean;
  readonly locked: readonly boolean[];
  readonly remaining: number;
}

export function combatDamageAssignmentState(
  assignment: PlayCombatDamageAssignment,
  amounts: readonly number[],
): CombatDamageAssignmentState {
  const blockersBelowLethal = assignment.recipients.map((recipient, index) => {
    return recipient.kind === 'blocker' && (amounts[index] ?? 0) < recipient.lethal;
  });
  const locked = assignment.recipients.map((recipient, index) => {
    if (assignment.overrideOrder) {
      return recipient.kind === 'defender' && blockersBelowLethal.some(Boolean);
    }
    return blockersBelowLethal.slice(0, index).some(Boolean);
  });
  const numeric =
    amounts.length === assignment.recipients.length &&
    amounts.every((amount) => Number.isSafeInteger(amount) && amount >= 0 && amount <= assignment.total);
  const spent = amounts.reduce((total, amount) => total + amount, 0);
  const respectsOrder = amounts.every((amount, index) => amount === 0 || !locked[index]);
  return {
    valid: numeric && spent === assignment.total && respectsOrder,
    locked,
    remaining: assignment.total - spent,
  };
}

export function combatDamageAmountsAfterChange(
  assignment: PlayCombatDamageAssignment,
  amounts: readonly number[],
  changedIndex: number,
  amount: number,
): readonly number[] {
  const changed = amounts.map((held, index) => (index === changedIndex ? amount : held));
  const state = combatDamageAssignmentState(assignment, changed);
  return changed.map((held, index) => (index !== changedIndex && state.locked[index] ? 0 : held));
}

export function combatDamageSubmission(
  assignment: PlayCombatDamageAssignment,
  amounts: readonly number[],
): string {
  return JSON.stringify({
    version: 1,
    source: assignment.source,
    total: assignment.total,
    canDefer: assignment.canDefer,
    overrideOrder: assignment.overrideOrder,
    recipients: assignment.recipients,
    amounts,
    defer: false,
  });
}

export function deferredCombatDamageSubmission(assignment: PlayCombatDamageAssignment): string {
  return JSON.stringify({
    version: 1,
    source: assignment.source,
    total: assignment.total,
    canDefer: assignment.canDefer,
    overrideOrder: assignment.overrideOrder,
    recipients: assignment.recipients,
    amounts: assignment.defaultAmounts,
    defer: true,
  });
}
