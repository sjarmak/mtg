/** Hand-authored Auras may grant one activated ability without widening model output. */
import { describe, expect, it } from 'vitest';
import { ModelAuraSchema, parseCard, renderOracleText } from '@mtg/dsl';

const trampleGrant = {
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
} as const;

describe('an Aura-granted activated ability', () => {
  it('renders the exact creature-hosted clause while remaining outside the model schema', () => {
    const card = parseCard({
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
        modifications: [{ kind: 'statBonus', power: 2, toughness: 1 }, trampleGrant],
      },
    });

    if (card.kind !== 'enchantment') throw new Error('Deviant Glee must remain an enchantment');
    expect(renderOracleText(card)).toBe(
      'Enchant creature\nEnchanted creature gets +2/+1 and has "{R}: This creature gains trample until end of turn."',
    );
    expect(ModelAuraSchema.safeParse(card.aura).success).toBe(false);
  });

  it('supports a land host and prints its tap-and-life activation exactly', () => {
    const card = parseCard({
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
    });

    if (card.kind !== 'enchantment') {
      throw new Error('Underworld Connections must remain an enchantment');
    }
    expect(renderOracleText(card)).toBe('Enchant land\nEnchanted land has "{T}, Pay 1 life: Draw a card."');
    expect(ModelAuraSchema.safeParse(card.aura).success).toBe(false);
  });

  it('refuses host combinations whose rules meaning or Forge composition is not proven', () => {
    const base = {
      kind: 'enchantment',
      id: 'tst-aura-grant-boundary',
      name: 'Aura Grant Boundary',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 1 },
      manaCost: {},
      colors: [],
      subtypes: ['Aura'],
    } as const;
    expect(() =>
      parseCard({
        ...base,
        aura: { enchant: 'land', modifications: [{ kind: 'statBonus', power: 1, toughness: 1 }] },
      }),
    ).toThrow(/AURA_INVALID/);
    expect(() =>
      parseCard({
        ...base,
        aura: { enchant: 'artifactOrCreature', modifications: [trampleGrant] },
      }),
    ).toThrow(/AURA_INVALID/);
    expect(() =>
      parseCard({
        ...base,
        aura: {
          enchant: 'creature',
          modifications: [
            trampleGrant,
            {
              kind: 'grantActivatedAbility',
              ability: {
                kind: 'activated',
                cost: { mana: { G: 1 }, tapSelf: false },
                effects: [
                  {
                    kind: 'grantKeywordUntilEndOfTurn',
                    keyword: 'deathtouch',
                    target: { kind: 'selfCreature' },
                  },
                ],
              },
            },
          ],
        },
      }),
    ).toThrow(/AURA_INVALID/);
  });
});
