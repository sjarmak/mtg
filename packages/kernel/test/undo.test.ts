/**
 * Where undo stops, checked against a real game rather than against intuition.
 *
 * Three claims, and they are the three the feature is worth having for. Undo to
 * a boundary lands on a byte-identical position, which is what makes it a rewind
 * rather than a second way to reach a similar state. Undo past a boundary is
 * refused and says which event closed it. And in a game with two people at one
 * screen the refusal protects the seat that is not asking, which is the case
 * intuition gets wrong: the player pressing the button is not the only player
 * whose knowledge the rewind would have to un-teach.
 *
 * `packages/kernel/src/undo.ts` carries the argument for the set itself.
 */
import { describe, expect, it } from 'vitest';
import type { Action, DeckList, GameEvent, GameSession, GameSetup, PlayerId, Seat } from '@mtg/kernel';
import {
  botSeat,
  canUndo,
  choose,
  commitPoint,
  commits,
  createSession,
  humanSeat,
  passIndex,
  replaySession,
  serializeEvents,
  simpleAgent,
  stateFingerprint,
  undo,
  UndoRefusedError,
  undoTo,
} from '@mtg/kernel';
import type { Card } from '@mtg/dsl';
import { exampleCard } from '@mtg/dsl';
import { lands, MOUNTAIN } from './cards';

function redDeck(name: string): DeckList {
  const cards: Card[] = [
    ...lands(MOUNTAIN, 17),
    ...Array.from({ length: 8 }, () => exampleCard('slc-emberflow-raider')),
    ...Array.from({ length: 8 }, () => exampleCard('slc-lightning-lash')),
    ...Array.from({ length: 7 }, () => exampleCard('slc-ironclad-golem')),
  ];
  return { name, cards };
}

const SETUP: GameSetup = {
  seed: 'undo/v0',
  decks: [redDeck('One'), redDeck('Two')],
  maximumTurns: 40,
};

const soloSeats = (): readonly [Seat, Seat] => [humanSeat('you'), botSeat(simpleAgent('bot'))];
const hotseatSeats = (): readonly [Seat, Seat] => [humanSeat('One'), humanSeat('Two')];

/**
 * A driver that acts rather than passes, because a game of nothing but passes
 * has no undoable decision in it at all. That is not a defect of the driver: a
 * pass is a boundary, so the only positions undo is ever available from are the
 * ones a player reached by doing something and not yet handing the game over.
 *
 * Mana abilities are left out of the preference on purpose. They are legal at
 * every priority once a land is untapped, so preferring one is a loop rather
 * than a game.
 */
const PREFERRED = ['playLand', 'castSpell'] as const;

function nextChoice(decision: NonNullable<GameSession['pending']>): number {
  if (decision.kind === 'mulligan') {
    const keep = decision.options.findIndex((option: Action) => option.type === 'keepHand');
    return keep < 0 ? 0 : keep;
  }
  if (decision.kind !== 'priority') return decision.options.length - 1;
  for (const type of PREFERRED) {
    const found = decision.options.findIndex((option: Action) => option.type === type);
    if (found >= 0) return found;
  }
  return passIndex(decision) ?? 0;
}

/** The floor a session's own commitment sets, with no commitment meaning zero. */
function floorOf(session: GameSession): number {
  return session.committed?.floor ?? 0;
}

describe('the commit boundary', () => {
  const pass: GameEvent = { type: 'priorityPassed', player: 0 };
  const drawn: GameEvent = { type: 'cardDrawn', player: 1, oid: 'o1' };
  const shuffled: GameEvent = { type: 'libraryShuffled', player: 0, cards: 53 };
  const milled: GameEvent = { type: 'cardsMilled', player: 1, oids: ['o2'] };
  const discarded: GameEvent = { type: 'cardsDiscarded', player: 0, oids: ['o3'] };
  const scried: GameEvent = { type: 'cardsScried', player: 1, count: 2, bottom: 1 };
  const kept: GameEvent = { type: 'handKept', player: 0, mulligans: 0, bottomed: [] };

  const uncommitted: readonly GameEvent[] = [
    { type: 'landPlayed', player: 0, oid: 'o4' },
    { type: 'permanentTapped', oid: 'o5' },
    { type: 'manaProduced', player: 0, sourceOid: 'o5', color: 'R', amount: 1 },
    { type: 'spellCast', player: 0, oid: 'o6', targets: [], chosenX: null },
    { type: 'attackersDeclared', player: 0, attacks: [] },
  ];

  it('names each of the seven events that close it', () => {
    const boundaries: readonly GameEvent[] = [pass, drawn, shuffled, milled, discarded, scried, kept];
    for (const event of boundaries) {
      const reason = commitPoint([event]);
      expect(reason, `${event.type} is a boundary`).not.toBeNull();
      expect(reason?.event).toBe(event.type);
      expect(reason?.why.length).toBeGreaterThan(0);
    }
  });

  it('lets a declaration, a land, a tap and a cast through', () => {
    expect(commits(uncommitted)).toBe(false);
    expect(commitPoint(uncommitted)).toBeNull();
  });

  it('reports the first boundary in a slice, not the last', () => {
    expect(commitPoint([...uncommitted, pass, drawn])?.event).toBe('priorityPassed');
    expect(commitPoint([...uncommitted, drawn, pass])?.event).toBe('cardDrawn');
  });

  it('carries the player the event belongs to', () => {
    expect(commitPoint([drawn])?.player).toBe(1);
    expect(commitPoint([pass])?.player).toBe(0);
  });

  it('is empty on an empty slice, so a decision that changed nothing commits nothing', () => {
    expect(commits([])).toBe(false);
  });
});

describe('a session that records where it committed', () => {
  it('has committed nothing before the first decision', () => {
    const session = createSession(SETUP, soloSeats());
    expect(session.committed).toBeNull();
    expect(canUndo(session)).toBe(false);
  });

  it('commits the mulligan on the shuffle it deals from', () => {
    const opening = createSession(SETUP, soloSeats());
    const mulligan = opening.pending?.options.findIndex((option) => option.type === 'mulligan') ?? -1;
    expect(mulligan).toBeGreaterThanOrEqual(0);

    const after = choose(opening, mulligan);
    expect(after.committed?.reason.event).toBe('libraryShuffled');
    expect(after.committed?.floor).toBe(1);
  });

  it('commits a kept hand on the keep itself', () => {
    const opening = createSession(SETUP, soloSeats());
    const keep = opening.pending?.options.findIndex((option) => option.type === 'keepHand') ?? -1;
    expect(keep).toBeGreaterThanOrEqual(0);

    const after = choose(opening, keep);
    expect(after.committed?.reason.event).toBe('handKept');
  });

  it('replays to the same commitment it recorded', () => {
    let session = createSession(SETUP, soloSeats());
    for (let step = 0; step < 60 && session.pending !== null; step += 1) {
      session = choose(session, nextChoice(session.pending));
    }
    const replayed = replaySession(SETUP, soloSeats(), session.choices);
    expect(replayed.committed).toEqual(session.committed);
  });
});

/**
 * The position `undo` is reachable from: a decision was taken, and no boundary
 * has closed behind it. Returns the session as it stood before that decision
 * alongside the session after it, because the byte-identity claim is an
 * assertion about the pair.
 */
function firstUndoablePosition(): { readonly before: GameSession; readonly after: GameSession } {
  let session = createSession(SETUP, soloSeats());
  for (let step = 0; step < 400 && session.pending !== null; step += 1) {
    const before = session;
    session = choose(session, nextChoice(session.pending));
    if (canUndo(session)) return { before, after: session };
  }
  throw new Error('the driven game never reached a position undo was available from');
}

describe('undo to a boundary', () => {
  it('lands on a byte-identical position', () => {
    const { before, after } = firstUndoablePosition();
    expect(after.choices.length).toBeGreaterThan(before.choices.length);

    const undone = undo(SETUP, after);

    expect(stateFingerprint(undone.state)).toBe(stateFingerprint(before.state));
    expect(serializeEvents(undone.events)).toBe(serializeEvents(before.events));
    expect(undone.choices).toEqual(before.choices);
    expect(undone.committed).toEqual(before.committed);
  });

  it('takes back every uncommitted decision at once rather than one of them', () => {
    const { before, after } = firstUndoablePosition();
    expect(floorOf(after)).toBe(before.choices.length);
    expect(undo(SETUP, after).choices.length).toBe(floorOf(after));
  });

  it('leaves the same session a second undo would have nothing to take back from', () => {
    const { after } = firstUndoablePosition();
    const undone = undo(SETUP, after);
    expect(canUndo(undone)).toBe(false);
    expect(() => undo(SETUP, undone)).toThrow(UndoRefusedError);
  });
});

describe('undo past a boundary', () => {
  it('is refused with the event that closed it', () => {
    const { after } = firstUndoablePosition();
    const floor = floorOf(after);
    expect(floor).toBeGreaterThan(0);

    let refusal: UndoRefusedError | null = null;
    try {
      undoTo(SETUP, after, floor - 1);
    } catch (cause: unknown) {
      refusal = cause instanceof UndoRefusedError ? cause : null;
    }

    expect(refusal).not.toBeNull();
    expect(refusal?.floor).toBe(floor);
    expect(refusal?.requested).toBe(floor - 1);
    expect(refusal?.reason?.event).toBe(after.committed?.reason.event);
    expect(refusal?.message).toContain(after.committed?.reason.why ?? 'nothing');
  });

  it('is refused rather than silently clamped, at every prefix under the floor', () => {
    const { after } = firstUndoablePosition();
    for (let keep = 0; keep < floorOf(after); keep += 1) {
      expect(() => undoTo(SETUP, after, keep)).toThrow(UndoRefusedError);
    }
  });

  it('says there is nothing to take back when the last decision was a pass', () => {
    let session = createSession(SETUP, soloSeats());
    session = choose(session, nextChoice(session.pending as NonNullable<GameSession['pending']>));
    while (session.pending !== null && session.committed?.reason.event !== 'priorityPassed') {
      session = choose(session, passIndex(session.pending) ?? 0);
    }
    expect(session.committed?.reason.event).toBe('priorityPassed');
    expect(canUndo(session)).toBe(false);
    expect(() => undo(SETUP, session)).toThrow(/nothing is left to take back/);
  });

  it('refuses before a decision has been taken at all', () => {
    const opening = createSession(SETUP, soloSeats());
    expect(() => undo(SETUP, opening)).toThrow(/no decision has been taken yet/);
  });

  it('rejects a prefix outside the recording as a caller bug rather than a refusal', () => {
    const { after } = firstUndoablePosition();
    expect(() => undoTo(SETUP, after, after.choices.length + 1)).toThrow(/outside/);
    expect(() => undoTo(SETUP, after, -1)).toThrow(/outside/);
  });
});

/**
 * Two people at one screen, which is the case the boundary set exists for.
 *
 * The board is drawn from the seat that owes the decision (`@mtg/ui`'s
 * `use-session.ts` carries why), so the moment the question crosses the table
 * the other player has seen their own hand. A rewind that crossed back would be
 * asking them to un-see it, and ADR-0001 §133 names that failure by name:
 * "irreversibly corrupting hidden information (draw then undo)".
 */
describe('two people at one screen', () => {
  /** Drives a hotseat game and hands back every position it stopped at. */
  function hotseatPositions(steps: number): readonly GameSession[] {
    const walked: GameSession[] = [];
    let session = createSession(SETUP, hotseatSeats());
    for (let step = 0; step < steps && session.pending !== null; step += 1) {
      walked.push(session);
      session = choose(session, nextChoice(session.pending));
    }
    walked.push(session);
    return walked;
  }

  it('never hands the device back across the table', () => {
    const walked = hotseatPositions(120);
    let checked = 0;
    for (const session of walked) {
      if (!canUndo(session)) continue;
      expect(undo(SETUP, session).pending?.player).toBe(session.pending?.player);
      checked += 1;
    }
    expect(checked, 'the driven hotseat game reached a position undo was available from').toBeGreaterThan(0);
  });

  it('refuses the rewind that would take back the other seat drawing a card', () => {
    const walked = hotseatPositions(120);
    // The first position seat 1 was asked at after drawing for the turn. Seat 0
    // is the one that would be pressing undo, and the draw is not theirs.
    const drawn = walked.findIndex(
      (session, index) =>
        index > 0 &&
        session.pending?.player === 1 &&
        session.events
          .slice((walked[index - 1] as GameSession).events.length)
          .some((event) => event.type === 'cardDrawn' && event.player === 1),
    );
    expect(drawn, 'the driven hotseat game reached seat 1 drawing a card').toBeGreaterThan(0);

    const reached = walked[drawn] as GameSession;
    const previous = walked[drawn - 1] as GameSession;
    expect(previous.pending?.player).toBe(0);

    // Every prefix at or before the position seat 0 last held is refused, so no
    // press of undo from seat 1's screen can reach back to seat 0's turn.
    for (let keep = 0; keep <= previous.choices.length; keep += 1) {
      expect(() => undoTo(SETUP, reached, keep)).toThrow(UndoRefusedError);
    }
  });

  it('protects the other seat by the same floor whichever seat is asking', () => {
    const walked = hotseatPositions(120);
    for (const session of walked) {
      const seat: PlayerId | undefined = session.pending?.player;
      if (seat === undefined) continue;
      // The floor is a fact about the log, not about who is looking at it.
      // Nothing in `undoTo` takes a player, which is what makes that true.
      expect(floorOf(session)).toBe(floorOf(replaySession(SETUP, hotseatSeats(), session.choices)));
    }
  });
});
