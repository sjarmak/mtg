/**
 * Spell selection: pool playables -> 23 spells on a target curve.
 *
 * Three passes, in this order, because that is the order the constraints bind:
 *
 * 1. **Curve fill.** Walk the buckets in `curvePriority` (2-4 first) and take
 *    the best cards in each. Each bucket reserves part of the creature floor
 *    first, so a bucket does not fill itself entirely with spells and leave the
 *    floor unreachable later.
 * 2. **Overflow.** Buckets the pool could not fill leave slots open; fill them
 *    with the best remaining cards regardless of mana value. A deck that is 40
 *    cards with a lumpy curve beats a deck that is 36 cards with a perfect one.
 * 3. **Creature-floor repair.** If the floor is still unmet, swap the weakest
 *    selected non-creature for the strongest unselected creature, preferring a
 *    creature in the same bucket so the curve survives the swap.
 *
 * The achieved curve is recomputed from the final selection, so the reported
 * shape is always what was actually built, never what was intended.
 */
import { apportion } from '@mtg/dsl';
import type { DeckBuildConfig } from './config';
import { spellCount } from './config';
import type { CurveBucket, CurveHistogram } from './curve-bucket';
import { CURVE_BUCKETS, emptyCurveHistogram } from './curve-bucket';
import type { PoolCard } from './evaluate';
import { comparePoolCards } from './evaluate';

export interface SpellSelection {
  /** The chosen spells, best-pick first. */
  readonly spells: readonly PoolCard[];
  readonly achievedCurve: CurveHistogram;
  readonly creatureCount: number;
  /** Playables the pool offered but the deck did not take, best-first. */
  readonly leftovers: readonly PoolCard[];
}

function groupByBucket(playables: readonly PoolCard[]): ReadonlyMap<CurveBucket, PoolCard[]> {
  const groups = new Map<CurveBucket, PoolCard[]>(CURVE_BUCKETS.map((bucket) => [bucket, []]));
  for (const playable of playables) {
    groups.get(playable.bucket)?.push(playable);
  }
  for (const group of groups.values()) group.sort(comparePoolCards);
  return groups;
}

/**
 * Splits the creature floor across buckets in proportion to their curve
 * targets, so the floor is pursued where the deck actually has slots.
 */
function creatureQuotaByBucket(config: DeckBuildConfig): ReadonlyMap<CurveBucket, number> {
  const weights = CURVE_BUCKETS.map((bucket) => config.targetCurve[bucket]);
  const quotas = apportion(config.minCreatures, weights);
  return new Map(CURVE_BUCKETS.map((bucket, index) => [bucket, quotas[index] ?? 0]));
}

function fillCurve(
  groups: ReadonlyMap<CurveBucket, PoolCard[]>,
  config: DeckBuildConfig,
  taken: Set<number>,
): PoolCard[] {
  const quotas = creatureQuotaByBucket(config);
  const selected: PoolCard[] = [];
  for (const bucket of config.curvePriority) {
    const target = config.targetCurve[bucket];
    if (target <= 0) continue;
    const candidates = groups.get(bucket) ?? [];
    const creatureQuota = Math.min(quotas.get(bucket) ?? 0, target);

    let picked = 0;
    for (const candidate of candidates) {
      if (picked >= creatureQuota) break;
      if (taken.has(candidate.poolIndex) || !candidate.isCreature) continue;
      taken.add(candidate.poolIndex);
      selected.push(candidate);
      picked += 1;
    }
    for (const candidate of candidates) {
      if (picked >= target) break;
      if (taken.has(candidate.poolIndex)) continue;
      taken.add(candidate.poolIndex);
      selected.push(candidate);
      picked += 1;
    }
  }
  return selected;
}

function fillOverflow(
  playables: readonly PoolCard[],
  wanted: number,
  taken: Set<number>,
  selected: PoolCard[],
): void {
  for (const candidate of playables) {
    if (selected.length >= wanted) return;
    if (taken.has(candidate.poolIndex)) continue;
    taken.add(candidate.poolIndex);
    selected.push(candidate);
  }
}

/**
 * Swaps the weakest selected non-creature for the strongest unselected
 * creature until the floor is met or no swap remains. Same-bucket creatures are
 * preferred so a repair does not distort the curve.
 */
function repairCreatureFloor(
  playables: readonly PoolCard[],
  config: DeckBuildConfig,
  taken: Set<number>,
  selected: PoolCard[],
): void {
  const isTaken = (candidate: PoolCard): boolean => taken.has(candidate.poolIndex);

  for (;;) {
    const creatures = selected.filter((candidate) => candidate.isCreature).length;
    if (creatures >= config.minCreatures) return;

    const nonCreatures = selected.filter((candidate) => !candidate.isCreature).sort(comparePoolCards);
    const weakest = nonCreatures[nonCreatures.length - 1];
    if (weakest === undefined) return;

    const spare = playables.filter((candidate) => candidate.isCreature && !isTaken(candidate));
    const replacement = spare.find((candidate) => candidate.bucket === weakest.bucket) ?? spare[0];
    if (replacement === undefined) return;

    const position = selected.indexOf(weakest);
    if (position < 0) return;
    selected.splice(position, 1, replacement);
    taken.delete(weakest.poolIndex);
    taken.add(replacement.poolIndex);
  }
}

function histogramOf(cards: readonly PoolCard[]): CurveHistogram {
  const histogram = emptyCurveHistogram();
  for (const card of cards) histogram[card.bucket] += 1;
  return histogram;
}

/**
 * Selects the deck's spells from the pool cards playable in the chosen colors.
 * `playables` must already be filtered to legal colors and sorted best-first.
 */
export function selectSpells(playables: readonly PoolCard[], config: DeckBuildConfig): SpellSelection {
  const wanted = spellCount(config);
  const groups = groupByBucket(playables);
  const taken = new Set<number>();

  const selected = fillCurve(groups, config, taken);
  fillOverflow(playables, wanted, taken, selected);
  repairCreatureFloor(playables, config, taken, selected);

  const spells = [...selected].sort(comparePoolCards);
  return {
    spells,
    achievedCurve: histogramOf(spells),
    creatureCount: spells.filter((spell) => spell.isCreature).length,
    leftovers: playables.filter((candidate) => !taken.has(candidate.poolIndex)),
  };
}
