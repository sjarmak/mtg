/** Whispersilk Cloak against Forge's current checked-in card script. */
import { parseCard, renderOracleText } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const CLOAK = parseCard({
  kind: 'artifact',
  id: 'm11-whispersilk-cloak',
  name: 'Whispersilk Cloak',
  rarity: 'uncommon',
  set: { code: 'M11', collectorNumber: 221 },
  manaCost: { generic: 3 },
  subtypes: ['Equipment'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 2 } },
      attach: {
        modifications: [{ kind: 'cantBeBlocked' }, { kind: 'grantKeyword', keyword: 'shroud' }],
      },
      effects: [],
    },
  ],
});

describe('Whispersilk Cloak in Forge', () => {
  it("splits its continuous grant from Forge's attached-attacker restriction", () => {
    const script = mustTranspile(CLOAK);
    expect(script).toContain('K:Equip:2');
    expect(script).toContain(
      "S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddKeyword$ Shroud | Description$ Equipped creature can't be blocked and has shroud.",
    );
    expect(script).toContain('S:Mode$ CantBlockBy | ValidAttacker$ Creature.EquippedBy');
    expect(script.match(/^S:.*Creature\.EquippedBy.*$/gm)).toHaveLength(2);
    expect(script).toContain(`Oracle:${renderOracleText(CLOAK).replace('\n', '\\n')}`);
  });
});
