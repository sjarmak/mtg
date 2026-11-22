/** Haunting Echoes' linked public-zone exile and hidden-zone search. */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import {
  ALL_EFFECT_KINDS,
  CardEffectSchema,
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  safeParseCard,
  validateCards,
} from '@mtg/dsl';

const ECHOES = {
  kind: 'exileNonbasicGraveyardAndMatchingLibrary' as const,
  target: { kind: 'targetPlayer' as const },
};

function hauntingEchoes(effect: unknown = ECHOES): CardInput {
  return {
    kind: 'sorcery',
    id: 'm11-099',
    name: 'Haunting Echoes',
    rarity: 'rare',
    set: { code: 'M11', collectorNumber: 99 },
    manaCost: { generic: 3, B: 2 },
    colors: ['B'],
    effects: [effect],
  } as unknown as CardInput;
}

describe('Haunting Echoes authoring', () => {
  it('parses, validates, and renders the linked operation as one exact sentence', () => {
    expect(CardEffectSchema.safeParse(ECHOES).success).toBe(true);
    const card = parseCard(hauntingEchoes());
    expect(validateCards([card])).toEqual([]);
    expect(renderOracleText(card)).toBe(
      "Exile all cards from target player's graveyard other than basic land cards. For each card exiled this way, search that player's library for all cards with the same name as that card and exile them. Then that player shuffles.",
    );
  });

  it('is an engine capability that no generator-facing schema can emit', () => {
    expect(ALL_EFFECT_KINDS).toContain('exileNonbasicGraveyardAndMatchingLibrary');
    expect(ModelEffectSchema.safeParse(ECHOES).success).toBe(false);
  });

  it('requires the printed target-player slot rather than an inferred opponent', () => {
    const parsed = safeParseCard(
      hauntingEchoes({
        kind: 'exileNonbasicGraveyardAndMatchingLibrary',
        target: { kind: 'targetOpponent' },
      }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('Haunting Echoes accepted a narrower target than it prints');
    expect(parsed.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'ILLEGAL_TARGET_FOR_EFFECT',
          path: 'effects[0].target.kind',
        }),
      ]),
    );
  });
});
