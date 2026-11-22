/** Civic Saber's layer-5-to-layer-7c live color-count proof. */
import { isAttachingAbility, parseCard, type Card, type Color } from '@mtg/dsl';
import {
  attachTo,
  beginTrace,
  objectFilter,
  powerOf,
  scenario,
  toughnessOf,
  type ContinuousEffect,
  type GameState,
  type ObjectId,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature } from './cards';
import { oidOf } from './helpers';

const CIVIC_SABER = parseCard({
  kind: 'artifact',
  id: 'rtr-civic-saber',
  name: 'Civic Saber',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 227 },
  manaCost: { generic: 1 },
  subtypes: ['Equipment'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 1 } },
      attach: { modifications: [{ kind: 'statBonusPerColor', power: 1, toughness: 0 }] },
      effects: [],
    },
  ],
});

const COLORLESS = creature('Colorless Host', 2, 2);
const MONO = creature('Monocolored Host', 2, 2, { cost: { G: 1 } });
const MULTI: Card = parseCard({
  kind: 'creature',
  id: 'rtr-three-color-host',
  name: 'Three-Color Host',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 1 },
  manaCost: { W: 1, U: 1, B: 1 },
  colors: ['W', 'U', 'B'],
  power: 2,
  toughness: 2,
});

function ability() {
  const found = CIVIC_SABER.abilities.find(isAttachingAbility);
  if (found === undefined) throw new Error('Civic Saber lost Equip');
  return found;
}

function board(host: Card): { state: GameState; saber: ObjectId; host: ObjectId } {
  const state = scenario({
    battlefield: [
      { card: CIVIC_SABER, controller: 0 },
      { card: host, controller: 0 },
    ],
  }).state;
  return { state, saber: oidOf(state, CIVIC_SABER.name), host: oidOf(state, host.name) };
}

function recolor(state: GameState, host: ObjectId, colors: readonly Color[]): GameState {
  const timestamp = state.nextId;
  const effect: ContinuousEffect = {
    id: `continuous:${String(timestamp)}`,
    kind: 'colorChange',
    layer: '5',
    affects: objectFilter({ oids: [host] }),
    setColors: [...colors],
    addColors: [],
    duration: 'endOfTurn',
    timestamp,
    sourceOid: host,
    enabledWhile: null,
  };
  return { ...state, nextId: timestamp + 1, continuous: [...state.continuous, effect] };
}

describe('Civic Saber in the kernel', () => {
  it.each([
    [COLORLESS, 2],
    [MONO, 3],
    [MULTI, 5],
  ] as const)('gives %s exactly +1/+0 per live color', (card, expectedPower) => {
    const start = board(card);
    const attached = attachTo(beginTrace(start.state), start.saber, start.host, ability()).state;
    expect([powerOf(attached, start.host), toughnessOf(attached, start.host)]).toEqual([expectedPower, 2]);
  });

  it('re-reads color changes after attachment instead of freezing the original count', () => {
    const start = board(MONO);
    const attached = attachTo(beginTrace(start.state), start.saber, start.host, ability()).state;
    expect(powerOf(attached, start.host)).toBe(3);
    expect(powerOf(recolor(attached, start.host, ['W', 'U', 'B', 'R', 'G']), start.host)).toBe(7);
    expect(powerOf(recolor(attached, start.host, []), start.host)).toBe(2);
  });
});
