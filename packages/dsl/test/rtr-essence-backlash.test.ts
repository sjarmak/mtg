import { describe, expect, it } from 'vitest';
import { ModelEffectSchema, parseCard, renderOracleText, safeParseCard, validateCard } from '@mtg/dsl';

const ESSENCE_BACKLASH = {
  kind: 'instant',
  id: 'rtr-160-essence-backlash-dsl',
  name: 'Essence Backlash',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 160 },
  manaCost: { generic: 2, U: 1, R: 1 },
  colors: ['U', 'R'],
  effects: [
    {
      kind: 'counterSpell',
      spellFilter: { cardTypes: ['creature'] },
      dealDamageToControllerEqualToSpellPower: true,
    },
  ],
} as const;

describe('RTR #160 Essence Backlash', () => {
  it('renders both source-attested instructions in exact current Oracle order', () => {
    const card = parseCard(ESSENCE_BACKLASH);

    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      "Counter target creature spell. Essence Backlash deals damage equal to that spell's power to its controller.",
    );
  });

  it('keeps the stack-power damage rider outside the generator vocabulary', () => {
    const effect = parseCard(ESSENCE_BACKLASH).effects[0];
    expect(ModelEffectSchema.safeParse(effect).success).toBe(false);
  });

  it('refuses to read power from a counter target that is not necessarily a creature spell', () => {
    const parsed = safeParseCard({
      ...ESSENCE_BACKLASH,
      effects: [{ kind: 'counterSpell', dealDamageToControllerEqualToSpellPower: true }],
    });

    expect(parsed.ok).toBe(false);
    expect((parsed.ok ? [] : parsed.violations).map((violation) => violation.code)).toContain(
      'ILLEGAL_REFERENT_AMOUNT',
    );
  });
});
