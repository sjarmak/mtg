import { describe, expect, it } from 'vitest';
import type { Card, CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import {
  CURVE_BUCKETS,
  curveTotal,
  evaluatePool,
  playablesFor,
  resolveConfig,
  selectSpells,
  spellCount,
} from '@mtg/deckbuild';
import { makeSyntheticPool } from './helpers/pool';

const PAIR = ['R', 'G'] as const;

function redCreature(index: number, manaValue: number): Card {
  return parseCard({
    kind: 'creature',
    id: `rc-${index}`,
    name: `Red Creature ${index}`,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: index + 1 },
    manaCost: { generic: manaValue - 1, R: 1 },
    colors: ['R'],
    power: manaValue,
    toughness: manaValue,
  } satisfies CardInput);
}

function redSpell(index: number, manaValue: number): Card {
  return parseCard({
    kind: 'instant',
    id: `rs-${index}`,
    name: `Red Spell ${index}`,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: index + 200 },
    manaCost: { generic: manaValue - 1, R: 1 },
    colors: ['R'],
    effects: [{ kind: 'dealDamage', amount: 4, target: { kind: 'anyTarget' } }],
  } satisfies CardInput);
}

function select(pool: readonly Card[], overrides: Parameters<typeof resolveConfig>[0] = {}) {
  const config = resolveConfig(overrides);
  const evaluated = evaluatePool(pool, config.weights);
  return { config, selection: selectSpells(playablesFor(evaluated, PAIR), config) };
}

describe('selectSpells', () => {
  it('hits the target curve exactly when the pool can supply every slot', () => {
    const pool = [
      ...CURVE_BUCKETS.flatMap((bucket) =>
        Array.from({ length: 10 }, (_unused, index) =>
          redCreature(bucket * 100 + index, Math.max(1, bucket)),
        ),
      ),
    ];
    const { config, selection } = select(pool);
    expect(selection.spells).toHaveLength(spellCount(config));
    for (const bucket of CURVE_BUCKETS) {
      expect(selection.achievedCurve[bucket]).toBe(config.targetCurve[bucket]);
    }
    expect(curveTotal(selection.achievedCurve)).toBe(spellCount(config));
  });

  it('puts the curve mass at MV 2-4', () => {
    const { selection } = select(makeSyntheticPool(21, { size: 200 }));
    const mass = selection.achievedCurve[2] + selection.achievedCurve[3] + selection.achievedCurve[4];
    expect(mass).toBe(17);
  });

  it('reaches the creature floor even when spells score higher', () => {
    const pool = [
      ...Array.from({ length: 40 }, (_unused, index) => redSpell(index, 2 + (index % 4))),
      ...Array.from({ length: 20 }, (_unused, index) => redCreature(index, 1 + (index % 5))),
    ];
    const { config, selection } = select(pool);
    expect(selection.creatureCount).toBeGreaterThanOrEqual(config.minCreatures);
  });

  it('degrades gracefully when a bucket cannot be filled, keeping the deck full size', () => {
    // Nothing above two mana exists in this pool.
    const pool = [
      ...Array.from({ length: 30 }, (_unused, index) => redCreature(index, 1 + (index % 2))),
      ...Array.from({ length: 10 }, (_unused, index) => redSpell(index, 2)),
    ];
    const { config, selection } = select(pool);
    expect(selection.spells).toHaveLength(spellCount(config));
    expect(selection.achievedCurve[4]).toBe(0);
    expect(selection.achievedCurve[1] + selection.achievedCurve[2]).toBe(spellCount(config));
  });

  it('ships fewer spells rather than duplicating cards when the pool runs out', () => {
    const pool = Array.from({ length: 9 }, (_unused, index) => redCreature(index, 2));
    const { selection } = select(pool);
    expect(selection.spells).toHaveLength(9);
    expect(new Set(selection.spells.map((pick) => pick.poolIndex)).size).toBe(9);
    expect(selection.leftovers).toHaveLength(0);
  });

  it('never picks the same pool card twice and leaves the rest as leftovers', () => {
    const pool = makeSyntheticPool(42, { size: 120 });
    const { config, selection } = select(pool);
    const indices = selection.spells.map((pick) => pick.poolIndex);
    expect(new Set(indices).size).toBe(indices.length);
    const leftoverIndices = new Set(selection.leftovers.map((pick) => pick.poolIndex));
    expect(indices.some((index) => leftoverIndices.has(index))).toBe(false);
    expect(selection.spells.length + selection.leftovers.length).toBe(
      playablesFor(evaluatePool(pool, config.weights), PAIR).length,
    );
  });

  it('honors a custom target curve', () => {
    const custom = { 0: 0, 1: 0, 2: 0, 3: 23, 4: 0, 5: 0, 6: 0 } as const;
    const pool = Array.from({ length: 60 }, (_unused, index) => redCreature(index, 3));
    const { selection } = select(pool, { targetCurve: custom });
    expect(selection.achievedCurve[3]).toBe(23);
  });

  it('is deterministic for a fixed pool', () => {
    const pool = makeSyntheticPool(99, { size: 150 });
    const first = select(pool).selection.spells.map((pick) => pick.poolIndex);
    const second = select(pool).selection.spells.map((pick) => pick.poolIndex);
    expect(first).toEqual(second);
  });
});
