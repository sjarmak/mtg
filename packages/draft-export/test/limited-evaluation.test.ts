import { describe, expect, it } from 'vitest';
import { planLimitedPool, projectedPoolValue } from '../src/limited-evaluation/deck';
import { allocateMana, colorPips } from '../src/limited-evaluation/mana';
import type { EvaluationCard } from '../src/limited-evaluation/model';

const card = (
  id: string,
  colors: EvaluationCard['colors'],
  quality = 2,
  extra: Partial<EvaluationCard> = {},
): EvaluationCard => ({
  id,
  colors,
  manaValue: 3,
  type: 'creature',
  pips: Object.fromEntries(colors.map((c) => [c, 1])),
  sources: [],
  quality,
  roles: [],
  tags: [],
  payoffs: [],
  ...extra,
});
const copies = (prefix: string, count: number, colors: EvaluationCard['colors'], quality = 2) =>
  Array.from({ length: count }, (_, i) => card(`${prefix}${i}`, colors, quality));

describe('shared finished-deck evaluation', () => {
  it('chooses a coherent pair over scattered high-rated off-color cards', () => {
    const pool = [
      ...copies('white', 13, ['W'], 3),
      ...copies('blue', 13, ['U'], 3),
      card('black', ['B'], 3.2),
      card('red', ['R'], 3.2),
      card('green', ['G'], 3.2),
    ];
    const before = structuredClone(pool);
    const plan = planLimitedPool(pool, { landCounts: [17] });
    expect(plan.selectedIds).toHaveLength(23);
    expect(plan.selectedIds).not.toContain('black');
    expect(plan.selectedIds).not.toContain('red');
    expect(plan.selectedIds).not.toContain('green');
    expect(Object.values(plan.basics).reduce((a, b) => a + b, 0)).toBe(17);
    expect(planLimitedPool(pool, { landCounts: [17] })).toEqual(plan);
    expect(pool).toEqual(before);
  });

  it('counts fixing lands inside the land target, preserving 23 spells', () => {
    const pool = [
      ...copies('w', 12, ['W']),
      ...copies('u', 12, ['U']),
      card('dual', [], 3, { type: 'nonbasic-land', manaValue: 0, sources: ['W', 'U'] }),
    ];
    const plan = planLimitedPool(pool, { landCounts: [17] });
    expect(plan.selectedIds).toContain('dual');
    expect(plan.selectedIds).toHaveLength(24);
    expect(Object.values(plan.basics).reduce((a, b) => a + b, 0)).toBe(16);
  });

  it('allocates colored-pip demand and credits existing dual sources', () => {
    const spells = [
      ...copies('w', 10, ['W']).map((c) => ({ ...c, pips: { W: 3 } })),
      ...copies('u', 10, ['U']),
    ];
    const basics = allocateMana(spells, [], 17);
    expect(basics.Plains).toBeGreaterThan(basics.Island);
    expect(basics.Swamp + basics.Mountain + basics.Forest).toBe(0);
    expect(colorPips('{2}{W}{W}{U}')).toEqual({ W: 2, U: 1 });
    expect(() => colorPips('{W/U}')).toThrow(/mana symbol/);
  });

  it('values an enabler more when its payoff is in the same playable deck', () => {
    const enabler = card('cycler', ['U'], 2, { tags: ['cycling'] });
    const payoff = card('payoff', ['U'], 2, { payoffs: [{ tag: 'cycling', target: 1, weight: 2 }] });
    const base = copies('u', 6, ['U']);
    const ordinary = projectedPoolValue([...base, enabler]) - projectedPoolValue(base);
    const synergy = projectedPoolValue([...base, payoff, enabler]) - projectedPoolValue([...base, payoff]);
    expect(synergy).toBeGreaterThan(ordinary);
  });

  it('does not let a payoff satisfy itself or an off-color sideboard enabler', () => {
    const payoff = card('self', ['U'], 2, {
      tags: ['cycling'],
      payoffs: [{ tag: 'cycling', target: 1, weight: 2 }],
    });
    expect(projectedPoolValue([payoff])).toBe(projectedPoolValue([{ ...payoff, payoffs: [] }]));
    const pool = [...copies('u', 12, ['U'], 3), ...copies('w', 12, ['W'], 3), payoff];
    expect(projectedPoolValue([...pool, card('off', ['B', 'R', 'G'], 1, { tags: ['cycling'] })])).toBe(
      projectedPoolValue(pool),
    );
  });

  it('selects a colorless Desert when it enables the chosen spells', () => {
    const pool = copies('r', 23, ['R']).map((c) => ({
      ...c,
      payoffs: [{ tag: 'desert', weight: 1, target: 1 }],
    }));
    const desert = card('desert', [], 1, { type: 'nonbasic-land', manaValue: 0, tags: ['desert'] });
    const plan = planLimitedPool([...pool, desert], { landCounts: [17] });
    expect(plan.selectedIds).toContain('desert');
    expect(plan.basics.Mountain).toBe(16);
  });

  it('rejects inconsistent color requirements and malformed draft projections', () => {
    expect(() => planLimitedPool([card('x', [], 2, { pips: { W: 1 } })])).toThrow(/color/);
    expect(() => projectedPoolValue([card('x', ['W'], NaN)])).toThrow();
  });

  it('rejects duplicate copies, invalid grades and empty construction pools', () => {
    expect(() => planLimitedPool([card('x', ['W']), card('x', ['U'])])).toThrow(/duplicate/);
    expect(() => planLimitedPool([card('x', ['W'], NaN)])).toThrow();
    expect(() => planLimitedPool([])).toThrow(/pool/);
    expect(projectedPoolValue([])).toBe(0);
  });
});
