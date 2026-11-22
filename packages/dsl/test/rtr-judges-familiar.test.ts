/** Judge's Familiar's activated counter toll stays hand-authored and exact. */
import { AbilitySchema, ModelAbilitySchema, parseCard, renderOracleText } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

const ABILITY = {
  kind: 'activated' as const,
  cost: { mana: {}, sacrificeSelf: true },
  printedSourceReference: 'thisCreature' as const,
  effects: [
    {
      kind: 'counterSpell' as const,
      spellFilter: { cardTypes: ['instant' as const, 'sorcery' as const] },
    },
  ],
  counterTargetSpellUnless: { cost: { generic: 1 } },
};

describe("Judge's Familiar activated counter toll", () => {
  it('parses and renders the source Oracle exactly', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'rtr-218-judges-familiar',
      name: "Judge's Familiar",
      rarity: 'uncommon',
      set: { code: 'RTR', collectorNumber: 218 },
      manaCost: { hybrid: { 'W/U': 1 } },
      colors: ['W', 'U'],
      subtypes: ['Bird'],
      power: 1,
      toughness: 1,
      keywords: ['flying'],
      abilities: [ABILITY],
    });

    expect(renderOracleText(card)).toBe(
      'Flying\nSacrifice this creature: Counter target instant or sorcery spell unless its controller pays {1}.',
    );
  });

  it('keeps the toll outside model output', () => {
    expect(AbilitySchema.safeParse(ABILITY).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(ABILITY).success).toBe(false);
  });

  it('rejects a toll without exactly one counter effect', () => {
    expect(
      AbilitySchema.safeParse({
        ...ABILITY,
        effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
      }).success,
    ).toBe(false);
  });

  it('rejects a free or unannounced variable toll', () => {
    expect(AbilitySchema.safeParse({ ...ABILITY, counterTargetSpellUnless: { cost: {} } }).success).toBe(
      false,
    );
    expect(
      AbilitySchema.safeParse({ ...ABILITY, counterTargetSpellUnless: { cost: { hasX: true } } }).success,
    ).toBe(false);
  });
});
