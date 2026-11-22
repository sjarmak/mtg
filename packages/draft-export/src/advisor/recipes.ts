import type { AdvisorModel } from './evidence';
import { profileOf } from './evidence';
import type { AdvisorCard } from './state';
import type { SynergyPackage } from './types';

/** A recipe family is an OR: keep its best-supported compatible recipe only. */
export function selectRecipes(
  packages: readonly SynergyPackage[],
  pool: readonly AdvisorCard[],
  model: AdvisorModel,
): readonly SynergyPackage[] {
  const completion = (recipe: SynergyPackage): number =>
    recipe.needs.reduce(
      (sum, need) =>
        sum + Math.min(1, pool.filter((c) => profileOf(model, c).tags.includes(need.tag)).length / need.min),
      0,
    ) / recipe.needs.length;
  return packages.filter((recipe) => {
    if (recipe.alternativeGroup === undefined) return true;
    const candidates = packages.filter((p) => p.alternativeGroup === recipe.alternativeGroup);
    return [...candidates].sort((a, b) => completion(b) - completion(a))[0] === recipe;
  });
}
