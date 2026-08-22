/** CR 701.18: bounded hidden choices, continuation, and deterministic replay. */
import { describe, expect, it } from 'vitest';
import type { Action, GameSession, GameSetup, ReduceResult, Seat } from '@mtg/kernel';
import {
  canUndo,
  choose,
  createSession,
  eventsOfType,
  humanSeat,
  pendingDecision,
  replaySession,
  scenario,
  seatState,
  serializeEvents,
  stateFingerprint,
  undo,
  UndoRefusedError,
  validateAction,
} from '@mtg/kernel';
import { creature, ISLAND, lands, MOUNTAIN, sorcery } from './cards';
import { apply, handOidOf } from './helpers';

const LOOK_TWO = sorcery('Crystal Glimpse', [{ kind: 'scry', count: 2 }], { U: 1 });
const PREORDAIN = sorcery(
  'Preordain',
  [
    { kind: 'scry', count: 2 },
    { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } },
  ],
  { U: 1 },
);
const FORESEE = sorcery(
  'Foresee',
  [
    { kind: 'scry', count: 4 },
    { kind: 'drawCards', count: 2, target: { kind: 'noTarget' } },
  ],
  { generic: 3, U: 1 },
);

function namedLibrary(count = 5) {
  return Array.from({ length: count }, (_, index) => creature(`Library ${String(index + 1)}`, 1, 1));
}

function untilScry(card = LOOK_TWO, library = namedLibrary()): ReduceResult {
  let current = scenario({
    battlefield: lands(ISLAND, 4).map((land) => ({ card: land, controller: 0 as const })),
    hands: [[card], []],
    libraries: [library, namedLibrary(8)],
  });
  current = apply(current, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(current.state, 0, card.name),
    targets: card.kind === 'sorcery' ? card.effects.map(() => null) : [],
  });
  current = apply(current, { type: 'passPriority', player: 0 });
  return apply(current, { type: 'passPriority', player: 1 });
}

function scryAction(
  current: ReduceResult,
  top: readonly string[],
  bottom: readonly string[],
): Extract<Action, { type: 'scry' }> {
  const decision = pendingDecision(current.state);
  if (decision?.kind !== 'scry') throw new Error('scry was not pending');
  const action = decision.options.find(
    (option): option is Extract<Action, { type: 'scry' }> =>
      option.type === 'scry' &&
      JSON.stringify(option.top) === JSON.stringify(top) &&
      JSON.stringify(option.bottom) === JSON.stringify(bottom),
  );
  if (action === undefined) throw new Error('wanted scry action was not enumerated');
  return action;
}

function factorial(value: number): number {
  let result = 1;
  for (let factor = 2; factor <= value; factor += 1) result *= factor;
  return result;
}

function membershipKey(values: readonly string[], universe: readonly string[]): string {
  const members = new Set(values);
  return universe.map((oid) => (members.has(oid) ? '1' : '0')).join('');
}

describe('scry choice semantics', () => {
  it.each([
    [1, 2, 'Viscera Seer'],
    [2, 6, 'Crystal Ball and Preordain'],
    [3, 24, 'Augury Owl'],
    [4, 120, 'Foresee'],
  ] as const)('enumerates every legal scry %i choice (%i options) for %s', (count, optionCount, source) => {
    const card = sorcery(`${source} Scry`, [{ kind: 'scry', count }], { U: 1 });
    const decision = pendingDecision(untilScry(card, namedLibrary(5)).state);
    expect(decision?.kind).toBe('scry');
    expect(decision?.options).toHaveLength(optionCount);
    expect(decision?.complete).toBe(true);

    if (decision?.kind !== 'scry') throw new Error('scry was not pending');
    const actions = decision.options.filter(
      (option): option is Extract<Action, { type: 'scry' }> => option.type === 'scry',
    );
    expect(actions).toHaveLength(optionCount);
    expect(new Set(actions.map((action) => JSON.stringify([action.top, action.bottom]))).size).toBe(
      optionCount,
    );

    const expectedCards = [...decision.cards].sort();
    for (const action of actions) {
      expect([...action.top, ...action.bottom].sort()).toEqual(expectedCards);
      expect(new Set([...action.top, ...action.bottom]).size).toBe(count);
    }

    // For each top/bottom membership partition, every independent ordering of
    // both groups appears exactly once: k! ways to order the top and (n-k)!
    // ways to order the bottom. Validity, uniqueness, and all 2^n membership
    // keys at those multiplicities prove the 2/6/24/120 spaces are complete.
    for (let mask = 0; mask < 2 ** count; mask += 1) {
      const key = decision.cards.map((_oid, index) => ((mask & (1 << index)) === 0 ? '0' : '1')).join('');
      const topCount = [...key].filter((bit) => bit === '1').length;
      expect(actions.filter((action) => membershipKey(action.top, decision.cards) === key)).toHaveLength(
        factorial(topCount) * factorial(count - topCount),
      );
    }
  });

  it('enumerates every partition and both orders, completely and deterministically', () => {
    const two = untilScry();
    const four = untilScry(FORESEE, namedLibrary(5));
    const decisionTwo = pendingDecision(two.state);
    const decisionFour = pendingDecision(four.state);
    expect(decisionTwo?.kind).toBe('scry');
    expect(decisionTwo?.options).toHaveLength(6);
    expect(decisionFour?.kind).toBe('scry');
    expect(decisionFour?.options).toHaveLength(120);
    expect(decisionTwo?.complete).toBe(true);
    expect(decisionFour?.complete).toBe(true);
    expect(pendingDecision(untilScry().state)?.options).toEqual(decisionTwo?.options);
  });

  it('supports zero-bottom, all-bottom, and mixed choices with independent orders', () => {
    for (const shape of ['zero', 'all', 'mixed'] as const) {
      const asked = untilScry();
      const [first, second, ...rest] = asked.state.players[0].library;
      if (first === undefined || second === undefined) throw new Error('library was too short');
      const action =
        shape === 'zero'
          ? scryAction(asked, [second, first], [])
          : shape === 'all'
            ? scryAction(asked, [], [second, first])
            : scryAction(asked, [second], [first]);
      const result = apply(asked, action);
      expect(result.state.players[0].library).toEqual(
        shape === 'zero'
          ? [second, first, ...rest]
          : shape === 'all'
            ? [...rest, second, first]
            : [second, ...rest, first],
      );
      expect(eventsOfType(result.events, 'cardsScried').at(-1)).toEqual({
        type: 'cardsScried',
        player: 0,
        count: 2,
        bottom: shape === 'zero' ? 0 : shape === 'all' ? 2 : 1,
      });
    }
  });

  it('executes scry 1 by moving the looked-at card to the chosen end of the library', () => {
    const card = sorcery('Viscera Seer Scry', [{ kind: 'scry', count: 1 }], { U: 1 });
    const asked = untilScry(card, namedLibrary(3));
    const [looked, ...tail] = asked.state.players[0].library;
    if (looked === undefined) throw new Error('library was empty');

    const done = apply(asked, scryAction(asked, [], [looked]));

    expect(done.state.players[0].library).toEqual([...tail, looked]);
    expect(eventsOfType(done.events, 'cardsScried').at(-1)).toEqual({
      type: 'cardsScried',
      player: 0,
      count: 1,
      bottom: 1,
    });
  });

  it('uses the short library rather than inventing cards and resumes later effects', () => {
    const asked = untilScry(PREORDAIN, namedLibrary(1));
    const only = asked.state.players[0].library[0];
    if (only === undefined) throw new Error('library was empty');
    const done = apply(asked, scryAction(asked, [only], []));
    expect(done.state.players[0].library).toEqual([]);
    expect(done.state.players[0].hand).toContain(only);
    expect(done.state.objects[only]?.zone).toBe('hand');
    expect(eventsOfType(done.events, 'cardsScried')).toContainEqual({
      type: 'cardsScried',
      player: 0,
      count: 2,
      bottom: 0,
    });
  });

  it('offers the sole empty partition and resumes subsequent effects from an empty library', () => {
    const spell = sorcery(
      'Read the Empty Deep',
      [
        { kind: 'scry', count: 2 },
        { kind: 'gainLife', amount: 3, target: { kind: 'noTarget' } },
      ],
      { U: 1 },
    );
    const asked = untilScry(spell, []);
    const decision = pendingDecision(asked.state);
    expect(decision?.kind).toBe('scry');
    expect(decision?.options).toEqual([{ type: 'scry', player: 0, top: [], bottom: [] }]);

    const action = decision?.options[0];
    if (action === undefined) throw new Error('empty scry offered no action');
    const done = apply(asked, action);

    expect(done.state.players[0].life).toBe(23);
    expect(done.state.players[0].library).toEqual([]);
    expect(eventsOfType(done.events, 'cardsScried').at(-1)).toEqual({
      type: 'cardsScried',
      player: 0,
      count: 2,
      bottom: 0,
    });
  });

  it('does not check state-based actions in the middle of a resolving spell', () => {
    const victim = creature('Marked Victim', 2, 2);
    const spell = sorcery(
      'Read the Ashes',
      [
        { kind: 'dealDamage', amount: 2, target: { kind: 'targetCreature' } },
        { kind: 'scry', count: 2 },
      ],
      { U: 1 },
    );
    let current = scenario({
      battlefield: [
        { card: ISLAND, controller: 0 },
        { card: victim, controller: 1 },
      ],
      hands: [[spell], []],
      libraries: [namedLibrary(), namedLibrary()],
    });
    const victimOid = current.state.battlefield.find(
      (oid) => current.state.objects[oid]?.card.name === victim.name,
    );
    if (victimOid === undefined) throw new Error('victim was absent');
    current = apply(current, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(current.state, 0, spell.name),
      targets: [{ kind: 'permanent', oid: victimOid }, null],
    });
    current = apply(current, { type: 'passPriority', player: 0 });
    current = apply(current, { type: 'passPriority', player: 1 });
    expect(pendingDecision(current.state)?.kind).toBe('scry');
    expect(current.state.objects[victimOid]).toEqual(
      expect.objectContaining({ zone: 'battlefield', damage: 2 }),
    );

    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'scry') throw new Error('scry was not pending');
    const choice = decision.options[0];
    if (choice === undefined) throw new Error('scry offered no choice');
    const done = apply(current, choice);
    expect(done.state.objects[victimOid]?.zone).toBe('graveyard');
  });

  it('defers triggers from earlier effects until the interrupted resolution finishes', () => {
    const witness = creature('Last Witness', 1, 1, {
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfDies',
          effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
        },
      ],
    });
    const spell = sorcery(
      'Read the Doom',
      [
        { kind: 'destroyPermanent', target: { kind: 'targetCreature' } },
        { kind: 'scry', count: 2 },
      ],
      { U: 1 },
    );
    let current = scenario({
      battlefield: [
        { card: ISLAND, controller: 0 },
        { card: witness, controller: 1 },
      ],
      hands: [[spell], []],
      libraries: [namedLibrary(), namedLibrary()],
    });
    const witnessOid = current.state.battlefield.find(
      (oid) => current.state.objects[oid]?.card.name === witness.name,
    );
    if (witnessOid === undefined) throw new Error('witness was absent');
    current = apply(current, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(current.state, 0, spell.name),
      targets: [{ kind: 'permanent', oid: witnessOid }, null],
    });
    current = apply(current, { type: 'passPriority', player: 0 });
    current = apply(current, { type: 'passPriority', player: 1 });
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'scry') throw new Error('scry was not pending');
    expect(current.state.objects[witnessOid]?.zone).toBe('graveyard');
    expect(current.state.stack).toEqual([]);

    const choice = decision.options[0];
    if (choice === undefined) throw new Error('scry offered no choice');
    const done = apply(current, choice);
    expect(done.state.stack).toHaveLength(1);
    expect(eventsOfType(done.events, 'abilityTriggered')).toEqual([
      expect.objectContaining({ source: witnessOid, condition: 'selfDies' }),
    ]);
  });

  it('combines triggers from before and after scry, then puts them on the stack in APNAP order', () => {
    const activeWitness = creature('Active Witness', 1, 1, {
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfDies',
          effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
        },
      ],
    });
    const nonactiveWitness = creature('Nonactive Witness', 1, 1, {
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfDies',
          effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
        },
      ],
    });
    const spell = sorcery(
      'Read Both Fates',
      [
        { kind: 'destroyPermanent', target: { kind: 'targetCreature' } },
        { kind: 'scry', count: 2 },
        { kind: 'destroyPermanent', target: { kind: 'targetCreature', distinct: true } },
      ],
      { U: 1 },
    );
    let current = scenario({
      battlefield: [
        { card: ISLAND, controller: 0 },
        { card: activeWitness, controller: 0 },
        { card: nonactiveWitness, controller: 1 },
      ],
      hands: [[spell], []],
      libraries: [namedLibrary(), namedLibrary()],
      active: 0,
    });
    const activeOid = current.state.battlefield.find(
      (oid) => current.state.objects[oid]?.card.name === activeWitness.name,
    );
    const nonactiveOid = current.state.battlefield.find(
      (oid) => current.state.objects[oid]?.card.name === nonactiveWitness.name,
    );
    if (activeOid === undefined || nonactiveOid === undefined) throw new Error('witness was absent');
    current = apply(current, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(current.state, 0, spell.name),
      targets: [{ kind: 'permanent', oid: nonactiveOid }, null, { kind: 'permanent', oid: activeOid }],
    });
    current = apply(current, { type: 'passPriority', player: 0 });
    current = apply(current, { type: 'passPriority', player: 1 });

    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'scry') throw new Error('scry was not pending');
    expect(current.state.objects[nonactiveOid]?.zone).toBe('graveyard');
    expect(current.state.objects[activeOid]?.zone).toBe('battlefield');
    expect(eventsOfType(current.events, 'abilityTriggered')).toEqual([]);

    const choice = decision.options[0];
    if (choice === undefined) throw new Error('scry offered no choice');
    const done = apply(current, choice);
    const fired = eventsOfType(done.events, 'abilityTriggered');
    expect(fired.map((event) => [event.player, event.source])).toEqual([
      [0, activeOid],
      [1, nonactiveOid],
    ]);
    expect(done.state.stack.map((entry) => entry.ability?.sourceOid)).toEqual([activeOid, nonactiveOid]);
  });

  it('retains resolution-local computed amounts across the choice', () => {
    const spell = sorcery(
      'Read the Void',
      [
        {
          kind: 'exileTarget',
          scope: 'creaturesThatPlayerControls',
          target: { kind: 'targetOpponent' },
        },
        { kind: 'scry', count: 2 },
        {
          kind: 'dealDamage',
          amount: { kind: 'exiledThisResolution' },
          target: { kind: 'targetOpponent' },
        },
      ],
      { U: 1 },
    );
    let current = scenario({
      battlefield: [
        { card: ISLAND, controller: 0 },
        { card: creature('Void One', 1, 1), controller: 1 },
        { card: creature('Void Two', 2, 2), controller: 1 },
      ],
      hands: [[spell], []],
      libraries: [namedLibrary(), namedLibrary()],
    });
    current = apply(current, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(current.state, 0, spell.name),
      targets: [{ kind: 'player', player: 1 }, null, { kind: 'player', player: 1 }],
    });
    current = apply(current, { type: 'passPriority', player: 0 });
    current = apply(current, { type: 'passPriority', player: 1 });
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'scry') throw new Error('scry was not pending');
    const choice = decision.options[0];
    if (choice === undefined) throw new Error('scry offered no choice');
    const done = apply(current, choice);
    expect(done.state.exile).toHaveLength(2);
    expect(done.state.players[1].life).toBe(18);
  });

  it('retains a damage tally across the choice', () => {
    // `exiledThisResolution`'s sibling, and for a while the DSL refused to
    // print this arrangement at all: the banked half of a paused resolution was
    // one number, the exile count, so a damage tally read zero after the pause
    // and `DAMAGE_TALLY_ACROSS_PAUSE` refused the card rather than let it
    // undercount. The bank is a `ResolutionTally` now and both halves cross.
    const spell = sorcery(
      'Void Reprise',
      [
        { kind: 'dealDamage', amount: 3, target: { kind: 'targetOpponent' } },
        { kind: 'scry', count: 2 },
        {
          kind: 'dealDamage',
          amount: { kind: 'damageDealtThisResolution' },
          target: { kind: 'targetOpponent' },
        },
      ],
      { generic: 2, R: 1 },
    );
    let current = scenario({
      battlefield: lands(MOUNTAIN, 3).map((land) => ({ card: land, controller: 0 as const })),
      hands: [[spell], []],
      libraries: [namedLibrary(), namedLibrary()],
    });
    current = apply(current, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(current.state, 0, spell.name),
      targets: [{ kind: 'player', player: 1 }, null, { kind: 'player', player: 1 }],
    });
    current = apply(current, { type: 'passPriority', player: 0 });
    current = apply(current, { type: 'passPriority', player: 1 });
    expect(current.state.players[1].life).toBe(17);
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'scry') throw new Error('scry was not pending');
    const choice = decision.options[0];
    if (choice === undefined) throw new Error('scry offered no choice');
    const done = apply(current, choice);
    expect(done.state.players[1].life).toBe(14);
  });

  it('retains a damage tally across a library search, which pauses the same way', () => {
    // The second pausing effect, asserted separately because the banking is
    // per-record: `PendingSearch` carries its own tally and a fix that reached
    // only `PendingScry` would pass the test above and undercount here.
    const spell = sorcery(
      'Void Errand',
      [
        { kind: 'dealDamage', amount: 2, target: { kind: 'targetOpponent' } },
        {
          kind: 'searchLibrary',
          filter: { cardTypes: ['land'], supertypes: ['basic'] },
          destination: 'hand',
        },
        {
          kind: 'dealDamage',
          amount: { kind: 'damageDealtThisResolution' },
          target: { kind: 'targetOpponent' },
        },
      ],
      { generic: 2, R: 1 },
    );
    let current = scenario({
      battlefield: lands(MOUNTAIN, 3).map((land) => ({ card: land, controller: 0 as const })),
      hands: [[spell], []],
      libraries: [[...namedLibrary(2), ...lands(ISLAND, 2)], namedLibrary()],
    });
    current = apply(current, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(current.state, 0, spell.name),
      targets: [{ kind: 'player', player: 1 }, null, { kind: 'player', player: 1 }],
    });
    current = apply(current, { type: 'passPriority', player: 0 });
    current = apply(current, { type: 'passPriority', player: 1 });
    expect(current.state.players[1].life).toBe(18);
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'searchLibrary') throw new Error('a search was not pending');
    const found = decision.cards[0];
    if (found === undefined) throw new Error('the search matched nothing');
    const done = apply(current, { type: 'searchLibrary', player: 0, found });
    expect(done.state.players[1].life).toBe(16);
  });

  it('refuses duplicates, omissions, cards below the looked-at window, and the wrong player', () => {
    const asked = untilScry();
    const [first, second, third] = asked.state.players[0].library;
    if (first === undefined || second === undefined || third === undefined) throw new Error('short library');
    const invalid: readonly Extract<Action, { type: 'scry' }>[] = [
      { type: 'scry', player: 0, top: [first, first], bottom: [] },
      { type: 'scry', player: 0, top: [first], bottom: [] },
      { type: 'scry', player: 0, top: [first], bottom: [third] },
      { type: 'scry', player: 1, top: [first, second], bottom: [] },
    ];
    for (const action of invalid) expect(validateAction(asked.state, action)).not.toBeNull();
  });
});

describe('scry concealment', () => {
  it('reveals the looked-at cards only to the choosing seat and keeps public events identity-free', () => {
    const asked = untilScry();
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'scry') throw new Error('scry was not pending');
    const mine = seatState(asked.state, 0, 'chooser');
    const theirs = seatState(asked.state, 1, 'opponent');
    for (const oid of decision.cards) {
      expect(mine.objects[oid]?.card.name).toMatch(/^Library /);
      expect(theirs.objects[oid]).toBeUndefined();
    }
    expect(mine.pendingScry?.cards).toEqual(decision.cards);
    expect(theirs.pendingScry).toBeUndefined();

    const action = decision.options[0];
    if (action === undefined) throw new Error('scry offered no action');
    const done = apply(asked, action);
    expect(eventsOfType(done.events, 'cardsScried').at(-1)).toEqual({
      type: 'cardsScried',
      player: 0,
      count: 2,
      bottom: expect.any(Number),
    });
  });
});

const REPLAY_SETUP: GameSetup = {
  seed: 'scry/replay',
  decks: [
    {
      name: 'Preordain',
      cards: [...Array.from({ length: 12 }, () => PREORDAIN), ...lands(ISLAND, 28)],
    },
    { name: 'Islands', cards: lands(ISLAND, 40) },
  ],
};
const REPLAY_SEATS: readonly [Seat, Seat] = [humanSeat('A'), humanSeat('B')];

function playedScrySession(): GameSession {
  let session: GameSession = createSession(REPLAY_SETUP, REPLAY_SEATS);
  for (let step = 0; step < 500; step += 1) {
    const decision = session.pending;
    if (decision === null) throw new Error('replay rig stopped early');
    let pick = 0;
    if (decision.kind === 'mulligan') {
      pick = decision.options.findIndex((action) => action.type === 'keepHand');
    } else if (decision.kind === 'priority') {
      const land = decision.options.findIndex((action) => action.type === 'playLand');
      const spell = decision.options.findIndex(
        (action) =>
          action.type === 'castSpell' && session.state.objects[action.oid]?.card.name === 'Preordain',
      );
      pick = land >= 0 ? land : spell >= 0 ? spell : 0;
    } else if (decision.kind === 'scry') {
      pick = decision.options.findIndex((action) => action.type === 'scry' && action.bottom.length === 1);
    } else {
      pick = decision.options.findIndex((action) =>
        action.type === 'declareAttackers'
          ? action.attackers.length === 0
          : action.type === 'declareBlockers'
            ? action.blocks.length === 0
            : true,
      );
    }
    if (pick < 0) throw new Error(`no replay option for ${decision.kind}`);
    session = choose(session, pick);
    if (decision.kind === 'scry') return session;
  }
  throw new Error('replay rig never reached scry');
}

describe('scry replay', () => {
  it('replays the bounded choice, continued draw, event bytes, and state fingerprint', () => {
    const session = playedScrySession();
    const replayed = replaySession(REPLAY_SETUP, REPLAY_SEATS, session.choices);
    expect(replayed.choices).toEqual(session.choices);
    expect(stateFingerprint(replayed.state)).toBe(stateFingerprint(session.state));
    expect(serializeEvents(replayed.events)).toBe(serializeEvents(session.events));
  });

  it('refuses undo after the choosing player has seen and ordered hidden library cards', () => {
    const session = playedScrySession();

    expect(session.committed?.reason.event).toBe('cardsScried');
    expect(session.committed?.floor).toBe(session.choices.length);
    expect(canUndo(session)).toBe(false);
    expect(() => undo(REPLAY_SETUP, session)).toThrow(UndoRefusedError);
    expect(() => undo(REPLAY_SETUP, session)).toThrow(/scried.*cannot un-learn/i);
  });
});
