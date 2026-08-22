/**
 * A token that dies fires its death trigger, and only then stops existing
 * (CR 111.7, CR 704.5d).
 *
 * The two rules are separate steps and the order between them is the point. A
 * destroyed or sacrificed token is put into its owner's graveyard like any
 * other permanent, which is the zone change a `selfDies` trigger reads; a
 * state-based action removes it from existence afterwards. Collapse the two and
 * the trigger is never derived at all, which is what this kernel used to do:
 * `moveObject` redirected every token leaving the battlefield straight to
 * exile, so no `zoneChanged` into a graveyard was ever emitted for one and
 * `conditionsFrom` had nothing to match.
 *
 * The gap was not academic. the flagship set's economy is a Monster dying and
 * leaving a part (the set design document), and a Monster that is
 * itself a token dropped nothing. `validateCard` accepted the trigger and
 * `@mtg/forge-export` wrote a working Forge trigger for it, so the divergence
 * ran in the one direction that matters: Forge fired it and the kernel did not.
 *
 * The second half is asserted as hard as the first. Once state-based actions
 * have run, nothing may find the token in a graveyard — not the zone list, not
 * the object record.
 */
import { describe, expect, it } from 'vitest';
import type { TokenSpec } from '@mtg/dsl';
import { mana } from '@mtg/dsl';
import type { Action, GameState, ObjectId, PlayerId, ReduceResult } from '@mtg/kernel';
import { eventsOfType, getObject, playerOf, reduce, scenario } from '@mtg/kernel';
import { instant, MOUNTAIN, sorcery } from './cards';
import { apply, handOidOf } from './helpers';

/** A 1/1 Monster token that pays its killer three life. */
const BRIGAND: TokenSpec = {
  name: 'Brigand',
  power: 1,
  toughness: 1,
  colors: ['R'],
  subtypes: ['Brigand', 'Monster'],
  keywords: [],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfDies',
      effects: [{ kind: 'gainLife', amount: 3, target: { kind: 'noTarget' } }],
    },
  ],
};

/** The same body, plus a Fuse-shaped cost that spends it. */
const BOMB_FLOWER: TokenSpec = {
  name: 'Bomb Flower',
  power: 1,
  toughness: 1,
  colors: ['R'],
  subtypes: ['Plant'],
  keywords: [],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfDies',
      effects: [{ kind: 'gainLife', amount: 3, target: { kind: 'noTarget' } }],
    },
    {
      kind: 'activated',
      cost: { mana: mana({}), tapSelf: false, sacrificeSelf: true },
      effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }],
    },
  ],
};

const BLOOD_MOON = sorcery('Blood Moon Rises', [{ kind: 'createToken', count: 1, token: BRIGAND }], {
  generic: 1,
  R: 1,
});

const BLOSSOM = sorcery('Bomb Blossom', [{ kind: 'createToken', count: 1, token: BOMB_FLOWER }], {
  generic: 1,
  R: 1,
});

const ANCIENT_BLADE = instant('Ancient Blade', [
  { kind: 'destroyPermanent', target: { kind: 'targetCreature' } },
]);

const ARROW = instant('Bomb Arrow', [{ kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } }]);

const PASS: readonly Action[] = [
  { type: 'passPriority', player: 0 },
  { type: 'passPriority', player: 1 },
];

/** Casts the named token-maker from player 0's hand and resolves it. */
function board(maker: typeof BLOOD_MOON, ...alsoInHand: readonly (typeof ANCIENT_BLADE)[]) {
  const start = scenario({
    battlefield: Array.from({ length: 6 }, () => ({ card: MOUNTAIN, controller: 0 as const })),
    hands: [[maker, ...alsoInHand], []],
  });
  const cast = reduce(start.state, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(start.state, 0, maker.name),
    targets: [null],
  });
  let current: ReduceResult = { state: cast.state, events: [...cast.events] };
  for (const action of PASS) current = apply(current, action);
  return current;
}

function tokenOid(state: GameState): ObjectId {
  const found = state.battlefield.find((oid) => state.objects[oid]?.token === true);
  if (found === undefined) throw new Error('no token on the battlefield');
  return found;
}

/** Casts an instant at the token and lets everything it starts settle. */
function cast(current: ReduceResult, name: string, target: ObjectId): ReduceResult {
  let next = apply(current, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(current.state, 0, name),
    targets: [{ kind: 'permanent', oid: target }],
  });
  for (const action of [...PASS, ...PASS]) next = apply(next, action);
  return next;
}

function graveyardOf(state: GameState, player: PlayerId): readonly ObjectId[] {
  return playerOf(state, player).graveyard;
}

describe('a token creature that dies', () => {
  it('fires its printed death trigger when it is destroyed', () => {
    const start = board(BLOOD_MOON, ANCIENT_BLADE);
    const token = tokenOid(start.state);
    expect(playerOf(start.state, 0).life).toBe(20);

    const dead = cast(start, 'Ancient Blade', token);

    expect(eventsOfType(dead.events, 'lifeChanged').map((event) => event.player)).toContain(0);
    expect(playerOf(dead.state, 0).life).toBe(23);
    expect(dead.state.stack).toEqual([]);
  });

  it('fires it off lethal damage too, which is the same zone change', () => {
    const start = board(BLOOD_MOON, ARROW);
    const token = tokenOid(start.state);
    const dead = cast(start, 'Bomb Arrow', token);

    expect(playerOf(dead.state, 0).life).toBe(23);
  });

  /**
   * The trigger is derived from a real arrival in a graveyard rather than from
   * a token-shaped branch in `triggers.ts`, and the event log says so: the
   * token's own zone changes are the two CR 111.7 asks for, in order.
   */
  it('reaches the graveyard first, which is the event the trigger reads', () => {
    const start = board(BLOOD_MOON, ANCIENT_BLADE);
    const token = tokenOid(start.state);
    const dead = cast(start, 'Ancient Blade', token);

    const moves = eventsOfType(dead.events, 'zoneChanged').filter((event) => event.oid === token);
    expect(moves.map((event) => `${event.from}->${event.to}`)).toEqual([
      'battlefield->graveyard',
      'graveyard->exile',
    ]);
  });

  /**
   * CR 704.5d, the half that keeps the graveyard honest. Once state-based
   * actions have run, the token is in no zone list and its object record no
   * longer claims a graveyard.
   */
  it('does not sit in a graveyard once state-based actions have run', () => {
    const start = board(BLOOD_MOON, ANCIENT_BLADE);
    const token = tokenOid(start.state);
    const dead = cast(start, 'Ancient Blade', token);

    expect(graveyardOf(dead.state, 0)).not.toContain(token);
    expect(graveyardOf(dead.state, 1)).not.toContain(token);
    expect(dead.state.battlefield).not.toContain(token);
    expect(getObject(dead.state, token).zone).toBe('exile');
  });
});

describe('a token creature that is sacrificed', () => {
  /**
   * CR 701.17b: a sacrifice is not a destruction, and a death trigger watches
   * the zone change rather than the destruction, so spending the token fires it
   * too. The activated ability the sacrifice paid for still resolves with its
   * source gone (CR 608.2), which is the ordering `fuse.test.ts` and
   * `sacrifice-cost.test.ts` pin from the other side.
   */
  it('fires the death trigger and still resolves the ability it paid for', () => {
    const start = board(BLOSSOM);
    const token = tokenOid(start.state);

    const spent = reduce(start.state, {
      type: 'activateAbility',
      player: 0,
      oid: token,
      abilityIndex: 1,
      targets: [{ kind: 'player', player: 1 }],
      sacrifices: [],
    });
    // The cost is paid on activation, so the token is already gone; its death
    // trigger went on the stack under the ability it paid for.
    expect(getObject(spent.state, token).zone).toBe('exile');
    expect(graveyardOf(spent.state, 0)).not.toContain(token);

    let settled: ReduceResult = { state: spent.state, events: [...spent.events] };
    for (const action of [...PASS, ...PASS]) settled = apply(settled, action);

    expect(playerOf(settled.state, 0).life).toBe(23);
    expect(playerOf(settled.state, 1).life).toBe(18);
    expect(settled.state.stack).toEqual([]);
  });
});
