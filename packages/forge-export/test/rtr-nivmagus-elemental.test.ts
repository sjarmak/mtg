/** Installed-Forge parity for RTR #219. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';
import { readInstalledForgeCardScript } from './installed-card-script';

const card = parseCard({
  kind: 'creature',
  id: 'rtr-219',
  name: 'Nivmagus Elemental',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 219 },
  colors: ['U', 'R'],
  manaCost: { hybrid: { 'U/R': 1 } },
  subtypes: ['Elemental'],
  power: 1,
  toughness: 2,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, exileControlledInstantOrSorcerySpell: true },
      effects: [
        {
          kind: 'putCounters',
          counter: 'plusOnePlusOne',
          count: 2,
          target: { kind: 'selfCreature' },
        },
      ],
    },
  ],
});

const installed = readInstalledForgeCardScript('nivmagus_elemental.txt');

describe.skipIf(installed === null)('RTR Nivmagus Elemental Forge parity', () => {
  it('matches the installed stack-exile cost and counter protocol exactly', () => {
    if (installed === null) throw new Error('Required installed Forge is absent');
    const emitted = mustTranspile(card);
    const structural = (text: string) =>
      text
        .split('\n')
        .filter((line) => line.startsWith('A:'))
        .map((line) => line.replace(/ \| SpellDescription\$ .*$/, ''));
    expect(structural(emitted)).toEqual(structural(installed));
  });
});
