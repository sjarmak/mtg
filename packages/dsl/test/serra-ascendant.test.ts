/** Serra Ascendant's controller-life conditional static authoring. */
import { describe, expect, it } from 'vitest';
import { ModelAbilitySchema, parseCard, renderOracleText } from '@mtg/dsl';

const THRESHOLD = { kind: 'controllerLifeAtLeast' as const, atLeast: 30 };

const ABILITIES = [
  {
    kind: 'static' as const,
    scope: 'self' as const,
    subtype: null,
    enabledWhile: THRESHOLD,
    modification: { kind: 'statBonus' as const, power: 5, toughness: 5 },
  },
  {
    kind: 'static' as const,
    scope: 'self' as const,
    subtype: null,
    enabledWhile: THRESHOLD,
    modification: { kind: 'grantKeyword' as const, keyword: 'flying' as const },
  },
] as const;

const SERRA_ASCENDANT = {
  kind: 'creature' as const,
  id: 'tst-serra-ascendant',
  name: 'Serra Ascendant',
  rarity: 'rare' as const,
  set: { code: 'M11', collectorNumber: 28 },
  colors: ['W'] as const,
  manaCost: { W: 1 },
  power: 1,
  toughness: 1,
  subtypes: ['Human', 'Monk'],
  keywords: ['lifelink'] as const,
  abilities: ABILITIES,
};

describe('Serra Ascendant authoring', () => {
  it('composes the life threshold from the existing self stat and keyword layers', () => {
    expect(renderOracleText(parseCard(SERRA_ASCENDANT))).toBe(
      [
        'Lifelink',
        'As long as you have 30 or more life, Serra Ascendant gets +5/+5.',
        'As long as you have 30 or more life, Serra Ascendant has flying.',
      ].join('\n'),
    );
  });

  it('keeps the controller-life predicate outside generator output', () => {
    expect(ModelAbilitySchema.safeParse(ABILITIES[0]).success).toBe(false);
  });
});
