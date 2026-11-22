/** Exact Forge parity for Stormtide Leviathan's global static abilities. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';

const STORMTIDE_LEVIATHAN = parseCard({
  kind: 'creature',
  id: 'm11-074-stormtide-leviathan-forge',
  name: 'Stormtide Leviathan',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 74 },
  colors: ['U'],
  manaCost: { generic: 5, U: 3 },
  power: 8,
  toughness: 8,
  subtypes: ['Leviathan'],
  keywordAbilities: [{ kind: 'landwalk', landType: 'Island' }],
  abilities: [
    {
      kind: 'static',
      scope: 'allLands',
      subtype: null,
      modification: { kind: 'addSubtype', subtype: 'Island' },
    },
    {
      kind: 'static',
      scope: 'allCreatures',
      subtype: null,
      modification: {
        kind: 'cantAttackWithoutAnyOf',
        anyOf: [
          { kind: 'keyword', keyword: 'flying' },
          { kind: 'landwalk', landType: 'Island' },
        ],
      },
    },
  ],
});

describe('Stormtide Leviathan Forge parity', () => {
  it('emits the exact shipped Forge master script', () => {
    const result = transpileCard(STORMTIDE_LEVIATHAN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const lines = result.script.text.split('\n');
    expect(lines).toContain('K:Landwalk:Island');
    expect(lines).toContain(
      'S:Mode$ Continuous | Affected$ Land | AddType$ Island | Description$ All lands are Islands in addition to their other types.',
    );
    expect(lines).toContain(
      "S:Mode$ CantAttack | ValidCard$ Creature.withoutFlying+!hasKeywordLandwalk:Island | Description$ Creatures without flying or islandwalk can't attack.",
    );
  });
});
