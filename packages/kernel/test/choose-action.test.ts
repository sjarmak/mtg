/**
 * The constructed-action door, and the integer it still records.
 *
 * `chooseAction` exists so a surface that builds a move out of clicks does not
 * have to find that move's index in a cartesian product (`session.ts` carries
 * the reversal and its price). The property this file is really about is the
 * one that did *not* change: whatever door a game is played through,
 * `session.choices` is a list of integers and `replaySession` reproduces the
 * game from them. The last block asserts exactly that over a whole game.
 */
import { describe, expect, it } from 'vitest';
import type { Action, DeckList, GameSession, PlayerAgent } from '@mtg/kernel';
import {
  actionKey,
  botSeat,
  choose,
  chooseAction,
  createSession,
  humanSeat,
  indexOfAction,
  replaySession,
  sameAction,
  serializeEvents,
  simpleAgent,
  stateFingerprint,
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

const SETUP = {
  seed: 'choose-action/v0',
  decks: [redDeck('Human Red'), redDeck('Bot Red')] as const,
  maximumTurns: 40,
};

/**
 * A seed whose driven game reaches a declaration of more than one attacker,
 * which `SETUP`'s does not. The reorder assertion needs a real enumerated
 * option with two members in it to reverse.
 */
const COMBAT_SETUP = { ...SETUP, seed: 'choose-action/attackers' };

const seats = () => [humanSeat('human'), botSeat(simpleAgent('bot'))] as const;

function pending(session: GameSession): GameSession['pending'] & object {
  const decision = session.pending;
  if (decision === null) throw new Error('nothing is pending');
  return decision;
}

/**
 * The bot's own answer, handed to the human door as a value rather than as an
 * index. This is the shape a clicked declaration arrives in: a constructed
 * `Action` whose index nobody has looked up.
 */
function asBotWould(agent: PlayerAgent): (session: GameSession) => Action {
  return (session: GameSession): Action => {
    const decision = pending(session);
    return agent.decide({ state: session.state, player: decision.player, decision });
  };
}

describe('an accepted action', () => {
  it('applies the move and lands where the same index would have', () => {
    const session = createSession(SETUP, seats());
    const decision = pending(session);
    const wanted = decision.options[0] as Action;

    const byAction = chooseAction(session, wanted);
    const byIndex = choose(session, 0);

    expect(stateFingerprint(byAction.state)).toBe(stateFingerprint(byIndex.state));
    expect(serializeEvents(byAction.events)).toBe(serializeEvents(byIndex.events));
    expect(byAction.choices).toEqual(byIndex.choices);
  });

  it('records the index rather than the action, because a recording is integers', () => {
    const session = createSession(SETUP, seats());
    const decision = pending(session);
    const last = decision.options.length - 1;

    const applied = chooseAction(session, decision.options[last] as Action);

    expect(applied.choices[0]).toBe(last);
    expect(applied.choices.every((choice) => Number.isInteger(choice))).toBe(true);
  });

  it('matches a value the caller built rather than one taken out of the list', () => {
    // Constructed by hand, with the members in another order and no shared
    // identity with anything the kernel handed out.
    let session = createSession(SETUP, seats());
    while (pending(session).kind !== 'priority') session = choose(session, 0);
    const player = pending(session).player;

    const applied = chooseAction(session, { player, type: 'passPriority' });

    expect(applied.choices.length).toBe(session.choices.length + 1);
  });
});

describe('a refused action', () => {
  it('refuses an illegal move by name and applies nothing', () => {
    let session = createSession(SETUP, seats());
    while (pending(session).kind !== 'priority') session = choose(session, 0);
    const player = pending(session).player;

    expect(() => chooseAction(session, { type: 'playLand', player, oid: 'not-a-card' })).toThrow(
      /illegal action playLand by player 0: card is not in your hand/,
    );
  });

  it('refuses a move that belongs to a decision the kernel is not asking', () => {
    const session = createSession(SETUP, seats());
    expect(pending(session).kind).toBe('mulligan');

    expect(() => chooseAction(session, { type: 'declareAttackers', player: 0, attackers: [] })).toThrow(
      /attackers are not being declared/,
    );
  });

  it('refuses to answer for the other seat', () => {
    let session = createSession(SETUP, seats());
    while (pending(session).kind !== 'priority') session = choose(session, 0);

    expect(() => chooseAction(session, { type: 'passPriority', player: 1 })).toThrow(
      /it is player 0's decision/,
    );
  });

  it('leaves the session untouched when it refuses', () => {
    const session = createSession(SETUP, seats());
    const before = stateFingerprint(session.state);
    expect(() => chooseAction(session, { type: 'discard', player: 0, oids: [] })).toThrow();
    expect(stateFingerprint(session.state)).toBe(before);
    expect(session.choices).toEqual([]);
  });

  it('refuses when nothing is pending', () => {
    const botOnly = createSession(SETUP, [botSeat(simpleAgent('a')), botSeat(simpleAgent('b'))]);
    expect(() => chooseAction(botOnly, { type: 'passPriority', player: 0 })).toThrow(/after the game ended/);
  });

  /**
   * The one legal action the kernel never enumerates, kept as a test because it
   * is a real hole rather than a hypothetical one.
   *
   * `validateAction` returns `null` for a concession from any decision at any
   * time, and `priorityDecision` leaves it out of the options deliberately, so
   * an agent sampling uniformly cannot resign by accident. Both are right on
   * their own terms and together they mean a concession has no index, and a
   * move with no index has no recording. So this door refuses it and says which
   * fault it is: the enumeration ran to completion and this was not in it.
   *
   * A concede button on the play surface therefore needs the enumeration to
   * offer one, not a weakening here.
   */
  it('refuses a concession, because it is legal everywhere and enumerated nowhere', () => {
    const session = createSession(SETUP, seats());
    let thrown: unknown = null;
    try {
      chooseAction(session, { type: 'concede', player: 0 });
    } catch (cause: unknown) {
      thrown = cause;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).name).toBe('ActionNotEnumeratedError');
    expect((thrown as Error).message).toMatch(/legal but the "mulligan" enumeration does not contain it/);
    expect((thrown as { complete?: boolean }).complete).toBe(true);
  });
});

describe('two spellings of one move', () => {
  const attack = (attackers: readonly { oid: string; defender: 0 | 1 }[]): Action => ({
    type: 'declareAttackers',
    player: 0,
    attackers,
  });

  it('compares equal with the members in another order', () => {
    const forward = attack([
      { oid: 'o1', defender: 1 },
      { oid: 'o2', defender: 1 },
    ]);
    const reversed = attack([
      { oid: 'o2', defender: 1 },
      { oid: 'o1', defender: 1 },
    ]);
    expect(sameAction(forward, reversed)).toBe(true);
    expect(indexOfAction([attack([]), forward], reversed)).toBe(1);
  });

  it('compares equal with the object keys in another order', () => {
    const written = { type: 'playLand', player: 0, oid: 'o1' } as const;
    const rewritten = { oid: 'o1', player: 0, type: 'playLand' } as const;
    expect(actionKey(written)).toBe(actionKey(rewritten));
  });

  /**
   * A blocker order is CR 509.2's damage assignment order, so the inner list is
   * the whole content of the choice and reversing it is a different answer. The
   * outer list is one entry per multiply-blocked attacker and is looked up by
   * attacker, so its order carries nothing.
   */
  it('keeps a damage assignment order distinct while ignoring the order of attackers', () => {
    const order = (blockers: readonly string[]): Action => ({
      type: 'orderBlockers',
      player: 0,
      orders: [
        { attacker: 'a1', blockers },
        { attacker: 'a2', blockers: ['b9'] },
      ],
    });
    const flipped: Action = {
      type: 'orderBlockers',
      player: 0,
      orders: [
        { attacker: 'a2', blockers: ['b9'] },
        { attacker: 'a1', blockers: ['b1', 'b2'] },
      ],
    };
    expect(sameAction(order(['b1', 'b2']), flipped)).toBe(true);
    expect(sameAction(order(['b1', 'b2']), order(['b2', 'b1']))).toBe(false);
  });

  /**
   * A target list is parallel to an effect list, so slot 1 is the second
   * effect's target and two aimings of one spell are two moves.
   */
  it('keeps two aimings of one spell distinct', () => {
    const cast = (targets: readonly { kind: 'permanent'; oid: string }[]): Action => ({
      type: 'castSpell',
      player: 0,
      oid: 'spell',
      targets,
    });
    const first = cast([
      { kind: 'permanent', oid: 'x' },
      { kind: 'permanent', oid: 'y' },
    ]);
    const second = cast([
      { kind: 'permanent', oid: 'y' },
      { kind: 'permanent', oid: 'x' },
    ]);
    expect(sameAction(first, second)).toBe(false);
  });

  it('finds a reordered declaration in a real enumeration', () => {
    let session = createSession(COMBAT_SETUP, seats());
    const pick = asBotWould(simpleAgent('mirror'));
    let found = false;
    for (let step = 0; step < 2000 && session.pending !== null; step += 1) {
      const decision = session.pending;
      if (decision.kind === 'declareAttackers') {
        for (const option of decision.options) {
          if (option.type !== 'declareAttackers' || option.attackers.length < 2) continue;
          const reversed: Action = { ...option, attackers: [...option.attackers].reverse() };
          expect(indexOfAction(decision.options, reversed)).toBe(
            decision.options.findIndex((entry) => entry === option),
          );
          found = true;
        }
      }
      session = chooseAction(session, pick(session));
    }
    expect(found, 'the driven game reached a multi-attacker declaration').toBe(true);
  });
});

describe('determinism', () => {
  /**
   * The assertion the whole door rests on: a game played entirely through
   * constructed actions replays from its recorded integers, byte for byte.
   * `replaySession` spends those integers at full control through `choose`, so
   * a `chooseAction` that resolved to the wrong index — or recorded anything
   * other than an index — lands in a different position with the same list.
   */
  it('replays a game played through chooseAction from the integers it recorded', () => {
    let session = createSession(SETUP, seats());
    const pick = asBotWould(simpleAgent('mirror'));
    for (let step = 0; step < 10_000 && session.pending !== null; step += 1) {
      session = chooseAction(session, pick(session));
    }

    expect(session.result).not.toBeNull();
    expect(session.choices.length).toBeGreaterThan(50);

    const replayed = replaySession(SETUP, seats(), session.choices);

    expect(stateFingerprint(replayed.state)).toBe(stateFingerprint(session.state));
    expect(serializeEvents(replayed.events)).toBe(serializeEvents(session.events));
    expect(replayed.result).toEqual(session.result);
    expect(replayed.choices).toEqual(session.choices);
  });

  it('plays the identical game the same choices through choose would', () => {
    let byAction = createSession(SETUP, seats());
    const pick = asBotWould(simpleAgent('mirror'));
    for (let step = 0; step < 10_000 && byAction.pending !== null; step += 1) {
      byAction = chooseAction(byAction, pick(byAction));
    }

    let byIndex = createSession(SETUP, seats());
    for (const index of byAction.choices) {
      if (byIndex.pending === null) break;
      byIndex = choose(byIndex, index);
    }

    expect(serializeEvents(byIndex.events)).toBe(serializeEvents(byAction.events));
    expect(stateFingerprint(byIndex.state)).toBe(stateFingerprint(byAction.state));
  });
});
