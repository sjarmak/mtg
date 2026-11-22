/** Fling: a spell-paid creature sacrifice retained as last-known power. */
import { describe, expect, it } from 'vitest';
import { ModelEffectSchema, parseCard, renderOracleText, safeParseCard, type CardInput } from '@mtg/dsl';

const FLING = {
  kind: 'instant',
  id: 'm11-139-fling',
  name: 'Fling',
  rarity: 'common',
  set: { code: 'M11', collectorNumber: 139 },
  colors: ['R'],
  manaCost: { generic: 1, R: 1 },
  additionalCost: {
    sacrificeMatching: { count: 1, filter: { cardTypes: ['creature'] } },
  },
  effects: [
    {
      kind: 'dealDamage',
      amount: { kind: 'paidSacrificePower' },
      target: { kind: 'anyTarget' },
    },
  ],
} as unknown as CardInput;

describe('Fling DSL', () => {
  it('parses and renders the current Oracle text exactly', () => {
    expect(renderOracleText(parseCard(FLING))).toBe(
      [
        'As an additional cost to cast this spell, sacrifice a creature.',
        "Fling deals damage equal to the sacrificed creature's power to any target.",
      ].join('\n'),
    );
  });

  it('keeps both the spell payment and its retained amount hand-authored', () => {
    const parsed = parseCard(FLING);
    expect(parsed.kind).toBe('instant');
    if (parsed.kind !== 'instant') throw new Error('Fling did not parse as an instant');
    expect(parsed.additionalCost).toEqual({
      sacrificeMatching: { count: 1, filter: { cardTypes: ['creature'] } },
    });
    expect(ModelEffectSchema.safeParse(parsed.effects[0]).success).toBe(false);
  });

  it('refuses a zero-card additional sacrifice rather than making it free', () => {
    const result = safeParseCard({
      ...(FLING as unknown as Record<string, unknown>),
      additionalCost: {
        sacrificeMatching: { count: 0, filter: { cardTypes: ['creature'] } },
      },
    });

    expect(result.ok).toBe(false);
  });
});
