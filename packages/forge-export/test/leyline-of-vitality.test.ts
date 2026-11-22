/** Source-attested Forge parity for M11 Leyline of Vitality. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

describe('Leyline of Vitality Forge export', () => {
  it('emits Forge current card source exactly', () => {
    const card = parseCard({
      kind: 'enchantment',
      id: 'm11-183-leyline-of-vitality-forge',
      name: 'Leyline of Vitality',
      rarity: 'rare',
      set: { code: 'M11', collectorNumber: 183 },
      manaCost: { generic: 2, G: 2 },
      colors: ['G'],
      openingHandAction: { kind: 'beginOnBattlefield' },
      abilities: [
        {
          kind: 'static',
          scope: 'creaturesYouControl',
          subtype: null,
          modification: { kind: 'statBonus', power: 0, toughness: 1 },
        },
        {
          kind: 'triggered',
          condition: 'controlledCreatureEnters',
          optional: true,
          effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
        },
      ],
    });

    expect(mustTranspile(card)).toBe(
      [
        'Name:Leyline of Vitality',
        'ManaCost:2 G G',
        'Types:Enchantment',
        'K:MayEffectFromOpeningHand:FromHand',
        'SVar:FromHand:DB$ ChangeZone | Defined$ Self | Origin$ Hand | Destination$ Battlefield | SpellDescription$ If CARDNAME is in your opening hand, you may begin the game with it on the battlefield.',
        'S:Mode$ Continuous | Affected$ Creature.YouCtrl | AddToughness$ 1 | Description$ Creatures you control get +0/+1.',
        'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Creature.YouCtrl | TriggerZones$ Battlefield | Execute$ Trig2Effect1 | OptionalDecider$ You | TriggerDescription$ Whenever a creature you control enters, you may gain 1 life.',
        'SVar:Trig2Effect1:DB$ GainLife | Defined$ You | LifeAmount$ 1',
        'DeckHas:Ability$LifeGain',
        'Oracle:If Leyline of Vitality is in your opening hand, you may begin the game with it on the battlefield.\\nCreatures you control get +0/+1.\\nWhenever a creature you control enters, you may gain 1 life.',
        '',
      ].join('\n'),
    );
  });
});
