/** Exact Forge parity for Awakener Druid's linked land animation. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';

const AWAKENER_DRUID = parseCard({
  kind: 'creature',
  id: 'm11-163-awakener-druid-forge',
  name: 'Awakener Druid',
  rarity: 'uncommon',
  set: { code: 'M11', collectorNumber: 163 },
  manaCost: { generic: 2, G: 1 },
  colors: ['G'],
  subtypes: ['Human', 'Druid'],
  power: 1,
  toughness: 1,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [
        {
          kind: 'animateLandWhileSourceOnBattlefield',
          power: 4,
          toughness: 5,
          colors: ['G'],
          subtypes: ['Treefolk'],
          target: { kind: 'targetPermanent', filter: { subtypes: ['Forest'] } },
        },
      ],
    },
  ],
});

describe('Awakener Druid Forge parity', () => {
  it('emits the shipped Animate contract and source-linked duration exactly', () => {
    const result = transpileCard(AWAKENER_DRUID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.script.text.split('\n')).toContain(
      'SVar:Trig1Effect1:DB$ Animate | ValidTgts$ Forest | Types$ Creature,Treefolk | Power$ 4 | Toughness$ 5 | Colors$ Green | OverwriteColors$ True | Duration$ AsLongAsInPlay',
    );
  });
});
