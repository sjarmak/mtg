import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedBirthingPodRefusals, loadLegacyCubeSyntaxReview } from '@mtg/data';

const EXACT = [
  'Name:Birthing Pod',
  'ManaCost:3 GP',
  'Types:Artifact',
  "A:AB$ ChangeZone | Cost$ 1 GP T Sac<1/Creature> | Origin$ Library | Destination$ Battlefield | ChangeType$ Creature.cmcEQX | ChangeNum$ 1 | SorcerySpeed$ True | AILogic$ SacAndUpgrade | StackDescription$ Search your library for a creature card with mana value equal to 1 plus the sacrificed creature's mana value, put that card onto the battlefield, then shuffle. | SpellDescription$ Search your library for a creature card with mana value equal to 1 plus the sacrificed creature's mana value, put that card onto the battlefield, then shuffle. Activate only as a sorcery.",
  'SVar:X:Sacrificed$CardManaCost/Plus.1',
  '# AI Preference is needed to make the AI consider the ability. Further constraints are defined by AILogic SacAndUpgrade.',
  'SVar:AIPreference:SacCost$Creature',
  "Oracle:({G/P} can be paid with either {G} or 2 life.)\\n{1}{G/P}, {T}, Sacrifice a creature: Search your library for a creature card with mana value equal to 1 plus the sacrificed creature's mana value, put that card onto the battlefield, then shuffle. Activate only as a sorcery.",
] as const;

const syntax = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedBirthingPodRefusals(Buffer.from(lines.join('\n')), syntax);

describe('Legacy Cube reviewed Birthing Pod boundary', () => {
  it('admits only the exact complete installed script', () => {
    expect(refusal(EXACT)).toEqual([]);
  });

  it.each([
    ['identity', EXACT.map((line) => line.replace('Name:Birthing Pod', 'Name:Near Pod'))],
    ['spell mana cost', EXACT.map((line) => line.replace('ManaCost:3 GP', 'ManaCost:4 GP'))],
    ['activation generic cost', EXACT.map((line) => line.replace('Cost$ 1 GP', 'Cost$ 2 GP'))],
    ['activation Phyrexian symbol', EXACT.map((line) => line.replace('Cost$ 1 GP', 'Cost$ 1 G'))],
    ['tap cost', EXACT.map((line) => line.replace(' GP T Sac', ' GP Sac'))],
    ['sacrifice count', EXACT.map((line) => line.replace('Sac<1/Creature>', 'Sac<2/Creature>'))],
    ['sacrifice type', EXACT.map((line) => line.replace('Sac<1/Creature>', 'Sac<1/Permanent>'))],
    ['origin', EXACT.map((line) => line.replace('Origin$ Library', 'Origin$ Graveyard'))],
    ['destination', EXACT.map((line) => line.replace('Destination$ Battlefield', 'Destination$ Hand'))],
    [
      'selection type',
      EXACT.map((line) => line.replace('ChangeType$ Creature.cmcEQX', 'ChangeType$ Card.cmcEQX')),
    ],
    ['selection count', EXACT.map((line) => line.replace('ChangeNum$ 1', 'ChangeNum$ 2'))],
    ['timing', EXACT.map((line) => line.replace('SorcerySpeed$ True', 'SorcerySpeed$ False'))],
    [
      'derivation subject',
      EXACT.map((line) => line.replace('Sacrificed$CardManaCost', 'Count$CardManaCost')),
    ],
    ['derivation increment', EXACT.map((line) => line.replace('/Plus.1', '/Plus.2'))],
    ['line order', [EXACT[1], EXACT[0], ...EXACT.slice(2)]],
    ['extra mechanic', [...EXACT, 'A:AB$ Draw | Cost$ 0 | NumCards$ 1']],
  ])('refuses %s drift as an exact-composition failure', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed Birthing Pod composition');
  });
});
