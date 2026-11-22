/** Source-attested Forge parity for M11 Merfolk Spy. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

describe('Merfolk Spy Forge export', () => {
  it('emits Forge current card source exactly', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'm11-066-merfolk-spy-forge',
      name: 'Merfolk Spy',
      rarity: 'common',
      set: { code: 'M11', collectorNumber: 66 },
      manaCost: { U: 1 },
      colors: ['U'],
      subtypes: ['Merfolk', 'Rogue'],
      power: 1,
      toughness: 1,
      keywordAbilities: [{ kind: 'landwalk', landType: 'Island' }],
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfDealsCombatDamageToPlayer',
          effects: [{ kind: 'revealRandomCardFromHand', target: { kind: 'triggeringPlayer' } }],
        },
      ],
    } as unknown as CardInput);

    expect(mustTranspile(card)).toBe(
      [
        'Name:Merfolk Spy',
        'ManaCost:U',
        'Types:Creature Merfolk Rogue',
        'PT:1/1',
        'K:Landwalk:Island',
        'T:Mode$ DamageDone | ValidSource$ Card.Self | ValidTarget$ Player | CombatDamage$ True | TriggerZones$ Battlefield | Execute$ Trig1Effect1 | TriggerDescription$ Whenever CARDNAME deals combat damage to a player, that player reveals a card at random from their hand.',
        'SVar:Trig1Effect1:DB$ Reveal | Random$ True | Defined$ TriggeredTarget',
        'Oracle:Islandwalk\\nWhenever Merfolk Spy deals combat damage to a player, that player reveals a card at random from their hand.',
        '',
      ].join('\n'),
    );
  });
});
