/**
 * Who each attacker attacks: the plan a backend's combat moves sort into, and the
 * picker that plan asks.
 *
 * `mtg-bc2.154.6.5.4`. The refusals matter as much as the accepted shapes. A
 * declaration the surface cannot state exactly gets no click-to-stage at all, and
 * a table that stages a creature without a defender picked has chosen for the
 * player, which is the one thing the pod board is not allowed to do.
 */
import { describe, expect, it } from 'vitest';
import type { ObjectMove, ObjectView, PlayDefender, SeatId, TableView } from '@mtg/engine';
import {
  attackPlan,
  attackTargeting,
  defenderKey,
  describeDefender,
} from '../../src/routes/play/attack-targets';
import type { AttackDefender } from '../../src/routes/play/attack-targets';

function object(oid: string, name: string, controller: SeatId): ObjectView {
  return {
    oid,
    name,
    typeLine: 'Legendary Planeswalker — Jace',
    power: null,
    toughness: null,
    tapped: false,
    attacking: false,
    damage: 0,
    controller,
    counters: {},
  };
}

const VIEW: Pick<TableView, 'seats'> = {
  seats: [
    {
      id: 0,
      name: 'Ana',
      life: 40,
      hand: [],
      handSize: 0,
      librarySize: 0,
      graveyard: [],
      exile: [],
      battlefield: [],
    },
    {
      id: 1,
      name: 'Bo',
      life: 40,
      hand: null,
      handSize: 0,
      librarySize: 0,
      graveyard: [],
      exile: [],
      battlefield: [],
    },
    {
      id: 2,
      name: 'Cy',
      life: 40,
      hand: null,
      handSize: 0,
      librarySize: 0,
      graveyard: [],
      exile: [],
      battlefield: [object('jace-2', 'Jace, Telepath Unbound', 2)],
    },
  ],
} as Pick<TableView, 'seats'>;

const describe3 = describeDefender(VIEW);

function add(oid: string, move: string, defender?: PlayDefender): ObjectMove {
  return {
    oid,
    move,
    category: 'combat',
    ...(defender === undefined ? {} : { defender }),
  };
}

const offered = (...moves: string[]): ReadonlySet<string> => new Set(moves);

describe('defender keys and words', () => {
  it('files a player and a planeswalker under keys that cannot collide', () => {
    expect(defenderKey({ seat: 2 })).toBe('seat:2');
    expect(defenderKey({ oid: 'jace-2' })).toBe('card:jace-2');
    expect(defenderKey({ seat: 2 })).not.toBe(defenderKey({ oid: '2' }));
  });

  it('names a player by their name and a planeswalker by its own', () => {
    expect(describe3({ seat: 1 })).toEqual({ key: 'seat:1', label: 'Bo', kind: 'player' });
    expect(describe3({ oid: 'jace-2' })).toEqual({
      key: 'card:jace-2',
      label: 'Jace, Telepath Unbound',
      kind: 'planeswalker',
    });
  });

  it('never prints an id for something the view no longer shows', () => {
    expect(describe3({ oid: 'opaque-gone-7' }).label).toBe('A planeswalker');
    expect(describe3({ seat: 9 }).label).toBe('Seat 10');
  });
});

describe('the attack plan', () => {
  const adds = [
    add('wolf', 'wolf-bo', { seat: 1 }),
    add('wolf', 'wolf-cy', { seat: 2 }),
    add('wolf', 'wolf-jace', { oid: 'jace-2' }),
    add('bear', 'bear-bo', { seat: 1 }),
    add('bear', 'bear-cy', { seat: 2 }),
  ];
  const all = offered('wolf-bo', 'wolf-cy', 'wolf-jace', 'bear-bo', 'bear-cy');

  it('lists each defender once, in the order the backend first offered them', () => {
    const plan = attackPlan(adds, all, new Set(), describe3);
    expect(plan?.defenders.map((defender) => defender.key)).toEqual(['seat:1', 'seat:2', 'card:jace-2']);
    expect([...(plan?.creatures ?? [])]).toEqual(['wolf', 'bear']);
  });

  it('answers a click with the move for the picked defender, and with nothing while nobody is picked', () => {
    const plan = attackPlan(adds, all, new Set(), describe3);
    expect(plan?.move('wolf', 'seat:2')).toBe('wolf-cy');
    expect(plan?.move('wolf', 'card:jace-2')).toBe('wolf-jace');
    expect(plan?.move('wolf', null)).toBeNull();
    // The bear cannot go at the planeswalker: the backend offered it no such move.
    expect(plan?.move('bear', 'card:jace-2')).toBeNull();
    expect(plan?.move('nobody', 'seat:1')).toBeNull();
  });

  it('takes a staged creature back out with its one removal, whoever is picked', () => {
    const removal = [
      add('wolf', 'wolf-out'),
      add('bear', 'bear-bo', { seat: 1 }),
      add('bear', 'bear-cy', { seat: 2 }),
    ];
    const plan = attackPlan(removal, offered('wolf-out', 'bear-bo', 'bear-cy'), new Set(['wolf']), describe3);
    expect(plan?.move('wolf', null)).toBe('wolf-out');
    expect(plan?.move('wolf', 'seat:1')).toBe('wolf-out');
  });

  it('keeps a lone defender-less move a plain toggle, the one-opponent declaration', () => {
    const plan = attackPlan([add('wolf', 'wolf-in')], offered('wolf-in'), new Set(), describe3);
    expect(plan?.defenders).toEqual([]);
    expect(plan?.move('wolf', null)).toBe('wolf-in');
  });

  it('refuses a move the decision did not offer', () => {
    expect(attackPlan(adds, offered('wolf-bo'), new Set(), describe3)).toBeNull();
  });

  it('refuses a creature offered the same defender twice, because a click could not say which', () => {
    const twice = [add('wolf', 'a', { seat: 1 }), add('wolf', 'b', { seat: 1 })];
    expect(attackPlan(twice, offered('a', 'b'), new Set(), describe3)).toBeNull();
  });

  it('refuses a defender-less move beside named ones', () => {
    const mixed = [add('wolf', 'a'), add('wolf', 'b', { seat: 1 })];
    expect(attackPlan(mixed, offered('a', 'b'), new Set(), describe3)).toBeNull();
  });

  it('refuses a staged creature that has no way back out, or has two', () => {
    expect(
      attackPlan([add('bear', 'bear-bo', { seat: 1 })], offered('bear-bo'), new Set(['wolf']), describe3),
    ).toBeNull();
    const two = [add('wolf', 'x'), add('wolf', 'y')];
    expect(attackPlan(two, offered('x', 'y'), new Set(['wolf']), describe3)).toBeNull();
  });
});

describe('the attack picker', () => {
  const adds = [
    add('wolf', 'wolf-bo', { seat: 1 }),
    add('wolf', 'wolf-cy', { seat: 2 }),
    add('bear', 'bear-bo', { seat: 1 }),
    add('bear', 'bear-cy', { seat: 2 }),
  ];
  const plan = attackPlan(adds, offered('wolf-bo', 'wolf-cy', 'bear-bo', 'bear-cy'), new Set(), describe3);
  if (plan === null) throw new Error('the fixture is an exact plan');
  const pick = (): void => undefined;
  const bo: AttackDefender = { key: 'seat:1', label: 'Bo', kind: 'player' };

  it('draws nothing at a table with one defender', () => {
    const single = attackPlan(
      [add('wolf', 'wolf-bo', { seat: 1 }), add('bear', 'bear-bo', { seat: 1 })],
      offered('wolf-bo', 'bear-bo'),
      new Set(),
      describe3,
    );
    expect(single === null ? null : attackTargeting(single, new Set(), new Map(), null, pick)).toBeNull();
  });

  it('keeps the picker once somebody is picked, though a single defender is all that is left', () => {
    const removals = [add('wolf', 'wolf-out')];
    const after = attackPlan(removals, offered('wolf-out'), new Set(['wolf']), describe3);
    if (after === null) throw new Error('the fixture is an exact plan');
    const staged = new Set(['wolf']);
    const going = new Map([['wolf', bo]]);
    const standing = attackTargeting(after, staged, going, 'seat:1', pick);
    expect(standing?.options.map((option) => option.key)).toEqual(['seat:1']);
    expect(standing?.counts.get('seat:1')).toBe(1);
    // With nobody picked, one defender is the duel again and asks nothing.
    expect(attackTargeting(after, staged, going, null, pick)).toBeNull();
  });

  it('has nobody picked until the player picks, and offers every defender', () => {
    const targeting = attackTargeting(plan, new Set(), new Map(), null, pick);
    expect(targeting?.picked).toBeNull();
    expect(targeting?.options.map((option) => option.key)).toEqual(['seat:1', 'seat:2']);
  });

  it('counts the creatures already sent at each defender', () => {
    const targeting = attackTargeting(
      plan,
      new Set(['wolf', 'bear']),
      new Map([
        ['wolf', bo],
        ['bear', bo],
      ]),
      'seat:1',
      pick,
    );
    expect(targeting?.counts.get('seat:1')).toBe(2);
    expect(targeting?.counts.get('seat:2')).toBeUndefined();
    expect(targeting?.picked).toBe('seat:1');
  });

  it('drops a picked defender that is not an option, rather than aiming at nobody', () => {
    expect(attackTargeting(plan, new Set(), new Map(), 'seat:7', pick)?.picked).toBeNull();
  });

  it('keeps a defender in the list while a staged creature is still going at it', () => {
    // Both creatures are staged at Bo, so the backend offers nothing at Bo any more.
    const removals = [add('wolf', 'wolf-out'), add('bear', 'bear-out')];
    const after = attackPlan(removals, offered('wolf-out', 'bear-out'), new Set(['wolf', 'bear']), describe3);
    if (after === null) throw new Error('the fixture is an exact plan');
    const cy: AttackDefender = { key: 'seat:2', label: 'Cy', kind: 'player' };
    const targeting = attackTargeting(
      after,
      new Set(['wolf', 'bear']),
      new Map([
        ['wolf', bo],
        ['bear', cy],
      ]),
      null,
      pick,
    );
    expect(targeting?.options.map((option) => option.key)).toEqual(['seat:1', 'seat:2']);
    expect(targeting?.counts.get('seat:1')).toBe(1);
    expect(targeting?.counts.get('seat:2')).toBe(1);
  });
});
