/** Source-attested Forge parity for M13 Jace, Memory Adept. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

describe('Jace, Memory Adept Forge export', () => {
  it('emits the pinned Forge 2.0.14 loyalty and plural-player draw rows', () => {
    const card = parseCard({
      kind: 'planeswalker',
      id: 'm13-56-jace-memory-adept-forge',
      name: 'Jace, Memory Adept',
      rarity: 'mythic',
      set: { code: 'M13', collectorNumber: 56 },
      manaCost: { generic: 3, U: 2 },
      colors: ['U'],
      supertypes: ['legendary'],
      subtypes: ['Jace'],
      startingLoyalty: 4,
      abilities: [
        {
          kind: 'activated',
          cost: { mana: {} },
          loyaltyCost: 1,
          effects: [
            { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } },
            { kind: 'millCards', count: 1, target: { kind: 'targetPlayer' } },
          ],
        },
        {
          kind: 'activated',
          cost: { mana: {} },
          loyaltyCost: 0,
          effects: [{ kind: 'millCards', count: 10, target: { kind: 'targetPlayer' } }],
        },
        {
          kind: 'activated',
          cost: { mana: {} },
          loyaltyCost: -7,
          effects: [
            {
              kind: 'drawCards',
              count: 20,
              target: { kind: 'targetPlayer', anyNumber: true },
            },
          ],
        },
      ],
    } satisfies CardInput);

    expect(mustTranspile(card)).toBe(
      [
        'Name:Jace, Memory Adept',
        'ManaCost:3 U U',
        'Types:Legendary Planeswalker Jace',
        'Loyalty:4',
        'A:AB$ Draw | Cost$ AddCounter<1/LOYALTY> | Defined$ You | NumCards$ 1 | Planeswalker$ True | SubAbility$ Act1Effect2 | SpellDescription$ Draw a card. Target player mills a card.',
        'SVar:Act1Effect2:DB$ Mill | ValidTgts$ Player | NumCards$ 1',
        'A:AB$ Mill | Cost$ AddCounter<0/LOYALTY> | ValidTgts$ Player | NumCards$ 10 | Planeswalker$ True | SpellDescription$ Target player mills ten cards.',
        'A:AB$ Draw | Cost$ SubCounter<7/LOYALTY> | ValidTgts$ Player | TargetMin$ 0 | TargetMax$ MaxTgt | NumCards$ 20 | Planeswalker$ True | Ultimate$ True | SpellDescription$ Any number of target players each draw twenty cards.',
        'SVar:MaxTgt:PlayerCountPlayers$Amount',
        'Oracle:[+1]: Draw a card. Target player mills a card.\\n[0]: Target player mills ten cards.\\n[-7]: Any number of target players each draw twenty cards.',
        '',
      ].join('\n'),
    );
  });
});
