/** RTR #135 Slime Molding's chosen-X token body is a creation value, not a CDA. */
import { describe, expect, it } from 'vitest';
import { ModelEffectSchema, parseCard, renderOracleText, safeParseCard, type CardInput } from '@mtg/dsl';

function slimeMolding(power = 0, toughness = 0, hasX = true): CardInput {
  return {
    kind: 'sorcery',
    id: 'rtr-135-slime-molding',
    name: 'Slime Molding',
    rarity: 'uncommon',
    set: { code: 'RTR', collectorNumber: 135 },
    manaCost: { G: 1, hasX },
    colors: ['G'],
    effects: [
      {
        kind: 'createToken',
        count: 1,
        token: {
          name: 'Ooze',
          power,
          toughness,
          creationPowerToughness: { kind: 'chosenX' },
          colors: ['G'],
          subtypes: ['Ooze'],
          keywords: [],
        },
      },
    ],
  };
}

describe('RTR #135 Slime Molding', () => {
  it('parses and renders current Oracle exactly', () => {
    const card = parseCard(slimeMolding());

    expect(renderOracleText(card)).toBe('Create an X/X green Ooze creature token.');
  });

  it('keeps creation-time token values outside the generator schema', () => {
    const effect = slimeMolding().effects?.[0];
    if (effect === undefined) throw new Error('Slime Molding test lost its token effect');

    expect(ModelEffectSchema.safeParse(effect).success).toBe(false);
  });

  it('requires an X cost and canonical 0/0 storage for the creation recipe', () => {
    const noX = safeParseCard(slimeMolding(0, 0, false));
    expect(noX.ok ? [] : noX.violations.map(({ code }) => code)).toContain('CHOSEN_X_WITHOUT_X_COST');

    const contradictory = safeParseCard(slimeMolding(2, 2));
    expect(contradictory.ok ? [] : contradictory.violations.map(({ code }) => code)).toContain(
      'CREATION_POWER_TOUGHNESS_CONFLICT',
    );
  });
});
