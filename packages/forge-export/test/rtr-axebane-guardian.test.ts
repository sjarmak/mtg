/** Installed-Forge parity for RTR #115. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';
import { readInstalledForgeCardScript } from './installed-card-script';

const card = parseCard({
  kind: 'creature',
  id: 'rtr-115',
  name: 'Axebane Guardian',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 115 },
  colors: ['G'],
  manaCost: { generic: 2, G: 1 },
  subtypes: ['Human', 'Druid'],
  keywordAbilities: [{ kind: 'defender' }],
  power: 0,
  toughness: 3,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, tapSelf: true },
      effects: [
        {
          kind: 'addMana',
          produces: ['W', 'U', 'B', 'R', 'G'],
          amount: {
            kind: 'countMatching',
            filter: { cardTypes: ['creature'], keywordAbilities: ['defender'] },
          },
          distribution: 'anyCombinationOfColors',
        },
      ],
    },
  ],
});

const installed = readInstalledForgeCardScript('axebane_guardian.txt');

describe.skipIf(installed === null)('RTR Axebane Guardian Forge parity', () => {
  it('matches the installed mana API and count protocol exactly', () => {
    if (installed === null) throw new Error('Required installed Forge is absent');
    const emitted = mustTranspile(card);
    const structural = (text: string) =>
      text
        .split('\n')
        .filter((line) => line.startsWith('A:') || line.startsWith('SVar:'))
        .map((line) => line.replace(/ \| SpellDescription\$ .*$/, ''));
    expect(structural(emitted)).toEqual(structural(installed));
  });
});
