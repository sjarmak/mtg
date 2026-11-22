import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import { cellOf, cutPool, PoolCutError, sheetShape } from '../src/pool-cut';
import type { PoolCutPlan, SheetShape } from '../src/pool-cut';
import { createRng } from '../src/rng';

type Color = 'W' | 'U' | 'B' | 'R' | 'G';
const COLORS: readonly Color[] = ['W', 'U', 'B', 'R', 'G'];

interface Spec {
  readonly id: string;
  readonly rarity: 'common' | 'uncommon' | 'rare' | 'mythic';
  readonly colors: readonly Color[];
  readonly manaValue: number;
  readonly creature: boolean;
  readonly number: number;
}

function card(spec: Spec): Card {
  const pips = Object.fromEntries(COLORS.map((color) => [color, spec.colors.includes(color) ? 1 : 0]));
  const colored = spec.colors.length;
  const shared = {
    id: spec.id,
    name: spec.id,
    rarity: spec.rarity,
    set: { code: 'TST', collectorNumber: spec.number },
    colors: spec.colors,
    supertypes: [],
    subtypes: [],
    keywords: [],
    abilities: [],
    manaCost: { generic: Math.max(0, spec.manaValue - colored), ...pips },
  };
  return spec.creature
    ? parseCard({ ...shared, kind: 'creature', effects: [], power: 1, toughness: 1, artifact: false })
    : parseCard({
        ...shared,
        kind: 'sorcery',
        effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
      });
}

function common(id: string, color: Color, manaValue: number, number: number, creature = true): Card {
  return card({ id, rarity: 'common', colors: [color], manaValue, creature, number });
}

const FLAT: readonly number[] = [1, 1, 1, 1, 1, 1];

function shape(size: number, curve: readonly number[] = FLAT): SheetShape {
  return { size, curve };
}

const isAnswer = (entry: Card): boolean => entry.id.startsWith('answer');

function plan(
  commons: SheetShape,
  uncommons: SheetShape,
  protectedIds: readonly string[] = [],
  prices: Readonly<Record<string, number>> = {},
): PoolCutPlan {
  return {
    protectedIds: new Set(protectedIds),
    sheets: { common: commons, uncommon: uncommons },
    isAnswer,
    price: (entry) => prices[entry.id] ?? 0,
  };
}

function ids(cards: readonly Card[]): readonly string[] {
  return cards.map((entry) => entry.id);
}

describe('cutPool', () => {
  it('keeps every protected card and every rare and mythic', () => {
    const pool = [
      common('w1', 'W', 2, 1),
      common('w2', 'W', 2, 2),
      common('u1', 'U', 2, 3),
      card({ id: 'r1', rarity: 'rare', colors: ['R'], manaValue: 4, creature: true, number: 4 }),
      card({ id: 'm1', rarity: 'mythic', colors: [], manaValue: 6, creature: true, number: 5 }),
    ];
    const result = cutPool(pool, plan(shape(2), shape(0), ['w2']));
    expect(ids(result.kept)).toEqual(['w2', 'u1', 'r1', 'm1']);
    expect(ids(result.cut)).toEqual(['w1']);
  });

  it('gives each free slot to the color holding the fewest cards on the sheet', () => {
    const pool = [
      common('w1', 'W', 2, 1),
      common('w2', 'W', 2, 2),
      common('w3', 'W', 2, 3),
      common('w4', 'W', 2, 4),
      common('u1', 'U', 2, 5),
      common('u2', 'U', 2, 6),
      common('u3', 'U', 2, 7),
    ];
    const result = cutPool(pool, plan(shape(5), shape(0), ['w1', 'w2', 'w3']));
    expect(ids(result.kept)).toEqual(['w1', 'w2', 'w3', 'u1', 'u2']);
  });

  it('breaks a tie between colors toward the color holding fewer cards in the whole set', () => {
    const pool = [
      common('w1', 'W', 2, 1),
      common('u1', 'U', 2, 2),
      card({ id: 'wr', rarity: 'rare', colors: ['W'], manaValue: 4, creature: true, number: 3 }),
    ];
    const result = cutPool(pool, plan(shape(1), shape(0)));
    expect(ids(result.kept)).toEqual(['u1', 'wr']);
  });

  it('takes the candidate whose mana-value band is furthest under the reference curve', () => {
    const pool = [common('held', 'W', 2, 1), common('two', 'W', 2, 2), common('four', 'W', 4, 3)];
    const result = cutPool(pool, plan(shape(2, [0, 1, 0, 1, 0, 0]), shape(0), ['held']));
    expect(ids(result.kept)).toEqual(['held', 'four']);
  });

  it('takes the role the color has kept the smallest share of before it reads the curve', () => {
    const pool = [
      common('creature-held', 'W', 2, 1),
      common('creature-two', 'W', 4, 2),
      common('answer-one', 'W', 2, 3, false),
      common('answer-two', 'W', 2, 4, false),
      common('spell-held', 'W', 2, 5, false),
    ];
    const result = cutPool(
      pool,
      plan(shape(3, [0, 1, 0, 1, 0, 0]), shape(0), ['creature-held', 'spell-held']),
    );
    expect(ids(result.kept)).toEqual(['creature-held', 'answer-one', 'spell-held']);
  });

  it('gives a color priced under the sheet the card that leaves it the least under the mean of the single-color cards kept on the sheet', () => {
    const pool = [
      common('w1', 'W', 2, 1),
      common('w2', 'W', 2, 2),
      common('u1', 'U', 2, 3),
      common('u-low', 'U', 2, 4),
      common('u-nearer', 'U', 2, 5),
    ];
    const prices = { w1: 5, w2: 5, u1: 1, 'u-low': 1, 'u-nearer': 3 };
    const result = cutPool(pool, plan(shape(4), shape(0), ['w1', 'w2', 'u1'], prices));
    expect(ids(result.kept)).toEqual(['w1', 'w2', 'u1', 'u-nearer']);
  });

  it('stops reading the price at the card that brings the color level with the sheet', () => {
    const pool = [
      common('w1', 'W', 2, 1),
      common('w2', 'W', 2, 2),
      common('u1', 'U', 2, 3),
      common('u-low', 'U', 2, 4),
      common('u-level', 'U', 2, 5),
      common('u-high', 'U', 2, 6),
    ];
    const prices = { w1: 3, w2: 3, u1: 1, 'u-low': 2, 'u-level': 5, 'u-high': 9 };
    const result = cutPool(pool, plan(shape(4), shape(0), ['w1', 'w2', 'u1'], prices));
    expect(ids(result.kept)).toEqual(['w1', 'w2', 'u1', 'u-level']);
  });

  it('reads no price in a color already priced over the sheet', () => {
    const pool = [
      common('g1', 'G', 2, 1),
      common('w1', 'W', 2, 2),
      common('w2', 'W', 2, 3),
      common('g-high', 'G', 2, 4),
      common('g-low', 'G', 2, 5),
    ];
    const prices = { g1: 5, w1: 1, w2: 1, 'g-high': 4, 'g-low': 3 };
    const result = cutPool(pool, plan(shape(4), shape(0), ['g1', 'w1', 'w2'], prices));
    expect(ids(result.kept)).toEqual(['g1', 'w1', 'w2', 'g-high']);
  });

  it('reads the price before the role', () => {
    const pool = [
      common('creature-held', 'W', 2, 1),
      common('creature-two', 'W', 2, 2),
      common('answer-one', 'W', 2, 3, false),
      common('spell-held', 'W', 2, 4, false),
    ];
    const prices = { 'creature-held': 4, 'creature-two': 4, 'answer-one': 1, 'spell-held': 4 };
    const result = cutPool(pool, plan(shape(3), shape(0), ['creature-held', 'spell-held'], prices));
    expect(ids(result.kept)).toEqual(['creature-held', 'creature-two', 'spell-held']);
  });

  it('reads the price before the curve', () => {
    const pool = [
      common('w1', 'W', 2, 1),
      common('w2', 'W', 2, 2),
      common('two', 'W', 2, 3),
      common('four', 'W', 4, 4),
    ];
    const prices = { w1: 3, w2: 3, two: 3, four: 0 };
    const result = cutPool(pool, plan(shape(3, [0, 1, 0, 1, 0, 0]), shape(0), ['w1', 'w2'], prices));
    expect(ids(result.kept)).toEqual(['w1', 'w2', 'two']);
  });

  it('reads no price while the sheet has kept no single-color card to compare against', () => {
    const pool = [common('w-cheap', 'W', 2, 1), common('w-dear', 'W', 2, 2)];
    const result = cutPool(pool, plan(shape(1), shape(0), [], { 'w-cheap': 1, 'w-dear': 9 }));
    expect(ids(result.kept)).toEqual(['w-cheap']);
  });

  it('reads no price outside a single color', () => {
    for (const colors of [[], ['W', 'U']] as const) {
      const other = (id: string, number: number): Card =>
        card({ id, rarity: 'common', colors, manaValue: 2, creature: true, number });
      const pool = [common('r1', 'R', 2, 1), other('held', 2), other('first', 3), other('dear', 4)];
      const prices = { r1: 5, held: 1, first: 1, dear: 9 };
      const result = cutPool(pool, plan(shape(3), shape(0), ['r1', 'held'], prices));
      expect(ids(result.kept)).toEqual(['r1', 'held', 'first']);
    }
  });

  it('counts an answer printed on a creature as an answer', () => {
    const pool = [
      common('creature-held', 'W', 2, 1),
      common('creature-two', 'W', 2, 2),
      common('answer-body', 'W', 2, 3),
      common('creature-three', 'W', 2, 4),
    ];
    const result = cutPool(pool, plan(shape(2), shape(0), ['creature-held']));
    expect(ids(result.kept)).toEqual(['creature-held', 'answer-body']);
  });

  it('breaks a tie between roles on the curve, then on the lower collector number', () => {
    const pool = [
      common('creature-late', 'W', 3, 4),
      common('creature-early', 'W', 3, 2),
      common('spell-off-curve', 'W', 5, 1, false),
    ];
    const result = cutPool(pool, plan(shape(1, [0, 0, 1, 0, 0, 0]), shape(0)));
    expect(ids(result.kept)).toEqual(['creature-early']);
  });

  it('reaches colorless and multicolor candidates only once no single color has one left', () => {
    const pool = [
      card({ id: 'c1', rarity: 'common', colors: [], manaValue: 2, creature: true, number: 1 }),
      common('w1', 'W', 2, 2),
      card({ id: 'gold', rarity: 'common', colors: ['W', 'U'], manaValue: 2, creature: true, number: 3 }),
    ];
    expect(ids(cutPool(pool, plan(shape(1), shape(0))).kept)).toEqual(['w1']);
    expect(ids(cutPool(pool, plan(shape(2), shape(0))).kept)).toEqual(['c1', 'w1']);
  });

  it('refuses a size the protected cards already exceed', () => {
    const pool = [common('w1', 'W', 2, 1), common('w2', 'W', 2, 2)];
    expect(() => cutPool(pool, plan(shape(1), shape(0), ['w1', 'w2']))).toThrow(PoolCutError);
  });

  it('refuses a size the sheet cannot fill', () => {
    expect(() => cutPool([common('w1', 'W', 2, 1)], plan(shape(2), shape(0)))).toThrow(PoolCutError);
  });
});

describe('sheetShape', () => {
  const reference = [
    { rarity: 'common', manaValue: 1, types: ['Creature'] },
    { rarity: 'common', manaValue: 0, types: ['Artifact'] },
    { rarity: 'common', manaValue: 3, types: ['Instant'] },
    { rarity: 'common', manaValue: 8, types: ['Creature'] },
    { rarity: 'common', manaValue: 0, types: ['Land'] },
    { rarity: 'uncommon', manaValue: 2, types: ['Creature'] },
  ];

  it('counts one rarity by mana-value band, leaving lands out', () => {
    expect(sheetShape(reference, 'common', 10)).toEqual({ size: 10, curve: [2, 0, 1, 0, 0, 1] });
  });

  it('refuses a rarity the reference does not print', () => {
    expect(() => sheetShape(reference, 'mythic', 3)).toThrow(PoolCutError);
  });
});

describe('cutPool over seeded random pools', () => {
  function randomPool(seed: string): readonly Card[] {
    const rng = createRng(seed);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(rng() * items.length)] as T;
    const size = 20 + Math.floor(rng() * 60);
    return Array.from({ length: size }, (_, index) => {
      const roll = rng();
      const colors: readonly Color[] = roll < 0.08 ? [] : roll < 0.14 ? ['W', 'U'] : [pick(COLORS)];
      return card({
        id: `${rng() < 0.2 ? 'answer' : 'card'}-${String(index)}`,
        rarity: pick(['common', 'common', 'common', 'uncommon', 'uncommon', 'rare', 'mythic'] as const),
        colors,
        manaValue: Math.max(colors.length, 1 + Math.floor(rng() * 7)),
        creature: rng() < 0.55,
        number: index + 1,
      });
    });
  }

  function randomPlan(pool: readonly Card[], seed: string, mostFree = Infinity): PoolCutPlan {
    const rng = createRng(`${seed}/plan`);
    const protectedIds = pool.filter(() => rng() < 0.3).map((entry) => entry.id);
    const sized = (rarity: 'common' | 'uncommon'): SheetShape => {
      const sheet = pool.filter((entry) => entry.rarity === rarity);
      const held = sheet.filter((entry) => protectedIds.includes(entry.id)).length;
      const free = Math.min(mostFree, Math.floor(rng() * (sheet.length - held + 1)));
      return shape(held + free, [24, 28, 22, 15, 9, 2]);
    };
    const priced = createRng(`${seed}/price`);
    const prices = Object.fromEntries(pool.map((entry) => [entry.id, Math.floor(priced() * 8)]));
    return plan(sized('common'), sized('uncommon'), protectedIds, prices);
  }

  const seeds = Array.from({ length: 150 }, (_, index) => `pool-cut/${String(index)}`);

  it('partitions the pool in its own order and never cuts a protected, rare or mythic card', () => {
    for (const seed of seeds) {
      const pool = randomPool(seed);
      const cutPlan = randomPlan(pool, seed);
      const result = cutPool(pool, cutPlan);
      const kept = new Set(ids(result.kept));
      expect(ids(pool.filter((entry) => kept.has(entry.id)))).toEqual(ids(result.kept));
      expect(ids(pool.filter((entry) => !kept.has(entry.id)))).toEqual(ids(result.cut));
      for (const entry of result.cut) {
        expect(cutPlan.protectedIds.has(entry.id)).toBe(false);
        expect(['common', 'uncommon']).toContain(entry.rarity);
      }
    }
  });

  it('lands each sheet on its stated size and cuts nothing when run again', () => {
    for (const seed of seeds) {
      const pool = randomPool(seed);
      const cutPlan = randomPlan(pool, seed);
      const result = cutPool(pool, cutPlan);
      for (const rarity of ['common', 'uncommon'] as const) {
        expect(result.kept.filter((entry) => entry.rarity === rarity)).toHaveLength(
          cutPlan.sheets[rarity].size,
        );
      }
      expect(cutPool(result.kept, cutPlan).cut).toEqual([]);
    }
  });

  it('with every card priced alike, never fills a role past one card above the share of a role in the same color that still had a card to give', () => {
    const roleOf = (entry: Card): string => (isAnswer(entry) ? 'answer' : entry.kind);
    for (const seed of seeds) {
      const pool = randomPool(seed);
      const cutPlan = { ...randomPlan(pool, seed), price: (): number => 1 };
      const result = cutPool(pool, cutPlan);
      const kept = new Set(ids(result.kept));
      for (const rarity of ['common', 'uncommon'] as const) {
        for (const color of COLORS) {
          const cell = pool.filter(
            (entry) => entry.rarity === rarity && entry.colors.length === 1 && entry.colors[0] === color,
          );
          const roles = [...new Set(cell.map(roleOf))];
          const inRole = (role: string): readonly Card[] => cell.filter((entry) => roleOf(entry) === role);
          const keptIn = (role: string): number => inRole(role).filter((entry) => kept.has(entry.id)).length;
          for (const filled of roles) {
            const tookFreeSlot = inRole(filled).some(
              (entry) => kept.has(entry.id) && !cutPlan.protectedIds.has(entry.id),
            );
            if (!tookFreeSlot) continue;
            for (const starved of roles) {
              if (keptIn(starved) === inRole(starved).length) continue;
              expect((keptIn(filled) - 1) / inRole(filled).length).toBeLessThanOrEqual(
                keptIn(starved) / inRole(starved).length,
              );
            }
          }
        }
      }
    }
  });

  it('never gives a single free slot to a card priced under one it passed over in that color, unless the card taken brings the color level with the sheet', () => {
    const total = (cards: readonly Card[], price: PoolCutPlan['price']): number =>
      cards.reduce((sum, entry) => sum + price(entry), 0);
    const passedOver = seeds.flatMap((seed) => {
      const pool = randomPool(seed);
      const cutPlan = randomPlan(pool, seed, 1);
      const result = cutPool(pool, cutPlan);
      return (['common', 'uncommon'] as const).flatMap((rarity) => {
        const kept = result.kept.filter((entry) => entry.rarity === rarity);
        const [taken] = kept.filter((entry) => !cutPlan.protectedIds.has(entry.id));
        if (taken === undefined || taken.colors.length !== 1) return [];
        const held = kept.filter((entry) => entry.id !== taken.id && entry.colors.length === 1);
        const inColor = held.filter((entry) => cellOf(entry) === cellOf(taken));
        const level =
          (total(inColor, cutPlan.price) + cutPlan.price(taken)) * held.length >=
          total(held, cutPlan.price) * (inColor.length + 1);
        const others = result.cut.filter(
          (entry) => entry.rarity === rarity && cellOf(entry) === cellOf(taken),
        );
        for (const other of others) {
          expect(level || cutPlan.price(taken) >= cutPlan.price(other)).toBe(true);
        }
        return others;
      });
    });
    expect(passedOver.length).toBeGreaterThan(100);
  });

  it('reads how prices compare and not how large they are: doubling every price cuts the same cards', () => {
    for (const seed of seeds) {
      const pool = randomPool(seed);
      const cutPlan = randomPlan(pool, seed);
      const doubled = { ...cutPlan, price: (entry: Card): number => cutPlan.price(entry) * 2 };
      expect(ids(cutPool(pool, doubled).cut)).toEqual(ids(cutPool(pool, cutPlan).cut));
    }
  });

  it('never fills a color past one card above a color that still had a card to give', () => {
    for (const seed of seeds) {
      const pool = randomPool(seed);
      const cutPlan = randomPlan(pool, seed);
      const result = cutPool(pool, cutPlan);
      for (const rarity of ['common', 'uncommon'] as const) {
        const held = (cards: readonly Card[], color: Color): readonly Card[] =>
          cards.filter(
            (entry) => entry.rarity === rarity && entry.colors.length === 1 && entry.colors[0] === color,
          );
        for (const filled of COLORS) {
          const tookFreeSlot = held(result.kept, filled).some((entry) => !cutPlan.protectedIds.has(entry.id));
          if (!tookFreeSlot) continue;
          for (const starved of COLORS) {
            if (held(result.cut, starved).length === 0) continue;
            expect(held(result.kept, filled).length).toBeLessThanOrEqual(
              held(result.kept, starved).length + 1,
            );
          }
        }
      }
    }
  });
});
