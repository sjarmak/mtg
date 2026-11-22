import type { Target } from './state';

/** Number of target instances announced across ordinary and plural slots. */
export function countTargetInstances(
  targets: readonly (Target | null)[],
  multiTargets?: Readonly<Record<number, readonly Target[]>>,
): number {
  const ordinary = targets.filter((target) => target !== null).length;
  const plural = Object.values(multiTargets ?? {}).reduce((count, members) => count + members.length, 0);
  return ordinary + plural;
}
