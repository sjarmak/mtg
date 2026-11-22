/** Rules-object identities retained for permanent and graveyard-card targets. */
import type { GameState, Target } from './state';

/** The current CR 400.7 identity for a target, where that concept applies. */
export function targetIncarnationOf(state: GameState, target: Target | null): number | null {
  return target?.kind === 'permanent' || target?.kind === 'card'
    ? (state.objects[target.oid]?.incarnation ?? 0)
    : null;
}

/** Whether an object target still denotes the exact incarnation that was chosen. */
export function targetIsCurrentIncarnation(
  state: GameState,
  target: Target,
  incarnation: number | null | undefined,
): boolean {
  return (
    (target.kind !== 'permanent' && target.kind !== 'card') ||
    (incarnation !== null &&
      incarnation !== undefined &&
      (state.objects[target.oid]?.incarnation ?? 0) === incarnation)
  );
}

/** Compare two target choices including CR 400.7 identity for object targets. */
export function sameTargetIncarnation(
  left: Target,
  leftIncarnation: number | null,
  right: Target,
  rightIncarnation: number | null,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'player') return right.kind === 'player' && left.player === right.player;
  if (right.kind === 'player' || left.oid !== right.oid) return false;
  return (left.kind !== 'permanent' && left.kind !== 'card') || leftIncarnation === rightIncarnation;
}

/** Capture CR 400.7 identity for each chosen object target. */
export function targetIncarnationsOf(
  state: GameState,
  targets: readonly (Target | null)[],
): readonly (number | null)[] {
  return targets.map((target) => targetIncarnationOf(state, target));
}

/** Capture CR 400.7 identity for every member of each plural target slot. */
export function multiTargetIncarnationsOf(
  state: GameState,
  multiTargets: Readonly<Record<number, readonly Target[]>>,
): Readonly<Record<number, readonly (number | null)[]>> {
  return Object.fromEntries(
    Object.entries(multiTargets).map(([index, targets]) => [index, targetIncarnationsOf(state, targets)]),
  );
}
