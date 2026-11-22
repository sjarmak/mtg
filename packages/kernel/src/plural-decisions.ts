import { isCastable, type Effect } from '@mtg/dsl';
import type { Action } from './actions';
import { selectedCastingManaCost } from './cost';
import { sameTarget } from './effects';
import type { ObjectId, PlayerId } from './ids';
import { canPay } from './mana';
import { pendingPluralContext } from './pending-plural-context';
import {
  damageAllocationRange,
  nextPluralStage,
  pluralTargetLimit,
  pluralTargetMinimum,
} from './plural-targets';
import type { GameState, Target } from './state';
import { multipleTargetCandidates } from './target-choices';
import { countTargetInstances } from './target-count';
import { getObject } from './zones';

export interface PluralTargetsDecision {
  readonly kind: 'pluralTargets';
  readonly player: PlayerId;
  readonly oid: ObjectId;
  readonly effectIndex: number;
  readonly selected: readonly Target[];
  readonly options: readonly Action[];
  readonly complete: true;
}

export interface DamageAllocationDecision {
  readonly kind: 'damageAllocation';
  readonly player: PlayerId;
  readonly oid: ObjectId;
  readonly effectIndex: number;
  readonly total: number;
  readonly allocated: readonly number[];
  readonly options: readonly Action[];
  readonly complete: true;
}

function canAffordTarget(state: GameState, index: number, target: Target): boolean {
  const pending = state.pendingPluralTargets;
  if (pending === undefined || pending.origin !== 'cast') return true;
  const card = getObject(state, pending.oid).card;
  if (!isCastable(card)) return false;
  const members = [...(pending.multiTargets[index] ?? []), target];
  const multiTargets = { ...pending.multiTargets, [index]: members };
  const count = countTargetInstances(pending.targets, multiTargets);
  const cost = selectedCastingManaCost(
    state,
    pending.player,
    card,
    pending.x,
    pending.castingCost ?? 'mana',
    count,
  );
  return canPay(state, pending.player, cost);
}

export function pluralTargetsDecision(state: GameState): PluralTargetsDecision {
  const pending = state.pendingPluralTargets;
  if (pending === undefined) throw new Error('plural target decision has no pending record');
  const context = pendingPluralContext(state, pending);
  const stage = nextPluralStage(context.effects, pending);
  if (stage === null || stage.kind !== 'targets') throw new Error('plural member stage is not pending');
  const effect = context.effects[stage.index] as Effect;
  const selected = pending.multiTargets[stage.index] ?? [];
  const candidates = multipleTargetCandidates(state, effect, pending.player, context.source, selected.length);
  const limit = pluralTargetLimit(effect, candidates.length);
  const additions = candidates.filter(
    (target) =>
      !selected.some((member) => sameTarget(member, target)) &&
      selected.length < limit &&
      canAffordTarget(state, stage.index, target),
  );
  const additionsOptions: readonly Action[] = additions.map((target) => ({
    type: 'choosePluralTarget',
    player: pending.player,
    oid: pending.oid,
    target,
  }));
  const finishOptions: readonly Action[] =
    selected.length >= pluralTargetMinimum(effect)
      ? [{ type: 'choosePluralTarget', player: pending.player, oid: pending.oid, target: null }]
      : [];
  const options = [...additionsOptions, ...finishOptions];
  return {
    kind: 'pluralTargets',
    player: pending.player,
    oid: pending.oid,
    effectIndex: stage.index,
    selected,
    options,
    complete: true,
  };
}

export function damageAllocationDecision(state: GameState): DamageAllocationDecision {
  const pending = state.pendingPluralTargets;
  if (pending === undefined) throw new Error('damage allocation has no pending record');
  const context = pendingPluralContext(state, pending);
  const stage = nextPluralStage(context.effects, pending);
  if (stage === null || stage.kind !== 'allocation')
    throw new Error('damage allocation stage is not pending');
  const members = pending.multiTargets[stage.index] ?? [];
  const allocated = pending.damageAllocations[stage.index] ?? [];
  const range = damageAllocationRange(stage.total, members.length, allocated);
  const options = Array.from({ length: Math.max(0, range.maximum - range.minimum + 1) }, (_, offset) => ({
    type: 'allocateDividedDamage' as const,
    player: pending.player,
    oid: pending.oid,
    amount: range.minimum + offset,
  }));
  return {
    kind: 'damageAllocation',
    player: pending.player,
    oid: pending.oid,
    effectIndex: stage.index,
    total: stage.total,
    allocated,
    options,
    complete: true,
  };
}
