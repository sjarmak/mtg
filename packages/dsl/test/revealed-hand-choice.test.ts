/** Typed, hand-authored revealed-hand choices for two exact M13 identities. */
import { describe, expect, it } from 'vitest';
import type { CardInput, EffectInput } from '../src';
import { ModelEffectSchema, parseCard, renderOracleText } from '../src';

const MINDCLAW_CHOICE: EffectInput = {
  kind: 'chooseFromRevealedHand',
  target: { kind: 'targetOpponent' },
  filter: { cardTypes: ['instant', 'sorcery'] },
  outcome: { kind: 'mayCastWithoutPayingManaCost' },
};

const SHIMIAN_CHOICE: EffectInput = {
  kind: 'chooseFromRevealedHand',
  target: { kind: 'triggeringPlayer' },
  filter: { excludeCardTypes: ['land'] },
  outcome: { kind: 'exileAllCardsWithSameNameThenShuffle' },
};

function creature(name: string, collectorNumber: number, effects: EffectInput[]): CardInput {
  return {
    kind: 'creature',
    id: `m13-${String(collectorNumber).padStart(3, '0')}`,
    name,
    rarity: collectorNumber === 109 ? 'rare' : 'uncommon',
    set: { code: 'M13', collectorNumber },
    manaCost: collectorNumber === 109 ? { generic: 2, B: 2 } : { generic: 4, R: 1 },
    colors: collectorNumber === 109 ? ['B'] : ['R'],
    subtypes: collectorNumber === 109 ? ['Specter'] : ['Lizard', 'Shaman'],
    power: 2,
    toughness: 2,
    abilities: [
      {
        kind: 'triggered',
        condition: collectorNumber === 109 ? 'selfDealsCombatDamageToPlayer' : 'selfEnters',
        effects,
      },
    ],
  };
}

describe('revealed-hand choice DSL', () => {
  it('prints Mindclaw Shaman as one atomic reveal, filtered optional choice, and free cast', () => {
    const card = parseCard(creature('Mindclaw Shaman', 142, [MINDCLAW_CHOICE]));

    expect(renderOracleText(card)).toBe(
      'When Mindclaw Shaman enters the battlefield, target opponent reveals their hand. You may cast an instant or sorcery spell from among those cards without paying its mana cost.',
    );
  });

  it('prints Shimian Specter with the retained damaged player and linked chosen name', () => {
    const input = creature('Shimian Specter', 109, [SHIMIAN_CHOICE]);
    input.keywords = ['flying'];
    const card = parseCard(input);

    expect(renderOracleText(card)).toBe(
      "Flying\nWhenever Shimian Specter deals combat damage to a player, that player reveals their hand. You choose a nonland card from it. Search that player's graveyard, hand, and library for all cards with the same name as that card and exile them. Then that player shuffles.",
    );
  });

  it('keeps both linked outcomes outside the generator-facing schema', () => {
    expect(ModelEffectSchema.safeParse(MINDCLAW_CHOICE).success).toBe(false);
    expect(ModelEffectSchema.safeParse(SHIMIAN_CHOICE).success).toBe(false);
  });
});
