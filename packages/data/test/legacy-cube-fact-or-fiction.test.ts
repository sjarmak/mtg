import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedFactOrFictionRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const exact = [
  'Name:Fact or Fiction',
  'ManaCost:3 U',
  'Types:Instant',
  'A:SP$ PeekAndReveal | PeekAmount$ 5 | RememberRevealed$ True | NoPeek$ True | SubAbility$ DBTwoPiles | SpellDescription$ Reveal the top five cards of your library. An opponent separates those cards into two piles. Put one pile into your hand and the other into your graveyard.',
  'SVar:DBTwoPiles:DB$ TwoPiles | Defined$ You | DefinedCards$ Remembered | Separator$ Opponent | ChosenPile$ DBHand | UnchosenPile$ DBGrave | StackDescription$ An opponent separates those cards into two piles. {p:You} puts one pile into their hand and the other into their graveyard.',
  'SVar:DBHand:DB$ ChangeZone | Defined$ Remembered | Origin$ Library | Destination$ Hand',
  'SVar:DBGrave:DB$ ChangeZone | Defined$ Remembered | Origin$ Library | Destination$ Graveyard',
  'Oracle:Reveal the top five cards of your library. An opponent separates those cards into two piles. Put one pile into your hand and the other into your graveyard.',
];

const inventory = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]) =>
  legacyCubeReviewedFactOrFictionRefusals(new TextEncoder().encode(`${lines.join('\n')}\n`), inventory);

describe('Legacy Cube reviewed Fact or Fiction boundary', () => {
  it('admits only the exact remembered-reveal TwoPiles composition', () => {
    expect(refusal(exact)).toEqual([]);
    for (const mutation of [
      exact.map((line) => line.replace('Name:Fact or Fiction', 'Name:Other')),
      exact.map((line) => line.replace('PeekAmount$ 5', 'PeekAmount$ 4')),
      exact.map((line) => line.replace('RememberRevealed$ True', 'RememberRevealed$ False')),
      exact.map((line) => line.replace('DefinedCards$ Remembered', 'DefinedCards$ TopFive')),
      exact.map((line) => line.replace('Separator$ Opponent', 'Separator$ You')),
      exact.map((line) => line.replace('ChosenPile$ DBHand', 'ChosenPile$ DBGrave')),
      exact.map((line) => line.replace('Destination$ Hand', 'Destination$ Exile')),
      exact.map((line) => line.replace('Destination$ Graveyard', 'Destination$ Exile')),
      exact.filter((line) => !line.startsWith('SVar:DBHand:')),
      exact.filter((line) => !line.startsWith('SVar:DBGrave:')),
      [...exact, 'SVar:Extra:DB$ Draw'],
    ]) {
      expect(refusal(mutation)).toContain('exact reviewed Fact or Fiction composition');
    }
  });
});
