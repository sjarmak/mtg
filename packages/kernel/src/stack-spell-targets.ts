/** Immutable stack-spell copy and target-replacement primitives. */
import { copiedSpellObjectId, type ObjectId, type PlayerId } from './ids';
import type { GameState, StackEntry, Target } from './state';
import { spellCard } from './stack-spell';
import {
  multiTargetIncarnationsOf,
  sameTargetIncarnation,
  targetIncarnationOf,
  targetIncarnationsOf,
} from './target-incarnations';
import type { Trace } from './trace';
import { emit, withState } from './trace';

export interface SpellTargetTuple {
  readonly targets: readonly (Target | null)[];
  readonly multiTargets?: Readonly<Record<number, readonly Target[]>>;
  readonly damageAllocations?: Readonly<Record<number, readonly number[]>>;
}

export interface SpellCopyOptions extends SpellTargetTuple {
  readonly controller: PlayerId;
}

function cloneMultiTargets(
  multiTargets: Readonly<Record<number, readonly Target[]>> | undefined,
): Readonly<Record<number, readonly Target[]>> | undefined {
  return multiTargets === undefined
    ? undefined
    : Object.fromEntries(Object.entries(multiTargets).map(([index, targets]) => [index, [...targets]]));
}

function cloneDamageAllocations(
  allocations: Readonly<Record<number, readonly number[]>> | undefined,
): Readonly<Record<number, readonly number[]>> | undefined {
  return allocations === undefined
    ? undefined
    : Object.fromEntries(Object.entries(allocations).map(([index, amounts]) => [index, [...amounts]]));
}

function withTargetTuple(
  state: GameState,
  entry: StackEntry,
  tuple: SpellTargetTuple,
  preserveIncarnations = false,
): StackEntry {
  const {
    multiTargets: _oldMultiTargets,
    damageAllocations: _oldDamageAllocations,
    targetIncarnations: _oldTargetIncarnations,
    multiTargetIncarnations: _oldMultiTargetIncarnations,
    ...withoutTargetSideChannels
  } = entry;
  const multiTargets = cloneMultiTargets(tuple.multiTargets);
  const damageAllocations = cloneDamageAllocations(tuple.damageAllocations);
  return {
    ...withoutTargetSideChannels,
    targets: [...tuple.targets],
    targetIncarnations:
      preserveIncarnations && entry.targetIncarnations !== undefined
        ? [...entry.targetIncarnations]
        : targetIncarnationsOf(state, tuple.targets),
    ...(multiTargets === undefined ? {} : { multiTargets }),
    ...(multiTargets === undefined
      ? {}
      : preserveIncarnations && entry.multiTargetIncarnations !== undefined
        ? { multiTargetIncarnations: entry.multiTargetIncarnations }
        : { multiTargetIncarnations: multiTargetIncarnationsOf(state, multiTargets) }),
    ...(damageAllocations === undefined ? {} : { damageAllocations }),
  };
}

/**
 * Copies a spell atomically with its final target tuple. All other stack facts
 * are spread from the original so newly retained copiable choices cannot be
 * dropped by a field-by-field copier.
 */
export function copySpellOnStack(trace: Trace, originalOid: ObjectId, options?: SpellCopyOptions): Trace {
  const original = trace.state.stack.find((entry) => entry.oid === originalOid);
  if (original === undefined || original.ability !== null) {
    throw new Error(`${originalOid} is not a spell on the stack`);
  }
  const card = spellCard(trace.state, original);
  if (card === null) throw new Error(`${originalOid} is not a spell`);
  if (card.kind !== 'instant' && card.kind !== 'sorcery') {
    throw new Error(`${originalOid} is a permanent spell, whose copied resolution is not supported`);
  }
  const oid = copiedSpellObjectId(trace.state.nextId);
  const sourceOid = original.copiedSpell?.sourceOid ?? original.oid;
  const tuple: SpellTargetTuple = options ?? {
    targets: original.targets,
    ...(original.multiTargets === undefined ? {} : { multiTargets: original.multiTargets }),
    ...(original.damageAllocations === undefined ? {} : { damageAllocations: original.damageAllocations }),
  };
  const copied = withTargetTuple(trace.state, original, tuple, options === undefined);
  const entry: StackEntry = {
    ...copied,
    oid,
    controller: options?.controller ?? original.controller,
    copiedSpell: { card, copiedFrom: original.oid, sourceOid },
  };
  const pushed = withState(trace, {
    ...trace.state,
    nextId: trace.state.nextId + 1,
    stack: [...trace.state.stack, entry],
  });
  return emit(pushed, {
    type: 'spellCopied',
    player: entry.controller,
    oid,
    copiedFrom: original.oid,
    targets: entry.targets,
    ...(entry.multiTargets === undefined ? {} : { multiTargets: entry.multiTargets }),
    ...(entry.damageAllocations === undefined ? {} : { damageAllocations: entry.damageAllocations }),
    chosenX: entry.x,
  });
}

interface TargetIdentity {
  readonly target: Target;
  readonly incarnation: number | null;
}

function targetIdentities(state: GameState, entry: StackEntry): readonly TargetIdentity[] {
  const ordinary = entry.targets.flatMap((target, index): readonly TargetIdentity[] =>
    target === null
      ? []
      : [
          {
            target,
            incarnation: entry.targetIncarnations?.[index] ?? targetIncarnationOf(state, target),
          },
        ],
  );
  const plural = Object.entries(entry.multiTargets ?? {}).flatMap(
    ([effectIndex, targets]): readonly TargetIdentity[] =>
      targets.map((target, memberIndex) => ({
        target,
        incarnation:
          entry.multiTargetIncarnations?.[Number(effectIndex)]?.[memberIndex] ??
          targetIncarnationOf(state, target),
      })),
  );
  return [...ordinary, ...plural];
}

function sameIdentity(left: TargetIdentity, right: TargetIdentity): boolean {
  return sameTargetIncarnation(left.target, left.incarnation, right.target, right.incarnation);
}

function newlyAcquiredTargets(state: GameState, before: StackEntry, after: StackEntry): readonly Target[] {
  const prior = targetIdentities(state, before);
  const current = targetIdentities(state, after);
  return current
    .filter(
      (identity, index) =>
        !prior.some((candidate) => sameIdentity(candidate, identity)) &&
        current.findIndex((candidate) => sameIdentity(candidate, identity)) === index,
    )
    .map((identity) => identity.target);
}

/** Replaces one spell's target tuple and reports only genuinely new targets. */
export function changeSpellTargetsOnStack(
  trace: Trace,
  player: PlayerId,
  oid: ObjectId,
  tuple: SpellTargetTuple,
): Trace {
  const before = trace.state.stack.find((entry) => entry.oid === oid);
  if (before === undefined || before.ability !== null) throw new Error(`${oid} is not a spell on the stack`);
  const after = withTargetTuple(trace.state, before, tuple);
  const targets = newlyAcquiredTargets(trace.state, before, after);
  const changed = withState(trace, {
    ...trace.state,
    stack: trace.state.stack.map((entry) => (entry.oid === oid ? after : entry)),
  });
  return targets.length === 0
    ? changed
    : emit(changed, { type: 'spellTargetsChanged', player, oid, targets });
}
