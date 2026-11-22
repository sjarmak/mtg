/** Harbor Serpent's attack restriction over both sides of the battlefield. */
import { describe, expect, it } from 'vitest';
import { basicLand, parseCard } from '@mtg/dsl';
import { eligibleAttackers, scenario } from '@mtg/kernel';
import { creature } from './cards';
import { oidOf } from './helpers';

const HARBOR_SERPENT = parseCard({
  kind: 'creature',
  id: 'tst-harbor-serpent',
  name: 'Harbor Serpent',
  rarity: 'common',
  set: { code: 'M11', collectorNumber: 56 },
  colors: ['U'],
  manaCost: { generic: 4, U: 2 },
  power: 5,
  toughness: 5,
  subtypes: ['Serpent'],
  keywordAbilities: [{ kind: 'landwalk', landType: 'Island' }],
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      enabledWhile: {
        kind: 'battlefieldCountBelow',
        filter: { subtypes: ['Island'] },
        fewerThan: 5,
      },
      modification: { kind: 'cantAttack' },
    },
  ],
});

const ESCORT = creature('Harbor Escort', 1, 1);

function board(islands: readonly [number, number]) {
  return scenario({
    battlefield: [
      { card: HARBOR_SERPENT, controller: 0 },
      { card: ESCORT, controller: 0 },
      ...Array.from({ length: islands[0] }, (_unused, index) => ({
        card: basicLand('Island', 'TST', 100 + index),
        controller: 0 as const,
      })),
      ...Array.from({ length: islands[1] }, (_unused, index) => ({
        card: basicLand('Island', 'TST', 200 + index),
        controller: 1 as const,
      })),
    ],
  }).state;
}

describe('Harbor Serpent', () => {
  it('is excluded below five Islands while another creature remains eligible', () => {
    const state = board([2, 2]);
    expect(eligibleAttackers(state)).not.toContain(oidOf(state, HARBOR_SERPENT.name));
    expect(eligibleAttackers(state)).toContain(oidOf(state, ESCORT.name));
  });

  it('can attack at five Islands counted across both players', () => {
    const state = board([2, 3]);
    expect(eligibleAttackers(state)).toContain(oidOf(state, HARBOR_SERPENT.name));
  });
});
