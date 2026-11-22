/** Hostile executable contract for RTR Rakdos, Lord of Riots. */
import { isCastable, parseCard, type Card, type CastableCard } from '@mtg/dsl';
import {
  beginTrace,
  effectiveManaCost,
  legalActions,
  loseLife,
  moveObject,
  scenario,
  validateAction,
  type Action,
  type GameState,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { beginTurn } from '../src/turn';
import { creature, instant, lands, MOUNTAIN, SWAMP } from './cards';
import { handOidOf, oidOf } from './helpers';

const RAKDOS = parseCard({
  kind: 'creature',
  id: 'rtr-187-rakdos-lord-of-riots-kernel',
  name: 'Rakdos, Lord of Riots',
  rarity: 'mythic',
  set: { code: 'RTR', collectorNumber: 187 },
  manaCost: { B: 2, R: 2 },
  colors: ['B', 'R'],
  supertypes: ['legendary'],
  subtypes: ['Demon'],
  power: 6,
  toughness: 6,
  keywords: ['flying', 'trample'],
  opponentsLifeLostThisTurnCasting: true,
});

function castable(card: Card): CastableCard {
  if (!isCastable(card)) throw new Error(`${card.name} is not castable`);
  return card;
}

const EXPENSIVE_CREATURE = castable(creature('Costly Creature', 4, 4, { cost: { generic: 5, G: 1 } }));
const NONCREATURE = castable(
  instant('Costly Instant', [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }], {
    generic: 5,
    U: 1,
  }),
);

function manaLands(controller: 0 | 1) {
  return [
    ...lands(SWAMP, 2).map((card) => ({ card, controller })),
    ...lands(MOUNTAIN, 2).map((card) => ({ card, controller })),
  ];
}

function castRakdos(state: GameState): Extract<Action, { type: 'castSpell' }> {
  return {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(state, 0, RAKDOS.name),
    targets: [],
  };
}

function rakdosOffered(state: GameState): boolean {
  const oid = handOidOf(state, 0, RAKDOS.name);
  return legalActions(state).some(
    (action) => action.type === 'castSpell' && action.player === 0 && action.oid === oid,
  );
}

function reductionState(
  battlefield: readonly { readonly card: Card; readonly controller: 0 | 1 }[] = [],
): GameState {
  return scenario({
    battlefield: [{ card: RAKDOS, controller: 0 }, ...battlefield],
    hands: [[EXPENSIVE_CREATURE, NONCREATURE], [EXPENSIVE_CREATURE]],
  }).state;
}

describe('Rakdos casting permission', () => {
  it('is absent from enumeration and rejected before an opponent loses life', () => {
    const start = scenario({ battlefield: manaLands(0), hands: [[RAKDOS], []] });

    expect(rakdosOffered(start.state)).toBe(false);
    expect(validateAction(start.state, castRakdos(start.state))).toContain(
      'unless an opponent lost life this turn',
    );
  });

  it('appears immediately after opposing life loss and ignores its controller losing life', () => {
    const start = scenario({ battlefield: manaLands(0), hands: [[RAKDOS], []] });
    const ownLoss = loseLife(beginTrace(start.state), 0, 7);
    expect(rakdosOffered(ownLoss.state)).toBe(false);

    const opponentLoss = loseLife(ownLoss, 1, 1);
    expect(rakdosOffered(opponentLoss.state)).toBe(true);
    expect(validateAction(opponentLoss.state, castRakdos(opponentLoss.state))).toBeNull();
  });

  it('resets at the next turn boundary', () => {
    const start = scenario({ battlefield: manaLands(0), hands: [[RAKDOS], []] });
    const lost = loseLife(beginTrace(start.state), 1, 3);
    expect(rakdosOffered(lost.state)).toBe(true);

    const begun = beginTurn(lost, 0);
    expect(begun.state.turn.lifeLostThisTurn).toEqual([0, 0]);
    const next: GameState = {
      ...begun.state,
      turn: { ...begun.state.turn, step: 'precombatMain', priority: 0 },
    };
    expect(validateAction(next, castRakdos(next))).toContain('unless an opponent lost life this turn');
  });
});

describe('Rakdos dynamic creature-spell reduction', () => {
  it('uses total opposing life lost, preserves colored pips, and floors generic at zero', () => {
    const start = reductionState();
    const ownLoss = loseLife(beginTrace(start), 0, 9);
    expect(effectiveManaCost(ownLoss.state, 0, EXPENSIVE_CREATURE)).toMatchObject({
      generic: 5,
      G: 1,
    });

    const threeLost = loseLife(ownLoss, 1, 3);
    expect(effectiveManaCost(threeLost.state, 0, EXPENSIVE_CREATURE)).toMatchObject({
      generic: 2,
      G: 1,
    });

    const eightLost = loseLife(threeLost, 1, 5);
    expect(effectiveManaCost(eightLost.state, 0, EXPENSIVE_CREATURE)).toMatchObject({
      generic: 0,
      G: 1,
    });
  });

  it('reaches neither noncreatures nor the other player', () => {
    const lost = loseLife(beginTrace(reductionState()), 1, 4);

    expect(effectiveManaCost(lost.state, 0, NONCREATURE)).toStrictEqual(NONCREATURE.manaCost);
    expect(effectiveManaCost(lost.state, 1, EXPENSIVE_CREATURE)).toStrictEqual(EXPENSIVE_CREATURE.manaCost);
  });

  it('expires with its source and reads zero again after the turn changes', () => {
    const lost = loseLife(beginTrace(reductionState()), 1, 4);
    expect(effectiveManaCost(lost.state, 0, EXPENSIVE_CREATURE).generic).toBe(1);

    const departed = moveObject(lost, oidOf(lost.state, RAKDOS.name), 'graveyard');
    expect(departed.state.costModifiers).toEqual([]);
    expect(effectiveManaCost(departed.state, 0, EXPENSIVE_CREATURE)).toStrictEqual(
      EXPENSIVE_CREATURE.manaCost,
    );

    const fresh = beginTurn(lost, 0);
    expect(effectiveManaCost(fresh.state, 0, EXPENSIVE_CREATURE)).toStrictEqual(EXPENSIVE_CREATURE.manaCost);
  });
});
