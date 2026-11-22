/** Installed Forge 2.0.14 parity for RTR Search the City. */
import { parseCard, type CardInput } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

describe('Search the City Forge export', () => {
  it('emits the installed remembered-card cast and land-play chains exactly', () => {
    const card = parseCard({
      kind: 'enchantment',
      id: 'rtr-49-search-the-city-forge',
      name: 'Search the City',
      rarity: 'rare',
      set: { code: 'RTR', collectorNumber: 49 },
      manaCost: { generic: 4, U: 1 },
      colors: ['U'],
      subtypes: [],
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfEnters',
          effects: [],
          searchTheCityProfile: 'exileTopFive',
        },
        {
          kind: 'triggered',
          condition: 'youCastSpell',
          optional: true,
          effects: [],
          searchTheCityProfile: 'matchingNameCompletion',
        },
      ],
    } satisfies CardInput);

    expect(mustTranspile(card)).toBe(
      [
        'Name:Search the City',
        'ManaCost:4 U',
        'Types:Enchantment',
        'T:Mode$ ChangesZone | ValidCard$ Card.Self | Origin$ Any | Destination$ Battlefield | Execute$ SetupSearch | TriggerDescription$ When CARDNAME enters, exile the top five cards of your library.',
        'SVar:SetupSearch:DB$ Dig | Defined$ You | DigNum$ 5 | ChangeNum$ All | DestinationZone$ Exile | RememberChanged$ True | ForgetOtherRemembered$ True',
        "T:Mode$ SpellCast | ValidCard$ Card.sharesNameWith Remembered | ValidActivatingPlayer$ You | TriggerZones$ Battlefield | OptionalDecider$ You | Execute$ TrigFind | TriggerDescription$ Whenever you play a card with the same name as one of the exiled cards, you may put one of those cards with that name into its owner's hand. Then if there are no cards exiled with CARDNAME, sacrifice it. If you do, take an extra turn after this one.",
        "T:Mode$ LandPlayed | ValidCard$ Land.YouCtrl+sharesNameWith Remembered | TriggerZones$ Battlefield | Execute$ TrigFind | OptionalDecider$ You | Secondary$ True | TriggerDescription$ Whenever you play a card with the same name as one of the exiled cards, you may put one of those cards with that name into its owner's hand. Then if there are no cards exiled with CARDNAME, sacrifice it. If you do, take an extra turn after this one.",
        'SVar:TrigFind:DB$ ChangeZone | ChangeType$ TriggeredCard.sharesNameWith | Hidden$ True | SelectPrompt$ Select a card exiled with CARDNAME that shares a name with the played card | Origin$ Exile | Destination$ Hand | ChangeNum$ 1 | ForgetChanged$ True | SubAbility$ SacSelf',
        'SVar:SacSelf:DB$ Sacrifice | ConditionCheckSVar$ StillLooking | ConditionSVarCompare$ EQ0 | RememberSacrificed$ True | SubAbility$ AllFoundCelebration',
        'SVar:AllFoundCelebration:DB$ AddTurn | NumTurns$ 1 | ConditionCheckSVar$ X | ConditionSVarCompare$ EQ1',
        'SVar:StillLooking:Remembered$Amount',
        'SVar:X:Remembered$Amount',
        "Oracle:When this enchantment enters, exile the top five cards of your library.\\nWhenever you play a card with the same name as one of the exiled cards, you may put one of those cards with that name into its owner's hand. Then if there are no cards exiled with this enchantment, sacrifice it. If you do, take an extra turn after this one.",
        '',
      ].join('\n'),
    );
  });
});
