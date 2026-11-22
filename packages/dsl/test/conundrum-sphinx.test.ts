/** Conundrum Sphinx's hand-authored linked name and reveal effect. */
import { describe, expect, it } from 'vitest';
import { ALL_EFFECT_KINDS, ModelEffectSchema, parseCard, renderOracleText } from '@mtg/dsl';

const INPUT = {
  kind: 'creature',
  id: 'm11-051',
  name: 'Conundrum Sphinx',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 51 },
  manaCost: { generic: 2, U: 2 },
  colors: ['U'],
  subtypes: ['Sphinx'],
  keywords: ['flying'],
  power: 4,
  toughness: 4,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfAttacks',
      effects: [{ kind: 'eachPlayerNamesCardThenRevealsTop' }],
    },
  ],
} as const;

describe('Conundrum Sphinx authoring', () => {
  it('accepts the exact hand-authored trigger and renders its current Oracle sentence', () => {
    const card = parseCard(INPUT);
    expect(renderOracleText(card)).toBe(
      "Flying\nWhenever Conundrum Sphinx attacks, each player chooses a card name. Then each player reveals the top card of their library. If the card a player revealed has the name they chose, that player puts it into their hand. If it doesn't, that player puts it on the bottom of their library.",
    );
    expect(ALL_EFFECT_KINDS).toContain('eachPlayerNamesCardThenRevealsTop');
  });

  it('keeps the composite outside the model generator output', () => {
    expect(
      ModelEffectSchema.safeParse({
        kind: 'eachPlayerNamesCardThenRevealsTop',
      }).success,
    ).toBe(false);
  });
});
