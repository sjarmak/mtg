import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import {
  hasKeyword,
  legalActions,
  powerOf,
  reduce,
  reduceAll,
  scenario,
  toughnessOf,
  type Action,
} from '@mtg/kernel';
import { creature, FOREST, PLAINS } from './cards';
import { handOidOf, oidOf, oidsOf } from './helpers';

const SELESNYA_CHARM = parseCard({
  kind: 'instant',
  id: 'rtr-194-selesnya-charm-kernel',
  name: 'Selesnya Charm',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 194 },
  manaCost: { G: 1, W: 1 },
  colors: ['G', 'W'],
  effects: [],
  modes: [
    {
      effects: [
        {
          kind: 'pumpUntilEndOfTurn',
          power: 2,
          toughness: 2,
          keyword: 'trample',
          target: { kind: 'targetCreature' },
        },
      ],
    },
    {
      effects: [
        {
          kind: 'exileTarget',
          target: { kind: 'targetCreature', restriction: { kind: 'minPower', power: 5 } },
        },
      ],
    },
    {
      effects: [
        {
          kind: 'createToken',
          count: 1,
          token: {
            name: 'Knight',
            power: 2,
            toughness: 2,
            colors: ['W'],
            subtypes: ['Knight'],
            keywords: ['vigilance'],
          },
        },
      ],
    },
  ],
} as unknown as CardInput);

const SMALL = creature('Charm Small', 4, 4);
const LARGE = creature('Charm Large', 5, 5);

function startWith(...creatures: readonly ReturnType<typeof creature>[]) {
  return scenario({
    battlefield: [
      { card: FOREST, controller: 0 },
      { card: PLAINS, controller: 0 },
      ...creatures.map((card) => ({ card, controller: 1 as const })),
    ],
    hands: [[SELESNYA_CHARM], []],
  });
}

function resolveMode(
  start: ReturnType<typeof startWith>,
  mode: number,
  targets: Extract<Parameters<typeof reduce>[1], { type: 'castSpell' }>['targets'] = [null],
) {
  const cast = reduce(start.state, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(start.state, 0, SELESNYA_CHARM.name),
    mode,
    targets,
  });
  return reduceAll(cast.state, [
    { type: 'passPriority', player: 0 },
    { type: 'passPriority', player: 1 },
  ]);
}

describe('RTR #194 Selesnya Charm', () => {
  it('pumps one chosen creature and grants trample to the same target', () => {
    const start = startWith(SMALL);
    const target = oidOf(start.state, SMALL.name);
    const resolved = resolveMode(start, 0, [{ kind: 'permanent', oid: target }]);

    expect(powerOf(resolved.state, target)).toBe(6);
    expect(toughnessOf(resolved.state, target)).toBe(6);
    expect(hasKeyword(resolved.state, target, 'trample')).toBe(true);
  });

  it('offers the exile mode only for creatures with power 5 or greater', () => {
    const start = startWith(SMALL, LARGE);
    const spell = handOidOf(start.state, 0, SELESNYA_CHARM.name);
    const small = oidOf(start.state, SMALL.name);
    const large = oidOf(start.state, LARGE.name);
    const options = legalActions(start.state).filter(
      (action): action is Extract<Action, { type: 'castSpell' }> =>
        action.type === 'castSpell' && action.oid === spell && action.mode === 1,
    );

    expect(options.map((action) => action.targets)).toEqual([[{ kind: 'permanent', oid: large }]]);
    const resolved = resolveMode(start, 1, [{ kind: 'permanent', oid: large }]);
    expect(resolved.state.objects[large]?.zone).toBe('exile');
    expect(resolved.state.objects[small]?.zone).toBe('battlefield');
  });

  it('creates one 2/2 white Knight token with vigilance', () => {
    const resolved = resolveMode(startWith(), 2);
    const [knight] = oidsOf(resolved.state, 'Knight');
    if (knight === undefined) throw new Error('Selesnya Charm created no Knight');

    expect(oidsOf(resolved.state, 'Knight')).toHaveLength(1);
    expect(powerOf(resolved.state, knight)).toBe(2);
    expect(toughnessOf(resolved.state, knight)).toBe(2);
    expect(resolved.state.objects[knight]?.card.colors).toEqual(['W']);
    expect(hasKeyword(resolved.state, knight, 'vigilance')).toBe(true);
  });
});
