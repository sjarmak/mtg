/** Forge parity for a parameterized landwalk grant on a tribal lord. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const MASTER = parseCard({
  kind: 'creature',
  id: 'm13-master-of-the-pearl-trident',
  name: 'Master of the Pearl Trident',
  rarity: 'rare',
  set: { code: 'M13', collectorNumber: 59 },
  manaCost: { U: 2 },
  colors: ['U'],
  subtypes: ['Merfolk'],
  power: 2,
  toughness: 2,
  abilities: [
    {
      kind: 'static',
      scope: 'otherCreaturesYouControl',
      subtype: 'Merfolk',
      modification: { kind: 'statBonus', power: 1, toughness: 1 },
    },
    {
      kind: 'static',
      scope: 'otherCreaturesYouControl',
      subtype: 'Merfolk',
      modification: {
        kind: 'grantKeywordAbilities',
        grants: [{ kind: 'landwalk', landType: 'Island' }],
      },
    },
  ],
});

describe('Master of the Pearl Trident in Forge', () => {
  it('exports the exact other-Merfolk stat and Islandwalk layers', () => {
    const script = mustTranspile(MASTER);

    expect(script).toContain('Affected$ Creature.Other+YouCtrl+Merfolk | AddPower$ 1 | AddToughness$ 1');
    expect(script).toContain('Affected$ Creature.Other+YouCtrl+Merfolk | AddKeyword$ Landwalk:Island');
    expect(script).not.toContain('Affected$ Creature.YouCtrl+Merfolk | AddKeyword$');
    expect(script).not.toContain('AddKeyword$ Islandwalk');
  });
});
