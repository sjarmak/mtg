/** Cryptborn Horror reads actual life loss from the current turn at entry. */
import { parseCard, type Card } from '@mtg/dsl';
import {
  applyDamage,
  beginTrace,
  counterCount,
  gainLife,
  getObject,
  loseLife,
  moveObject,
  scenario,
  type DamageInstance,
  type GameState,
  type ObjectId,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { beginTurn } from '../src/turn';
import { creature } from './cards';
import { handOidOf, oidOf } from './helpers';

const CRYPTBORN = parseCard({
  kind: 'creature',
  id: 'rtr-212-cryptborn-horror',
  name: 'Cryptborn Horror',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 212 },
  manaCost: { generic: 1, hybrid: { 'B/R': 2 } },
  colors: ['B', 'R'],
  subtypes: ['Horror'],
  power: 0,
  toughness: 0,
  keywords: ['trample'],
  entryReplacement: {
    kind: 'entersWithCounters',
    counter: 'plusOnePlusOne',
    count: { kind: 'opponentsLifeLostThisTurn' },
  },
});

const SOURCE = creature('Cryptborn Damage Source', 2, 2);
const CORPSEJACK = parseCard({
  kind: 'creature',
  id: 'rtr-152-corpsejack-menace-for-cryptborn',
  name: 'Corpsejack Menace',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 152 },
  manaCost: { generic: 2, B: 1, G: 1 },
  colors: ['B', 'G'],
  subtypes: ['Fungus'],
  power: 4,
  toughness: 4,
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: { kind: 'doublePlusOnePlusOneCountersOnCreaturesYouControl' },
    },
  ],
});

function opening(
  battlefield: readonly { readonly card: Card; readonly controller: 0 | 1 }[] = [],
): GameState {
  return scenario({
    battlefield: [{ card: SOURCE, controller: 1 }, ...battlefield],
    hands: [[CRYPTBORN], []],
  }).state;
}

function damage(state: GameState, player: 0 | 1, amount: number): DamageInstance {
  return {
    sourceOid: oidOf(state, SOURCE.name),
    controller: 1,
    recipient: { kind: 'player', player },
    amount,
    deathtouch: false,
    lifelink: false,
    combat: false,
    preventable: true,
  };
}

function enter(state: GameState): { readonly state: GameState; readonly oid: ObjectId } {
  const oid = handOidOf(state, 0, CRYPTBORN.name);
  return { state: moveObject(beginTrace(state), oid, 'battlefield').state, oid };
}

function counters(state: GameState, oid: ObjectId): number {
  return counterCount(getObject(state, oid).counters, 'plusOnePlusOne');
}

describe('Cryptborn Horror dynamic entry counters', () => {
  it('enters with zero when no opponent lost life this turn', () => {
    const arrived = enter(opening());

    expect(counters(arrived.state, arrived.oid)).toBe(0);
  });

  it('sums opponent damage and direct life loss without subtracting later life gain', () => {
    const start = opening();
    const directlyLost = loseLife(beginTrace(start), 1, 2);
    const damaged = applyDamage(directlyLost, [damage(directlyLost.state, 1, 3)]);
    const regained = gainLife(damaged, 1, 1, false);
    const arrived = enter(regained.state);

    expect(counters(arrived.state, arrived.oid)).toBe(5);
  });

  it("does not count its controller's life loss", () => {
    const start = opening();
    const ownLoss = loseLife(beginTrace(start), 0, 7);
    const opponentLoss = loseLife(ownLoss, 1, 1);
    const arrived = enter(opponentLoss.state);

    expect(counters(arrived.state, arrived.oid)).toBe(1);
  });

  it('forgets prior-turn life loss at the next turn boundary', () => {
    const start = opening();
    const lost = loseLife(beginTrace(start), 1, 4);
    const nextTurn = beginTurn(lost, 1);
    const arrived = enter(nextTurn.state);

    expect(counters(arrived.state, arrived.oid)).toBe(0);
  });

  it('composes the computed entry count with a live Corpsejack replacement', () => {
    const start = opening([{ card: CORPSEJACK, controller: 0 }]);
    const lost = loseLife(beginTrace(start), 1, 3);
    const arrived = enter(lost.state);

    expect(counters(arrived.state, arrived.oid)).toBe(6);
  });
});
