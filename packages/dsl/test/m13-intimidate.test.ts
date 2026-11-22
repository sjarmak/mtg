/** M13 Intimidate authoring stays engine-only and preserves generator containment. */
import {
  KeywordAbilitySchema,
  KeywordSchema,
  abilityLineReminder,
  parseCard,
  renderOracleText,
} from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

const INTIMIDATE = { kind: 'intimidate' as const };

const BLADETUSK_BOAR = {
  kind: 'creature' as const,
  id: 'm13-bladetusk-boar',
  name: 'Bladetusk Boar',
  rarity: 'common' as const,
  set: { code: 'M13', collectorNumber: 121 },
  manaCost: { generic: 3, R: 1 },
  colors: ['R'] as const,
  subtypes: ['Boar'],
  power: 3,
  toughness: 2,
  keywordAbilities: [INTIMIDATE] as never,
};

describe('M13 Intimidate authoring', () => {
  it('parses and renders Bladetusk Boar with the measured reminder', () => {
    const card = parseCard(BLADETUSK_BOAR);

    expect(renderOracleText(card)).toBe('Intimidate');
    expect(abilityLineReminder('Intimidate')).toEqual({
      keyword: 'Intimidate',
      gloss:
        "(This creature can't be blocked except by artifact creatures and/or creatures that share a color with it.)",
    });
  });

  it('keeps Intimidate outside the model-visible flat keyword vocabulary', () => {
    expect(KeywordAbilitySchema.safeParse(INTIMIDATE).success).toBe(true);
    expect(KeywordSchema.safeParse('intimidate').success).toBe(false);
  });

  it('rejects duplicate Intimidate and noncreature hosts', () => {
    expect(() =>
      parseCard({
        ...BLADETUSK_BOAR,
        keywordAbilities: [INTIMIDATE, INTIMIDATE] as never,
      }),
    ).toThrow(/repeats keywordAbilities/iu);
    expect(() =>
      parseCard({
        kind: 'artifact',
        id: 'intimidate-artifact',
        name: 'Intimidating Relic',
        rarity: 'common',
        set: { code: 'TST', collectorNumber: 1 },
        manaCost: { generic: 2 },
        keywordAbilities: [INTIMIDATE] as never,
      }),
    ).toThrow(/intimidate.*artifact|artifact.*intimidate/iu);
  });
});
