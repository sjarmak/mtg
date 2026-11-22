/** Phantom General applies one live layer-7c anthem only to its controller's creature tokens. */
import { parseCard } from '@mtg/dsl';
import { beginTrace, moveObject, onlyObject, powerOf, scenario, toughnessOf } from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { artifact, creature } from './cards';
import { controlledBy, withContinuous } from './continuous-helpers';
import { oidOf } from './helpers';

const GENERAL = parseCard({
  kind: 'creature',
  id: 'rtr-16-phantom-general-kernel',
  name: 'Phantom General',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 16 },
  manaCost: { generic: 3, W: 1 },
  colors: ['W'],
  subtypes: ['Spirit', 'Soldier'],
  power: 2,
  toughness: 3,
  abilities: [
    {
      kind: 'static',
      scope: 'creaturesYouControl',
      filter: { token: true },
      modification: { kind: 'statBonus', power: 1, toughness: 1 },
    },
  ],
});
const SOLDIER = creature('Phantom Soldier', 2, 2);
const RELIC = artifact('Phantom Relic');

function board() {
  return scenario({
    battlefield: [
      { card: GENERAL, controller: 0 },
      { card: SOLDIER, controller: 0, token: true },
      { card: SOLDIER, controller: 0 },
      { card: SOLDIER, controller: 1, token: true },
      { card: RELIC, controller: 0, token: true },
    ],
  });
}

describe("Phantom General's live token-only anthem", () => {
  it('buffs only creature tokens controlled by the source controller', () => {
    const start = board();
    const ownToken = start.state.battlefield[1];
    const ownCard = start.state.battlefield[2];
    const opposingToken = start.state.battlefield[3];
    const tokenRelic = start.state.battlefield[4];
    if (
      ownToken === undefined ||
      ownCard === undefined ||
      opposingToken === undefined ||
      tokenRelic === undefined
    ) {
      throw new Error('Phantom General board is incomplete');
    }

    expect([powerOf(start.state, ownToken), toughnessOf(start.state, ownToken)]).toEqual([3, 3]);
    expect([powerOf(start.state, ownCard), toughnessOf(start.state, ownCard)]).toEqual([2, 2]);
    expect([powerOf(start.state, opposingToken), toughnessOf(start.state, opposingToken)]).toEqual([2, 2]);
    expect(powerOf(start.state, tokenRelic)).toBe(0);
  });

  it('follows live source control and ends when the source leaves', () => {
    const start = board();
    const general = oidOf(start.state, GENERAL.name);
    const ownToken = start.state.battlefield[1];
    const opposingToken = start.state.battlefield[3];
    if (ownToken === undefined || opposingToken === undefined) {
      throw new Error('Phantom General token board is incomplete');
    }

    const stolen = withContinuous(start.state, [controlledBy(onlyObject(general), 1)]);
    expect(powerOf(stolen, ownToken)).toBe(2);
    expect(powerOf(stolen, opposingToken)).toBe(3);

    const departed = moveObject(beginTrace(stolen), general, 'graveyard').state;
    expect(powerOf(departed, ownToken)).toBe(2);
    expect(powerOf(departed, opposingToken)).toBe(2);
  });
});
