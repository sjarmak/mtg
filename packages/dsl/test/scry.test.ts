/** The source-bound scry primitive stays exact and outside model generation. */
import { describe, expect, it } from 'vitest';
import { CardEffectSchema, MAX_SCRY_COUNT, ModelEffectSchema, parseCard, renderOracleText } from '@mtg/dsl';

describe('typed scry', () => {
  it('accepts exactly the bounded M11/M13 values', () => {
    expect(MAX_SCRY_COUNT).toBe(4);
    for (const count of [1, 2, 3, 4]) {
      expect(CardEffectSchema.parse({ kind: 'scry', count })).toEqual({ kind: 'scry', count });
    }
    for (const count of [0, 5, -1, 1.5]) {
      expect(CardEffectSchema.safeParse({ kind: 'scry', count }).success).toBe(false);
    }
  });

  it('does not widen the model-facing generator schema', () => {
    expect(ModelEffectSchema.safeParse({ kind: 'scry', count: 2 }).success).toBe(false);
  });

  it('renders current Oracle wording in authored order', () => {
    const preordain = parseCard({
      kind: 'sorcery',
      id: 'm11-preordain',
      name: 'Preordain',
      rarity: 'common',
      set: { code: 'M11', collectorNumber: 70 },
      manaCost: { U: 1 },
      colors: ['U'],
      effects: [
        { kind: 'scry', count: 2 },
        { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } },
      ],
    });
    expect(renderOracleText(preordain)).toBe('Scry 2. Draw a card.');
  });
});
