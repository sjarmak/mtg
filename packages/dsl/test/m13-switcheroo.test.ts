/** M13 #71: an atomic exchange over exactly two creature targets. */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import { ModelEffectSchema, parseCard, renderOracleText, validateCard } from '../src/index';

const SWITCHEROO_INPUT = {
  kind: 'sorcery',
  id: 'm13-switcheroo',
  name: 'Switcheroo',
  rarity: 'uncommon',
  set: { code: 'M13', collectorNumber: 71 },
  manaCost: { generic: 4, U: 1 },
  colors: ['U'],
  effects: [{ kind: 'exchangeControl', target: { kind: 'targetCreature', count: 2, minimum: 2 } }],
} as CardInput;

describe('Switcheroo authoring', () => {
  it('prints the exact two-target Oracle sentence', () => {
    const card = parseCard(SWITCHEROO_INPUT);

    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe('Exchange control of two target creatures.');
  });

  it('keeps board-dependent control exchange outside the model schema', () => {
    expect(ModelEffectSchema.safeParse(SWITCHEROO_INPUT.effects?.[0]).success).toBe(false);
  });

  it('requires exactly two creature targets', () => {
    expect(() =>
      parseCard({
        ...SWITCHEROO_INPUT,
        effects: [{ kind: 'exchangeControl', target: { kind: 'targetCreature', count: 1, minimum: 1 } }],
      } as CardInput),
    ).toThrow('exchange control requires exactly two target creatures');
  });
});
