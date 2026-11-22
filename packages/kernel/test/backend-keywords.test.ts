/**
 * `mtg-pt9dp`: `ObjectView.keywords`, the kernel arm.
 *
 * The projection carried no abilities at all, so a keyword granted by anything
 * but the card itself was invisible to a board: the printed face does not say
 * it, because the grant is not printed on the receiver. These run a real
 * `GameState` through the real `projectState`, the way `backend-projection`'s
 * other tests do, and read what a surface would read.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import type { SessionSpec } from '@mtg/engine';
import type { GameState, ReduceResult } from '@mtg/kernel';
import { pendingDecision, reduce, reduceAll, scenario } from '@mtg/kernel';
import { projectState } from '../src/backend-projection';
import { creature, instant, MOUNTAIN } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const TABLE: SessionSpec = {
  content: { kind: 'dsl-set', setCode: 'SLC' },
  seats: [
    { name: 'North', controller: 'local', deck: { name: 'north', cards: [] } },
    { name: 'South', controller: 'local', deck: { name: 'south', cards: [] } },
  ],
  seed: 'backend-keywords/mtg-pt9dp',
  maximumTurns: 40,
};

const UPDRAFT: Card = instant('Test Updraft', [
  { kind: 'grantKeywordUntilEndOfTurn', keyword: 'flying', target: { kind: 'targetCreature' } },
]);

function keywordsOnBattlefield(state: GameState, name: string): readonly string[] | undefined {
  const found = projectState(state, TABLE, [0, 1])
    .seats.flatMap((seat) => seat.battlefield)
    .find((object) => object.name === name);
  if (found === undefined) throw new Error(`${name} is not on the battlefield`);
  return found.keywords;
}

function castUpdraftOn(start: ReduceResult, name: string): ReduceResult {
  const cast = reduce(start.state, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(start.state, 0, 'Test Updraft'),
    targets: [{ kind: 'permanent', oid: oidOf(start.state, name) }],
  });
  const resolved = reduceAll(cast.state, [
    { type: 'passPriority', player: 0 },
    { type: 'passPriority', player: 1 },
  ]);
  return { state: resolved.state, events: [...cast.events, ...resolved.events] };
}

function passToNextTurn(from: ReduceResult): ReduceResult {
  const target = from.state.turn.number + 1;
  let current = from;
  for (let guard = 0; guard < 400 && current.state.turn.number < target; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision === null) throw new Error('the game ended early');
    const option =
      decision.kind === 'priority'
        ? { type: 'passPriority' as const, player: decision.player }
        : decision.options[0];
    if (option === undefined) throw new Error(`no option offered for ${decision.kind}`);
    current = apply(current, option);
  }
  if (current.state.turn.number < target) throw new Error(`never reached turn ${String(target)}`);
  return current;
}

const twoLands = [
  { card: MOUNTAIN, controller: 0 as const },
  { card: MOUNTAIN, controller: 0 as const },
];

describe('a permanent projects the keywords it has', () => {
  it('spells the printed keywords and keyword abilities in printed English, keywords first', () => {
    const start = scenario({
      battlefield: [
        {
          card: creature('Test Knight', 2, 2, {
            keywords: ['flying', 'firstStrike'],
            keywordAbilities: [
              { kind: 'protection', quality: { kind: 'color', color: 'R' } },
              { kind: 'doubleStrike' },
              { kind: 'landwalk', landType: 'Island' },
              { kind: 'hexproof' },
            ],
          }),
          controller: 0,
        },
      ],
    });

    expect(keywordsOnBattlefield(start.state, 'Test Knight')).toEqual([
      'flying',
      'first strike',
      'protection from red',
      'double strike',
      'islandwalk',
      'hexproof',
    ]);
  });

  it('is present and empty on a permanent with none, so empty means none and absent means unreported', () => {
    const start = scenario({
      battlefield: [
        { card: creature('Test Bear', 2, 2), controller: 0 },
        { card: MOUNTAIN, controller: 1 },
      ],
    });

    expect(keywordsOnBattlefield(start.state, 'Test Bear')).toEqual([]);
    expect(keywordsOnBattlefield(start.state, 'Mountain')).toEqual([]);
  });

  it('is absent for an object that is not on the battlefield', () => {
    const start = scenario({ hands: [[creature('Test Flyer', 1, 1, { keywords: ['flying'] })], []] });

    const view = projectState(start.state, TABLE, [0, 1]);

    expect(view.seats[0].hand?.[0]?.name).toBe('Test Flyer');
    expect(view.seats[0].hand?.[0]).not.toHaveProperty('keywords');
  });
});

describe('a granted keyword is on the creature that received it and gone when the grant ends', () => {
  it('appears on the receiver only, and clears on the following turn', () => {
    const start = scenario({
      battlefield: [
        { card: creature('Test Bear', 2, 2), controller: 0 },
        { card: creature('Test Ground Bear', 2, 2), controller: 0 },
        ...twoLands,
      ],
      hands: [[UPDRAFT], []],
    });
    expect(keywordsOnBattlefield(start.state, 'Test Bear')).toEqual([]);

    const granted = castUpdraftOn(start, 'Test Bear');

    expect(keywordsOnBattlefield(granted.state, 'Test Bear')).toEqual(['flying']);
    expect(keywordsOnBattlefield(granted.state, 'Test Ground Bear')).toEqual([]);

    const later = passToNextTurn(granted);

    expect(keywordsOnBattlefield(later.state, 'Test Bear')).toEqual([]);
  });

  it('lists a keyword once when the receiver already printed it', () => {
    const start = scenario({
      battlefield: [
        { card: creature('Test Flyer', 2, 2, { keywords: ['flying'] }), controller: 0 },
        ...twoLands,
      ],
      hands: [[UPDRAFT], []],
    });

    const granted = castUpdraftOn(start, 'Test Flyer');

    expect(keywordsOnBattlefield(granted.state, 'Test Flyer')).toEqual(['flying']);
  });
});
