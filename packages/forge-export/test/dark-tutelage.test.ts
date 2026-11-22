/** Source-attested Forge parity for M11 Dark Tutelage. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const DARK_TUTELAGE = parseCard({
  kind: 'enchantment',
  id: 'm11-090-dark-tutelage-forge',
  name: 'Dark Tutelage',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 90 },
  manaCost: { generic: 2, B: 1 },
  colors: ['B'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'beginningOfYourUpkeep',
      effects: [
        { kind: 'revealTopCardToHand' },
        {
          kind: 'loseLife',
          amount: { kind: 'revealedCardManaValueThisResolution' },
          target: { kind: 'noTarget' },
        },
      ],
    },
  ],
});

describe('Dark Tutelage Forge export', () => {
  it('emits the shipped Dig, remembered mana value, and cleanup protocol exactly', () => {
    expect(mustTranspile(DARK_TUTELAGE)).toBe(
      [
        'Name:Dark Tutelage',
        'ManaCost:2 B',
        'Types:Enchantment',
        'T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | TriggerZones$ Battlefield | Execute$ Trig1Effect1 | TriggerDescription$ At the beginning of your upkeep, reveal the top card of your library and put that card into your hand. You lose life equal to its mana value.',
        'SVar:Trig1Effect1:DB$ Dig | DigNum$ 1 | Reveal$ True | ChangeNum$ All | ChangeValid$ Card | DestinationZone$ Hand | RememberChanged$ True | SubAbility$ Trig1Effect2',
        'SVar:Trig1Effect2:DB$ LoseLife | Defined$ You | LifeAmount$ X | SubAbility$ Trig1Effect3',
        'SVar:Trig1Effect3:DB$ Cleanup | ClearRemembered$ True',
        'SVar:X:Remembered$CardManaCost',
        'Oracle:At the beginning of your upkeep, reveal the top card of your library and put that card into your hand. You lose life equal to its mana value.',
        '',
      ].join('\n'),
    );
  });
});
