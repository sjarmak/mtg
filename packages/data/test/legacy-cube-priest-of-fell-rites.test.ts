import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedPriestOfFellRitesRefusals, loadLegacyCubeSyntaxReview } from '@mtg/data';

const EXACT = [
  'Name:Priest of Fell Rites',
  'ManaCost:W B',
  'Types:Creature Human Warlock',
  'PT:2/2',
  'A:AB$ ChangeZone | Cost$ T PayLife<3> Sac<1/CARDNAME> | Origin$ Graveyard | Destination$ Battlefield | TgtPrompt$ Choose target creature card in your graveyard | ValidTgts$ Creature.YouCtrl | SorcerySpeed$ True | SpellDescription$ Return target creature card from your graveyard to the battlefield.',
  'K:Unearth:3 W B',
  'Oracle:{T}, Pay 3 life, Sacrifice Priest of Fell Rites: Return target creature card from your graveyard to the battlefield. Activate only as a sorcery.\\nUnearth {3}{W}{B} ({3}{W}{B}: Return this card from your graveyard to the battlefield. It gains haste. Exile it at the beginning of the next end step or if it would leave the battlefield. Unearth only as a sorcery.)',
] as const;

const syntax = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedPriestOfFellRitesRefusals(Buffer.from(lines.join('\n')), syntax);

describe('Legacy Cube reviewed Priest of Fell Rites boundary', () => {
  it('admits only the exact complete installed script', () => {
    expect(refusal(EXACT)).toEqual([]);
  });

  it.each([
    ['identity', EXACT.map((line) => line.replace('Name:Priest of Fell Rites', 'Name:Near Priest'))],
    ['mana cost', EXACT.map((line) => line.replace('ManaCost:W B', 'ManaCost:1 W B'))],
    ['card type', EXACT.map((line) => line.replace('Types:Creature Human Warlock', 'Types:Creature Cleric'))],
    ['power and toughness', EXACT.map((line) => line.replace('PT:2/2', 'PT:3/2'))],
    ['effect', EXACT.map((line) => line.replace('A:AB$ ChangeZone', 'A:AB$ Draw'))],
    ['tap cost', EXACT.map((line) => line.replace('Cost$ T PayLife<3>', 'Cost$ PayLife<3>'))],
    ['life cost', EXACT.map((line) => line.replace('PayLife<3>', 'PayLife<2>'))],
    ['sacrifice count', EXACT.map((line) => line.replace('Sac<1/CARDNAME>', 'Sac<2/CARDNAME>'))],
    ['sacrifice identity', EXACT.map((line) => line.replace('Sac<1/CARDNAME>', 'Sac<1/Creature>'))],
    ['origin', EXACT.map((line) => line.replace('Origin$ Graveyard', 'Origin$ Hand'))],
    ['destination', EXACT.map((line) => line.replace('Destination$ Battlefield', 'Destination$ Hand'))],
    ['target prompt', EXACT.map((line) => line.replace('Choose target creature card', 'Choose a card'))],
    [
      'target legality',
      EXACT.map((line) => line.replace('ValidTgts$ Creature.YouCtrl', 'ValidTgts$ Creature')),
    ],
    ['timing', EXACT.map((line) => line.replace('SorcerySpeed$ True', 'SorcerySpeed$ False'))],
    ['Unearth cost', EXACT.map((line) => line.replace('K:Unearth:3 W B', 'K:Unearth:4 W B'))],
    ['Unearth keyword', EXACT.map((line) => line.replace('K:Unearth:3 W B', 'K:Flashback:3 W B'))],
    ['line order', [EXACT[1], EXACT[0], ...EXACT.slice(2)]],
    ['extra mechanic', [...EXACT, 'A:AB$ Draw | Cost$ 0 | NumCards$ 1']],
  ])('refuses %s drift as an exact-composition failure', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed Priest of Fell Rites composition');
  });
});
