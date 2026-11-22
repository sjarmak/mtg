/** A hand-authored characteristic filter on a printed static scope. */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '../src/index';
import { ModelAbilitySchema, parseCard, renderOracleText, safeParseCard } from '../src/index';

function honor(filter: unknown, scope: 'self' | 'creaturesYouControl' = 'creaturesYouControl'): CardInput {
  return {
    kind: 'enchantment',
    id: 'm11-honor-of-the-pure',
    name: 'Honor of the Pure',
    rarity: 'rare',
    set: { code: 'M11', collectorNumber: 17 },
    colors: ['W'],
    manaCost: { generic: 1, W: 1 },
    abilities: [
      {
        kind: 'static',
        scope,
        subtype: null,
        filter,
        modification: { kind: 'statBonus', power: 1, toughness: 1 },
      },
    ],
  } as CardInput;
}

function violations(filter: unknown, scope?: 'self' | 'creaturesYouControl') {
  const result = safeParseCard(honor(filter, scope));
  return result.ok ? [] : result.violations.map((found) => [found.code, found.path]);
}

describe('a static scope filter', () => {
  it('prints Honor of the Pure exactly', () => {
    expect(renderOracleText(parseCard(honor({ colors: ['W'] })))).toBe(
      'White creatures you control get +1/+1.',
    );
  });

  it('refuses an empty filter, a contradictory color, and filtering one fixed source', () => {
    expect(violations({})).toContainEqual(['ILLEGAL_TARGET_FILTER', 'abilities[0].filter']);
    expect(violations({ colors: ['W'], excludeColors: ['W'] })).toContainEqual([
      'ILLEGAL_TARGET_FILTER',
      'abilities[0].filter',
    ]);
    expect(violations({ colors: ['W'] }, 'self')).toContainEqual([
      'STATIC_FILTER_ILLEGAL_ON_SCOPE',
      'abilities[0].filter',
    ]);
  });

  it('keeps the hand-authored filter outside the generator-facing ability schema', () => {
    expect(
      ModelAbilitySchema.safeParse({
        kind: 'static',
        scope: 'creaturesYouControl',
        subtype: null,
        filter: { colors: ['W'] },
        modification: { kind: 'statBonus', power: 1, toughness: 1 },
      }).success,
    ).toBe(false);
  });
});
