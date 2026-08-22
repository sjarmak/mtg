import { describe, expect, it } from 'vitest';
import type { DeckList, GameSession, PlayerAgent } from '@mtg/kernel';
import {
  advance,
  botSeat,
  choose,
  createSession,
  humanSeat,
  humanSeats,
  playGame,
  replaySession,
  seatName,
  serializeEvents,
  simpleAgent,
  stateFingerprint,
} from '@mtg/kernel';
import type { Card } from '@mtg/dsl';
import { exampleCard } from '@mtg/dsl';
import { lands, MOUNTAIN } from './cards';

function sliceDeck(name: string): DeckList {
  const cards: Card[] = [
    ...lands(MOUNTAIN, 17),
    ...Array.from({ length: 8 }, () => exampleCard('slc-emberflow-raider')),
    ...Array.from({ length: 8 }, () => exampleCard('slc-lightning-lash')),
    ...Array.from({ length: 7 }, () => exampleCard('slc-ironclad-golem')),
  ];
  return { name, cards };
}

const SETUP = {
  seed: 'session/v0',
  decks: [sliceDeck('Human Red'), sliceDeck('Bot Red')] as const,
  maximumTurns: 40,
};

/** Picks the first enumerated option every time. A player who only ever passes. */
const first = (): number => 0;

/** Picks the last, which for a subset enumeration is the largest declaration. */
const last = (session: GameSession): number => (session.pending?.options.length ?? 1) - 1;

/**
 * Clicks whatever the given bot would have chosen.
 *
 * This is the strongest driver available in a test, and it earns its keep
 * twice. It plays a realistic game (the passive `first` player never casts a
 * creature, so it is never asked to attack, and would leave combat untested).
 * And finding the bot's action inside `options` at all is the assertion that
 * the enumerated list is complete enough for a person: if a bot could reach a
 * move a human cannot point at, the seam would be handicapping the human.
 */
function asBotWould(agent: PlayerAgent): (session: GameSession) => number {
  return (session: GameSession): number => {
    const decision = session.pending;
    if (decision === null) throw new Error('asBotWould: nothing is pending');
    const wanted = agent.decide({ state: session.state, player: decision.player, decision });
    const key = JSON.stringify(wanted);
    const index = decision.options.findIndex((option) => JSON.stringify(option) === key);
    if (index < 0) {
      throw new Error(
        `asBotWould: the bot chose a "${wanted.type}" action that is not among the ${decision.options.length} options enumerated for "${decision.kind}"`,
      );
    }
    return index;
  };
}

/**
 * Stands in for a person clicking. Loops rather than recursing so a long game
 * cannot blow the stack, and refuses to run forever so a stalled session fails
 * as a test rather than as a hang.
 */
function playAsHuman(session: GameSession, pick: (session: GameSession) => number): GameSession {
  let current = session;
  for (let guard = 0; guard < 10_000; guard += 1) {
    if (current.pending === null) return current;
    current = choose(current, pick(current));
  }
  throw new Error('playAsHuman: the session never stopped asking');
}

describe('a session with no human in it', () => {
  it('plays the identical game playOut would, because both end in the same reduce', () => {
    const seats = [botSeat(simpleAgent('red-a')), botSeat(simpleAgent('red-b'))] as const;
    const session = createSession(SETUP, seats);
    const direct = playGame(SETUP, [simpleAgent('red-a'), simpleAgent('red-b')]);

    expect(session.pending).toBeNull();
    expect(session.result).not.toBeNull();
    expect(stateFingerprint(session.state)).toBe(stateFingerprint(direct.state));
    expect(serializeEvents(session.events)).toBe(serializeEvents(direct.events));
    expect(session.decisions).toBe(direct.decisions);
  });

  it('reports no human seats', () => {
    const session = createSession(SETUP, [botSeat(simpleAgent('a')), botSeat(simpleAgent('b'))]);
    expect(humanSeats(session)).toEqual([]);
  });
});

describe('a human seat', () => {
  const seats = [humanSeat('the playtester'), botSeat(simpleAgent('greedy'))] as const;

  it('plays a full game against a bot and reaches a result', () => {
    const finished = playAsHuman(createSession(SETUP, seats), first);

    expect(finished.result).not.toBeNull();
    expect(finished.pending).toBeNull();
    // A real game rather than a two-click one, so the assertions above and the
    // determinism suite below are measuring something.
    expect(finished.choices.length).toBeGreaterThan(50);
    expect(finished.decisions).toBeGreaterThan(finished.choices.length);
  });

  it('is asked every kind of question a game contains, including combat', () => {
    let session = createSession(SETUP, seats);
    const pick = asBotWould(simpleAgent('mirror'));
    const kinds = new Set<string>();
    for (let step = 0; step < 2000 && session.pending !== null; step += 1) {
      kinds.add(session.pending.kind);
      session = choose(session, pick(session));
    }
    expect(kinds).toContain('priority');
    expect(kinds).toContain('declareAttackers');
    expect(kinds).toContain('declareBlockers');
    expect(session.result).not.toBeNull();
  });

  it('plays the identical game a bot seat would, given the identical choices', () => {
    // The claim the milestone rests on: a human is just another seat, and the
    // enforcement path does not know or care which kind it is serving. Driving
    // seat 0 by hand with a bot's own choices has to land on the same game as
    // letting the bot sit there.
    const byHand = playAsHuman(createSession(SETUP, seats), asBotWould(simpleAgent('mirror')));
    const byBot = playGame(SETUP, [simpleAgent('mirror'), simpleAgent('greedy')]);

    expect(stateFingerprint(byHand.state)).toBe(stateFingerprint(byBot.state));
    expect(serializeEvents(byHand.events)).toBe(serializeEvents(byBot.events));
    expect(byHand.decisions).toBe(byBot.decisions);
    expect(byHand.result).toEqual(byBot.result);
  });

  it('is only ever asked when it owes the decision', () => {
    let session = createSession(SETUP, seats);
    for (let step = 0; step < 40 && session.pending !== null; step += 1) {
      expect(session.pending.player).toBe(0);
      session = choose(session, 0);
    }
  });

  it('is named and located for the UI', () => {
    const session = createSession(SETUP, seats);
    expect(humanSeats(session)).toEqual([0]);
    expect(seatName(session.seats[0])).toBe('the playtester');
    expect(seatName(session.seats[1])).toBe('greedy');
  });
});

// Renamed from "illegal actions are unrepresentable rather than rejected" when
// `chooseAction` landed (`mtg-bz2`). The claim was about the whole seam and is
// now true only of this door: an index still cannot name an unenumerated move,
// while a constructed action is checked and refused. `choose-action.test.ts`
// holds the other door's refusals and `session.ts` carries the reversal.
describe('an index cannot name a move the kernel did not offer', () => {
  const seats = [humanSeat('human'), botSeat(simpleAgent('bot'))] as const;

  it('refuses an index past the end of the offered options', () => {
    const session = createSession(SETUP, seats);
    const count = session.pending?.options.length ?? 0;
    expect(() => choose(session, count)).toThrow(/outside the \d+ options offered/);
  });

  it('refuses a negative or fractional index', () => {
    const session = createSession(SETUP, seats);
    expect(() => choose(session, -1)).toThrow(/outside the/);
    expect(() => choose(session, 1.5)).toThrow(/outside the/);
  });

  it('refuses a choice when the game is not waiting on a human', () => {
    const botOnly = createSession(SETUP, [botSeat(simpleAgent('a')), botSeat(simpleAgent('b'))]);
    expect(() => choose(botOnly, 0)).toThrow(/after the game ended/);
  });

  it('refuses a choice once the game is over', () => {
    const finished = playAsHuman(createSession(SETUP, seats), first);
    expect(() => choose(finished, 0)).toThrow(/after the game ended/);
  });

  it('offers only options the kernel enumerated, so every choice is legal by construction', () => {
    let session = createSession(SETUP, seats);
    for (let step = 0; step < 25 && session.pending !== null; step += 1) {
      const decision = session.pending;
      expect(decision.options.length).toBeGreaterThan(0);
      for (const option of decision.options) {
        expect(option.player).toBe(decision.player);
      }
      session = choose(session, 0);
    }
  });
});

describe('determinism', () => {
  const seats = () => [humanSeat('human'), botSeat(simpleAgent('bot'))] as const;

  it('replays a recorded choice sequence into the identical game', () => {
    // Recorded off a real game with combat in it, not the passive one.
    const played = playAsHuman(createSession(SETUP, seats()), asBotWould(simpleAgent('mirror')));
    const replayed = replaySession(SETUP, seats(), played.choices);

    expect(played.choices.length).toBeGreaterThan(100);

    expect(replayed.choices).toEqual(played.choices);
    expect(stateFingerprint(replayed.state)).toBe(stateFingerprint(played.state));
    expect(serializeEvents(replayed.events)).toBe(serializeEvents(played.events));
    expect(replayed.decisions).toBe(played.decisions);
    expect(replayed.result).toEqual(played.result);
  });

  it('is not vacuous: different human choices produce a different game', () => {
    const firstGame = playAsHuman(createSession(SETUP, seats()), first);
    const lastGame = playAsHuman(createSession(SETUP, seats()), last);

    expect(lastGame.choices).not.toEqual(firstGame.choices);
    expect(stateFingerprint(lastGame.state)).not.toBe(stateFingerprint(firstGame.state));
  });

  it('resumes mid-game from a prefix of the recording', () => {
    const played = playAsHuman(createSession(SETUP, seats()), first);
    const prefix = played.choices.slice(0, 5);
    const resumed = replaySession(SETUP, seats(), prefix);

    expect(resumed.choices).toEqual(prefix);
    expect(resumed.result).toBeNull();
    expect(resumed.pending).not.toBeNull();

    const finished = playAsHuman(resumed, first);
    expect(stateFingerprint(finished.state)).toBe(stateFingerprint(played.state));
  });

  it('rejects a recording longer than the game it describes', () => {
    const played = playAsHuman(createSession(SETUP, seats()), first);
    const tooMany = [...played.choices, 0];
    expect(() => replaySession(SETUP, seats(), tooMany)).toThrow(/stopped asking after/);
  });
});

describe('safety valve', () => {
  it('fails rather than hanging when bots never finish the game', () => {
    const seats = [botSeat(simpleAgent('a')), botSeat(simpleAgent('b'))] as const;
    expect(() => createSession(SETUP, seats, { maxDecisions: 5 })).toThrow(/exceeded 5 decisions/);
  });

  it('advance is idempotent on a settled session', () => {
    const seats = [humanSeat('human'), botSeat(simpleAgent('bot'))] as const;
    const session = createSession(SETUP, seats);
    const again = advance(session);
    expect(stateFingerprint(again.state)).toBe(stateFingerprint(session.state));
    expect(again.decisions).toBe(session.decisions);
  });
});
