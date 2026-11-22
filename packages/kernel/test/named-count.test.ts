/**
 * Relentless Rats' layer-7c count: every other current name on both sides of
 * the battlefield qualifies. The copy-effect case distinguishes a live
 * characteristic read from comparing the printed card records directly.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { powerOf, scenario } from '@mtg/kernel';
import { copies, onlyObject, withContinuous } from './continuous-helpers';
import { creature } from './cards';
import { oidOf, oidsOf } from './helpers';

const RATS = {
  id: 'm11-relentless-rats',
  name: 'Relentless Rats',
  rarity: 'uncommon',
  set: { code: 'M11', collectorNumber: 113 },
  colors: ['B'],
  supertypes: [],
  subtypes: ['Rat'],
  keywords: [],
  effects: [],
  modes: undefined,
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: {
        kind: 'statBonusPer',
        power: 1,
        toughness: 1,
        each: {
          kind: 'countMatching',
          filter: { cardTypes: ['creature'], names: ['Relentless Rats'] },
          whose: 'each',
          excludeSource: true,
        },
      },
    },
  ],
  costReduction: null,
  deckConstruction: { kind: 'anyNumberOfThisCard' },
  kind: 'creature',
  manaCost: { generic: 1, W: 0, U: 0, B: 2, R: 0, G: 0, C: 0, hasX: false },
  artifact: false,
  power: 2,
  toughness: 2,
} as unknown as Card;

const DECOY = creature('Rat Decoy', 2, 2, { subtypes: ['Rat'] });

function board() {
  return scenario({
    seed: 'named-count/relentless-rats',
    battlefield: [
      { card: RATS, controller: 0 },
      { card: RATS, controller: 1 },
      { card: DECOY, controller: 0 },
    ],
  }).state;
}

describe('a live count by current name', () => {
  it('counts the other copy across the table and excludes its own source', () => {
    const state = board();
    const rats = oidsOf(state, 'Relentless Rats');

    expect(rats).toHaveLength(2);
    for (const oid of rats) expect(powerOf(state, oid)).toBe(3);
  });

  it('starts counting a differently printed creature after layer 1 copies the name', () => {
    const state = board();
    const source = oidsOf(state, 'Relentless Rats')[0];
    if (source === undefined) throw new Error('no Relentless Rats source');
    const copied = withContinuous(state, [copies(onlyObject(oidOf(state, 'Rat Decoy')), source)]);

    for (const oid of oidsOf(copied, 'Relentless Rats')) expect(powerOf(copied, oid)).toBe(4);
  });
});
