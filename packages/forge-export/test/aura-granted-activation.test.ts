/** Forge's source-attested AddAbility form for creature and land Auras. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { transpileCardScript } from '@mtg/forge-export';

function script(input: CardInput): readonly string[] {
  const result = transpileCardScript(parseCard(input));
  if (!result.ok) throw new Error(JSON.stringify(result.rejections));
  return result.value.lines;
}

describe('Aura-granted activation Forge export', () => {
  it('writes Deviant Glee with the exact continuous grant and SVar body', () => {
    expect(
      script({
        kind: 'enchantment',
        id: 'rtr-65',
        name: 'Deviant Glee',
        rarity: 'common',
        set: { code: 'RTR', collectorNumber: 65 },
        manaCost: { B: 1 },
        colors: ['B'],
        subtypes: ['Aura'],
        aura: {
          enchant: 'creature',
          modifications: [
            { kind: 'statBonus', power: 2, toughness: 1 },
            {
              kind: 'grantActivatedAbility',
              ability: {
                kind: 'activated',
                cost: { mana: { R: 1 }, tapSelf: false },
                effects: [
                  {
                    kind: 'grantKeywordUntilEndOfTurn',
                    keyword: 'trample',
                    target: { kind: 'selfCreature' },
                  },
                ],
              },
            },
          ],
        },
      }),
    ).toEqual([
      'Name:Deviant Glee',
      'ManaCost:B',
      'Types:Enchantment Aura',
      'K:Enchant:Creature',
      'SVar:AttachAILogic:Pump',
      'S:Mode$ Continuous | Affected$ Creature.EnchantedBy | AddPower$ 2 | AddToughness$ 1 | AddAbility$ AuraGrant1 | Description$ Enchanted creature gets +2/+1 and has "{R}: This creature gains trample until end of turn."',
      'SVar:AuraGrant1:AB$ Pump | Cost$ R | Defined$ Self | KW$ Trample | SpellDescription$ This creature gains trample until end of turn.',
      'Oracle:Enchant creature\\nEnchanted creature gets +2/+1 and has "{R}: This creature gains trample until end of turn."',
    ]);
  });

  it('writes Underworld Connections with the exact land grant and paid draw body', () => {
    expect(
      script({
        kind: 'enchantment',
        id: 'rtr-83',
        name: 'Underworld Connections',
        rarity: 'rare',
        set: { code: 'RTR', collectorNumber: 83 },
        manaCost: { generic: 1, B: 2 },
        colors: ['B'],
        subtypes: ['Aura'],
        aura: {
          enchant: 'land',
          modifications: [
            {
              kind: 'grantActivatedAbility',
              ability: {
                kind: 'activated',
                cost: { mana: {}, tapSelf: true, payLife: 1 },
                effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
              },
            },
          ],
        },
      }),
    ).toEqual([
      'Name:Underworld Connections',
      'ManaCost:1 B B',
      'Types:Enchantment Aura',
      'K:Enchant:Land',
      'SVar:AttachAILogic:Pump',
      'S:Mode$ Continuous | Affected$ Card.EnchantedBy | AddAbility$ AuraGrant1 | Description$ Enchanted land has "{T}, Pay 1 life: Draw a card."',
      'SVar:AuraGrant1:AB$ Draw | Cost$ T PayLife<1> | NumCards$ 1 | SpellDescription$ Draw a card.',
      'Oracle:Enchant land\\nEnchanted land has "{T}, Pay 1 life: Draw a card."',
    ]);
  });
});
