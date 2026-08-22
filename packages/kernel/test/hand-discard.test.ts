/**
 * The hand vocabulary: a discard the owner chooses, a discard its opponent
 * chooses after a reveal, and a discard paid as a cost.
 *
 * Three primitives and two stopping places, which is why they are one file.
 * `discardCards` and `chooseDiscard` both suspend a resolution to ask which
 * cards leave a hand, so they reuse `scry.ts`'s runner rather than growing a
 * third one, and the assertions that matter are the continuation ones
 * `library.test.ts` already makes about a search: the effects printed after the
 * pause still run, and the seat that is not being asked never sees the window.
 * `ActivationCost.discard` is the third and it stops nowhere at all — CR 601.2h
 * pays a cost whole, so the payment is enumerated into the activation and there
 * is no pending anything.
 *
 * The one asymmetry worth stating up front is the arithmetic. CR 701.8a
 * discards "as many as possible", so an effect aimed at a hand shorter than its
 * count takes the whole hand; a cost is not an effect, so a hand short of the
 * printed number cannot pay at all and the activation is refused. Both are
 * tested, because a single clamp shared between them would let a player
 * activate for free with an empty hand.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import type { Action, GameSession, GameSetup, ReduceResult, Seat, Target } from '@mtg/kernel';
import {
  choose,
  createSession,
  eventsOfType,
  humanSeat,
  pendingDecision,
  playGame,
  replaySession,
  scenario,
  seatState,
  serializeEvents,
  simpleAgent,
  stateFingerprint,
  validateAction,
} from '@mtg/kernel';
import { artifact, creature, lands, SWAMP, sorcery } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

/** A hand of distinctly named cards, so a graveyard can be read by name. */
function namedHand(count: number): readonly Card[] {
  return Array.from({ length: count }, (_, index) => creature(`Held ${String(index + 1)}`, 1, 1));
}

const PROBE = sorcery(
  'Mind Probe',
  [{ kind: 'discardCards', count: 2, target: { kind: 'targetOpponent' } }],
  {
    B: 1,
  },
);

const COERCE = sorcery(
  'Coerce the Weak',
  [{ kind: 'chooseDiscard', count: 1, target: { kind: 'targetOpponent' } }],
  {
    B: 1,
  },
);

/**
 * Casts `card` from player 0's hand at player 1 and resolves it with both
 * seats passing. The target list is one slot per printed effect, which is what
 * `castSpell` wants; a spell that prints two says so.
 */
function resolveSpell(start: ReduceResult, name: string, targets: readonly (Target | null)[]) {
  let current = apply(start, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(start.state, 0, name),
    targets: [...targets],
  });
  current = apply(current, { type: 'passPriority', player: 0 });
  return apply(current, { type: 'passPriority', player: 1 });
}

const AT_OPPONENT: readonly (Target | null)[] = [{ kind: 'player', player: 1 }];

function probeScenario(hand = 4, spell: Card = PROBE, seed = 'hand-discard/probe') {
  return scenario({
    battlefield: lands(SWAMP, 2).map((land) => ({ card: land, controller: 0 as const })),
    hands: [[spell], namedHand(hand)],
    libraries: [lands(SWAMP, 6), lands(SWAMP, 6)],
    seed,
  });
}

describe('discardCards', () => {
  it('asks the hand owner, not the spell controller', () => {
    const asked = resolveSpell(probeScenario(), PROBE.name, AT_OPPONENT);
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'handDiscard') throw new Error('a hand discard was not pending');
    expect(decision.player).toBe(1);
    expect(decision.owner).toBe(1);
    expect(decision.count).toBe(2);
    expect(decision.revealed).toBe(false);
    expect(decision.hand).toEqual(asked.state.players[1].hand);
  });

  it('moves the named cards to the owner graveyard and reports them', () => {
    const asked = resolveSpell(probeScenario(), PROBE.name, AT_OPPONENT);
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'handDiscard') throw new Error('a hand discard was not pending');
    const [first, second] = decision.hand;
    if (first === undefined || second === undefined) throw new Error('the hand was smaller than it looks');

    const done = apply(asked, { type: 'chooseDiscards', player: 1, oids: [first, second] });

    expect(done.state.objects[first]?.zone).toBe('graveyard');
    expect(done.state.objects[second]?.zone).toBe('graveyard');
    expect(done.state.players[1].graveyard).toEqual([first, second]);
    expect(done.state.players[1].hand).toHaveLength(2);
    // The spell went to *its own* controller's graveyard, which is the half a
    // shared `moveObject` could get wrong without any test noticing: both
    // moves are to a zone named `graveyard`, and only the owner distinguishes
    // them.
    expect(done.state.players[0].graveyard.map((oid) => done.state.objects[oid]?.card.name)).toEqual([
      PROBE.name,
    ]);
    expect(eventsOfType(done.events, 'cardsDiscarded').at(-1)).toEqual({
      type: 'cardsDiscarded',
      player: 1,
      oids: [first, second],
    });
    expect(done.state.turn.awaiting).toBeNull();
  });

  it('takes a hand shorter than the count whole and never asks', () => {
    // CR 701.8a's "as many as possible". A hand of one against a discard of two
    // has exactly one legal answer, so asking for it would be a prompt with a
    // single button, and a hand of none has no answer at all.
    const asked = resolveSpell(probeScenario(1), PROBE.name, AT_OPPONENT);
    expect(pendingDecision(asked.state)?.kind).not.toBe('handDiscard');
    expect(asked.state.players[1].hand).toEqual([]);
    expect(asked.state.players[1].graveyard).toHaveLength(1);
    expect(eventsOfType(asked.events, 'cardsDiscarded').at(-1)?.oids).toHaveLength(1);
  });

  it('resolves against an empty hand without discarding or asking', () => {
    const asked = resolveSpell(probeScenario(0), PROBE.name, AT_OPPONENT);
    expect(asked.state.turn.awaiting).toBeNull();
    expect(eventsOfType(asked.events, 'cardsDiscarded')).toEqual([]);
  });

  it('runs the effects printed after it once the discard is answered', () => {
    // The continuation assertion. Everything after the pause is banked on the
    // pending record, so an effect list that stopped at the discard would leave
    // this spell a Mind Rot that never drew.
    const twin = sorcery(
      'Probe and Profit',
      [
        { kind: 'discardCards', count: 2, target: { kind: 'targetOpponent' } },
        { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } },
      ],
      { B: 1 },
    );
    const start = scenario({
      battlefield: lands(SWAMP, 2).map((land) => ({ card: land, controller: 0 as const })),
      hands: [[twin], namedHand(4)],
      libraries: [lands(SWAMP, 6), lands(SWAMP, 6)],
      seed: 'hand-discard/continuation',
    });
    const asked = resolveSpell(start, twin.name, [{ kind: 'player', player: 1 }, null]);
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'handDiscard') throw new Error('a hand discard was not pending');
    const held = asked.state.players[0].hand.length;

    const done = apply(asked, { type: 'chooseDiscards', player: 1, oids: decision.hand.slice(0, 2) });

    expect(done.state.players[0].hand).toHaveLength(held + 1);
    expect(eventsOfType(done.events, 'cardDrawn').at(-1)?.player).toBe(0);
  });

  it('refuses an answer that names a card outside the hand it paused on', () => {
    const asked = resolveSpell(probeScenario(), PROBE.name, AT_OPPONENT);
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'handDiscard') throw new Error('a hand discard was not pending');
    const [elsewhere] = asked.state.players[0].library;
    const [theirs] = decision.hand;
    if (elsewhere === undefined || theirs === undefined) throw new Error('the scenario dealt nobody cards');

    const invalid: readonly Extract<Action, { type: 'chooseDiscards' }>[] = [
      { type: 'chooseDiscards', player: 1, oids: [theirs, elsewhere] },
      { type: 'chooseDiscards', player: 1, oids: [theirs, theirs] },
      { type: 'chooseDiscards', player: 0, oids: decision.hand.slice(0, 2) },
    ];
    for (const action of invalid) expect(validateAction(asked.state, action)).not.toBeNull();
  });

  it('keeps the pending question and the hand off the seat that was not asked', () => {
    const asked = resolveSpell(probeScenario(), PROBE.name, AT_OPPONENT);
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'handDiscard') throw new Error('a hand discard was not pending');
    const theirs = seatState(asked.state, 1, 'owner');
    const mine = seatState(asked.state, 0, 'caster');

    expect(theirs.pendingHandDiscard?.cards).toEqual(decision.hand);
    expect(mine.pendingHandDiscard).toBeUndefined();
    for (const oid of decision.hand) {
      expect(theirs.objects[oid]?.card.name).toBe(asked.state.objects[oid]?.card.name);
      expect(mine.objects[oid]).toBeUndefined();
    }
  });
});

describe('chooseDiscard', () => {
  it('reveals the hand and asks the spell controller about cards that are not theirs', () => {
    const asked = resolveSpell(probeScenario(3, COERCE, 'hand-discard/coerce'), COERCE.name, AT_OPPONENT);
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'handDiscard') throw new Error('a hand discard was not pending');
    expect(decision.player).toBe(0);
    expect(decision.owner).toBe(1);
    expect(decision.revealed).toBe(true);
    expect(eventsOfType(asked.events, 'handRevealed').at(-1)).toEqual({
      type: 'handRevealed',
      player: 1,
      oids: decision.hand,
    });
  });

  it('sends the chosen card to its owner graveyard rather than the chooser', () => {
    const asked = resolveSpell(probeScenario(3, COERCE, 'hand-discard/coerce'), COERCE.name, AT_OPPONENT);
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'handDiscard') throw new Error('a hand discard was not pending');
    const taken = decision.hand[1];
    if (taken === undefined) throw new Error('the revealed hand was smaller than it looks');

    const done = apply(asked, { type: 'chooseDiscards', player: 0, oids: [taken] });

    expect(done.state.players[1].graveyard).toEqual([taken]);
    expect(done.state.players[0].graveyard).not.toContain(taken);
    expect(eventsOfType(done.events, 'cardsDiscarded').at(-1)).toEqual({
      type: 'cardsDiscarded',
      player: 1,
      oids: [taken],
    });
  });

  it('shows the chooser exactly the cards the reveal named and nothing further', () => {
    // The reveal is what entitles the chooser to identify ids in a zone that is
    // not theirs, so the entitlement has to stop where the reveal did. The
    // owner's library is the thing on the other side of that line: it was never
    // shown, it is hidden from its own owner too, and un-concealing by seat
    // rather than by list is exactly the mistake that would hand it over.
    const asked = resolveSpell(probeScenario(3, COERCE, 'hand-discard/coerce'), COERCE.name, AT_OPPONENT);
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'handDiscard') throw new Error('a hand discard was not pending');
    const chooser = seatState(asked.state, 0, 'chooser');
    const owner = seatState(asked.state, 1, 'owner');

    expect(decision.hand.map((oid) => chooser.objects[oid]?.card.name)).toEqual(
      decision.hand.map((oid) => asked.state.objects[oid]?.card.name),
    );
    for (const oid of asked.state.players[1].library) expect(chooser.objects[oid]).toBeUndefined();
    expect(chooser.pendingHandDiscard?.cards).toEqual(decision.hand);
    // The owner is watching their own revealed hand be picked over, and the
    // question is not theirs to answer: `handRevealed` already put the fact in
    // their log, and a seat holding somebody else's pending question is how a
    // surface draws a prompt for the wrong player.
    expect(owner.pendingHandDiscard).toBeUndefined();
  });
});

const LOOTER = artifact('Sifting Lens', { generic: 2 }, [
  {
    kind: 'activated',
    cost: { mana: {}, discard: 1 },
    effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
  },
]);

function looterScenario(hand: readonly Card[]) {
  return scenario({
    battlefield: [{ card: LOOTER, controller: 0 as const }],
    hands: [hand, []],
    libraries: [lands(SWAMP, 6), lands(SWAMP, 6)],
    seed: 'hand-discard/looter',
  });
}

describe('discard as an activation cost', () => {
  it('refuses the activation when the hand cannot pay', () => {
    const start = looterScenario([]);
    const oid = oidOf(start.state, LOOTER.name);
    const decision = pendingDecision(start.state);
    if (decision?.kind !== 'priority') throw new Error('nobody holds priority');

    expect(decision.options.some((action) => action.type === 'activateAbility')).toBe(false);
    const blocker = validateAction(start.state, {
      type: 'activateAbility',
      player: 0,
      oid,
      abilityIndex: 0,
      targets: [null],
      sacrifices: [],
      discards: [],
    });
    expect(blocker).toBe('the cost discards 1 and you hold 0');
  });

  it('offers one activation per payable set and eats the card it named', () => {
    const held = namedHand(2);
    const start = looterScenario(held);
    const decision = pendingDecision(start.state);
    if (decision?.kind !== 'priority') throw new Error('nobody holds priority');
    const activations = decision.options.filter((action) => action.type === 'activateAbility');
    expect(activations.map((action) => action.discards)).toEqual([
      [start.state.players[0].hand[0]],
      [start.state.players[0].hand[1]],
    ]);

    const chosen = activations[0];
    if (chosen === undefined) throw new Error('the lens offered no activation');
    const paid = chosen.discards?.[0];
    if (paid === undefined) throw new Error('the activation named no payment');
    const done = apply(start, chosen);

    expect(done.state.objects[paid]?.zone).toBe('graveyard');
    expect(done.state.players[0].graveyard).toContain(paid);
    expect(eventsOfType(done.events, 'cardsDiscarded').at(-1)).toEqual({
      type: 'cardsDiscarded',
      player: 0,
      oids: [paid],
    });
  });

  it('refuses a payment the player does not hold', () => {
    const start = looterScenario(namedHand(2));
    const oid = oidOf(start.state, LOOTER.name);
    const theirs = start.state.players[1].library[0];
    const mine = start.state.players[0].hand[0];
    if (theirs === undefined || mine === undefined) throw new Error('the scenario dealt nobody a hand');
    const activate = (discards: readonly string[]): Action => ({
      type: 'activateAbility',
      player: 0,
      oid,
      abilityIndex: 0,
      targets: [null],
      sacrifices: [],
      discards: [...discards],
    });
    expect(validateAction(start.state, activate([theirs]))).toBe(`${theirs} is not in your hand`);
    expect(validateAction(start.state, activate([]))).toBe('the cost discards 1 cards, and 0 was offered');
    expect(validateAction(start.state, activate([mine]))).toBeNull();
  });
});

const COERCE_SETUP: GameSetup = {
  seed: 'hand-discard/replay',
  decks: [
    { name: 'Coercion', cards: [...Array.from({ length: 12 }, () => COERCE), ...lands(SWAMP, 28)] },
    { name: 'Swamps', cards: lands(SWAMP, 40) },
  ],
};
const COERCE_SEATS: readonly [Seat, Seat] = [humanSeat('A'), humanSeat('B')];

/** Plays until the first reveal-and-choose is pending, then stops on it. */
function playedCoerceSession(): GameSession {
  let session: GameSession = createSession(COERCE_SETUP, COERCE_SEATS);
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
          action.type === 'castSpell' && session.state.objects[action.oid]?.card.name === COERCE.name,
      );
      pick = land >= 0 ? land : spell >= 0 ? spell : 0;
    } else if (decision.kind !== 'handDiscard') {
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
    if (decision.kind === 'handDiscard') return session;
  }
  throw new Error('replay rig never reached a discard');
}

describe('hand discard replay', () => {
  it('reproduces the game from the seed and the same choice list', () => {
    const session = playedCoerceSession();
    const replayed = replaySession(COERCE_SETUP, COERCE_SEATS, session.choices);
    expect(replayed.choices).toEqual(session.choices);
    expect(stateFingerprint(replayed.state)).toBe(stateFingerprint(session.state));
    expect(serializeEvents(replayed.events)).toBe(serializeEvents(session.events));
  });

  it('is answered by the simple agent, so a driven game never stalls on it', () => {
    // Answered until it is settled rather than in one call: past the enumeration
    // cap `discardDecision` shrinks the question to "which card goes next", and
    // this agent scores the list it is given rather than constructing a whole
    // answer, so the number of calls a discard costs is a fact about the cap.
    // What never stalling means is that every call is answered and the position
    // settles, which is the claim at either width.
    let asked = resolveSpell(probeScenario(), PROBE.name, AT_OPPONENT);
    let answers = 0;
    for (let step = 0; step < 20 && asked.state.turn.awaiting === 'handDiscard'; step += 1) {
      const decision = pendingDecision(asked.state);
      if (decision?.kind !== 'handDiscard') throw new Error('a hand discard was not pending');
      const chosen = simpleAgent('discarder').decide({ state: asked.state, player: 1, decision });
      expect(chosen.type).toBe('chooseDiscards');
      asked = apply(asked, chosen);
      answers += 1;
    }
    expect(answers).toBeGreaterThan(0);
    expect(asked.state.turn.awaiting).toBeNull();
  });

  it('runs a whole simulated game on a deck that prints one', () => {
    const run = playGame({ ...COERCE_SETUP, maximumTurns: 40 }, [
      simpleAgent('coercer'),
      simpleAgent('victim'),
    ]);
    expect(run.result).not.toBeNull();
    expect(eventsOfType(run.events, 'cardsDiscarded').length).toBeGreaterThan(0);
  });
});

/**
 * Duress, and the reason a filtered hand-choice is not a filtered search.
 *
 * The two questions look alike — both narrow a set of cards by printed
 * characteristics, both suspend a resolution to ask — and one difference makes
 * them different records. A search shows the searcher exactly the cards it may
 * take, so `PendingSearch` carries one list and that list is both what was
 * revealed and what may be named. CR 701.16a reveals the *whole* hand, and only
 * part of it may then be named, so two lists: `cards` is what the chooser was
 * shown and what `concealedFrom` un-conceals, `choosable` is what they may
 * answer with. Collapsing them either hides cards the reveal already showed or
 * offers cards the printed sentence refuses, and the first is the leak while
 * the second is the bug this file was opened for — a clean `validateCards` on a
 * Duress that can take a Mountain.
 *
 * `Decision.hand` is the second list rather than the first, because a decision
 * is the answer space: `validateAction`, `asksInSteps` and both simulator bots
 * read it to build a `chooseDiscards`, so a `hand` holding cards the filter
 * refused would have three callers minting illegal actions. What the chooser
 * *saw* is on the seat's own `pendingHandDiscard.cards` and in the
 * `handRevealed` event, which is where a surface that wants to draw the whole
 * hand grayed out should read it.
 */
const DURESS = sorcery(
  'Duress',
  [
    {
      kind: 'chooseDiscard',
      count: 1,
      target: { kind: 'targetOpponent' },
      filter: { excludeCardTypes: ['creature', 'land'] },
    },
  ],
  { B: 1 },
);

const HELD_BEAST = creature('Held Beast', 2, 2);
const HELD_RITUAL = sorcery('Held Ritual', [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }]);
const HELD_LENS = artifact('Held Lens', { generic: 2 });

function duressScenario(victimHand: readonly Card[], seed = 'hand-discard/duress') {
  return scenario({
    battlefield: lands(SWAMP, 2).map((land) => ({ card: land, controller: 0 as const })),
    hands: [[DURESS], victimHand],
    libraries: [lands(SWAMP, 6), lands(SWAMP, 6)],
    seed,
  });
}

const MIXED_HAND: readonly Card[] = [HELD_BEAST, HELD_RITUAL, SWAMP, HELD_LENS];

describe('chooseDiscard under a card filter', () => {
  it('offers only the cards the filter names, out of a hand it revealed whole', () => {
    const asked = resolveSpell(duressScenario(MIXED_HAND), DURESS.name, AT_OPPONENT);
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'handDiscard') throw new Error('a hand discard was not pending');

    expect(decision.hand.map((oid) => asked.state.objects[oid]?.card.name)).toEqual([
      HELD_RITUAL.name,
      HELD_LENS.name,
    ]);
    // The refused cards are the assertion the bead was filed on: a Duress that
    // validates clean and then takes a creature is strictly stronger than the
    // printing, which is worse than refusing to translate it at all.
    expect(decision.hand).not.toContain(handOidOf(asked.state, 1, HELD_BEAST.name));
    expect(decision.hand).not.toContain(handOidOf(asked.state, 1, SWAMP.name));
    expect(decision.options).toHaveLength(2);
    for (const option of decision.options) {
      if (option.type !== 'chooseDiscards') throw new Error('the discard offered a foreign action');
      for (const oid of option.oids) expect(decision.hand).toContain(oid);
    }
  });

  it('shows the chooser the whole revealed hand even though it may name part of it', () => {
    const asked = resolveSpell(duressScenario(MIXED_HAND), DURESS.name, AT_OPPONENT);
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'handDiscard') throw new Error('a hand discard was not pending');
    const chooser = seatState(asked.state, 0, 'chooser');
    const whole = asked.state.players[1].hand;

    expect(chooser.pendingHandDiscard?.cards).toEqual(whole);
    expect(eventsOfType(asked.events, 'handRevealed').at(-1)?.oids).toEqual(whole);
    // Every card of the reveal is legible to the chooser, including the two
    // they may not name. The reveal is what CR 701.16a did; the filter is what
    // the printed sentence says about the choice that follows it.
    for (const oid of whole) {
      expect(chooser.objects[oid]?.card.name).toBe(asked.state.objects[oid]?.card.name);
    }
  });

  it('refuses an answer that names a card the filter excluded', () => {
    const asked = resolveSpell(duressScenario(MIXED_HAND), DURESS.name, AT_OPPONENT);
    for (const name of [HELD_BEAST.name, SWAMP.name]) {
      const refused = validateAction(asked.state, {
        type: 'chooseDiscards',
        player: 0,
        oids: [handOidOf(asked.state, 1, name)],
      });
      expect(refused, name).not.toBeNull();
    }
    expect(
      validateAction(asked.state, {
        type: 'chooseDiscards',
        player: 0,
        oids: [handOidOf(asked.state, 1, HELD_RITUAL.name)],
      }),
    ).toBeNull();
  });

  it('discards the card it was given and leaves the refused ones in hand', () => {
    const asked = resolveSpell(duressScenario(MIXED_HAND), DURESS.name, AT_OPPONENT);
    const taken = handOidOf(asked.state, 1, HELD_LENS.name);
    const done = apply(asked, { type: 'chooseDiscards', player: 0, oids: [taken] });

    expect(done.state.players[1].graveyard).toEqual([taken]);
    expect(done.state.players[1].hand.map((oid) => done.state.objects[oid]?.card.name)).toEqual([
      HELD_BEAST.name,
      HELD_RITUAL.name,
      SWAMP.name,
    ]);
    expect(done.state.turn.awaiting).toBeNull();
  });

  it('takes the only match without asking', () => {
    // CR 701.8a's "as many as possible" read through the filter: one legal
    // answer is a prompt with a single button, exactly as an unfiltered discard
    // of a one-card hand is.
    const asked = resolveSpell(duressScenario([HELD_BEAST, SWAMP, HELD_RITUAL]), DURESS.name, AT_OPPONENT);

    expect(asked.state.turn.awaiting).toBeNull();
    expect(eventsOfType(asked.events, 'cardsDiscarded').at(-1)?.oids).toHaveLength(1);
    expect(asked.state.players[1].graveyard.map((oid) => asked.state.objects[oid]?.card.name)).toEqual([
      HELD_RITUAL.name,
    ]);
  });

  it('reveals a hand it can take nothing from and discards none of it', () => {
    // The hand is not empty, so the reveal still happens and the opponent still
    // learns what is there; the filter matches none of it, so nothing is
    // discarded and nobody is asked. An unfiltered `chooseDiscard` reaches this
    // state only on an empty hand, which is why it is a separate case.
    const asked = resolveSpell(duressScenario([HELD_BEAST, SWAMP]), DURESS.name, AT_OPPONENT);

    expect(asked.state.turn.awaiting).toBeNull();
    expect(eventsOfType(asked.events, 'cardsDiscarded')).toEqual([]);
    expect(eventsOfType(asked.events, 'handRevealed').at(-1)?.oids).toEqual(asked.state.players[1].hand);
    expect(asked.state.players[1].hand).toHaveLength(2);
  });

  it('leaves an unfiltered choice offering the whole hand', () => {
    // The regression guard on the two-list record: with no filter the two lists
    // are the same list, and every assertion the rest of this file makes about
    // `Coerce the Weak` still has to hold.
    const coerced = resolveSpell(
      probeScenario(3, COERCE, 'hand-discard/coerce-whole'),
      COERCE.name,
      AT_OPPONENT,
    );
    const decision = pendingDecision(coerced.state);
    if (decision?.kind !== 'handDiscard') throw new Error('a hand discard was not pending');

    expect(decision.hand).toEqual(coerced.state.players[1].hand);
    expect(seatState(coerced.state, 0, 'chooser').pendingHandDiscard?.cards).toEqual(decision.hand);
    expect(decision.options).toHaveLength(decision.hand.length);
  });
});
