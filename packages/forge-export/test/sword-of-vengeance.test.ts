/** Sword of Vengeance against Forge's current checked-in card script. */
import { describe, expect, it } from 'vitest';
import { parseCard, renderOracleText } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const SWORD = parseCard({
  kind: 'artifact',
  id: 'm11-sword-of-vengeance',
  name: 'Sword of Vengeance',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 216 },
  manaCost: { generic: 3 },
  subtypes: ['Equipment'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 3 } },
      attach: {
        modifications: [
          { kind: 'statBonus', power: 2, toughness: 0 },
          { kind: 'grantKeyword', keyword: 'firstStrike' },
          { kind: 'grantKeyword', keyword: 'vigilance' },
          { kind: 'grantKeyword', keyword: 'trample' },
          { kind: 'grantKeyword', keyword: 'haste' },
        ],
      },
      effects: [],
    },
  ],
});

describe('Sword of Vengeance in Forge', () => {
  it("writes one equip keyword and Forge's joined keyword grammar", () => {
    const script = mustTranspile(SWORD);
    expect(script).toContain('K:Equip:3');
    expect(script).toContain(
      'S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddPower$ 2 | ' +
        'AddKeyword$ First Strike & Vigilance & Trample & Haste | ' +
        'Description$ Equipped creature gets +2/+0 and has first strike, vigilance, trample, and haste.',
    );
    expect(script).not.toContain('AddToughness$ 0');
    expect(script.match(/^S:.*Creature\.EquippedBy.*$/gm)).toHaveLength(1);
    expect(script).toContain(`Oracle:${renderOracleText(SWORD).replace('\n', '\\n')}`);
  });
});
