/** Hand-authored casting and damage riders needed by M11 Combust. */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import { CardEffectSchema, ModelEffectSchema, renderOracleText, validateCard } from '../src/index';
import { parseCard } from '../src/parse';

const UNPREVENTABLE_DAMAGE = {
  kind: 'dealDamage',
  amount: 5,
  target: { kind: 'targetCreature', filter: { colors: ['W', 'U'] } },
  preventable: false,
} as const;

function input(): CardInput {
  return {
    kind: 'instant',
    id: 'm11-130-combust',
    name: 'Combust',
    rarity: 'uncommon',
    set: { code: 'M11', collectorNumber: 130 },
    manaCost: { generic: 1, R: 1 },
    colors: ['R'],
    cannotBeCountered: true,
    effects: [UNPREVENTABLE_DAMAGE],
  } as unknown as CardInput;
}

describe('Combust DSL', () => {
  it('keeps unpreventable damage hand-authored and outside the model effect schema', () => {
    expect(CardEffectSchema.safeParse(UNPREVENTABLE_DAMAGE).success).toBe(true);
    expect(ModelEffectSchema.safeParse(UNPREVENTABLE_DAMAGE).success).toBe(false);
  });

  it('renders both card-level and effect-level rules exactly', () => {
    const card = parseCard(input());

    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      "This spell can't be countered.\nCombust deals 5 damage to target white or blue creature. The damage can't be prevented.",
    );
  });

  it('rejects the casting rule on a land', () => {
    expect(() =>
      parseCard({
        kind: 'land',
        id: 'illegal-uncounterable-land',
        name: 'Illegal Uncounterable Land',
        rarity: 'common',
        set: { code: 'TST', collectorNumber: 1 },
        producesMana: ['R'],
        cannotBeCountered: true,
      } as unknown as CardInput),
    ).toThrow(/countered|spell/u);
  });
});
