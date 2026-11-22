/** Native game-result permission proofs for M11 Platinum Angel. */
import { parseCard } from '@mtg/dsl';
import {
  beginTrace,
  canPlayerLoseGame,
  canPlayerWinGame,
  checkStateBasedActions,
  moveObject,
  onlyObject,
  scenario,
  stateFingerprint,
  type GameState,
  type PlayerId,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { abilities, controlledBy, copies, withContinuous } from './continuous-helpers';
import { creature } from './cards';
import { apply, oidOf } from './helpers';

const PLATINUM_ANGEL = parseCard({
  kind: 'creature',
  id: 'm11-212-platinum-angel-kernel',
  name: 'Platinum Angel',
  rarity: 'mythic',
  set: { code: 'M11', collectorNumber: 212 },
  colors: [],
  manaCost: { generic: 7 },
  artifact: true,
  power: 4,
  toughness: 4,
  subtypes: ['Angel'],
  keywords: ['flying'],
  abilities: [{ kind: 'staticGameRule', rule: 'controllerCantLoseAndOpponentsCantWin' }],
});

const COPY_BODY = creature('Platinum Copy Body', 1, 1);

function playerWith(
  state: GameState,
  player: PlayerId,
  changes: Partial<GameState['players'][number]>,
): GameState {
  return {
    ...state,
    players: [
      player === 0 ? { ...state.players[0], ...changes } : state.players[0],
      player === 1 ? { ...state.players[1], ...changes } : state.players[1],
    ],
  };
}

function check(state: GameState): ReduceResult {
  const result = checkStateBasedActions(beginTrace(state));
  return { state: result.state, events: result.events };
}

describe('Platinum Angel in the kernel', () => {
  it('prevents its controller from losing to zero life or an empty-library draw', () => {
    const start = scenario({ battlefield: [{ card: PLATINUM_ANGEL, controller: 0 }] });
    const doomed = playerWith(playerWith(start.state, 0, { life: 0 }), 0, {
      attemptedDrawFromEmptyLibrary: true,
    });
    const before = stateFingerprint(doomed);
    const protectedState = check(doomed);

    expect(canPlayerLoseGame(doomed, 0)).toBe(false);
    expect(canPlayerWinGame(doomed, 1)).toBe(false);
    expect(protectedState.state.result).toBeNull();
    expect(protectedState.events).toEqual([]);
    expect(stateFingerprint(protectedState.state)).toBe(before);
  });

  it('does not protect the opponent from an ordinary loss', () => {
    const start = scenario({ battlefield: [{ card: PLATINUM_ANGEL, controller: 0 }] });
    const done = check(playerWith(start.state, 1, { life: 0 }));

    expect(canPlayerLoseGame(start.state, 1)).toBe(true);
    expect(canPlayerWinGame(start.state, 0)).toBe(true);
    expect(done.state.result).toEqual({ winner: 0, loser: 1, reason: 'lifeZero', endedOnTurn: 2 });
  });

  it('filters simultaneous losses before deciding whether the game is a draw', () => {
    const oneAngel = scenario({ battlefield: [{ card: PLATINUM_ANGEL, controller: 0 }] });
    const oneProtected = check(playerWith(playerWith(oneAngel.state, 0, { life: 0 }), 1, { life: 0 }));
    expect(oneProtected.state.result).toEqual({
      winner: 0,
      loser: 1,
      reason: 'lifeZero',
      endedOnTurn: 2,
    });

    const twoAngels = scenario({
      battlefield: [
        { card: PLATINUM_ANGEL, controller: 0 },
        { card: PLATINUM_ANGEL, controller: 1 },
      ],
    });
    const neitherLoses = check(playerWith(playerWith(twoAngels.state, 0, { life: 0 }), 1, { life: 0 }));
    expect(neitherLoses.state.result).toBeNull();
  });

  it('recomputes the rule after control changes and the source leaves', () => {
    const start = scenario({ battlefield: [{ card: PLATINUM_ANGEL, controller: 0 }] });
    const angel = oidOf(start.state, PLATINUM_ANGEL.name);
    const stolen = withContinuous(start.state, [controlledBy(onlyObject(angel), 1)]);

    expect(canPlayerLoseGame(stolen, 0)).toBe(true);
    expect(canPlayerLoseGame(stolen, 1)).toBe(false);
    expect(canPlayerWinGame(stolen, 0)).toBe(false);
    expect(canPlayerWinGame(stolen, 1)).toBe(true);

    const gone = moveObject(beginTrace(start.state), angel, 'graveyard');
    expect(canPlayerLoseGame(gone.state, 0)).toBe(true);
    expect(check(playerWith(gone.state, 0, { life: 0 })).state.result?.loser).toBe(0);
  });

  it('copies the rule in layer 1 and removes it with all abilities in layer 6', () => {
    const start = scenario({
      battlefield: [
        { card: PLATINUM_ANGEL, controller: 0 },
        { card: COPY_BODY, controller: 1 },
      ],
    });
    const angel = oidOf(start.state, PLATINUM_ANGEL.name);
    const copy = oidOf(start.state, COPY_BODY.name);
    const copied = withContinuous(start.state, [copies(onlyObject(copy), angel)]);
    const stripped = withContinuous(start.state, [abilities(onlyObject(angel), { removeAll: true })]);

    expect(canPlayerLoseGame(copied, 1)).toBe(false);
    expect(canPlayerWinGame(copied, 0)).toBe(false);
    expect(canPlayerLoseGame(stripped, 0)).toBe(true);
    expect(canPlayerWinGame(stripped, 1)).toBe(true);
  });

  it('does not prevent its controller from conceding', () => {
    const start = scenario({ battlefield: [{ card: PLATINUM_ANGEL, controller: 0 }] });
    const done = apply(start, { type: 'concede', player: 0 });

    expect(done.state.result).toEqual({ winner: 1, loser: 0, reason: 'concede', endedOnTurn: 2 });
  });
});
