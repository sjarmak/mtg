import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedRecurringNightmareRefusals, loadLegacyCubeSyntaxReview } from '@mtg/data';

const EXACT = [
  'Name:Recurring Nightmare',
  'ManaCost:2 B',
  'Types:Enchantment',
  'A:AB$ ChangeZone | Cost$ Sac<1/Creature> Return<1/CARDNAME> | TgtPrompt$ Choose target creature card in your graveyard | ValidTgts$ Creature.YouCtrl | Origin$ Graveyard | Destination$ Battlefield | SorcerySpeed$ True | AILogic$ SacAndRetFromGrave | SpellDescription$ Return target creature card from your graveyard to the battlefield. Activate only as a sorcery.',
  'SVar:AIPreference:SacCost$Creature',
  "Oracle:Sacrifice a creature, Return Recurring Nightmare to its owner's hand: Return target creature card from your graveyard to the battlefield. Activate only as a sorcery.",
] as const;

const syntax = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedRecurringNightmareRefusals(Buffer.from(lines.join('\n')), syntax);

describe('Legacy Cube reviewed Recurring Nightmare boundary', () => {
  it('admits only the exact complete installed script', () => {
    expect(refusal(EXACT)).toEqual([]);
  });

  it.each([
    ['identity', EXACT.map((line) => line.replace('Name:Recurring Nightmare', 'Name:Near Nightmare'))],
    ['mana cost', EXACT.map((line) => line.replace('ManaCost:2 B', 'ManaCost:3 B'))],
    ['card type', EXACT.map((line) => line.replace('Types:Enchantment', 'Types:Artifact'))],
    ['sacrifice count', EXACT.map((line) => line.replace('Sac<1/Creature>', 'Sac<2/Creature>'))],
    ['sacrifice type', EXACT.map((line) => line.replace('Sac<1/Creature>', 'Sac<1/Permanent>'))],
    ['return count', EXACT.map((line) => line.replace('Return<1/CARDNAME>', 'Return<2/CARDNAME>'))],
    ['return identity', EXACT.map((line) => line.replace('Return<1/CARDNAME>', 'Return<1/Enchantment>'))],
    ['target prompt', EXACT.map((line) => line.replace('Choose target creature card', 'Choose a card'))],
    [
      'target legality',
      EXACT.map((line) => line.replace('ValidTgts$ Creature.YouCtrl', 'ValidTgts$ Creature')),
    ],
    ['origin', EXACT.map((line) => line.replace('Origin$ Graveyard', 'Origin$ Hand'))],
    ['destination', EXACT.map((line) => line.replace('Destination$ Battlefield', 'Destination$ Hand'))],
    ['timing', EXACT.map((line) => line.replace('SorcerySpeed$ True', 'SorcerySpeed$ False'))],
    ['AI logic', EXACT.map((line) => line.replace('AILogic$ SacAndRetFromGrave', 'AILogic$ Never'))],
    ['preference', EXACT.filter((line) => !line.startsWith('SVar:AIPreference:'))],
    ['line order', [EXACT[1], EXACT[0], ...EXACT.slice(2)]],
    ['extra mechanic', [...EXACT, 'A:AB$ Draw | Cost$ 0 | NumCards$ 1']],
  ])('refuses %s drift as an exact-composition failure', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed Recurring Nightmare composition');
  });
});
