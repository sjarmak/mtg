/** Forge's generic-first, repeated-pip mana spelling. */
import type { ManaCost, OverloadProfile } from '@mtg/dsl';
import { COLORS, hybridPips } from '@mtg/dsl';

export function forgeManaCost(cost: ManaCost): string {
  const pips = COLORS.flatMap((color) => Array.from({ length: Math.max(0, cost[color]) }, () => color));
  const hybrid = hybridPips(cost).flatMap(([pair, count]) =>
    Array.from({ length: count }, () => pair.replace('/', '')),
  );
  const generic = cost.generic > 0 ? [String(cost.generic)] : [];
  const parts = [...(cost.hasX ? ['X'] : []), ...generic, ...pips, ...hybrid];
  return parts.length > 0 ? parts.join(' ') : '0';
}

/** Forge's native `K:Overload:` price, including Street Spasm's repeated X. */
export function forgeOverloadCost(profile: OverloadProfile): string {
  if (!profile.cost.hasX) return forgeManaCost(profile.cost);
  const fixed = forgeManaCost({ ...profile.cost, hasX: false });
  const x = Array.from({ length: profile.xSymbols ?? 1 }, () => 'X');
  return [...x, ...(fixed === '0' ? [] : [fixed])].join(' ');
}
