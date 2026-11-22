/** Exact strict-DSL authoring for M13 #219, Tormod's Crypt. */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import {
  CardEffectSchema,
  HAND_AUTHORED_TARGETS,
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  validateCard,
} from '@mtg/dsl';

const TARGETED = {
  kind: 'exileGraveyard',
  target: { kind: 'targetPlayer' },
} as const;

const INPUT = {
  kind: 'artifact',
  id: 'm13-219',
  name: "Tormod's Crypt",
  rarity: 'uncommon',
  set: { code: 'M13', collectorNumber: 219 },
  manaCost: { generic: 0 },
  colors: [],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, tapSelf: true, sacrificeSelf: true },
      effects: [TARGETED],
    },
  ],
} as unknown as CardInput;

describe("Tormod's Crypt authoring", () => {
  it('accepts the target-player form and prints the exact Oracle line', () => {
    expect(CardEffectSchema.parse(TARGETED)).toEqual(TARGETED);
    const card = parseCard(INPUT);

    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe("{T}, Sacrifice Tormod's Crypt: Exile target player's graveyard.");
    expect(HAND_AUTHORED_TARGETS.exileGraveyard).toEqual(['targetPlayer']);
  });

  it('preserves all three untargeted owner forms', () => {
    for (const whose of ['you', 'opponent', 'each'] as const) {
      expect(CardEffectSchema.parse({ kind: 'exileGraveyard', whose })).toEqual({
        kind: 'exileGraveyard',
        whose,
      });
    }
  });

  it('requires exactly one owner form and keeps the widening out of the model schema', () => {
    expect(CardEffectSchema.safeParse({ kind: 'exileGraveyard' }).success).toBe(false);
    expect(
      CardEffectSchema.safeParse({
        kind: 'exileGraveyard',
        whose: 'you',
        target: { kind: 'targetPlayer' },
      }).success,
    ).toBe(false);
    expect(ModelEffectSchema.safeParse(TARGETED).success).toBe(false);
  });
});
