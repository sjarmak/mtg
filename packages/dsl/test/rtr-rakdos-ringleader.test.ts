import { describe, expect, it } from 'vitest';
import { ModelAbilitySchema, ModelEffectSchema, parseCard, renderOracleText, validateCard } from '@mtg/dsl';

const RINGLEADER = {
  kind: 'creature',
  id: 'rtr-186-rakdos-ringleader-dsl',
  name: 'Rakdos Ringleader',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 186 },
  manaCost: { generic: 4, B: 1, R: 1 },
  colors: ['B', 'R'],
  subtypes: ['Skeleton', 'Warrior'],
  keywords: ['firstStrike'],
  power: 3,
  toughness: 1,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfDealsCombatDamageToPlayer',
      printedSourceReference: 'thisCreature',
      effects: [{ kind: 'discardCards', count: 1, target: { kind: 'triggeringPlayer' }, random: true }],
    },
    {
      kind: 'activated',
      cost: { mana: { B: 1 } },
      regenerateSelf: true,
      printedSourceReference: 'thisCreature',
      effects: [],
    },
  ],
} as const;

describe('RTR #186 Rakdos Ringleader', () => {
  it('renders every source-attested line in exact current Oracle order', () => {
    const card = parseCard(RINGLEADER);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      'First strike\nWhenever this creature deals combat damage to a player, that player discards a card at random.\n{B}: Regenerate this creature.',
    );
  });

  it('keeps the retained-player random discard outside generator output', () => {
    const card = parseCard(RINGLEADER);
    const trigger = card.abilities[0];
    if (trigger?.kind !== 'triggered') throw new Error('Ringleader trigger order drifted');
    expect(ModelAbilitySchema.safeParse(trigger).success).toBe(false);
    expect(ModelEffectSchema.safeParse(trigger.effects[0]).success).toBe(false);
  });
});
