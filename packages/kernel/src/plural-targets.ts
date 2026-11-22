import type { Effect, TargetedEffect } from '@mtg/dsl';
import {
  canonicalJson,
  hasTarget,
  isLiteralAmount,
  isMultipleTargetSpec,
  isTargetedFight,
  targetCountOf,
  targetMinimumOf,
} from '@mtg/dsl';
import { survivingMultipleTargets } from './effects';
import type { ProtectionSource } from './keyword-abilities';
import { multipleTargetCandidates } from './target-choices';
import type { DamageAllocations, GameState, PendingPluralTargets, Target } from './state';

export interface PluralChoice {
  readonly multiTargets: Readonly<Record<number, readonly Target[]>>;
  readonly damageAllocations: DamageAllocations;
}

/** A side-channel target tuple: homogeneous counted targets or an ordered fight pair. */
export function isPluralTargetEffect(effect: Effect): effect is TargetedEffect {
  return (hasTarget(effect) && isMultipleTargetSpec(effect.target)) || isTargetedFight(effect);
}

export type PluralStage =
  | { readonly kind: 'targets'; readonly index: number }
  | { readonly kind: 'allocation'; readonly index: number; readonly total: number };

export function pluralTargetIndexes(effects: readonly Effect[]): readonly number[] {
  return effects.flatMap((effect, index) => (isPluralTargetEffect(effect) ? [index] : []));
}

export function hasPluralTargets(effects: readonly Effect[]): boolean {
  return pluralTargetIndexes(effects).length > 0;
}

/** True when an ordinary action is the request to begin staged plural targeting. */
export function shouldStagePluralTargets(
  effects: readonly Effect[],
  multiTargets: Readonly<Record<number, readonly Target[]>> | undefined,
  damageAllocations: DamageAllocations | undefined,
): boolean {
  return hasPluralTargets(effects) && multiTargets === undefined && damageAllocations === undefined;
}

function allocationTotal(effect: Effect): number | null {
  if (effect.kind !== 'dealDamage' || effect.division?.kind !== 'asYouChoose') return null;
  return isLiteralAmount(effect.amount) ? effect.amount : null;
}

export function nextPluralStage(
  effects: readonly Effect[],
  pending: PendingPluralTargets,
): PluralStage | null {
  const indexes = pluralTargetIndexes(effects);
  for (const index of indexes) {
    if (!pending.finishedTargetSlots.includes(index)) return { kind: 'targets', index };
  }
  for (const index of indexes) {
    const total = allocationTotal(effects[index] as Effect);
    if (total === null) continue;
    const members = pending.multiTargets[index] ?? [];
    if ((pending.damageAllocations[index]?.length ?? 0) < members.length) {
      return { kind: 'allocation', index, total };
    }
  }
  return null;
}

function minimumMembers(effect: Effect): number {
  if (isTargetedFight(effect)) return 2;
  if (!hasTarget(effect) || !isMultipleTargetSpec(effect.target)) return 0;
  return Math.max(targetMinimumOf(effect.target), allocationTotal(effect) === null ? 0 : 1);
}

function minimumAllocation(total: number, count: number): readonly number[] {
  if (count === 0) return [];
  return [total - count + 1, ...Array.from({ length: count - 1 }, () => 1)];
}

export function minimumPluralChoice(
  state: GameState,
  effects: readonly Effect[],
  controller: 0 | 1,
  source: ProtectionSource,
): PluralChoice | null {
  let multiTargets: Readonly<Record<number, readonly Target[]>> = {};
  let damageAllocations: DamageAllocations = {};
  for (const index of pluralTargetIndexes(effects)) {
    const effect = effects[index] as Effect;
    const count = minimumMembers(effect);
    const members = isTargetedFight(effect)
      ? [
          multipleTargetCandidates(state, effect, controller, source, 0)[0],
          multipleTargetCandidates(state, effect, controller, source, 1)[0],
        ].filter((target): target is Target => target !== undefined)
      : multipleTargetCandidates(state, effect, controller, source).slice(0, count);
    if (members.length !== count) return null;
    multiTargets = { ...multiTargets, [index]: members };
    const total = allocationTotal(effect);
    if (total !== null)
      damageAllocations = { ...damageAllocations, [index]: minimumAllocation(total, count) };
  }
  return { multiTargets, damageAllocations };
}

function validateKeys(
  actual: readonly string[],
  expected: readonly number[],
  label: 'multiTargets' | 'damageAllocations',
): string | null {
  if (actual.length !== expected.length) return `${label} must name every applicable slot and no other slot`;
  for (const key of actual) {
    const index = Number(key);
    if (!Number.isInteger(index) || String(index) !== key || !expected.includes(index)) {
      return `${label} names inapplicable effect ${key}`;
    }
  }
  return null;
}

function validateAllocation(
  effect: Effect,
  index: number,
  members: readonly Target[],
  allocations: readonly number[] | undefined,
): string | null {
  const total = allocationTotal(effect);
  if (total === null)
    return allocations === undefined ? null : `effect ${String(index)} does not allocate damage`;
  if (allocations?.length !== members.length)
    return `effect ${String(index)} needs one allocation per target`;
  if (allocations.some((amount) => !Number.isSafeInteger(amount) || amount <= 0)) {
    return `effect ${String(index)} damage allocations must be positive safe integers`;
  }
  return allocations.reduce((sum, amount) => sum + amount, 0) === total
    ? null
    : `effect ${String(index)} damage allocations must total ${String(total)}`;
}

function validateMembers(
  state: GameState,
  effect: Effect,
  index: number,
  members: readonly Target[],
  controller: 0 | 1,
  source: ProtectionSource,
): string | null {
  if (isTargetedFight(effect)) {
    if (members.length !== 2) return `effect ${String(index)} needs exactly two targets`;
    for (const [position, member] of members.entries()) {
      const candidates = new Set(
        multipleTargetCandidates(state, effect, controller, source, position).map(canonicalJson),
      );
      if (!candidates.has(canonicalJson(member))) return `illegal target for effect ${String(index)}`;
    }
    return null;
  }
  if (!hasTarget(effect) || !isMultipleTargetSpec(effect.target))
    return `effect ${String(index)} is not plural`;
  const maximum = targetCountOf(effect.target);
  if (members.length < targetMinimumOf(effect.target)) return `effect ${String(index)} has too few targets`;
  if (maximum !== null && members.length > maximum) return `effect ${String(index)} has too many targets`;
  if (new Set(members.map(canonicalJson)).size !== members.length)
    return `effect ${String(index)} repeats a target`;
  const candidates = new Set(multipleTargetCandidates(state, effect, controller, source).map(canonicalJson));
  if (members.some((member) => !candidates.has(canonicalJson(member)))) {
    return `illegal target for effect ${String(index)}`;
  }
  return survivingMultipleTargets(state, effect, members, controller, source).length === members.length
    ? null
    : `illegal target for effect ${String(index)}`;
}

export function validatePluralTargets(
  state: GameState,
  effects: readonly Effect[],
  targets: readonly (Target | null)[],
  multiTargets: Readonly<Record<number, readonly Target[]>> | undefined,
  damageAllocations: DamageAllocations | undefined,
  controller: 0 | 1,
  source: ProtectionSource,
): string | null {
  const indexes = pluralTargetIndexes(effects);
  const allocations = indexes.filter((index) => allocationTotal(effects[index] as Effect) !== null);
  const omitsOnlyOptionalTargets =
    multiTargets === undefined &&
    indexes.every((index) => {
      const effect = effects[index];
      return (
        effect !== undefined &&
        !isTargetedFight(effect) &&
        hasTarget(effect) &&
        targetMinimumOf(effect.target) === 0
      );
    });
  if (!omitsOnlyOptionalTargets) {
    const keyError = validateKeys(Object.keys(multiTargets ?? {}), indexes, 'multiTargets');
    if (keyError !== null) return keyError;
  }
  const allocationKeyError = validateKeys(
    Object.keys(damageAllocations ?? {}),
    allocations,
    'damageAllocations',
  );
  if (allocationKeyError !== null) return allocationKeyError;
  for (const index of indexes) {
    if (targets[index] !== null && targets[index] !== undefined) return `effect ${String(index)} is plural`;
    const effect = effects[index] as Effect;
    const members = multiTargets?.[index] ?? [];
    const memberError = validateMembers(state, effect, index, members, controller, source);
    if (memberError !== null) return memberError;
    const allocationError = validateAllocation(effect, index, members, damageAllocations?.[index]);
    if (allocationError !== null) return allocationError;
  }
  return null;
}

export function pluralTargetLimit(effect: Effect, candidateCount: number): number {
  if (isTargetedFight(effect)) return 2;
  if (!hasTarget(effect) || !isMultipleTargetSpec(effect.target)) return 0;
  const targetLimit = targetCountOf(effect.target) ?? candidateCount;
  const total = allocationTotal(effect);
  return total === null ? targetLimit : Math.min(targetLimit, total);
}

export function pluralTargetMinimum(effect: Effect): number {
  if (isTargetedFight(effect)) return 2;
  if (!hasTarget(effect) || !isMultipleTargetSpec(effect.target)) return 0;
  return Math.max(targetMinimumOf(effect.target), allocationTotal(effect) === null ? 0 : 1);
}

export function damageAllocationRange(
  total: number,
  members: number,
  allocations: readonly number[],
): { readonly minimum: number; readonly maximum: number } {
  const remaining = total - allocations.reduce((sum, amount) => sum + amount, 0);
  const after = members - allocations.length - 1;
  return { minimum: after === 0 ? remaining : 1, maximum: remaining - after };
}
