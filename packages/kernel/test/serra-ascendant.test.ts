/** Serra Ascendant's live controller-life threshold through layers 6 and 7c. */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import {
  controllerOf,
  hasKeyword,
  powerOf,
  reduce,
  reduceAll,
  scenario,
  toughnessOf,
  type GameState,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { sorcery } from './cards';
import { handOidOf, oidOf } from './helpers';

const THRESHOLD = { kind: 'controllerLifeAtLeast' as const, atLeast: 30 };

const SERRA_ASCENDANT = parseCard({
  kind: 'creature',
  id: 'tst-serra-ascendant',
  name: 'Serra Ascendant',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 28 },
  colors: ['W'],
  manaCost: { W: 1 },
  power: 1,
  toughness: 1,
  subtypes: ['Human', 'Monk'],
  keywords: ['lifelink'],
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      enabledWhile: THRESHOLD,
      modification: { kind: 'statBonus', power: 5, toughness: 5 },
    },
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      enabledWhile: THRESHOLD,
      modification: { kind: 'grantKeyword', keyword: 'flying' },
    },
  ],
});

const LOSE_ONE = sorcery(
  'Threshold Toll',
  [{ kind: 'loseLife', amount: 1, target: { kind: 'targetPlayer' } }],
  {},
);

const ACT: Card = sorcery(
  'Threshold Treason',
  [
    { kind: 'gainControlUntilEndOfTurn', target: { kind: 'targetCreature' } },
    { kind: 'untapPermanent', target: { kind: 'thatCreature' } },
    { kind: 'grantKeywordUntilEndOfTurn', keyword: 'haste', target: { kind: 'thatCreature' } },
  ],
  {},
);

const PASSES = [
  { type: 'passPriority' as const, player: 0 as const },
  { type: 'passPriority' as const, player: 1 as const },
];

function resolveCast(start: ReduceResult, card: Card, targets: readonly unknown[]): ReduceResult {
  const cast = reduce(start.state, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(start.state, 0, card.name),
    targets,
  } as never);
  const resolved = reduceAll(cast.state, PASSES);
  return { state: resolved.state, events: [...cast.events, ...resolved.events] };
}

function expectBody(state: GameState, oid: ObjectId, size: number, flying: boolean): void {
  expect(powerOf(state, oid)).toBe(size);
  expect(toughnessOf(state, oid)).toBe(size);
  expect(hasKeyword(state, oid, 'flying')).toBe(flying);
}

describe('Serra Ascendant in the kernel', () => {
  it('is a grounded 1/1 at 29 life and a flying 6/6 at 30 life', () => {
    const below = scenario({ life: [29, 20], battlefield: [{ card: SERRA_ASCENDANT, controller: 0 }] });
    expectBody(below.state, oidOf(below.state, SERRA_ASCENDANT.name), 1, false);

    const at = scenario({ life: [30, 20], battlefield: [{ card: SERRA_ASCENDANT, controller: 0 }] });
    expectBody(at.state, oidOf(at.state, SERRA_ASCENDANT.name), 6, true);
  });

  it('turns both continuous modifications off as soon as its controller falls below 30', () => {
    const start = scenario({
      life: [30, 20],
      battlefield: [{ card: SERRA_ASCENDANT, controller: 0 }],
      hands: [[LOSE_ONE], []],
    });
    const ascendant = oidOf(start.state, SERRA_ASCENDANT.name);
    expectBody(start.state, ascendant, 6, true);

    const resolved = resolveCast(start, LOSE_ONE, [{ kind: 'player', player: 0 }]);
    expect(resolved.state.players[0].life).toBe(29);
    expectBody(resolved.state, ascendant, 1, false);
  });

  it('follows the source permanent current controller rather than its owner', () => {
    const start = scenario({
      life: [30, 29],
      battlefield: [{ card: SERRA_ASCENDANT, controller: 1 }],
      hands: [[ACT], []],
    });
    const ascendant = oidOf(start.state, SERRA_ASCENDANT.name);
    expectBody(start.state, ascendant, 1, false);

    const resolved = resolveCast(start, ACT, [{ kind: 'permanent', oid: ascendant }, null, null]);
    expect(controllerOf(resolved.state, ascendant)).toBe(0);
    expectBody(resolved.state, ascendant, 6, true);
  });
});
