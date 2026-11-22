import { describe, expect, it } from 'vitest';
import { parseCard, type Card } from '@mtg/dsl';
import { beginTrace, eventsOfType, pendingDecision, scenario, type ReduceResult } from '@mtg/kernel';
import { counterStackEntry } from '../src/counter';
import { creature, FOREST, ISLAND, MOUNTAIN } from './cards';
import { apply, handOidOf } from './helpers';

const ESSENCE_BACKLASH = parseCard({
  kind: 'instant',
  id: 'rtr-160-essence-backlash-kernel',
  name: 'Essence Backlash',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 160 },
  manaCost: { generic: 2, U: 1, R: 1 },
  colors: ['U', 'R'],
  effects: [
    {
      kind: 'counterSpell',
      spellFilter: { cardTypes: ['creature'] },
      dealDamageToControllerEqualToSpellPower: true,
    },
  ],
});

const TARGET = creature('Backlash Four', 4, 4);
const ZERO = creature('Backlash Zero', 0, 4);
const UNCOUNTERABLE = parseCard({
  kind: 'creature',
  id: 'backlash-uncounterable',
  name: 'Backlash Uncounterable',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 160 },
  manaCost: { generic: 1 },
  colors: [],
  subtypes: [],
  keywords: [],
  abilities: [],
  power: 3,
  toughness: 3,
  cannotBeCountered: true,
});

function castBacklash(target: Card): {
  readonly cast: ReduceResult;
  readonly targetOid: string;
  readonly backlashOid: string;
} {
  const start = scenario({
    life: [20, 20],
    battlefield: [
      { card: FOREST, controller: 0 },
      { card: ISLAND, controller: 1 },
      { card: ISLAND, controller: 1 },
      { card: MOUNTAIN, controller: 1 },
      { card: MOUNTAIN, controller: 1 },
    ],
    hands: [[target], [ESSENCE_BACKLASH]],
  });
  const targetOid = handOidOf(start.state, 0, target.name);
  const backlashOid = handOidOf(start.state, 1, ESSENCE_BACKLASH.name);
  const targetCast = apply(start, { type: 'castSpell', player: 0, oid: targetOid, targets: [] });
  const offered = apply(targetCast, { type: 'passPriority', player: 0 });
  const cast = apply(offered, {
    type: 'castSpell',
    player: 1,
    oid: backlashOid,
    targets: [{ kind: 'spell', oid: targetOid }],
  });
  return { cast, targetOid, backlashOid };
}

function resolveBacklash(from: ReduceResult, backlashOid: string): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 10; guard += 1) {
    if (!current.state.stack.some((entry) => entry.oid === backlashOid)) return current;
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') throw new Error('Essence Backlash did not ask for priority');
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('Essence Backlash did not resolve');
}

describe('RTR #160 Essence Backlash', () => {
  it('counters the creature spell and deals its retained power to its stack controller', () => {
    const { cast, targetOid, backlashOid } = castBacklash(TARGET);
    const resolved = resolveBacklash(cast, backlashOid);

    expect(resolved.state.objects[targetOid]?.zone).toBe('graveyard');
    expect(resolved.state.players[0].life).toBe(16);
    expect(eventsOfType(resolved.events, 'spellCountered')).toHaveLength(1);
    expect(eventsOfType(resolved.events, 'damageDealt')).toEqual([
      expect.objectContaining({ sourceOid: backlashOid, amount: 4 }),
    ]);
  });

  it('still deals damage when the creature spell cannot be countered', () => {
    const { cast, targetOid, backlashOid } = castBacklash(UNCOUNTERABLE);
    const resolved = resolveBacklash(cast, backlashOid);

    expect(resolved.state.objects[targetOid]?.zone).toBe('stack');
    expect(resolved.state.players[0].life).toBe(17);
    expect(eventsOfType(resolved.events, 'spellCountered')).toHaveLength(0);
  });

  it('deals no damage for zero power and none when the target left the stack', () => {
    const zero = castBacklash(ZERO);
    const zeroResolved = resolveBacklash(zero.cast, zero.backlashOid);
    expect(zeroResolved.state.players[0].life).toBe(20);

    const departed = castBacklash(TARGET);
    const removed = counterStackEntry(beginTrace(departed.cast.state), departed.targetOid, 'outside-counter');
    const fizzled = resolveBacklash({ state: removed.state, events: removed.events }, departed.backlashOid);
    expect(fizzled.state.players[0].life).toBe(20);
    expect(eventsOfType(fizzled.events, 'damageDealt')).toHaveLength(0);
  });
});
