/** CR 107.3: X is chosen, paid, retained on the stack, and used at resolution. */
import { describe, expect, it } from 'vitest';
import type { Action, GameSession, GameSetup, ReduceResult, Seat } from '@mtg/kernel';
import {
  beginTrace,
  copySpellOnStack,
  choose,
  eventsOfType,
  createSession,
  humanSeat,
  legalActions,
  MAX_CHOSEN_X,
  reduce,
  replaySession,
  scenario,
  stateFingerprint,
} from '@mtg/kernel';
import { instant, lands, MOUNTAIN } from './cards';
import { apply, handOidOf } from './helpers';

const GEYSER = instant(
  'Variable Geyser',
  [{ kind: 'dealDamage', amount: { kind: 'chosenX' }, target: { kind: 'anyTarget' } }],
  { R: 2, hasX: true },
);
const FIXED = instant('Fixed Spark', [{ kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } }], {
  R: 1,
});

function board(card = GEYSER, mountains = 5): ReduceResult {
  return scenario({
    battlefield: lands(MOUNTAIN, mountains).map((land) => ({ card: land, controller: 0 as const })),
    hands: [[card], []],
  });
}

function casts(from: ReduceResult): readonly Extract<Action, { type: 'castSpell' }>[] {
  return legalActions(from.state).filter(
    (action): action is Extract<Action, { type: 'castSpell' }> => action.type === 'castSpell',
  );
}

function cast(from: ReduceResult, x: number): ReduceResult {
  const oid = handOidOf(from.state, 0, GEYSER.name);
  return apply(from, {
    type: 'castSpell',
    player: 0,
    oid,
    targets: [{ kind: 'player', player: 1 }],
    x,
  });
}

function resolve(from: ReduceResult): ReduceResult {
  let current = apply(from, { type: 'passPriority', player: 0 });
  current = apply(current, { type: 'passPriority', player: 1 });
  return current;
}

describe('X cast legality and payment', () => {
  it('enumerates X=0 through the largest payable value in deterministic order', () => {
    expect(
      casts(board())
        .filter((action) => action.targets[0]?.kind === 'player' && action.targets[0].player === 1)
        .map((action) => action.x),
    ).toEqual([0, 1, 2, 3]);
    expect(casts(board())).toHaveLength(8);
    expect(casts(board())).toEqual(casts(board()));
  });

  it('rejects missing, negative, fractional, over-cap, and unaffordable values', () => {
    const start = board(GEYSER, MAX_CHOSEN_X + 3);
    const oid = handOidOf(start.state, 0, GEYSER.name);
    const action = (x?: number): Action => ({
      type: 'castSpell',
      player: 0,
      oid,
      targets: [{ kind: 'player', player: 1 }],
      ...(x === undefined ? {} : { x }),
    });
    for (const invalid of [undefined, -1, 1.5, MAX_CHOSEN_X + 1]) {
      expect(() => reduce(start.state, action(invalid))).toThrow();
    }
    expect(() => reduce(board(GEYSER, 4).state, action(3))).toThrow();
  });

  it('rejects a chosen-X field on a fixed-cost spell', () => {
    const start = board(FIXED, 2);
    const oid = handOidOf(start.state, 0, FIXED.name);
    expect(() =>
      reduce(start.state, {
        type: 'castSpell',
        player: 0,
        oid,
        targets: [{ kind: 'player', player: 1 }],
        x: 0,
      }),
    ).toThrow(/this cost has no X to announce/);
  });

  it('materializes the paid cost and retains X in the cast event and stack state', () => {
    const current = cast(board(), 3);
    expect(eventsOfType(current.events, 'manaPaid').at(-1)?.cost).toEqual({
      generic: 3,
      W: 0,
      U: 0,
      B: 0,
      R: 2,
      G: 0,
      hasX: false,
    });
    expect(eventsOfType(current.events, 'spellCast').at(-1)?.chosenX).toBe(3);
    expect(current.state.stack.at(-1)?.x).toBe(3);
  });

  it('makes X=0 legal and propagates the chosen value to damage at resolution', () => {
    expect(resolve(cast(board(), 0)).state.players[1].life).toBe(20);
    expect(resolve(cast(board(), 3)).state.players[1].life).toBe(17);
  });
});

describe('copy and replay evidence', () => {
  it('copies the retained X and targets without paying again, then both copies resolve for X', () => {
    const original = cast(board(), 3);
    const oid = original.state.stack.at(-1)?.oid;
    if (oid === undefined) throw new Error('expected spell on stack');
    const copied = copySpellOnStack(beginTrace(original.state), oid);
    const originalEntry = original.state.stack.at(-1);
    const copiedEntry = copied.state.stack.at(-1);
    expect(original.state.stack).toHaveLength(1);
    expect(copied.state.stack[0]).toEqual(originalEntry);
    expect(copiedEntry?.oid).not.toBe(oid);
    expect(copiedEntry?.controller).toBe(originalEntry?.controller);
    expect(copiedEntry?.targets).toEqual(originalEntry?.targets);
    expect(copiedEntry?.copiedSpell).toMatchObject({
      copiedFrom: oid,
      sourceOid: oid,
      card: { id: GEYSER.id },
    });
    expect(copied.state.stack.map((entry) => entry.x)).toEqual([3, 3]);
    expect(eventsOfType(copied.events, 'spellCast')).toEqual([]);
    expect(eventsOfType(copied.events, 'manaPaid')).toEqual([]);
    expect(eventsOfType(copied.events, 'spellCopied').at(-1)?.chosenX).toBe(3);

    let current: ReduceResult = { state: copied.state, events: [...original.events, ...copied.events] };
    current = resolve(current);
    current = resolve(current);
    expect(current.state.players[1].life).toBe(14);
  });

  it('makes state fingerprints sensitive to the retained X choice', () => {
    expect(stateFingerprint(cast(board(), 0).state)).not.toBe(stateFingerprint(cast(board(), 1).state));
  });

  it('replays the chosen-X action, stack value, and event bytes from recorded indices', () => {
    const setup: GameSetup = {
      seed: 'x-mana/replay',
      decks: [
        {
          name: 'X spells',
          cards: [...Array.from({ length: 8 }, () => GEYSER), ...Array.from({ length: 32 }, () => MOUNTAIN)],
        },
        { name: 'Mountains', cards: Array.from({ length: 40 }, () => MOUNTAIN) },
      ],
    };
    const seats: readonly [Seat, Seat] = [humanSeat('A'), humanSeat('B')];
    let session: GameSession = createSession(setup, seats);
    for (let step = 0; step < 400; step += 1) {
      const decision = session.pending;
      if (decision === null) throw new Error('X replay rig stopped before the cast');
      let pick = 0;
      if (decision.kind === 'mulligan') {
        pick = decision.options.findIndex((action) => action.type === 'keepHand');
      } else if (decision.kind === 'priority') {
        const land = decision.options.findIndex((action) => action.type === 'playLand');
        const xCast = decision.options.findIndex(
          (action) =>
            action.type === 'castSpell' &&
            action.x === 2 &&
            action.targets[0]?.kind === 'player' &&
            action.targets[0].player === 1,
        );
        pick = land >= 0 ? land : xCast >= 0 ? xCast : 0;
      } else {
        pick = decision.options.findIndex((action) =>
          action.type === 'declareAttackers'
            ? action.attackers.length === 0
            : action.type === 'declareBlockers'
              ? action.blocks.length === 0
              : true,
        );
      }
      if (pick < 0) throw new Error(`X replay rig had no option for ${decision.kind}`);
      session = choose(session, pick);
      if (session.state.stack.at(-1)?.x === 2) break;
    }
    expect(session.state.stack.at(-1)?.x).toBe(2);
    const replayed = replaySession(setup, seats, session.choices);
    expect(stateFingerprint(replayed.state)).toBe(stateFingerprint(session.state));
    expect(replayed.events).toEqual(session.events);
  });
});
