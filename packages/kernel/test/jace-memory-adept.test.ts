/** Native activation, target staging, and resolution for M13 Jace, Memory Adept. */
import { describe, expect, it } from 'vitest';
import { parseCard, type AbilityInput, type Card } from '@mtg/dsl';
import {
  beginTrace,
  counterCount,
  eventsOfType,
  legalActions,
  moveObject,
  pendingDecision,
  playerOf,
  reduce,
  scenario,
  serializeEvents,
  stateFingerprint,
  validateAction,
  type Action,
  type PlayerId,
  type ReduceResult,
} from '@mtg/kernel';
import { creature, planeswalker } from './cards';
import { apply, oidOf } from './helpers';

const ABILITIES: readonly AbilityInput[] = [
  {
    kind: 'activated',
    cost: { mana: {} },
    loyaltyCost: 1,
    effects: [
      { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } },
      { kind: 'millCards', count: 1, target: { kind: 'targetPlayer' } },
    ],
  },
  {
    kind: 'activated',
    cost: { mana: {} },
    loyaltyCost: 0,
    effects: [{ kind: 'millCards', count: 10, target: { kind: 'targetPlayer' } }],
  },
  {
    kind: 'activated',
    cost: { mana: {} },
    loyaltyCost: -7,
    effects: [
      {
        kind: 'drawCards',
        count: 20,
        target: { kind: 'targetPlayer', anyNumber: true },
      },
    ],
  },
];

const LEYLINE = parseCard({
  kind: 'enchantment',
  id: 'm11-21-jace-probe-leyline',
  name: 'Jace Probe Leyline',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 21 },
  manaCost: { generic: 2, W: 2 },
  colors: ['W'],
  abilities: [{ kind: 'staticPlayerRule', players: 'controller', rule: 'hasHexproof' }],
});

function jace(): Card {
  return planeswalker('Jace, Memory Adept', 4, ABILITIES, { generic: 3, U: 2 });
}

function library(seat: PlayerId, count: number): readonly Card[] {
  return Array.from({ length: count }, (_, index) =>
    creature(`Jace seat ${String(seat)} card ${String(index + 1)}`, 1, 1),
  );
}

function board(
  loyalty = 7,
  librarySize = 25,
  hands: readonly [readonly Card[], readonly Card[]] = [[], []],
): ReduceResult {
  return scenario({
    battlefield: [{ card: jace(), controller: 0, loyalty }],
    hands,
    libraries: [library(0, librarySize), library(1, librarySize)],
  });
}

function beginUltimate(start: ReduceResult): { readonly begun: ReduceResult; readonly source: string } {
  const source = oidOf(start.state, 'Jace, Memory Adept');
  const action = legalActions(start.state).find(
    (option) => option.type === 'activateAbility' && option.oid === source && option.abilityIndex === 2,
  );
  if (action === undefined) throw new Error('Jace ultimate did not enter staged targeting');
  return { begun: reduce(start.state, action), source };
}

function choosePlayers(start: ReduceResult, selected: readonly PlayerId[]): ReduceResult {
  let current = start;
  for (const player of selected) {
    const decision = pendingDecision(current.state);
    const action = decision?.options.find(
      (option) =>
        option.type === 'choosePluralTarget' &&
        option.target?.kind === 'player' &&
        option.target.player === player,
    );
    if (action === undefined) throw new Error(`player ${String(player)} was not offered`);
    current = reduce(current.state, action);
  }
  const finish = pendingDecision(current.state)?.options.find(
    (option) => option.type === 'choosePluralTarget' && option.target === null,
  );
  if (finish === undefined) throw new Error('Jace target selection could not finish');
  return reduce(current.state, finish);
}

function resolve(start: ReduceResult): ReduceResult {
  return apply(apply(start, { type: 'passPriority', player: 0 }), {
    type: 'passPriority',
    player: 1,
  });
}

describe('Jace, Memory Adept plural-target activation', () => {
  it.each([
    { selected: [] as const, hands: [0, 0] },
    { selected: [0] as const, hands: [20, 0] },
    { selected: [1] as const, hands: [0, 20] },
    { selected: [0, 1] as const, hands: [20, 20] },
  ])('stages and resolves the $selected player subset', ({ selected, hands }) => {
    const start = board();
    const { begun, source } = beginUltimate(start);
    expect(counterCount(begun.state.objects[source]!.counters, 'loyalty')).toBe(7);
    expect(begun.state.objects[source]!.loyaltyActivatedTurn).toBeUndefined();
    const staged = choosePlayers(begun, selected);

    expect(counterCount(staged.state.objects[source]!.counters, 'loyalty')).toBe(0);
    expect(staged.state.stack.at(-1)?.multiTargets?.[0]).toEqual(
      selected.map((player) => ({ kind: 'player', player })),
    );
    const done = resolve(staged);
    expect(done.state.players.map((seat) => seat.hand.length)).toEqual(hands);
  });

  it('offers no duplicate member and rejects duplicate or non-player hostile payloads', () => {
    const start = board();
    const { begun, source } = beginUltimate(start);
    const chooseSelf = pendingDecision(begun.state)?.options.find(
      (option) =>
        option.type === 'choosePluralTarget' &&
        option.target?.kind === 'player' &&
        option.target.player === 0,
    );
    if (chooseSelf === undefined) throw new Error('self target was not offered');
    const one = reduce(begun.state, chooseSelf);
    expect(
      pendingDecision(one.state)?.options.some(
        (option) =>
          option.type === 'choosePluralTarget' &&
          option.target?.kind === 'player' &&
          option.target.player === 0,
      ),
    ).toBe(false);

    const base = {
      type: 'activateAbility',
      player: 0,
      oid: source,
      abilityIndex: 2,
      targets: [null],
      sacrifices: [],
    } as const;
    expect(
      validateAction(start.state, {
        ...base,
        multiTargets: {
          0: [
            { kind: 'player', player: 0 },
            { kind: 'player', player: 0 },
          ],
        },
      } as unknown as Action),
    ).not.toBeNull();
    expect(
      validateAction(start.state, {
        ...base,
        multiTargets: { 0: [{ kind: 'permanent', oid: source }] },
      } as unknown as Action),
    ).not.toBeNull();
    expect(
      validateAction(start.state, {
        ...base,
        multiTargets: { 1: [{ kind: 'player', player: 0 }] },
      } as unknown as Action),
    ).not.toBeNull();
    expect(
      validateAction(start.state, {
        ...base,
        multiTargets: { 0: [{ kind: 'player', player: 2 }] },
      } as unknown as Action),
    ).not.toBeNull();
  });

  it('filters player hexproof while choosing and rechecks each member at resolution', () => {
    const protectedStart = scenario({
      battlefield: [
        { card: jace(), controller: 0, loyalty: 7 },
        { card: LEYLINE, controller: 1 },
      ],
      libraries: [library(0, 25), library(1, 25)],
    });
    const protectedDecision = pendingDecision(beginUltimate(protectedStart).begun.state);
    expect(
      protectedDecision?.options.flatMap((option) =>
        option.type === 'choosePluralTarget' && option.target?.kind === 'player'
          ? [option.target.player]
          : [],
      ),
    ).toEqual([0]);

    const unprotected = board(7, 25, [[], [LEYLINE]]);
    const selected = choosePlayers(beginUltimate(unprotected).begun, [0, 1]);
    const leylineInHand = selected.state.players[1].hand[0];
    if (leylineInHand === undefined) throw new Error('missing Leyline object');
    const arrived = moveObject(beginTrace(selected.state), leylineInHand, 'battlefield', { controller: 1 });
    const done = resolve({ state: arrived.state, events: [...selected.events, ...arrived.events] });
    expect(done.state.players.map((seat) => seat.hand.length)).toEqual([20, 0]);
    expect(eventsOfType(done.events, 'spellFizzled')).toEqual([]);

    const onlyOpponent = board(7, 25, [[], [LEYLINE]]);
    const aimed = choosePlayers(beginUltimate(onlyOpponent).begun, [1]);
    const heldLeyline = aimed.state.players[1].hand[0];
    if (heldLeyline === undefined) throw new Error('missing held Leyline');
    const shielded = moveObject(beginTrace(aimed.state), heldLeyline, 'battlefield', { controller: 1 });
    const fizzled = resolve({ state: shielded.state, events: aimed.events });
    expect(fizzled.state.players[1].hand).toHaveLength(0);
    expect(eventsOfType(fizzled.events, 'cardDrawn')).toEqual([]);
    expect(eventsOfType(fizzled.events, 'effectSkipped')).toEqual([
      expect.objectContaining({ index: 0, why: 'all chosen targets are no longer legal' }),
    ]);
    expect(fizzled.state.stack).toEqual([]);
  });

  it('draws in APNAP order independent of selection order', () => {
    const staged = choosePlayers(beginUltimate(board()).begun, [1, 0]);
    const done = resolve(staged);
    expect(eventsOfType(done.events, 'cardDrawn').map((event) => event.player)).toEqual([
      ...Array.from({ length: 20 }, () => 0 as const),
      ...Array.from({ length: 20 }, () => 1 as const),
    ]);
  });

  it('finishes all short-library draws before simultaneous loss and replays deterministically', () => {
    const start = board(7, 3);
    const staged = choosePlayers(beginUltimate(start).begun, [0, 1]);
    const first = resolve(staged);
    const replay = resolve({ state: structuredClone(staged.state), events: [] });
    expect(playerOf(first.state, 0).hand).toHaveLength(3);
    expect(playerOf(first.state, 1).hand).toHaveLength(3);
    expect(eventsOfType(first.events, 'drawFromEmptyLibrary').map((event) => event.player)).toEqual([
      ...Array.from({ length: 17 }, () => 0 as const),
      ...Array.from({ length: 17 }, () => 1 as const),
    ]);
    expect(first.state.result).toEqual({
      winner: null,
      loser: null,
      reason: 'emptyLibrary',
      endedOnTurn: 2,
    });
    expect(stateFingerprint(replay.state)).toBe(stateFingerprint(first.state));
    expect(serializeEvents(replay.events)).toBe(serializeEvents(first.events.slice(staged.events.length)));
  });

  it('fizzles the +1 as a whole when its mill target becomes illegal, while 0 mills available cards', () => {
    const plusStart = board(4, 5, [[], [LEYLINE]]);
    const source = oidOf(plusStart.state, 'Jace, Memory Adept');
    const plus = legalActions(plusStart.state).find(
      (action) =>
        action.type === 'activateAbility' &&
        action.oid === source &&
        action.abilityIndex === 0 &&
        action.targets[1]?.kind === 'player' &&
        action.targets[1].player === 1,
    );
    if (plus === undefined) throw new Error('Jace +1 was not offered');
    const activated = reduce(plusStart.state, plus);
    const leyline = activated.state.players[1].hand[0];
    if (leyline === undefined) throw new Error('missing Leyline for +1');
    const shielded = moveObject(beginTrace(activated.state), leyline, 'battlefield', { controller: 1 });
    const fizzled = resolve({ state: shielded.state, events: activated.events });
    expect(fizzled.state.players[0].hand).toHaveLength(0);
    expect(fizzled.state.players[1].graveyard).toHaveLength(0);
    expect(eventsOfType(fizzled.events, 'effectSkipped')).toHaveLength(1);

    const zeroStart = board(4, 4);
    const zeroSource = oidOf(zeroStart.state, 'Jace, Memory Adept');
    const zero = legalActions(zeroStart.state).find(
      (action) =>
        action.type === 'activateAbility' &&
        action.oid === zeroSource &&
        action.abilityIndex === 1 &&
        action.targets[0]?.kind === 'player' &&
        action.targets[0].player === 1,
    );
    if (zero === undefined) throw new Error('Jace 0 was not offered');
    const milled = resolve(reduce(zeroStart.state, zero));
    expect(milled.state.players[1].library).toHaveLength(0);
    expect(milled.state.players[1].graveyard).toHaveLength(4);
    expect(eventsOfType(milled.events, 'drawFromEmptyLibrary')).toEqual([]);
    expect(milled.state.result).toBeNull();
  });
});
