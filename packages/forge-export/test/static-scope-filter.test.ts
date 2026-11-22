/** Forge's source-attested selector for Honor of the Pure. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';

describe('a filtered static scope in Forge', () => {
  it('writes the exact controlled-white-creature continuous selector', () => {
    const card = parseCard({
      kind: 'enchantment',
      id: 'm11-honor-of-the-pure',
      name: 'Honor of the Pure',
      rarity: 'rare',
      set: { code: 'M11', collectorNumber: 17 },
      colors: ['W'],
      manaCost: { generic: 1, W: 1 },
      abilities: [
        {
          kind: 'static',
          scope: 'creaturesYouControl',
          subtype: null,
          filter: { colors: ['W'] },
          modification: { kind: 'statBonus', power: 1, toughness: 1 },
        },
      ],
    });
    const result = transpileCard(card);
    if (!result.ok) throw new Error(JSON.stringify(result.rejections));

    expect(result.script.text).toContain(
      'S:Mode$ Continuous | Affected$ Creature.White+YouCtrl | AddPower$ 1 | AddToughness$ 1',
    );
  });
});
