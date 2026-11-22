/** Corpsejack Menace's exact, hand-authored counter-placement replacement. */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '../src/index';
import {
  AbilitySchema,
  ModelAbilitySchema,
  parseCard,
  renderOracleText,
  STATIC_MODIFICATION_KINDS,
  validateCard,
} from '../src/index';

const DOUBLE_COUNTERS = {
  kind: 'static',
  scope: 'self',
  subtype: null,
  modification: { kind: 'doublePlusOnePlusOneCountersOnCreaturesYouControl' },
} as const;

const INPUT = {
  kind: 'creature',
  id: 'rtr-152-corpsejack-menace',
  name: 'Corpsejack Menace',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 152 },
  manaCost: { generic: 2, B: 1, G: 1 },
  colors: ['B', 'G'],
  subtypes: ['Fungus'],
  power: 4,
  toughness: 4,
  abilities: [DOUBLE_COUNTERS],
} satisfies CardInput;

describe('Corpsejack Menace DSL', () => {
  it('prints the current Oracle sentence exactly', () => {
    const card = parseCard(INPUT);

    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      'If one or more +1/+1 counters would be put on a creature you control, twice that many +1/+1 counters are put on it instead.',
    );
  });

  it('keeps the replacement in the engine vocabulary and outside the generator vocabulary', () => {
    expect(STATIC_MODIFICATION_KINDS).toContain('doublePlusOnePlusOneCountersOnCreaturesYouControl');
    expect(AbilitySchema.safeParse(DOUBLE_COUNTERS).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(DOUBLE_COUNTERS).success).toBe(false);
  });

  it('refuses a replacement event disguised as a scoped characteristic change', () => {
    expect(() =>
      parseCard({
        ...INPUT,
        abilities: [{ ...DOUBLE_COUNTERS, scope: 'creaturesYouControl' }],
      }),
    ).toThrow(/REPLACEMENT_MODIFICATION_ILLEGAL_ON_SCOPE/u);
  });
});
