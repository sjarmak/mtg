/** Native target routing and linked-X probes for RTR Rakdos's Return. */
import { parseCard } from '@mtg/dsl';
import { legalActions, reduce, scenario, type Action, type ReduceResult } from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature, lands, MOUNTAIN, planeswalker, SWAMP } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const RAKDOSS_RETURN = parseCard({
  kind: 'sorcery',
  id: 'rtr-188-rakdoss-return-kernel',
  name: "Rakdos's Return",
  rarity: 'mythic',
  set: { code: 'RTR', collectorNumber: 188 },
  manaCost: { hasX: true, B: 1, R: 1 },
  colors: ['B', 'R'],
  effects: [
    {
      kind: 'dealDamage',
      amount: { kind: 'chosenX' },
      target: { kind: 'targetPlayerOrPlaneswalker' },
      opponentPlayerOrPlaneswalkerOnly: true,
    },
    {
      kind: 'discardCards',
      count: 1,
      countFrom: 'chosenX',
      target: { kind: 'thatPlayerOrPlaneswalkerController' },
    },
  ],
});

const OWN_WALKER = planeswalker('Friendly Walker', 4, []);
const OPPOSING_WALKER = planeswalker('Opposing Walker', 4, []);

function board(opponentHand = 0, ownHand = 0): ReduceResult {
  return scenario({
    battlefield: [
      ...lands(SWAMP, 3).map((card) => ({ card, controller: 0 as const })),
      ...lands(MOUNTAIN, 3).map((card) => ({ card, controller: 0 as const })),
      { card: OWN_WALKER, controller: 0 },
      { card: OPPOSING_WALKER, controller: 1 },
    ],
    hands: [
      [
        RAKDOSS_RETURN,
        ...Array.from({ length: ownHand }, (_, index) => creature(`Own discard ${String(index)}`, 1, 1)),
      ],
      Array.from({ length: opponentHand }, (_, index) => creature(`Discard ${String(index)}`, 1, 1)),
    ],
  });
}

function castAtPermanent(from: ReduceResult, oid: string, x: number): Action {
  return {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(from.state, 0, RAKDOSS_RETURN.name),
    targets: [{ kind: 'permanent', oid }, null],
    x,
  };
}

function castAction(from: ReduceResult, target: 0 | 1, x: number): Action {
  return {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(from.state, 0, RAKDOSS_RETURN.name),
    targets: [{ kind: 'player', player: target }, null],
    x,
  };
}

function resolve(from: ReduceResult): ReduceResult {
  return apply(apply(from, { type: 'passPriority', player: 0 }), { type: 'passPriority', player: 1 });
}

describe("Rakdos's Return in the kernel", () => {
  it('offers only the opponent as a player while leaving every planeswalker legal', () => {
    const start = board();
    const ownWalker = oidOf(start.state, OWN_WALKER.name);
    const opposingWalker = oidOf(start.state, OPPOSING_WALKER.name);
    const targets = legalActions(start.state)
      .filter(
        (action): action is Extract<Action, { type: 'castSpell' }> =>
          action.type === 'castSpell' && action.oid === handOidOf(start.state, 0, RAKDOSS_RETURN.name),
      )
      .filter((action) => action.x === 0)
      .map((action) => action.targets[0]);

    expect(targets).toContainEqual({ kind: 'player', player: 1 });
    expect(targets).toContainEqual({ kind: 'permanent', oid: opposingWalker });
    expect(targets).toContainEqual({ kind: 'permanent', oid: ownWalker });
    expect(targets).not.toContainEqual({ kind: 'player', player: 0 });
  });

  it('uses the same paid X for damage and as-many-as-possible discard', () => {
    const start = board(2);
    const done = resolve(apply(start, castAction(start, 1, 2)));
    expect(done.state.players[1].life).toBe(18);
    expect(done.state.players[1].hand).toEqual([]);
    expect(done.state.players[1].graveyard).toHaveLength(2);
  });

  it("may hit the caster's planeswalker and makes that planeswalker's controller discard", () => {
    const start = board(0, 2);
    const ownWalker = oidOf(start.state, OWN_WALKER.name);
    const done = resolve(apply(start, castAtPermanent(start, ownWalker, 2)));

    expect(done.state.objects[ownWalker]?.counters.loyalty).toBe(2);
    expect(done.state.players[0].hand).toEqual([]);
    expect(done.state.players[0].graveyard).toHaveLength(3);
  });

  it('does nothing for X zero and rejects the caster as a submitted target', () => {
    const zeroStart = board(2);
    const zero = resolve(apply(zeroStart, castAction(zeroStart, 1, 0)));
    expect(zero.state.players[1].life).toBe(20);
    expect(zero.state.players[1].hand).toHaveLength(2);

    const illegal = board();
    expect(() => reduce(illegal.state, castAction(illegal, 0, 0))).toThrow(/illegal target/u);
  });
});
