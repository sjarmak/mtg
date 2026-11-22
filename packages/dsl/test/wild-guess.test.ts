/** Wild Guess: a card discarded while casting, before the spell can resolve. */
import { describe, expect, it } from 'vitest';
import { ModelEffectSchema, parseCard, renderOracleText, safeParseCard, type CardInput } from '@mtg/dsl';

const WILD_GUESS = {
  kind: 'sorcery',
  id: 'm13-157-wild-guess',
  name: 'Wild Guess',
  rarity: 'common',
  set: { code: 'M13', collectorNumber: 157 },
  colors: ['R'],
  manaCost: { R: 2 },
  additionalCost: { discard: 1 },
  effects: [{ kind: 'drawCards', count: 2, target: { kind: 'noTarget' } }],
} as unknown as CardInput;

describe('Wild Guess DSL', () => {
  it('parses and renders the pinned Oracle text exactly', () => {
    const card = parseCard(WILD_GUESS);
    expect(renderOracleText(card)).toBe(
      ['As an additional cost to cast this spell, discard a card.', 'Draw two cards.'].join('\n'),
    );
  });

  it('keeps the spell payment hand-authored without widening model effects', () => {
    const card = parseCard(WILD_GUESS);
    if (card.kind !== 'sorcery') throw new Error('Wild Guess did not parse as a sorcery');
    expect(card.additionalCost).toEqual({ discard: 1 });
    expect(ModelEffectSchema.safeParse(card.effects[0]).success).toBe(true);
  });

  it('refuses a free, plural, or mixed additional payment', () => {
    const withCost = (additionalCost: unknown) =>
      safeParseCard({ ...(WILD_GUESS as unknown as Record<string, unknown>), additionalCost });
    expect(withCost({ discard: 0 }).ok).toBe(false);
    expect(withCost({ discard: 2 }).ok).toBe(false);
    expect(
      withCost({
        discard: 1,
        sacrificeMatching: { count: 1, filter: { cardTypes: ['creature'] } },
      }).ok,
    ).toBe(false);
  });
});
