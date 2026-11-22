import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedGlenElendraArchmageRefusals, loadLegacyCubeSyntaxReview } from '@mtg/data';

const EXACT = [
  'Name:Glen Elendra Archmage',
  'ManaCost:3 U',
  'Types:Creature Faerie Wizard',
  'PT:2/2',
  'K:Flying',
  'A:AB$ Counter | Cost$ U Sac<1/CARDNAME> | TargetType$ Spell | TgtPrompt$ Select target noncreature spell | ValidTgts$ Card.nonCreature | SpellDescription$ Counter target noncreature spell.',
  'K:Persist',
  "Oracle:Flying\\n{U}, Sacrifice Glen Elendra Archmage: Counter target noncreature spell.\\nPersist (When this creature dies, if it had no -1/-1 counters on it, return it to the battlefield under its owner's control with a -1/-1 counter on it.)",
] as const;

const syntax = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedGlenElendraArchmageRefusals(Buffer.from(lines.join('\n')), syntax);

describe('Legacy Cube reviewed Glen Elendra Archmage boundary', () => {
  it('admits only the exact complete installed script', () => {
    expect(refusal(EXACT)).toEqual([]);
  });

  it.each([
    ['identity', EXACT.map((line) => line.replace('Name:Glen Elendra Archmage', 'Name:Near Archmage'))],
    ['mana cost', EXACT.map((line) => line.replace('ManaCost:3 U', 'ManaCost:2 U'))],
    ['card type', EXACT.map((line) => line.replace('Types:Creature Faerie Wizard', 'Types:Creature Wizard'))],
    ['power and toughness', EXACT.map((line) => line.replace('PT:2/2', 'PT:2/3'))],
    ['flying', EXACT.filter((line) => line !== 'K:Flying')],
    ['ability API', EXACT.map((line) => line.replace('A:AB$ Counter', 'A:AB$ ChangeZone'))],
    ['activation mana', EXACT.map((line) => line.replace('Cost$ U ', 'Cost$ 1 U '))],
    ['sacrifice count', EXACT.map((line) => line.replace('Sac<1/CARDNAME>', 'Sac<2/CARDNAME>'))],
    ['sacrifice identity', EXACT.map((line) => line.replace('Sac<1/CARDNAME>', 'Sac<1/Creature>'))],
    ['target type', EXACT.map((line) => line.replace('TargetType$ Spell', 'TargetType$ Permanent'))],
    ['target prompt', EXACT.map((line) => line.replace('Select target noncreature spell', 'Select a spell'))],
    ['target legality', EXACT.map((line) => line.replace('Card.nonCreature', 'Card'))],
    ['effect text', EXACT.map((line) => line.replace('Counter target noncreature spell.', 'Counter it.'))],
    ['persist', EXACT.filter((line) => line !== 'K:Persist')],
    ['line order', [EXACT[1], EXACT[0], ...EXACT.slice(2)]],
    ['extra mechanic', [...EXACT, 'A:AB$ Draw | Cost$ 0 | NumCards$ 1']],
  ])('refuses %s drift as an exact-composition failure', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed Glen Elendra Archmage composition');
  });
});
