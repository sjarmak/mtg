import type { Decision } from '@mtg/kernel';

export const PRIORITY_WINDOWS: ReadonlySet<Decision['kind']> = new Set<Decision['kind']>([
  'priority',
  'declareAttackers',
  'declareBlockers',
  'orderAttackers',
  'orderBlockers',
]);

export function askOpensItself(decision: Decision | null): boolean {
  return decision !== null && !PRIORITY_WINDOWS.has(decision.kind);
}
