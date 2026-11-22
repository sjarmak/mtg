/** Palace Guard's hand-authored unlimited block capacity at the strict DSL seam. */
import { describe, expect, it } from 'vitest';
import { ModelAbilitySchema, parseCard, renderOracleText, type CardInput } from '@mtg/dsl';

export const PALACE_GUARD_INPUT = {
  kind: 'creature',
  id: 'm11-24',
  name: 'Palace Guard',
  rarity: 'common',
  set: { code: 'M11', collectorNumber: 24 },
  colors: ['W'],
  manaCost: { generic: 2, W: 1 },
  artifact: false,
  subtypes: ['Human', 'Soldier'],
  power: 1,
  toughness: 4,
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: { kind: 'canBlockAnyNumber' },
    },
  ],
} as unknown as CardInput;

describe('Palace Guard at the DSL boundary', () => {
  it('parses its exact body and prints its exact rule', () => {
    const card = parseCard(PALACE_GUARD_INPUT);

    expect(card).toMatchObject({
      name: 'Palace Guard',
      power: 1,
      toughness: 4,
      subtypes: ['Human', 'Soldier'],
    });
    expect(renderOracleText(card)).toBe('Palace Guard can block any number of creatures.');
  });

  it('keeps unlimited block capacity outside the generator schema', () => {
    expect(
      ModelAbilitySchema.safeParse({
        kind: 'static',
        scope: 'self',
        subtype: null,
        modification: { kind: 'canBlockAnyNumber' },
      }).success,
    ).toBe(false);
  });
});
