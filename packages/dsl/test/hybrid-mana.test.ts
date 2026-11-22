/** Two-color hybrid symbols are engine vocabulary, not generator vocabulary. */
import { describe, expect, it } from 'vitest';
import {
  colorsFromCost,
  formatManaCost,
  isColorless,
  mana,
  ManaCostSchema,
  manaValue,
  ModelManaCostSchema,
  resolveX,
} from '@mtg/dsl';

describe('two-color hybrid mana', () => {
  it('keeps each printed symbol as one ordered choice', () => {
    const cost = mana({ generic: 1, hybrid: { 'W/U': 2 } });

    expect(ManaCostSchema.parse(cost)).toEqual(cost);
    expect(formatManaCost(cost)).toBe('{1}{W/U}{W/U}');
    expect(manaValue(cost)).toBe(3);
    expect(colorsFromCost(cost)).toEqual(['W', 'U']);
    expect(isColorless(cost)).toBe(false);
  });

  it('preserves hybrid symbols while resolving X', () => {
    const resolved = resolveX(mana({ hasX: true, R: 1, hybrid: { 'R/G': 1 } }), 4);

    expect(formatManaCost(resolved)).toBe('{4}{R}{R/G}');
    expect(manaValue(resolved)).toBe(6);
  });

  it('rejects a symbol whose two choices are the same color', () => {
    expect(() => ManaCostSchema.parse({ hybrid: { 'G/G': 1 } })).toThrow();
    expect(() => ManaCostSchema.parse({ hybrid: { 'G/U': 0 } })).toThrow();
  });

  it('does not widen the model-visible generator ceiling', () => {
    const hybrid = mana({ hybrid: { 'B/G': 1 } });

    expect(ManaCostSchema.safeParse(hybrid).success).toBe(true);
    expect(ModelManaCostSchema.safeParse(hybrid).success).toBe(false);
  });

  it('does not add an empty compatibility field to legacy costs', () => {
    expect(mana()).not.toHaveProperty('hybrid');
  });

  it('does not alias hybrid counts when resolving X', () => {
    const original = mana({ hasX: true, hybrid: { 'W/U': 1 } });
    const resolved = resolveX(original, 2);

    expect(resolved).toEqual(mana({ generic: 2, hybrid: { 'W/U': 1 } }));
    expect(resolved.hybrid).not.toBe(original.hybrid);
  });
});
