/** Native atomic control exchange for M13 #71. */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import {
  beginTrace,
  controllerOf,
  eventsOfType,
  moveObject,
  onlyObject,
  pendingDecision,
  reduce,
  reduceAll,
  scenario,
  simpleAgent,
  validateAction,
} from '@mtg/kernel';
import { observeState } from '@mtg/kernel';
import { creature, ISLAND, lands } from './cards';
import { controlledBy, withContinuous } from './continuous-helpers';
import { handOidOf, oidOf } from './helpers';

const SWITCHEROO = parseCard({
  kind: 'sorcery',
  id: 'm13-switcheroo',
  name: 'Switcheroo',
  rarity: 'uncommon',
  set: { code: 'M13', collectorNumber: 71 },
  manaCost: { generic: 4, U: 1 },
  colors: ['U'],
  effects: [{ kind: 'exchangeControl', target: { kind: 'targetCreature', count: 2, minimum: 2 } }],
} as CardInput);

const PASSES = [
  { type: 'passPriority' as const, player: 0 as const },
  { type: 'passPriority' as const, player: 1 as const },
];

function board(secondController: 0 | 1 = 1) {
  return scenario({
    battlefield: [
      ...lands(ISLAND, 5).map((card) => ({ card, controller: 0 as const })),
      { card: creature('First Creature', 2, 2), controller: 0 },
      { card: creature('Second Creature', 3, 3), controller: secondController },
      { card: creature('Third Creature', 4, 4), controller: 1 },
    ],
    hands: [[SWITCHEROO], []],
  });
}

function cast(
  state: ReturnType<typeof board>['state'],
  first = 'First Creature',
  second = 'Second Creature',
) {
  return reduce(state, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(state, 0, SWITCHEROO.name),
    targets: [null],
    multiTargets: {
      0: [
        { kind: 'permanent', oid: oidOf(state, first) },
        { kind: 'permanent', oid: oidOf(state, second) },
      ],
    },
  });
}

function resolve(state: ReturnType<typeof board>['state']) {
  return reduceAll(state, PASSES);
}

describe('Switcheroo target tuple', () => {
  it('requires two distinct creature targets while allowing the same controller', () => {
    const start = board(0);
    const first = { kind: 'permanent' as const, oid: oidOf(start.state, 'First Creature') };
    const second = { kind: 'permanent' as const, oid: oidOf(start.state, 'Second Creature') };
    const spell = handOidOf(start.state, 0, SWITCHEROO.name);

    expect(
      validateAction(start.state, {
        type: 'castSpell',
        player: 0,
        oid: spell,
        targets: [null],
        multiTargets: { 0: [first, first] },
      }),
    ).toContain('repeats a target');
    expect(
      validateAction(start.state, {
        type: 'castSpell',
        player: 0,
        oid: spell,
        targets: [null],
        multiTargets: { 0: [first, second] },
      }),
    ).toBeNull();
  });

  it('has the kernel bot give one of its creatures for an opposing creature', () => {
    const start = board();
    const spell = handOidOf(start.state, 0, SWITCHEROO.name);
    const begun = reduce(start.state, {
      type: 'beginCastSpell',
      player: 0,
      oid: spell,
      targets: [null],
    });
    const firstDecision = pendingDecision(begun.state);
    if (firstDecision?.kind !== 'pluralTargets') throw new Error('first exchange target was not staged');
    const agent = simpleAgent('exchange');
    const first = agent.decide({
      state: observeState(begun.state, 0, 'test/m13-switcheroo.test.ts:112'),
      player: 0,
      decision: firstDecision,
    });
    expect(first).toMatchObject({
      type: 'choosePluralTarget',
      target: { kind: 'permanent', oid: oidOf(begun.state, 'First Creature') },
    });

    const selected = reduce(begun.state, first);
    const secondDecision = pendingDecision(selected.state);
    if (secondDecision?.kind !== 'pluralTargets') throw new Error('second exchange target was not staged');
    const second = agent.decide({
      state: observeState(selected.state, 0, 'test/m13-switcheroo.test.ts:121'),
      player: 0,
      decision: secondDecision,
    });
    expect(second).toMatchObject({
      type: 'choosePluralTarget',
      target: { kind: 'permanent', oid: oidOf(selected.state, 'Second Creature') },
    });
  });
});

describe('Switcheroo resolution', () => {
  it('gives each creature to the other creature controller atomically', () => {
    const start = board();
    const first = oidOf(start.state, 'First Creature');
    const second = oidOf(start.state, 'Second Creature');
    const done = resolve(cast(start.state).state);

    expect(controllerOf(done.state, first)).toBe(1);
    expect(controllerOf(done.state, second)).toBe(0);
    expect(eventsOfType(done.events, 'controlEffectAdded')).toEqual([
      expect.objectContaining({ targetOid: first, controller: 1, layer: '2' }),
      expect.objectContaining({ targetOid: second, controller: 0, layer: '2' }),
    ]);
  });

  it('does nothing when both targets have the same controller at resolution', () => {
    const start = board(0);
    const first = oidOf(start.state, 'First Creature');
    const second = oidOf(start.state, 'Second Creature');
    const done = resolve(cast(start.state).state);

    expect(controllerOf(done.state, first)).toBe(0);
    expect(controllerOf(done.state, second)).toBe(0);
    expect(eventsOfType(done.events, 'controlEffectAdded')).toEqual([]);
  });

  it('reads both current controllers at resolution before applying either exchange half', () => {
    const start = board();
    const first = oidOf(start.state, 'First Creature');
    const second = oidOf(start.state, 'Second Creature');
    const announced = cast(start.state);
    const alreadyTogether = withContinuous(announced.state, [
      controlledBy(onlyObject(first), 1, { source: second }),
    ]);
    const done = resolve(alreadyTogether);

    expect(controllerOf(done.state, first)).toBe(1);
    expect(controllerOf(done.state, second)).toBe(1);
    expect(eventsOfType(done.events, 'controlEffectAdded')).toEqual([]);
  });

  it('does not exchange a surviving target when the other target leaves', () => {
    const start = board();
    const first = oidOf(start.state, 'First Creature');
    const second = oidOf(start.state, 'Second Creature');
    const announced = cast(start.state);
    const departed = moveObject(beginTrace(announced.state), second, 'graveyard');
    const done = resolve(departed.state);

    expect(controllerOf(done.state, first)).toBe(0);
    expect(eventsOfType(done.events, 'controlEffectAdded')).toEqual([]);
    expect(eventsOfType(done.events, 'spellFizzled')).toEqual([]);
  });

  it('fizzles when both targets have left the battlefield', () => {
    const start = board();
    const first = oidOf(start.state, 'First Creature');
    const second = oidOf(start.state, 'Second Creature');
    const announced = cast(start.state);
    const firstGone = moveObject(beginTrace(announced.state), first, 'graveyard');
    const bothGone = moveObject(firstGone, second, 'graveyard');
    const done = resolve(bothGone.state);

    expect(eventsOfType(done.events, 'controlEffectAdded')).toEqual([]);
    expect(eventsOfType(done.events, 'spellFizzled')).toHaveLength(1);
  });

  it('does not exchange with a new incarnation of a departed target', () => {
    const start = board();
    const first = oidOf(start.state, 'First Creature');
    const second = oidOf(start.state, 'Second Creature');
    const announced = cast(start.state);
    const departed = moveObject(beginTrace(announced.state), second, 'graveyard');
    const returned = moveObject(departed, second, 'battlefield', { controller: 1 });
    const done = resolve(returned.state);

    expect(controllerOf(done.state, first)).toBe(0);
    expect(controllerOf(done.state, second)).toBe(1);
    expect(eventsOfType(done.events, 'controlEffectAdded')).toEqual([]);
    expect(eventsOfType(done.events, 'spellFizzled')).toEqual([]);
  });

  it('does not carry an exchanged controller into a later incarnation', () => {
    const start = board();
    const first = oidOf(start.state, 'First Creature');
    const exchanged = resolve(cast(start.state).state);
    expect(controllerOf(exchanged.state, first)).toBe(1);

    const departed = moveObject(beginTrace(exchanged.state), first, 'graveyard');
    const returned = moveObject(departed, first, 'battlefield', { controller: 0 });
    expect(controllerOf(returned.state, first)).toBe(0);
  });
});
