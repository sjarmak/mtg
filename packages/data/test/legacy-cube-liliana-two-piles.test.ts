import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedLilianaTwoPilesRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const exact = [
  'Name:Liliana of the Veil',
  'ManaCost:1 B B',
  'Types:Legendary Planeswalker Liliana',
  'Loyalty:3',
  'A:AB$ Discard | Cost$ AddCounter<1/LOYALTY> | Planeswalker$ True | NumCards$ 1 | Mode$ TgtChoose | Defined$ Player | SpellDescription$ Each player discards a card.',
  'A:AB$ Sacrifice | Cost$ SubCounter<2/LOYALTY> | Planeswalker$ True | ValidTgts$ Player | SacValid$ Creature | SpellDescription$ Target player sacrifices a creature.',
  'A:AB$ TwoPiles | Cost$ SubCounter<6/LOYALTY> | Planeswalker$ True | Ultimate$ True | ValidTgts$ Player | Separator$ You | ChosenPile$ DBSacAll | ValidCards$ Permanent | Zone$ Battlefield | AILogic$ Worst | StackDescription$ REP target player_{p:Targeted} | SpellDescription$ Separate all permanents target player controls into two piles. That player sacrifices all permanents in the pile of their choice.',
  'SVar:DBSacAll:DB$ SacrificeAll | ValidCards$ Permanent.IsRemembered',
  'DeckHas:Ability$Discard|Sacrifice',
  'Oracle:[+1]: Each player discards a card.\\n[-2]: Target player sacrifices a creature.\\n[-6]: Separate all permanents target player controls into two piles. That player sacrifices all permanents in the pile of their choice.',
];

const inventory = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]) =>
  legacyCubeReviewedLilianaTwoPilesRefusals(new TextEncoder().encode(`${lines.join('\n')}\n`), inventory);

describe('Legacy Cube reviewed Liliana of the Veil boundary', () => {
  it('admits only the exact whole-card TwoPiles composition', () => {
    expect(refusal(exact)).toEqual([]);
    for (const mutation of [
      exact.map((line) => line.replace('Name:Liliana of the Veil', 'Name:Other')),
      exact.map((line) => line.replace('SubCounter<6/LOYALTY>', 'SubCounter<5/LOYALTY>')),
      exact.map((line) => line.replace('ValidTgts$ Player', 'ValidTgts$ Opponent')),
      exact.map((line) => line.replace('Separator$ You', 'Separator$ Targeted')),
      exact.map((line) => line.replace('ChosenPile$ DBSacAll', 'ChosenPile$ Other')),
      exact.map((line) => line.replace('ValidCards$ Permanent | Zone$', 'ValidCards$ Creature | Zone$')),
      exact.map((line) => line.replace('Permanent.IsRemembered', 'Creature.IsRemembered')),
      exact.filter((line) => !line.startsWith('SVar:DBSacAll:')),
      [...exact, 'SVar:Extra:DB$ Draw'],
    ]) {
      expect(refusal(mutation)).toContain('exact reviewed Liliana of the Veil composition');
    }
  });
});
