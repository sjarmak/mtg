import { describe, expect, it } from 'vitest';
import type { GameState } from '@mtg/kernel';
import {
  availableMana,
  canPay,
  characteristicsOf,
  effectsApplyingTo,
  EMPTY_MANA_POOL,
  eventsOfType,
  getObject,
  landProduces,
  payFromPool,
  planPayment,
  pendingDecision,
  poolTotal,
  powerOf,
  scenario,
  toughnessOf,
} from '@mtg/kernel';
import { mana } from '@mtg/dsl';
import { creature, FOREST, instant, ISLAND, MOUNTAIN } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const giantGrowth = instant(
  'Test Growth',
  [{ kind: 'pumpUntilEndOfTurn', power: 3, toughness: 3, target: { kind: 'targetCreature' } }],
  { G: 1 },
);
const bear = creature('Layer Bear', 2, 2);

function resolveTop(from: ReturnType<typeof apply>): ReturnType<typeof apply> {
  return apply(apply(from, { type: 'passPriority', player: 0 }), { type: 'passPriority', player: 1 });
}

/** Idles forward: passes priority and takes the null option on every other decision. */
function passUntilTurn(from: ReturnType<typeof apply>, turn: number): ReturnType<typeof apply> {
  let current = from;
  for (let guard = 0; guard < 400; guard += 1) {
    if (current.state.turn.number >= turn) return current;
    const decision = pendingDecision(current.state);
    if (decision === null) throw new Error('the game ended early');
    const option =
      decision.kind === 'priority'
        ? { type: 'passPriority' as const, player: decision.player }
        : decision.options[0];
    if (option === undefined) throw new Error(`no option offered for ${decision.kind}`);
    current = apply(current, option);
  }
  throw new Error(`never reached turn ${turn}`);
}

describe('the fixed-order P/T layer', () => {
  it('derives power and toughness without touching the printed card', () => {
    const start = scenario({
      battlefield: [
        { card: bear, controller: 0 },
        { card: FOREST, controller: 0 },
      ],
      hands: [[giantGrowth], []],
    });
    const bearOid = oidOf(start.state, 'Layer Bear');
    const cast = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(start.state, 0, 'Test Growth'),
      targets: [{ kind: 'permanent', oid: bearOid }],
    });
    const pumped = resolveTop(cast);
    expect(powerOf(pumped.state, bearOid)).toBe(5);
    expect(toughnessOf(pumped.state, bearOid)).toBe(5);
    const object = pumped.state.objects[bearOid];
    expect(object?.card.kind === 'creature' ? object.card.power : -1).toBe(2);
    expect(effectsApplyingTo(pumped.state, bearOid)).toHaveLength(1);
    expect(characteristicsOf(pumped.state, bearOid).keywords).toEqual([]);
  });

  it('stacks two modifications in timestamp order and expires both at cleanup', () => {
    const start = scenario({
      battlefield: [
        { card: bear, controller: 0 },
        { card: FOREST, controller: 0 },
        { card: FOREST, controller: 0 },
      ],
      hands: [[giantGrowth, giantGrowth], []],
    });
    const bearOid = oidOf(start.state, 'Layer Bear');
    let current: ReturnType<typeof apply> = start;
    for (let cast = 0; cast < 2; cast += 1) {
      current = apply(current, {
        type: 'castSpell',
        player: 0,
        oid: handOidOf(current.state, 0, 'Test Growth'),
        targets: [{ kind: 'permanent', oid: bearOid }],
      });
      current = resolveTop(current);
    }
    expect(powerOf(current.state, bearOid)).toBe(8);
    const timestamps = effectsApplyingTo(current.state, bearOid).map((effect) => effect.timestamp);
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));

    const nextTurn = passUntilTurn(current, current.state.turn.number + 1);
    expect(powerOf(nextTurn.state, bearOid)).toBe(2);
    expect(nextTurn.state.continuous).toHaveLength(0);
    expect(eventsOfType(nextTurn.events, 'continuousEffectsExpired')).toHaveLength(1);
  });
});

describe('mana', () => {
  it('pays colored pips from their own color and generic from anything', () => {
    const pool = { ...EMPTY_MANA_POOL, R: 2, G: 1, C: 1 };
    // Pips come out first, then generic: colorless, then WUBRG order.
    expect(payFromPool(pool, mana({ generic: 2, R: 1 }))).toEqual({ ...EMPTY_MANA_POOL, G: 1 });
    expect(payFromPool(pool, mana({ U: 1 }))).toBeNull();
    expect(payFromPool(pool, mana({ generic: 5 }))).toBeNull();
    expect(poolTotal(pool)).toBe(4);
  });

  it('plans which lands to tap for a two-color cost', () => {
    const start = scenario({
      battlefield: [
        { card: MOUNTAIN, controller: 0 },
        { card: ISLAND, controller: 0 },
        { card: FOREST, controller: 0 },
      ],
    });
    const plan = planPayment(start.state, 0, mana({ generic: 1, R: 1, U: 1 }));
    expect(plan).not.toBeNull();
    expect(plan?.taps).toHaveLength(3);
    expect(plan?.produces).toEqual(['U', 'R', 'G']);
    expect(canPay(start.state, 0, mana({ R: 2 }))).toBe(false);
    expect(availableMana(start.state, 0)).toBe(3);
  });

  it('auto-taps exactly what a cast needs and leaves the rest untapped', () => {
    const start = scenario({
      battlefield: [
        { card: bear, controller: 0 },
        { card: FOREST, controller: 0 },
        { card: FOREST, controller: 0 },
      ],
      hands: [[giantGrowth], []],
    });
    const cast = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(start.state, 0, 'Test Growth'),
      targets: [{ kind: 'permanent', oid: oidOf(start.state, 'Layer Bear') }],
    });
    const tapped = cast.state.battlefield.filter((oid) => cast.state.objects[oid]?.tapped);
    expect(tapped).toHaveLength(1);
  });

  it('empties the pool at the end of every step, and says how much was wasted', () => {
    const start = scenario({ battlefield: [{ card: MOUNTAIN, controller: 0 }] });
    const landOid = oidOf(start.state, 'Mountain');
    expect(landProduces(getObject(start.state, landOid).card)).toEqual(['R']);
    const floated = apply(start, {
      type: 'activateManaAbility',
      player: 0,
      oid: landOid,
      color: 'R',
    });
    expect(poolOf(floated.state)).toBe(1);
    const advanced = apply(apply(floated, { type: 'passPriority', player: 0 }), {
      type: 'passPriority',
      player: 1,
    });
    expect(poolOf(advanced.state)).toBe(0);
    expect(eventsOfType(advanced.events, 'manaPoolEmptied')).toHaveLength(1);
  });
});

function poolOf(state: GameState): number {
  return poolTotal(state.players[0].pool);
}
