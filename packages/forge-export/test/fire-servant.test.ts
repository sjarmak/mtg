/** Forge parity for Fire Servant's filtered damage replacement. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';

const CARD = parseCard({
  kind: 'creature',
  id: 'tst-fire-servant',
  name: 'Fire Servant',
  rarity: 'uncommon',
  set: { code: 'M11', collectorNumber: 137 },
  colors: ['R'],
  manaCost: { generic: 3, R: 2 },
  power: 4,
  toughness: 3,
  subtypes: ['Elemental'],
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: {
        kind: 'doubleDamage',
        sourceFilter: { controller: 'you', cardTypes: ['instant', 'sorcery'], colors: ['R'] },
      },
    },
  ],
});

describe('Fire Servant Forge parity', () => {
  it('uses Forge master 0c9f64a replacement grammar with the red qualifier its Fire Servant row omits', () => {
    const result = transpileCard(CARD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const lines = result.script.text.split('\n');
    expect(lines).toContain(
      'R:Event$ DamageDone | ActiveZones$ Battlefield | ValidSource$ Instant.YouCtrl+Red,Sorcery.YouCtrl+Red | ReplaceWith$ DmgTwice | Description$ If a red instant or sorcery spell you control would deal damage, it deals double that damage instead.',
    );
    expect(lines).toContain('SVar:DmgTwice:DB$ ReplaceEffect | VarName$ DamageAmount | VarValue$ X');
    expect(lines).toContain('SVar:X:ReplaceCount$DamageAmount/Twice');
  });
});
