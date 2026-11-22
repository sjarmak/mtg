/** Forge parity for Spelltwine's remembered two-graveyard card-copy cast chain. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

describe('Spelltwine', () => {
  /**
   * Source: Card-Forge/forge at a8fbfd41d38c732b7204cfb17e75332d2483fb9e,
   * `forge-gui/res/cardsfolder/s/spelltwine.txt`.
   */
  it('writes both owned graveyard targets, remembered copies, free casts, source exile, and cleanup', () => {
    const card = parseCard({
      kind: 'sorcery',
      id: 'm13-072',
      name: 'Spelltwine',
      rarity: 'rare',
      set: { code: 'M13', collectorNumber: 72 },
      manaCost: { generic: 5, U: 1 },
      colors: ['U'],
      effects: [
        {
          kind: 'exileTarget',
          target: {
            kind: 'targetCardInYourGraveyard',
            filter: { cardTypes: ['instant', 'sorcery'] },
          },
        },
        {
          kind: 'exileTarget',
          target: {
            kind: 'targetCardInOpponentsGraveyard',
            filter: { cardTypes: ['instant', 'sorcery'] },
          },
        },
        { kind: 'castCopiesOfCardsExiledThisResolutionWithoutPayingManaCosts' },
        { kind: 'exileThisSpell' },
      ],
    } as CardInput);

    expect(mustTranspile(card)).toBe(
      [
        'Name:Spelltwine',
        'ManaCost:5 U',
        'Types:Sorcery',
        "A:SP$ ChangeZone | ValidTgts$ Instant.YouCtrl,Sorcery.YouCtrl | Origin$ Graveyard | Destination$ Exile | RememberChanged$ True | SubAbility$ DBEffect1 | SpellDescription$ Exile target instant or sorcery card from your graveyard and target instant or sorcery card from an opponent's graveyard. Copy those cards. Cast the copies if able without paying their mana costs. Exile CARDNAME.",
        'SVar:DBEffect1:DB$ ChangeZone | ValidTgts$ Instant.OppOwn,Sorcery.OppOwn | Origin$ Graveyard | Destination$ Exile | RememberChanged$ True | SubAbility$ DBEffect2',
        'SVar:DBEffect2:DB$ Play | Defined$ Remembered | Amount$ All | CopyCard$ True | WithoutManaCost$ True | SubAbility$ DBEffect3',
        'SVar:DBEffect3:DB$ ChangeZone | Origin$ Stack | Destination$ Exile | SubAbility$ DBEffect4',
        'SVar:DBEffect4:DB$ Cleanup | ClearRemembered$ True',
        "Oracle:Exile target instant or sorcery card from your graveyard and target instant or sorcery card from an opponent's graveyard. Copy those cards. Cast the copies if able without paying their mana costs. Exile Spelltwine.",
        '',
      ].join('\n'),
    );
  });
});
