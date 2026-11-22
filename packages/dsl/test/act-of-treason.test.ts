/** Act of Treason as three composable effects over one chosen creature. */
import { describe, expect, it } from 'vitest';
import { ModelEffectSchema, parseCard, renderOracleText, safeParseCard, validateCard } from '@mtg/dsl';

const EFFECTS = [
  { kind: 'gainControlUntilEndOfTurn', target: { kind: 'targetCreature' } },
  { kind: 'untapPermanent', target: { kind: 'thatCreature' } },
  { kind: 'grantKeywordUntilEndOfTurn', keyword: 'haste', target: { kind: 'thatCreature' } },
] as const;

const INPUT = {
  kind: 'sorcery',
  id: 'm11-121',
  name: 'Act of Treason',
  rarity: 'common',
  set: { code: 'M11', collectorNumber: 121 },
  manaCost: { generic: 2, R: 1 },
  colors: ['R'],
  effects: EFFECTS,
} as const;

describe('Act of Treason authoring', () => {
  it('renders one chosen creature through control, untap, and haste effects', () => {
    const card = parseCard(INPUT);

    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      'Gain control of target creature until end of turn. Untap that creature. That creature gains haste until end of turn.',
    );
  });

  it('keeps the layer-2 control primitive outside generator output', () => {
    expect(ModelEffectSchema.safeParse(EFFECTS[0]).success).toBe(false);
  });

  it('refuses a control effect that has no creature target', () => {
    const result = safeParseCard({
      ...INPUT,
      effects: [{ kind: 'gainControlUntilEndOfTurn', target: { kind: 'targetPlayer' } }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations).toEqual([
      expect.objectContaining({ code: 'ILLEGAL_TARGET_FOR_EFFECT', path: 'effects[0].target.kind' }),
    ]);
  });
});
