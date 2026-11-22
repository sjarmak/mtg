/** Forge parity for RTR #197's name and three-zone exile chain. */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

describe('Slaughter Games', () => {
  /** Installed Forge source: forge-gui/res/cardsfolder/s/slaughter_games.txt. */
  it('writes the attested uncounterable NameCard and graveyard/hand/library chain', () => {
    const card = parseCard({
      kind: 'sorcery',
      id: 'rtr-197',
      name: 'Slaughter Games',
      rarity: 'rare',
      set: { code: 'RTR', collectorNumber: 197 },
      manaCost: { generic: 2, B: 1, R: 1 },
      colors: ['B', 'R'],
      cannotBeCountered: true,
      effects: [
        {
          kind: 'nameNonlandCardAndExileMatchingOpponentZones',
          target: { kind: 'targetOpponent' },
        },
      ],
    } as unknown as CardInput);

    expect(mustTranspile(card)).toBe(
      [
        'Name:Slaughter Games',
        'ManaCost:2 B R',
        'Types:Sorcery',
        "R:Event$ Counter | ValidCard$ Card.Self | ValidSA$ Spell | Layer$ CantHappen | Description$ This spell can't be countered.",
        "A:SP$ NameCard | Defined$ You | ValidCards$ Card.nonLand | ValidDescription$ nonland | SubAbility$ DBEffect1 | SpellDescription$ Choose a nonland card name. Search target opponent's graveyard, hand, and library for any number of cards with that name and exile them. Then that player shuffles.",
        'SVar:DBEffect1:DB$ ChangeZone | Origin$ Graveyard | Destination$ Exile | ValidTgts$ Player.Opponent | ChangeType$ Card.NamedCard | Chooser$ You | ChangeNum$ NumInYard | Hidden$ True | SubAbility$ DBEffect2',
        'SVar:DBEffect2:DB$ ChangeZone | Origin$ Hand | Destination$ Exile | DefinedPlayer$ Targeted | ChangeType$ Card.NamedCard | ChangeNum$ NumInHand | Chooser$ You | SubAbility$ DBEffect3',
        'SVar:DBEffect3:DB$ ChangeZone | Origin$ Library | Destination$ Exile | DefinedPlayer$ Targeted | ChangeType$ Card.NamedCard | ChangeNum$ NumInLib | Chooser$ You | Shuffle$ True',
        'SVar:NumInLib:TargetedPlayer$CardsInLibrary',
        'SVar:NumInHand:TargetedPlayer$CardsInHand',
        'SVar:NumInYard:TargetedPlayer$CardsInGraveyard',
        "Oracle:This spell can't be countered.\\nChoose a nonland card name. Search target opponent's graveyard, hand, and library for any number of cards with that name and exile them. Then that player shuffles.",
        '',
      ].join('\n'),
    );
  });
});
