/** Installed Forge 2.0.14 parity for RTR Jace, Architect of Thought. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

describe('Jace, Architect of Thought Forge export', () => {
  it('emits the installed delayed trigger, TwoPiles, and per-player search chain exactly', () => {
    const card = parseCard({
      kind: 'planeswalker',
      id: 'rtr-44-jace-architect-of-thought-forge',
      name: 'Jace, Architect of Thought',
      rarity: 'mythic',
      set: { code: 'RTR', collectorNumber: 44 },
      manaCost: { generic: 2, U: 2 },
      colors: ['U'],
      supertypes: ['legendary'],
      subtypes: ['Jace'],
      startingLoyalty: 4,
      abilities: [
        {
          kind: 'activated',
          cost: { mana: {} },
          loyaltyCost: 1,
          effects: [],
          jaceArchitectProfile: 'attackDebuff',
        },
        {
          kind: 'activated',
          cost: { mana: {} },
          loyaltyCost: -2,
          effects: [],
          jaceArchitectProfile: 'piles',
        },
        {
          kind: 'activated',
          cost: { mana: {} },
          loyaltyCost: -8,
          effects: [],
          jaceArchitectProfile: 'searchAndCast',
        },
      ],
    } satisfies CardInput);

    expect(mustTranspile(card)).toBe(
      [
        'Name:Jace, Architect of Thought',
        'ManaCost:2 U U',
        'Types:Legendary Planeswalker Jace',
        'Loyalty:4',
        'A:AB$ Effect | Cost$ AddCounter<1/LOYALTY> | Planeswalker$ True | Triggers$ TrigAttack | Duration$ UntilYourNextTurn | AILogic$ Main2 | SpellDescription$ Until your next turn, whenever a creature an opponent controls attacks, it gets -1/-0 until end of turn.',
        'SVar:TrigAttack:Mode$ Attacks | ValidCard$ Creature.OppCtrl | TriggerZones$ Command | Execute$ JacePump | TriggerDescription$ Until your next turn, whenever a creature an opponent controls attacks, it gets -1/-0 until end of turn.',
        'SVar:JacePump:DB$ Pump | Defined$ TriggeredAttackerLKICopy | NumAtt$ -1',
        'A:AB$ PeekAndReveal | Cost$ SubCounter<2/LOYALTY> | Planeswalker$ True | PeekAmount$ 3 | RememberRevealed$ True | NoPeek$ True | SubAbility$ DBTwoPiles | SpellDescription$ Reveal the top three cards of your library. An opponent separates those cards into two piles. Put one pile into your hand and the other on the bottom of your library in any order.',
        'SVar:DBTwoPiles:DB$ TwoPiles | Defined$ You | DefinedCards$ Remembered | Separator$ Opponent | ChosenPile$ DBHand | UnchosenPile$ DBLibraryBottom',
        'SVar:DBHand:DB$ ChangeZone | Defined$ Remembered | Origin$ Library | Destination$ Hand',
        'SVar:DBLibraryBottom:DB$ ChangeZoneAll | ChangeType$ Card.IsRemembered | Origin$ Library | Destination$ Library | LibraryPosition$ -1',
        "A:AB$ ChangeZone | Cost$ SubCounter<8/LOYALTY> | Planeswalker$ True | Ultimate$ True | Origin$ Library | Destination$ Exile | DefinedPlayer$ Player | Chooser$ You | ChangeType$ Card.nonLand | ChangeNum$ 1 | Imprint$ True | Shuffle$ True | SubAbility$ DBPlayIt | SpellDescription$ For each player, search that player's library for a nonland card and exile it, then that player shuffles. You may cast those cards without paying their mana costs.",
        'SVar:DBPlayIt:DB$ Play | Defined$ Imprinted | Amount$ All | Controller$ You | WithoutManaCost$ True | ValidSA$ Spell | Optional$ True | SubAbility$ DBCleanup',
        'SVar:DBCleanup:DB$ Cleanup | ClearImprinted$ True',
        "Oracle:[+1]: Until your next turn, whenever a creature an opponent controls attacks, it gets -1/-0 until end of turn.\\n[-2]: Reveal the top three cards of your library. An opponent separates those cards into two piles. Put one pile into your hand and the other on the bottom of your library in any order.\\n[-8]: For each player, search that player's library for a nonland card and exile it, then that player shuffles. You may cast those cards without paying their mana costs.",
        '',
      ].join('\n'),
    );
  });
});
