/**
 * Holding priority over your own spell (`mtg-bz2.4`).
 *
 * `priority-stack.test.ts` proves the rule at the reducer: a spell sits on the
 * stack, CR 117.3c gives the caster priority back, and only the second pass in
 * succession resolves anything. What is measured here is the same rule as a
 * *player* meets it — through `createSession` and `advance`, with auto-pass on —
 * because that is the layer where it can be lost. A stop set passes priorities
 * on the player's behalf, and the window right after your own cast is the one
 * window no arrangement of stops can name: it falls in whatever step you cast
 * in, and ticking that step asks about every other priority in it too.
 *
 * So `stackWantsAnAnswer` covers both stacks rather than only the opponent's,
 * and these are the tests of the half that is new. The shape of the claim is the
 * one the opposing half already keeps: it fires only where the player could
 * actually have answered, it never overrules a stop into silence, and every
 * priority it hands back becomes a recorded choice, so the recording still
 * replays byte for byte at full control.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { exampleCard } from '@mtg/dsl';
import type { AutoPassSettings, DeckList, GameSession, GameState, SessionOptions, Step } from '@mtg/kernel';
import {
  advance,
  botSeat,
  choose,
  createSession,
  DEFAULT_AUTO_PASS,
  eventsOfType,
  holdsOwnTopOfStack,
  humanSeat,
  passIndex,
  pendingDecision,
  playerOf,
  reduce,
  replaySession,
  scenario,
  serializeEvents,
  simpleAgent,
  stateFingerprint,
} from '@mtg/kernel';
import { instant, ISLAND, lands, MOUNTAIN } from './cards';

const bolt = instant('Test Bolt', [{ kind: 'dealDamage', amount: 3, target: { kind: 'anyTarget' } }], {
  generic: 1,
  R: 1,
});
const counter = instant('Test Counter', [{ kind: 'counterSpell' }], { generic: 1, U: 1 });

/** Every step unstopped, so only the answerable-stack rule can ask anything. */
const NOTHING_STOPS: AutoPassSettings = {
  enabled: true,
  passUnstopped: true,
  stops: { yourTurn: new Set<Step>(), theirTurn: new Set<Step>() },
};

/**
 * A session wrapped around a stated position, so `advance` can be asked about it.
 *
 * `scenario` builds a `GameState` by walking the real turn machinery, and
 * `advance` takes a session; this is the join. The event list starts empty
 * because what these tests read is what the settling adds, and both seats are
 * human because a bot seat answers everything and there would be no auto-pass
 * left to measure.
 */
function sessionAt(state: GameState): GameSession {
  return {
    seats: [humanSeat('You'), humanSeat('Them')],
    state,
    events: [],
    result: state.result,
    pending: null,
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

/**
 * The position after player 0 casts a bolt at player 1, priority still theirs.
 *
 * Four Mountains rather than two, so the caster still has mana open afterwards:
 * the rule under test is gated on the player having an answer, and a tapped-out
 * caster is the case where it correctly does nothing.
 */
function boltOnTheStack(ownHand: readonly Card[], opponentHand: readonly Card[]): GameState {
  const start = scenario({
    battlefield: [
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
      { card: ISLAND, controller: 1 },
      { card: ISLAND, controller: 1 },
    ],
    hands: [[bolt, ...ownHand], opponentHand],
  });
  const cast = reduce(start.state, {
    type: 'castSpell',
    player: 0,
    oid: playerOf(start.state, 0).hand[0] ?? '',
    targets: [{ kind: 'player', player: 1 }],
  });
  // CR 117.3c, and the premise of everything below: the caster keeps priority.
  expect(cast.state.turn.priority).toBe(0);
  return cast.state;
}

function passOnce(session: GameSession, options: SessionOptions): GameSession {
  const decision = session.pending;
  if (decision === null) throw new Error('passOnce: nothing is pending');
  const index = passIndex(decision);
  if (index === null) throw new Error('passOnce: the kernel enumerated no pass');
  return choose(session, index, options);
}

describe('a spell on the stack, through the session', () => {
  it('waits for both players to pass before it resolves', () => {
    const options: SessionOptions = { autoPass: DEFAULT_AUTO_PASS };
    // The opponent holds an answer, which is what makes their pass a real second
    // one rather than a seat the settings pass for. The caster holds none — they
    // are empty-handed after the cast — so under `mtg-hmy` the stop on their own
    // main phase no longer asks them to watch their own spell resolve, and their
    // window is passed for them and recorded as the choice it is.
    const opened = advance(sessionAt(boltOnTheStack([], [counter])), options);

    expect(opened.choices, "the caster's window was not passed for them").toHaveLength(1);
    expect(opened.pending?.player, 'priority did not cross the table').toBe(1);
    expect(opened.state.stack, 'the spell resolved on one pass').toHaveLength(1);
    expect(eventsOfType(opened.events, 'resolutionBegan')).toHaveLength(0);

    const bothPassed = passOnce(opened, options);
    expect(bothPassed.state.stack).toHaveLength(0);
    expect(eventsOfType(bothPassed.events, 'resolutionBegan')).toHaveLength(1);
    expect(bothPassed.state.players[1].life).toBe(17);
  });
});

describe('the window over your own spell', () => {
  it('is handed back at a step no stop names', () => {
    const state = boltOnTheStack([bolt], []);
    const decision = pendingDecision(state);
    if (decision === null) throw new Error('the fixture settled to a finished game');
    expect(holdsOwnTopOfStack(state, decision)).toBe(true);

    const settled = advance(sessionAt(state), { autoPass: NOTHING_STOPS });

    expect(settled.pending?.player, 'the caster was not asked back').toBe(0);
    expect(settled.state.stack, 'the spell resolved without a question').toHaveLength(1);
    expect(settled.choices, 'a priority was passed for the caster').toEqual([]);
    expect(eventsOfType(settled.events, 'resolutionBegan')).toHaveLength(0);
    // And the answer is really on offer: this is the second bolt, castable in
    // response to the first, which is the whole point of the window.
    expect(settled.pending?.options.some((option) => option.type === 'castSpell')).toBe(true);
  });

  it('does not fire when the caster has nothing to answer with', () => {
    // Tapped out and empty-handed after the cast, so the only offer is the pass.
    // A prompt here would be asking the player to watch, which is what a stop is
    // for and what the `canRespond` gate keeps this rule out of.
    const state = boltOnTheStack([], []);
    const settled = advance(sessionAt(state), { autoPass: NOTHING_STOPS });

    expect(settled.state.stack, 'the caster was asked and the spell waited').toHaveLength(0);
    expect(eventsOfType(settled.events, 'resolutionBegan')).toHaveLength(1);
  });

  it('is not asked about by a stop either, when the caster tapped out for it', () => {
    // `mtg-hmy`, and the case the playtester named: "when I tap out for a creature".
    // The rule above already declined to hand this window back, and the default
    // stop set handed it back anyway — `precombatMain` on your own turn is in
    // `DEFAULT_STOPS`, and until the stop was qualified by `canRespond` it asked
    // whatever the kernel had enumerated there. Two Mountains, both spent on the
    // spell, nothing in hand: the only offer is the pass.
    const start = scenario({
      battlefield: [
        { card: MOUNTAIN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[bolt], []],
    });
    const state = reduce(start.state, {
      type: 'castSpell',
      player: 0,
      oid: playerOf(start.state, 0).hand[0] ?? '',
      targets: [{ kind: 'player', player: 1 }],
    }).state;
    const decision = pendingDecision(state);
    if (decision === null) throw new Error('the fixture settled to a finished game');
    expect(holdsOwnTopOfStack(state, decision)).toBe(true);
    expect(decision.options.map((option) => option.type)).toEqual(['passPriority']);

    const settled = advance(sessionAt(state), { autoPass: DEFAULT_AUTO_PASS });

    expect(settled.state.stack, 'the caster was asked to let their own spell resolve').toHaveLength(0);
    expect(eventsOfType(settled.events, 'resolutionBegan')).toHaveLength(1);
  });

  it('is not the same window as the opponent answering it', () => {
    const state = boltOnTheStack([], [counter]);
    // The opponent answers, and their counterspell is now the top object.
    const answered = reduce(reduce(state, { type: 'passPriority', player: 0 }).state, {
      type: 'castSpell',
      player: 1,
      oid: playerOf(state, 1).hand[0] ?? '',
      targets: [{ kind: 'spell', oid: state.stack[0]?.oid ?? '' }],
    });
    const theirs = pendingDecision(answered.state);
    if (theirs === null) throw new Error('nobody was asked after the counterspell');
    expect(theirs.player, 'the counterspell did not retain priority').toBe(1);
    expect(holdsOwnTopOfStack(answered.state, theirs)).toBe(true);

    // From player 0's seat that same stack is topped by the other player's
    // object, so this rule says nothing and the opposing-stack half is what
    // hands them the window.
    const passedBack = reduce(answered.state, { type: 'passPriority', player: 1 });
    const ours = pendingDecision(passedBack.state);
    if (ours === null) throw new Error('priority never came back');
    expect(ours.player).toBe(0);
    expect(holdsOwnTopOfStack(passedBack.state, ours)).toBe(false);
  });

  it('has no opinion on an empty stack, or on a question that is not a priority', () => {
    const empty = scenario({ battlefield: [{ card: MOUNTAIN, controller: 0 }] });
    const decision = pendingDecision(empty.state);
    if (decision === null) throw new Error('the fixture settled to a finished game');
    expect(decision.kind).toBe('priority');
    expect(holdsOwnTopOfStack(empty.state, decision)).toBe(false);

    // A mulligan is the other half: the stack is empty and the question is not a
    // priority, so both clauses refuse it.
    const dealt = createSession(SETUP, seats(), {});
    const opening = dealt.pending;
    if (opening === null) throw new Error('the deal settled to a finished game');
    expect(opening.kind).toBe('mulligan');
    expect(holdsOwnTopOfStack(dealt.state, opening)).toBe(false);
  });
});

function redDeck(name: string): DeckList {
  const cards: Card[] = [
    ...lands(MOUNTAIN, 17),
    ...Array.from({ length: 8 }, () => exampleCard('slc-emberflow-raider')),
    ...Array.from({ length: 8 }, () => exampleCard('slc-lightning-lash')),
    ...Array.from({ length: 7 }, () => exampleCard('slc-ironclad-golem')),
  ];
  return { name, cards };
}

const SETUP = {
  seed: 'own-spell-priority/v0',
  decks: [redDeck('Human Red'), redDeck('Bot Red')] as const,
  maximumTurns: 40,
};

const seats = () => [humanSeat('the playtester'), botSeat(simpleAgent('greedy'))] as const;

/** Plays lands and casts whatever it can, so the stack is busy all game. */
function spendsEverything(session: GameSession): number {
  const decision = session.pending;
  if (decision === null) throw new Error('spendsEverything: nothing is pending');
  const land = decision.options.findIndex((option) => option.type === 'playLand');
  if (land >= 0) return land;
  const cast = decision.options.findIndex((option) => option.type === 'castSpell');
  return cast >= 0 ? cast : 0;
}

function playThrough(options: SessionOptions): GameSession {
  let session = createSession(SETUP, seats(), options);
  for (let guard = 0; guard < 400; guard += 1) {
    if (session.pending === null) break;
    session = choose(session, spendsEverything(session), options);
  }
  return session;
}

describe('a whole game under the rule', () => {
  /**
   * The determinism assertion. A rule that handed a window back without the
   * answer being recorded would land here and nowhere else: `replaySession`
   * drops the settings and spends the recorded integers at full control, so
   * agreement means every priority the rule produced was answered by a choice
   * the recording kept.
   */
  it('records a game that replays byte for byte at full control', () => {
    const played = playThrough({ autoPass: DEFAULT_AUTO_PASS });
    expect(played.choices.length, 'the fixture stopped asking immediately').toBeGreaterThan(20);

    const replayed = replaySession(SETUP, seats(), played.choices);
    expect(stateFingerprint(replayed.state)).toBe(stateFingerprint(played.state));
    expect(serializeEvents(replayed.events)).toEqual(serializeEvents(played.events));
  });

  it('leaves a full-control game exactly as it was', () => {
    // The rule only ever *removes* an auto-pass, and full control makes none, so
    // a game played with every priority asked about is untouched by it.
    const plain = playThrough({});
    expect(plain.choices.length).toBeGreaterThan(20);
    expect(plain.result).not.toBeNull();
  });
});
