/** Source-attested Forge parity for M11 Wild Evocation. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

describe('Wild Evocation Forge export', () => {
  it('emits the current Forge reveal, land-move, free-cast, and cleanup chain', () => {
    const card = parseCard({
      kind: 'enchantment',
      id: 'm11-160-wild-evocation-forge',
      name: 'Wild Evocation',
      rarity: 'rare',
      set: { code: 'M11', collectorNumber: 160 },
      manaCost: { generic: 5, R: 1 },
      colors: ['R'],
      abilities: [
        {
          kind: 'triggered',
          condition: 'beginningOfEachPlayersUpkeep',
          effects: [
            {
              kind: 'playRandomHandCardWithoutPayingManaCost',
              target: { kind: 'triggeringPlayer' },
            },
          ],
        },
      ],
    } as unknown as CardInput);

    expect(mustTranspile(card)).toBe(
      [
        'Name:Wild Evocation',
        'ManaCost:5 R',
        'Types:Enchantment',
        "T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ Player | TriggerZones$ Battlefield | Execute$ Trig1Effect1 | TriggerDescription$ At the beginning of each player's upkeep, that player reveals a card at random from their hand. If it's a land card, the player puts it onto the battlefield. Otherwise, the player casts it without paying its mana cost if able.",
        'SVar:Trig1Effect1:DB$ Reveal | Random$ True | RememberRevealed$ True | Defined$ TriggeredPlayer | SubAbility$ Trig1Effect1Hold',
        'SVar:Trig1Effect1Hold:DB$ ChangeZone | Origin$ Hand | Destination$ Battlefield | Defined$ ValidHand Land.IsRemembered | ForgetChanged$ True | SubAbility$ Trig1Effect1Hold2',
        'SVar:Trig1Effect1Hold2:DB$ Play | ValidZone$ Hand | Controller$ TriggeredPlayer | Defined$ Remembered | ValidSA$ Spell | WithoutManaCost$ True | SubAbility$ Trig1Effect1Hold3',
        'SVar:Trig1Effect1Hold3:DB$ Cleanup | ClearRemembered$ True',
        "Oracle:At the beginning of each player's upkeep, that player reveals a card at random from their hand. If it's a land card, the player puts it onto the battlefield. Otherwise, the player casts it without paying its mana cost if able.",
        '',
      ].join('\n'),
    );
  });
});
