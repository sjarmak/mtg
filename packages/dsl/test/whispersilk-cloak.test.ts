/** Whispersilk Cloak's two attachment rules without widening model output. */
import { describe, expect, it } from 'vitest';
import {
  AttachingModelAbilitySchema,
  parseCard,
  renderOracleText,
  validateCard,
  type AttachModification,
  type CardInput,
} from '@mtg/dsl';

const MODIFICATIONS = [
  { kind: 'cantBeBlocked' },
  { kind: 'grantKeyword', keyword: 'shroud' },
] as const satisfies readonly AttachModification[];

const CLOAK: CardInput = {
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
      attach: { modifications: [...MODIFICATIONS] },
      effects: [],
    },
  ],
};

describe('Whispersilk Cloak in the DSL', () => {
  it('retains and prints both ordered attachment rules', () => {
    expect(validateCard(CLOAK)).toEqual([]);
    const card = parseCard(CLOAK);
    expect(renderOracleText(card)).toBe("Equipped creature can't be blocked and has shroud.\nEquip {2}");
    const ability = card.abilities[0];
    if (ability?.kind !== 'activated') throw new Error('Whispersilk Cloak lost its equip ability');
    expect(ability.attach?.modifications).toEqual(MODIFICATIONS);
  });

  it('keeps shroud and combat restrictions outside the model-facing equip schema', () => {
    const modelEquip = (modification: unknown): unknown => ({
      kind: 'activated',
      cost: { mana: { generic: 2 } },
      attach: { modification },
      effects: [],
    });

    expect(
      AttachingModelAbilitySchema.safeParse(modelEquip({ kind: 'statBonus', power: 1, toughness: 1 }))
        .success,
    ).toBe(true);
    expect(AttachingModelAbilitySchema.safeParse(modelEquip({ kind: 'cantBeBlocked' })).success).toBe(false);
    expect(
      AttachingModelAbilitySchema.safeParse(modelEquip({ kind: 'grantKeyword', keyword: 'shroud' })).success,
    ).toBe(false);
  });

  it('refuses two Equip abilities because one attachment cannot identify which clause created it', () => {
    const first = CLOAK.abilities?.[0];
    if (first === undefined) throw new Error('Whispersilk Cloak lost its equip ability');
    const ambiguous: CardInput = {
      ...CLOAK,
      abilities: [
        first,
        {
          kind: 'activated',
          cost: { mana: { generic: 1 } },
          attach: { modifications: [{ kind: 'statBonus', power: 1, toughness: 0 }] },
          effects: [],
        },
      ],
    };

    expect(validateCard(ambiguous)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'EQUIP_ABILITY_INVALID', path: 'abilities[1].attach' }),
      ]),
    );
  });
});
