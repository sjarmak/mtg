import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedEngineeredExplosivesRefusals, loadLegacyCubeSyntaxReview } from '@mtg/data';

const EXACT = [
  'Name:Engineered Explosives',
  'ManaCost:X',
  'Types:Artifact',
  'K:Sunburst',
  'A:AB$ DestroyAll | Cost$ 2 Sac<1/CARDNAME> | ValidCards$ Permanent.nonLand+cmcEQY | SpellDescription$ Destroy each nonland permanent with mana value equal to the number of charge counters on CARDNAME.',
  'SVar:X:Count$xPaid',
  'SVar:Y:Count$CardCounters.CHARGE',
  'SVar:NonStackingEffect:True',
  'AI:RemoveDeck:All',
  'DeckHints:Ability$Proliferate',
  'Oracle:Sunburst (This enters with a charge counter on it for each color of mana spent to cast it.)\\n{2}, Sacrifice Engineered Explosives: Destroy each nonland permanent with mana value equal to the number of charge counters on Engineered Explosives.',
] as const;

const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedEngineeredExplosivesRefusals(
    new TextEncoder().encode(`${lines.join('\n')}\n`),
    loadLegacyCubeSyntaxReview(),
  );

describe('Legacy Cube reviewed Engineered Explosives boundary', () => {
  it('admits only the exact installed Sunburst and fixed-source sacrifice composition', () => {
    expect(refusal(EXACT)).toEqual([]);
  });

  it.each([
    ['identity', EXACT.map((line) => line.replace('Name:Engineered Explosives', 'Name:Engineered Charge'))],
    ['mana cost', EXACT.map((line) => line.replace('ManaCost:X', 'ManaCost:X X'))],
    ['type', EXACT.map((line) => line.replace('Types:Artifact', 'Types:Creature Construct'))],
    ['keyword', EXACT.map((line) => line.replace('K:Sunburst', 'K:Flying'))],
    ['ability API', EXACT.map((line) => line.replace('AB$ DestroyAll', 'AB$ SacrificeAll'))],
    [
      'activation cost',
      EXACT.map((line) => line.replace('Cost$ 2 Sac<1/CARDNAME>', 'Cost$ 1 Sac<1/CARDNAME>')),
    ],
    ['sacrifice object', EXACT.map((line) => line.replace('Sac<1/CARDNAME>', 'Sac<1/Artifact>'))],
    ['destruction filter', EXACT.map((line) => line.replace('Permanent.nonLand+cmcEQY', 'Permanent+cmcEQY'))],
    ['X binding', EXACT.map((line) => line.replace('Count$xPaid', 'Count$ChosenNumber'))],
    ['counter type', EXACT.map((line) => line.replace('CardCounters.CHARGE', 'CardCounters.P1P1'))],
    ['nonstacking marker', EXACT.filter((line) => line !== 'SVar:NonStackingEffect:True')],
    ['AI marker', EXACT.filter((line) => line !== 'AI:RemoveDeck:All')],
    ['deck hint', EXACT.filter((line) => line !== 'DeckHints:Ability$Proliferate')],
    ['Oracle text', EXACT.map((line) => line.replace('each color of mana', 'each mana'))],
    ['ordering', [EXACT[1]!, EXACT[0]!, ...EXACT.slice(2)]],
    ['extra syntax', [...EXACT, 'SVar:Unreviewed:DB$ PutCounter | CounterType$ CHARGE']],
  ])('refuses hostile %s drift', (_label, lines) => {
    expect(refusal(lines)).toContain('exact reviewed Engineered Explosives composition');
  });
});
