/** Source-attested Forge parity for Captivating Vampire's cohort cost and layers. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const CAPTIVATING_VAMPIRE_INPUT = {
  kind: 'creature',
  id: 'm11-87',
  name: 'Captivating Vampire',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 87 },
  colors: ['B'],
  manaCost: { generic: 1, B: 2 },
  subtypes: ['Vampire'],
  power: 2,
  toughness: 2,
  abilities: [
    {
      kind: 'static',
      scope: 'otherCreaturesYouControl',
      subtype: 'Vampire',
      modification: { kind: 'statBonus', power: 1, toughness: 1 },
    },
    {
      kind: 'activated',
      cost: { mana: {}, tapMatching: { count: 5, filter: { subtypes: ['Vampire'] } } },
      effects: [
        { kind: 'gainControl', target: { kind: 'targetCreature' } },
        {
          kind: 'addSubtype',
          subtype: 'Vampire',
          target: { kind: 'thatCreature' },
        },
      ],
    },
  ],
} as const;

describe('Captivating Vampire Forge parity', () => {
  it('writes Forge master’s tapXType, GainControl, and permanent Animate chain', () => {
    const lines = mustTranspile(parseCard(CAPTIVATING_VAMPIRE_INPUT)).split('\n');
    const lord = lines.find((line) => line.startsWith('S:')) ?? '';
    const ability = lines.find((line) => line.startsWith('A:')) ?? '';
    const followName = /SubAbility\$ ([^ |]+)/.exec(ability)?.[1] ?? '';
    const animate = lines.find((line) => line.startsWith(`SVar:${followName}:`)) ?? '';

    expect(lord).toBe(
      'S:Mode$ Continuous | Affected$ Creature.Other+YouCtrl+Vampire | AddPower$ 1 | AddToughness$ 1 | Description$ Other Vampire creatures you control get +1/+1.',
    );
    expect(ability).toBe(
      `A:AB$ GainControl | Cost$ tapXType<5/Vampire> | ValidTgts$ Creature | SubAbility$ ${followName} | SpellDescription$ Gain control of target creature. It becomes a Vampire in addition to its other types.`,
    );
    expect(animate).toBe(
      `SVar:${followName}:DB$ Animate | Defined$ Targeted | Types$ Vampire | Duration$ Permanent`,
    );
  });
});
