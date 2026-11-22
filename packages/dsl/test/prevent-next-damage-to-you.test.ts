/** The plain numeric arm of the depleting controller-shield capability. */
import { describe, expect, it } from 'vitest';
import { ModelEffectSchema, parseCard, renderOracleText } from '@mtg/dsl';

const EFFECT = {
  kind: 'preventNextDamageToYouAndRetaliate' as const,
  amount: 1,
  target: { kind: 'noTarget' as const },
};

describe('the plain controller shield', () => {
  it('renders the source-attested fixed shield without the linked retaliation sentence', () => {
    const card = parseCard({
      kind: 'instant',
      id: 'tst-fixed-shield',
      name: 'Fixed Shield',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 1 },
      manaCost: { W: 1 },
      colors: ['W'],
      effects: [EFFECT],
    });
    expect(renderOracleText(card)).toBe('Prevent the next 1 damage that would be dealt to you this turn.');
  });

  it('remains outside generator output with its effect family', () => {
    expect(ModelEffectSchema.safeParse(EFFECT).success).toBe(false);
  });
});
