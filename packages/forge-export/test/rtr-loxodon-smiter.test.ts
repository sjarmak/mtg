import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

describe('RTR #178 Loxodon Smiter Forge export', () => {
  it('matches the current upstream replacement script', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'rtr-178',
      name: 'Loxodon Smiter',
      rarity: 'rare',
      set: { code: 'RTR', collectorNumber: 178 },
      manaCost: { generic: 1, G: 1, W: 1 },
      colors: ['G', 'W'],
      subtypes: ['Elephant', 'Soldier'],
      power: 4,
      toughness: 4,
      cannotBeCountered: true,
      abilities: [
        {
          kind: 'static',
          scope: 'self',
          subtype: null,
          printedSourceReference: 'thisCard',
          modification: { kind: 'discardedByOpponentEntersBattlefield' },
        },
      ],
    });

    expect(mustTranspile(card)).toBe(
      [
        'Name:Loxodon Smiter',
        'ManaCost:1 W G',
        'Types:Creature Elephant Soldier',
        'PT:4/4',
        "R:Event$ Counter | ValidCard$ Card.Self | ValidSA$ Spell | Layer$ CantHappen | Description$ This spell can't be countered.",
        'R:Event$ Moved | ActiveZones$ Hand | ValidCard$ Card.Self | ValidCause$ SpellAbility.OppCtrl | Discard$ True | EffectOnly$ True | ReplaceWith$ SurpriseETB | Description$ If a spell or ability an opponent controls causes you to discard CARDNAME, put it onto the battlefield instead of putting it into your graveyard.',
        'SVar:SurpriseETB:DB$ ChangeZone | Defined$ ReplacedCard | Origin$ Hand | Destination$ Battlefield',
        'SVar:DiscardMeByOpp:2',
        "Oracle:This spell can't be countered.\\nIf a spell or ability an opponent controls causes you to discard Loxodon Smiter, put it onto the battlefield instead of putting it into your graveyard.",
        '',
      ].join('\n'),
    );
  });
});
