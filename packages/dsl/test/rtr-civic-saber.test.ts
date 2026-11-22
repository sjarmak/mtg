/** Civic Saber's live equipped-creature color count without widening model output. */
import {
  AttachingModelAbilitySchema,
  parseCard,
  renderOracleText,
  validateCard,
  type CardInput,
} from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

const CIVIC_SABER = {
  kind: 'artifact',
  id: 'rtr-civic-saber',
  name: 'Civic Saber',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 227 },
  manaCost: { generic: 1 },
  subtypes: ['Equipment'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 1 } },
      attach: { modifications: [{ kind: 'statBonusPerColor', power: 1, toughness: 0 }] },
      effects: [],
    },
  ],
} as const satisfies CardInput;

describe('Civic Saber in the DSL', () => {
  it('retains and prints the source-exact ordered rules text', () => {
    expect(validateCard(CIVIC_SABER)).toEqual([]);
    expect(renderOracleText(parseCard(CIVIC_SABER))).toBe(
      'Equipped creature gets +1/+0 for each of its colors.\nEquip {1}',
    );
  });

  it('keeps live characteristic-derived attachment values outside model output', () => {
    expect(
      AttachingModelAbilitySchema.safeParse({
        kind: 'activated',
        cost: { mana: { generic: 1 } },
        attach: { modification: { kind: 'statBonusPerColor', power: 1, toughness: 0 } },
        effects: [],
      }).success,
    ).toBe(false);
  });
});
