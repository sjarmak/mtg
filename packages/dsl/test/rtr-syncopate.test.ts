import { describe, expect, it } from 'vitest';
import { ModelEffectSchema, parseCard, renderOracleText, safeParseCard, validateCard } from '@mtg/dsl';

const SYNCOPATE = {
  kind: 'instant',
  id: 'rtr-54-syncopate-dsl',
  name: 'Syncopate',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 54 },
  manaCost: { hasX: true, U: 1 },
  colors: ['U'],
  effects: [
    {
      kind: 'counterSpell',
      unlessCost: { kind: 'chosenX' },
      destination: 'exile',
    },
  ],
} as const;

describe('RTR #54 Syncopate', () => {
  it('renders the two source-attested sentences in exact current Oracle order', () => {
    const card = parseCard(SYNCOPATE);

    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      "Counter target spell unless its controller pays {X}. If that spell is countered this way, exile it instead of putting it into its owner's graveyard.",
    );
  });

  it('keeps both counter riders outside the generator output vocabulary', () => {
    const effect = parseCard(SYNCOPATE).effects[0];
    expect(ModelEffectSchema.safeParse(effect).success).toBe(false);
  });

  it('rejects a chosen-X counter toll on a spell that does not choose X', () => {
    const parsed = safeParseCard({ ...SYNCOPATE, manaCost: { U: 1 } });
    expect(parsed.ok).toBe(false);
    expect((parsed.ok ? [] : parsed.violations).map((violation) => violation.code)).toContain(
      'UNLESS_CHOSEN_X_WITHOUT_X_COST',
    );
  });
});
