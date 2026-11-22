/** Hybrid payment chooses one color per symbol without turning it into generic mana. */
import { describe, expect, it } from 'vitest';
import { mana } from '@mtg/dsl';
import { canPay, EMPTY_MANA_POOL, eventsOfType, payFromPool, planPayment, scenario } from '@mtg/kernel';
import { creature, FOREST, ISLAND, MOUNTAIN, PLAINS } from './cards';
import { apply, handOidOf } from './helpers';

const guildCreature = creature('Runeclaw Bear', 2, 2, {
  cost: {
    generic: 1,
    hybrid: { 'W/U': 2 },
  },
});
const guildCreatureCost = mana({ generic: 1, hybrid: { 'W/U': 2 } });

describe('hybrid costs in a mana pool', () => {
  const doubleAzorius = mana({ hybrid: { 'W/U': 2 } });

  it('pays repeated symbols with either color or a mixture', () => {
    expect(payFromPool({ ...EMPTY_MANA_POOL, W: 2 }, doubleAzorius)).toEqual(EMPTY_MANA_POOL);
    expect(payFromPool({ ...EMPTY_MANA_POOL, U: 2 }, doubleAzorius)).toEqual(EMPTY_MANA_POOL);
    expect(payFromPool({ ...EMPTY_MANA_POOL, W: 1, U: 1 }, doubleAzorius)).toEqual(EMPTY_MANA_POOL);
    expect(payFromPool({ ...EMPTY_MANA_POOL, W: 1, R: 1 }, doubleAzorius)).toBeNull();
  });

  it('satisfies fixed colored pips before flexible ones', () => {
    const cost = mana({ U: 1, hybrid: { 'W/U': 1 } });
    expect(payFromPool({ ...EMPTY_MANA_POOL, W: 1, U: 1 }, cost)).toEqual(EMPTY_MANA_POOL);
  });
});

describe('hybrid costs through the payment planner', () => {
  it('finds mono-color and mixed-color plans but refuses unrelated colors', () => {
    const white = scenario({
      battlefield: [
        { card: PLAINS, controller: 0 },
        { card: PLAINS, controller: 0 },
      ],
    });
    const mixed = scenario({
      battlefield: [
        { card: PLAINS, controller: 0 },
        { card: ISLAND, controller: 0 },
      ],
    });
    const wrong = scenario({
      battlefield: [
        { card: MOUNTAIN, controller: 0 },
        { card: FOREST, controller: 0 },
      ],
    });
    const cost = mana({ hybrid: { 'W/U': 2 } });

    expect(planPayment(white.state, 0, cost)?.produces).toEqual(['W', 'W']);
    expect(planPayment(mixed.state, 0, cost)?.produces).toEqual(['W', 'U']);
    expect(canPay(wrong.state, 0, cost)).toBe(false);
  });

  it('backtracks across overlapping pairs instead of greedily stranding a symbol', () => {
    const start = scenario({
      battlefield: [
        { card: ISLAND, controller: 0 },
        { card: PLAINS, controller: 0 },
      ],
    });
    const cost = mana({ hybrid: { 'W/U': 1, 'W/B': 1 } });

    expect(planPayment(start.state, 0, cost)?.produces).toEqual(['W', 'U']);
    expect(canPay(start.state, 0, cost)).toBe(true);
  });

  it('chooses the hybrid color that preserves a castable follow-up', () => {
    const whiteFollowUp = creature('Grizzly Bears', 1, 1, { cost: { W: 1 } });
    const start = scenario({
      battlefield: [
        { card: PLAINS, controller: 0 },
        { card: ISLAND, controller: 0 },
      ],
      hands: [[whiteFollowUp], []],
    });

    expect(planPayment(start.state, 0, mana({ hybrid: { 'W/U': 1 } }))?.produces).toEqual(['U']);
  });

  it('casts through the normal payment event path', () => {
    const start = scenario({
      battlefield: [
        { card: PLAINS, controller: 0 },
        { card: ISLAND, controller: 0 },
        { card: FOREST, controller: 0 },
      ],
      hands: [[guildCreature], []],
    });
    const cast = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(start.state, 0, guildCreature.name),
      targets: [],
    });

    expect(eventsOfType(cast.events, 'manaPaid').at(-1)?.cost).toEqual(guildCreatureCost);
    expect(cast.state.battlefield.filter((oid) => cast.state.objects[oid]?.tapped)).toHaveLength(3);
  });
});
