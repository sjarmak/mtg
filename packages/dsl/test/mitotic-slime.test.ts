/**
 * Mitotic Slime is the bounded token-genealogy proof: the card creates a token
 * whose own dies trigger creates a second token, and the two token surfaces
 * share the printed name "Ooze" while remaining different game cards.
 */
import { describe, expect, it } from 'vitest';
import {
  ModelTokenSpecSchema,
  parseCard,
  printedCardSurface,
  renderOracleText,
  setTokens,
  TokenSpecSchema,
  validateSetUniqueness,
} from '@mtg/dsl';

const ONE_ONE_OOZE = {
  identity: 'mitotic-ooze-1-1',
  name: 'Ooze',
  power: 1,
  toughness: 1,
  colors: ['G'] as const,
  subtypes: ['Ooze'],
  keywords: [],
};

const TWO_TWO_OOZE = {
  identity: 'mitotic-ooze-2-2',
  quoteAbilities: true as const,
  name: 'Ooze',
  power: 2,
  toughness: 2,
  colors: ['G'] as const,
  subtypes: ['Ooze'],
  keywords: [],
  abilities: [
    {
      kind: 'triggered' as const,
      condition: 'selfDies' as const,
      effects: [{ kind: 'createToken' as const, count: 2, token: ONE_ONE_OOZE }],
    },
  ],
};

const MITOTIC_SLIME = parseCard({
  id: 'm11-185-mitotic-slime',
  kind: 'creature',
  name: 'Mitotic Slime',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 185 },
  manaCost: { generic: 4, G: 1 },
  power: 4,
  toughness: 4,
  colors: ['G'],
  subtypes: ['Ooze'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfDies',
      effects: [{ kind: 'createToken', count: 2, token: TWO_TWO_OOZE }],
    },
  ],
});

describe('Mitotic Slime token genealogy', () => {
  it('parses and renders the exact two-generation dies clause', () => {
    expect(renderOracleText(MITOTIC_SLIME)).toBe(
      'When Mitotic Slime dies, create two 2/2 green Ooze creature tokens. They have "When this token dies, create two 1/1 green Ooze creature tokens."',
    );
  });

  it('walks both same-named token surfaces without merging their identities', () => {
    const surface = printedCardSurface(MITOTIC_SLIME);
    expect(surface.cardEffects.map((effect) => effect.kind)).toEqual(['createToken']);
    expect(surface.tokens.map((token) => token.identity)).toEqual(['mitotic-ooze-2-2', 'mitotic-ooze-1-1']);
    expect(surface.tokenAbilities.map((ability) => ability.kind)).toEqual(['triggered']);
    expect(surface.effects.map((effect) => effect.kind)).toEqual(['createToken', 'createToken']);

    expect(validateSetUniqueness([MITOTIC_SLIME])).toEqual([]);
    expect(setTokens([MITOTIC_SLIME]).map((entry) => entry.card.id)).toEqual([
      'token-mitotic-ooze-2-2',
      'token-mitotic-ooze-1-1',
    ]);
  });

  it('keeps token identities and abilities outside the model-facing schema', () => {
    expect(ModelTokenSpecSchema.safeParse(TWO_TWO_OOZE).success).toBe(false);
  });

  it('refuses a third token generation at the schema boundary', () => {
    const tooDeep = {
      ...TWO_TWO_OOZE,
      abilities: [
        {
          kind: 'triggered' as const,
          condition: 'selfDies' as const,
          effects: [
            {
              kind: 'createToken' as const,
              count: 1,
              token: {
                ...ONE_ONE_OOZE,
                abilities: [
                  {
                    kind: 'triggered' as const,
                    condition: 'selfDies' as const,
                    effects: [{ kind: 'createToken' as const, count: 1, token: ONE_ONE_OOZE }],
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(TokenSpecSchema.safeParse(tooDeep).success).toBe(false);
  });
});
