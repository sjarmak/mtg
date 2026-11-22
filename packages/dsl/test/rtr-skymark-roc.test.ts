import { describe, expect, it } from 'vitest';
import { ModelAbilitySchema, parseCard, renderOracleText, type AbilityInput, type CardInput } from '@mtg/dsl';

const ATTACK_TRIGGER: AbilityInput = {
  kind: 'triggered',
  condition: 'selfAttacks',
  printedSourceReference: 'thisCreature',
  optional: true,
  effects: [
    {
      kind: 'returnToHand',
      target: {
        kind: 'targetCreatureDefendingPlayerControls',
        restriction: { kind: 'maxToughness', toughness: 2 },
      },
    },
  ],
};

export const SKYMARK_ROC: CardInput = {
  kind: 'creature',
  id: 'rtr-196-skymark-roc',
  name: 'Skymark Roc',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 196 },
  manaCost: { generic: 2, W: 1, U: 1 },
  colors: ['W', 'U'],
  subtypes: ['Bird'],
  power: 3,
  toughness: 3,
  keywords: ['flying'],
  abilities: [ATTACK_TRIGGER],
};

describe('RTR #196 Skymark Roc', () => {
  it('renders exact current Oracle text in source order', () => {
    expect(renderOracleText(parseCard(SKYMARK_ROC))).toBe(
      [
        'Flying',
        "Whenever this creature attacks, you may return target creature defending player controls with toughness 2 or less to its owner's hand.",
      ].join('\n'),
    );
  });

  it('keeps the defending-player restriction outside model-generated abilities', () => {
    expect(ModelAbilitySchema.safeParse(ATTACK_TRIGGER).success).toBe(false);
  });
});
