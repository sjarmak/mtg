/**
 * The London mulligan (CR 103.4), driven through the public seam.
 *
 * Every assertion here goes through `createGame`, `pendingDecision` and
 * `reduce`, because the whole claim is that an opening hand is now a decision
 * like any other: the kernel asks, an agent answers, the reducer moves the
 * cards. A test that reached into state to bottom a card by hand would prove
 * nothing about the seam the play surface and the bots sit on.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { basicLand, parseCard } from '@mtg/dsl';
import type { Action, Decision, GameState, ObjectId, ReduceResult } from '@mtg/kernel';
import {
  settledChoice,
  createGame,
  DEFAULT_AUTO_PASS,
  eventsOfType,
  pendingDecision,
  reduce,
  serializeEvents,
  stateFingerprint,
  validateAction,
} from '@mtg/kernel';

const BEAR: Card = parseCard({
  kind: 'creature',
  id: 'mul-1',
  name: 'Tideglass Bear',
  rarity: 'common',
  set: { code: 'MUL', collectorNumber: 1 },
  manaCost: { generic: 1, G: 1 },
  colors: ['G'],
  power: 2,
  toughness: 2,
});

const OGRE: Card = parseCard({
  kind: 'creature',
  id: 'mul-2',
  name: 'Reach Ogre',
  rarity: 'common',
  set: { code: 'MUL', collectorNumber: 2 },
  manaCost: { generic: 5, R: 1 },
  colors: ['R'],
  power: 5,
  toughness: 5,
});

const FOREST = basicLand('Forest', 'MUL', 3);

function deck(name: string): { readonly name: string; readonly cards: readonly Card[] } {
  const cards: Card[] = [];
  for (let index = 0; index < 40; index += 1) {
    cards.push(index % 3 === 0 ? BEAR : index % 3 === 1 ? OGRE : FOREST);
  }
  return { name, cards };
}

const SETUP = { seed: 'mulligan/v1', decks: [deck('one'), deck('two')] as const };

function opening(seed = SETUP.seed): ReduceResult {
  return createGame({ ...SETUP, seed });
}

function asked(state: GameState): Decision {
  const decision = pendingDecision(state);
  if (decision === null) throw new Error('the kernel is waiting on nobody');
  return decision;
}

function mulliganDecision(state: GameState): Extract<Decision, { kind: 'mulligan' }> {
  const decision = asked(state);
  if (decision.kind !== 'mulligan') throw new Error(`asked for ${decision.kind}, not a mulligan`);
  return decision;
}

function apply(current: ReduceResult, action: Action): ReduceResult {
  const step = reduce(current.state, action);
  return { state: step.state, events: [...current.events, ...step.events] };
}

/** Keeps whatever hand is being asked about, bottoming the first cards in it. */
function keep(current: ReduceResult): ReduceResult {
  const decision = mulliganDecision(current.state);
  return apply(current, {
    type: 'keepHand',
    player: decision.player,
    bottom: decision.hand.slice(0, decision.count),
  });
}

function takeMulligan(current: ReduceResult): ReduceResult {
  const decision = mulliganDecision(current.state);
  return apply(current, { type: 'mulligan', player: decision.player });
}

/**
 * Keeps for whoever is being asked until this seat is the one being asked.
 *
 * The phase is round-robin, so a seat that mulligans does not get the next
 * question — the other one does. Tests about one seat's second and third
 * questions have to walk past the other seat's first.
 */
function until(current: ReduceResult, player: 0 | 1): ReduceResult {
  let cursor = current;
  for (let guard = 0; guard < 20; guard += 1) {
    if (mulliganDecision(cursor.state).player === player) return cursor;
    cursor = keep(cursor);
  }
  throw new Error(`player ${String(player)} was never asked again`);
}

function handOf(state: GameState, player: 0 | 1): readonly ObjectId[] {
  return state.players[player].hand;
}

describe('a game opens on a mulligan decision', () => {
  it('asks the starting player first, with a full hand already dealt', () => {
    const started = opening();
    const decision = mulliganDecision(started.state);

    expect(decision.player).toBe(started.state.config.startingPlayer);
    expect(decision.mulligans).toBe(0);
    expect(decision.count).toBe(0);
    expect(decision.hand).toHaveLength(7);
    expect(started.state.turn.number).toBe(0);
  });

  it('offers exactly one keep and one mulligan before any has been taken', () => {
    const decision = mulliganDecision(opening().state);
    const kinds = decision.options.map((option) => option.type);

    expect(kinds).toEqual(['keepHand', 'mulligan']);
    expect(decision.complete).toBe(true);
  });

  it('asks the other seat once the first keeps, and starts turn 1 once both have', () => {
    const first = opening();
    const startingPlayer = first.state.config.startingPlayer;
    const second = keep(first);

    expect(mulliganDecision(second.state).player).not.toBe(startingPlayer);
    expect(second.state.turn.number).toBe(0);

    const playing = keep(second);
    expect(playing.state.turn.number).toBe(1);
    expect(playing.state.turn.active).toBe(startingPlayer);
    expect(asked(playing.state).kind).toBe('priority');
  });
});

describe('a mulligan is a shuffle and a full redraw', () => {
  it('puts the hand back, shuffles, and deals a full hand again', () => {
    const started = opening();
    const player = mulliganDecision(started.state).player;
    const before = handOf(started.state, player);

    const again = takeMulligan(started);
    const after = handOf(again.state, player);

    expect(after).toHaveLength(7);
    expect(again.state.players[player].library).toHaveLength(33);
    expect(again.state.players[player].mulligans).toBe(1);
    // The redraw is a real one: the hand is not the hand that went back.
    expect(after).not.toEqual(before);
    expect(eventsOfType(again.events, 'handMulliganed').map((event) => event.player)).toEqual([player]);
  });

  it('draws from the seeded generator, so the same seed redraws the same hand', () => {
    const one = takeMulligan(opening());
    const other = takeMulligan(opening());

    expect(stateFingerprint(one.state)).toBe(stateFingerprint(other.state));
    expect(serializeEvents(one.events)).toBe(serializeEvents(other.events));
  });

  it('hands the question to the other seat between rounds, in turn order', () => {
    const started = opening();
    const first = mulliganDecision(started.state).player;
    const afterOne = takeMulligan(started);

    expect(mulliganDecision(afterOne.state).player).not.toBe(first);

    const afterBoth = takeMulligan(afterOne);
    expect(mulliganDecision(afterBoth.state).player).toBe(first);
  });
});

describe('keeping after a mulligan bottoms one card per mulligan taken', () => {
  it('asks for exactly N cards and every way of choosing them', () => {
    const started = opening();
    const player = mulliganDecision(started.state).player;
    const once = until(takeMulligan(started), player);
    const decision = mulliganDecision(once.state);

    expect(decision.mulligans).toBe(1);
    expect(decision.count).toBe(1);
    // Seven single-card keeps and the option to go again.
    expect(decision.options.filter((option) => option.type === 'keepHand')).toHaveLength(7);
    expect(decision.options.filter((option) => option.type === 'mulligan')).toHaveLength(1);
  });

  it('puts the chosen card on the bottom of the library and leaves a six-card hand', () => {
    const started = opening();
    const once = until(takeMulligan(started), mulliganDecision(started.state).player);
    const decision = mulliganDecision(once.state);
    const bottomed = decision.hand[0];
    if (bottomed === undefined) throw new Error('an empty opening hand');

    const kept = apply(once, { type: 'keepHand', player: decision.player, bottom: [bottomed] });
    const seat = kept.state.players[decision.player];

    expect(seat.hand).toHaveLength(6);
    expect(seat.hand).not.toContain(bottomed);
    expect(seat.library.at(-1)).toBe(bottomed);
    expect(seat.keptHand).toBe(true);
    expect(eventsOfType(kept.events, 'handKept').at(-1)?.bottomed).toEqual([bottomed]);
  });

  it('refuses a keep that bottoms the wrong number of cards, or a card held elsewhere', () => {
    const started = opening();
    const once = until(takeMulligan(started), mulliganDecision(started.state).player);
    const decision = mulliganDecision(once.state);
    const player = decision.player;
    const theirs = decision.hand[0];
    const elsewhere = once.state.players[player].library[0];
    if (theirs === undefined || elsewhere === undefined) throw new Error('a deck ran out of cards');

    // Each refusal names its own fault. A keep that bottoms nothing is short of
    // the one card this seat owes, and since `mtg-cs8t` a short keep is the
    // shape a wide bottoming is answered in one card at a time — so the reason
    // is that it settles nothing, not that it is the wrong length. Two copies of
    // one card is caught as the duplicate it is before anything counts it.
    expect(validateAction(once.state, { type: 'keepHand', player, bottom: [] })).toContain(
      'at least one more card',
    );
    expect(validateAction(once.state, { type: 'keepHand', player, bottom: [theirs, theirs] })).toContain(
      'listed twice',
    );
    expect(
      validateAction(once.state, { type: 'keepHand', player, bottom: [theirs, ...decision.hand.slice(1)] }),
    ).toContain('exactly 1');
    expect(validateAction(once.state, { type: 'keepHand', player, bottom: [elsewhere] })).toContain(
      'not in your hand',
    );
    expect(validateAction(once.state, { type: 'keepHand', player, bottom: [theirs] })).toBeNull();
  });
});

describe('the question terminates', () => {
  it('stops offering a mulligan once the whole opening hand would be bottomed', () => {
    let current = opening();
    const player = mulliganDecision(current.state).player;
    // Seven mulligans by this seat; the other seat keeps as soon as it is asked.
    for (let round = 0; round < 7; round += 1) {
      current = takeMulligan(until(current, player));
    }
    current = until(current, player);

    const decision = mulliganDecision(current.state);
    expect(decision.mulligans).toBe(7);
    expect(decision.count).toBe(7);
    expect(decision.options.map((option) => option.type)).toEqual(['keepHand']);
    expect(validateAction(current.state, { type: 'mulligan', player })).not.toBeNull();
  });

  it('leaves a seat that mulliganed to zero with an empty hand and a full library', () => {
    let current = opening();
    const player = mulliganDecision(current.state).player;
    for (let round = 0; round < 7; round += 1) {
      current = takeMulligan(until(current, player));
    }
    current = keep(until(current, player));
    const seat = current.state.players[player];
    expect(seat.hand).toEqual([]);
    expect(seat.library).toHaveLength(40);
  });
});

describe('the opening hand is a decision like any other', () => {
  it('is never taken for the player, because keeping and mulliganing are both legal', () => {
    const decision = mulliganDecision(opening().state);
    expect(decision.options.length).toBeGreaterThan(1);
    expect(settledChoice(decision, DEFAULT_AUTO_PASS)).toBeNull();
  });

  it('rejects a mulligan answer from the seat that was not asked', () => {
    const started = opening();
    const decision = mulliganDecision(started.state);
    const other = decision.player === 0 ? 1 : 0;
    expect(validateAction(started.state, { type: 'mulligan', player: other })).toContain(
      `player ${String(decision.player)}`,
    );
  });

  it('rejects a mulligan once the game has moved on to turn 1', () => {
    const playing = keep(keep(opening()));
    const player = playing.state.turn.active;
    expect(validateAction(playing.state, { type: 'mulligan', player })).not.toBeNull();
  });
});
