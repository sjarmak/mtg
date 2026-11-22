import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedGiftsUngivenRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const exact = [
  'Name:Gifts Ungiven',
  'ManaCost:3 U',
  'Types:Instant',
  'A:SP$ ChangeZone | Origin$ Library | Destination$ Library | ChangeType$ Card | ChangeNum$ 4 | RememberChanged$ True | Reveal$ True | Shuffle$ False | DifferentNames$ True | SubAbility$ DBChangeZone1 | StackDescription$ REP Search_{p:You} searches & your library_their library & reveal_reveals | SpellDescription$ Search your library for up to four cards with different names and reveal them.',
  'SVar:DBChangeZone1:DB$ ChangeZone | ValidTgts$ Opponent | DefinedPlayer$ You | Chooser$ Targeted | SelectPrompt$ Choose two cards for the graveyard | NoLooking$ True | Hidden$ True | Origin$ Library | Destination$ Graveyard | ChangeType$ Card.IsRemembered | ChangeNum$ 2 | Mandatory$ True | SelectPrompt$ Select two cards for the graveyard | Shuffle$ False | SubAbility$ DBChangeZone2 | StackDescription$ REP Target opponent_{p:Targeted} & Put_{p:You} puts & your graveyard_their graveyard & your hand_their hand & shuffle_{p:You} shuffles | SpellDescription$ Target opponent chooses two of those cards. Put the chosen cards into your graveyard and the rest into your hand. Then shuffle.',
  'SVar:DBChangeZone2:DB$ ChangeZoneAll | Origin$ Library | Destination$ Hand | ChangeType$ Card.IsRemembered | Shuffle$ True | SubAbility$ DBCleanup | StackDescription$ None',
  'SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True',
  'DeckHints:Ability$Graveyard',
  'Oracle:Search your library for up to four cards with different names and reveal them. Target opponent chooses two of those cards. Put the chosen cards into your graveyard and the rest into your hand. Then shuffle.',
];

const inventory = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]) =>
  legacyCubeReviewedGiftsUngivenRefusals(new TextEncoder().encode(`${lines.join('\n')}\n`), inventory);

describe('Legacy Cube reviewed Gifts Ungiven boundary', () => {
  it('admits only the exact whole-card composition', () => {
    expect(refusal(exact)).toEqual([]);
    for (const mutation of [
      exact.map((line) => line.replace('Name:Gifts Ungiven', 'Name:Other')),
      exact.map((line) => line.replace('ChangeNum$ 4', 'ChangeNum$ 3')),
      exact.map((line) => line.replace('DifferentNames$ True', 'DifferentNames$ False')),
      exact.map((line) => line.replace('RememberChanged$ True', 'RememberChanged$ False')),
      exact.map((line) => line.replace('Reveal$ True', 'Reveal$ False')),
      exact.map((line) => line.replace('Destination$ Library', 'Destination$ Hand')),
      exact.map((line) => line.replace('ValidTgts$ Opponent', 'ValidTgts$ Player')),
      exact.filter((line) => !line.startsWith('SVar:DBCleanup:')),
      [...exact, 'SVar:Extra:DB$ Draw'],
    ]) {
      expect(refusal(mutation)).toContain('exact reviewed Gifts Ungiven composition');
    }
  });
});
