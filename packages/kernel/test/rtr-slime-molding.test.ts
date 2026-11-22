/** RTR #135 Slime Molding materializes the announced X into copiable token values. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { beginTrace, eventsOfType, powerOf, scenario, toughnessOf, type ReduceResult } from '@mtg/kernel';
import { createCopiedToken } from '../src/zones';
import { FOREST, lands } from './cards';
import { apply, handOidOf, oidOf, oidsOf } from './helpers';

const SLIME_MOLDING = parseCard({
  kind: 'sorcery',
  id: 'rtr-135-slime-molding-kernel',
  name: 'Slime Molding',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 135 },
  manaCost: { G: 1, hasX: true },
  colors: ['G'],
  effects: [
    {
      kind: 'createToken',
      count: 1,
      token: {
        name: 'Ooze',
        power: 0,
        toughness: 0,
        creationPowerToughness: { kind: 'chosenX' },
        colors: ['G'],
        subtypes: ['Ooze'],
        keywords: [],
      },
    },
  ],
} as CardInput);

function castAndResolve(x: number): ReduceResult {
  let current = scenario({
    battlefield: lands(FOREST, 6).map((card) => ({ card, controller: 0 as const })),
    hands: [[SLIME_MOLDING], []],
  });
  current = apply(current, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(current.state, 0, SLIME_MOLDING.name),
    targets: [null],
    x,
  });
  current = apply(current, { type: 'passPriority', player: 0 });
  return apply(current, { type: 'passPriority', player: 1 });
}

describe('RTR #135 Slime Molding', () => {
  it('creates one exact green Ooze with the announced X as fixed base power and toughness', () => {
    const resolved = castAndResolve(4);
    const ooze = oidOf(resolved.state, 'Ooze');
    const card = resolved.state.objects[ooze]?.card;

    expect(powerOf(resolved.state, ooze)).toBe(4);
    expect(toughnessOf(resolved.state, ooze)).toBe(4);
    expect(card).toMatchObject({ colors: ['G'], subtypes: ['Ooze'], power: 4, toughness: 4 });
    expect(card).not.toHaveProperty('characteristicPowerToughness');
    expect(card).not.toHaveProperty('creationPowerToughness');
    expect(eventsOfType(resolved.events, 'tokenCreated')).toHaveLength(1);
  });

  it('creates a 0/0 for X=0 and lets ordinary state-based actions remove it', () => {
    const resolved = castAndResolve(0);

    expect(eventsOfType(resolved.events, 'tokenCreated')).toHaveLength(1);
    expect(oidsOf(resolved.state, 'Ooze')).toEqual([]);
  });

  it('copies the materialized body rather than re-reading the old spell value', () => {
    const resolved = castAndResolve(3);
    const original = oidOf(resolved.state, 'Ooze');
    const card = resolved.state.objects[original]?.card;
    if (card === undefined) throw new Error('Slime Molding test lost its token card');

    const copied = createCopiedToken(beginTrace(resolved.state), 0, card);
    const [first, second] = oidsOf(copied.state, 'Ooze');
    if (first === undefined || second === undefined) throw new Error('Slime Molding test lost a token copy');
    expect([powerOf(copied.state, first), powerOf(copied.state, second)]).toEqual([3, 3]);
    expect([toughnessOf(copied.state, first), toughnessOf(copied.state, second)]).toEqual([3, 3]);
  });
});
