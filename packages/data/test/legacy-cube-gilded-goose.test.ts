import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedGildedGooseRefusals, loadLegacyCubeSyntaxReview } from '@mtg/data';

const EXACT = [
  'Name:Gilded Goose',
  'ManaCost:G',
  'Types:Creature Bird',
  'PT:0/2',
  'K:Flying',
  'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigFood | TriggerDescription$ When CARDNAME enters, create a Food token. (It\'s an artifact with "{2}, {T}, Sacrifice this token: You gain 3 life.")',
  'SVar:TrigFood:DB$ Token | TokenScript$ c_a_food_sac | TokenOwner$ You',
  'A:AB$ Token | Cost$ 1 G T | TokenScript$ c_a_food_sac | TokenOwner$ You | SpellDescription$ Create a Food Token.',
  'A:AB$ Mana | Cost$ T Sac<1/Food> | Produced$ Any | SpellDescription$ Add one mana of any color.',
  'DeckHas:Ability$LifeGain|Token|Food',
  'DeckHints:Ability$Food',
  'Oracle:Flying\\nWhen Gilded Goose enters, create a Food token. (It\'s an artifact with "{2}, {T}, Sacrifice this token: You gain 3 life.")\\n{1}{G}, {T}: Create a Food token.\\n{T}, Sacrifice a Food: Add one mana of any color.',
] as const;

const syntax = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedGildedGooseRefusals(Buffer.from(lines.join('\n')), syntax);

describe('Legacy Cube reviewed Gilded Goose boundary', () => {
  it('admits only the exact complete installed script', () => {
    expect(refusal(EXACT)).toEqual([]);
  });

  it.each([
    ['identity', EXACT.map((line) => line.replace('Name:Gilded Goose', 'Name:Near Goose'))],
    ['mana cost', EXACT.map((line) => line.replace('ManaCost:G', 'ManaCost:1 G'))],
    ['card type', EXACT.map((line) => line.replace('Types:Creature Bird', 'Types:Creature Beast'))],
    ['power and toughness', EXACT.map((line) => line.replace('PT:0/2', 'PT:1/2'))],
    ['keyword', EXACT.map((line) => line.replace('K:Flying', 'K:Reach'))],
    ['entry origin', EXACT.map((line) => line.replace('Origin$ Any', 'Origin$ Stack'))],
    ['entry destination', EXACT.map((line) => line.replace('Destination$ Battlefield', 'Destination$ Hand'))],
    [
      'entry subject',
      EXACT.map((line) => line.replace('ValidCard$ Card.Self', 'ValidCard$ Creature.YouCtrl')),
    ],
    [
      'entry token root',
      EXACT.map((line) => line.replace('TokenScript$ c_a_food_sac', 'TokenScript$ c_a_treasure_sac')),
    ],
    ['token owner', EXACT.map((line) => line.replace('TokenOwner$ You', 'TokenOwner$ Opponent'))],
    ['token activation mana', EXACT.map((line) => line.replace('Cost$ 1 G T', 'Cost$ 2 G T'))],
    ['token activation tap', EXACT.map((line) => line.replace('Cost$ 1 G T', 'Cost$ 1 G'))],
    ['sacrifice count', EXACT.map((line) => line.replace('Sac<1/Food>', 'Sac<2/Food>'))],
    ['sacrifice filter', EXACT.map((line) => line.replace('Sac<1/Food>', 'Sac<1/Artifact>'))],
    ['sacrifice tap', EXACT.map((line) => line.replace('Cost$ T Sac<1/Food>', 'Cost$ Sac<1/Food>'))],
    ['produced mana', EXACT.map((line) => line.replace('Produced$ Any', 'Produced$ G'))],
    ['Oracle text', EXACT.map((line) => line.replace('Sacrifice a Food', 'Sacrifice an artifact'))],
    ['deck hint', EXACT.filter((line) => line !== 'DeckHints:Ability$Food')],
    ['line order', [EXACT[1], EXACT[0], ...EXACT.slice(2)]],
    ['extra mechanic', [...EXACT, 'A:AB$ Draw | Cost$ 0 | NumCards$ 1']],
  ])('refuses %s drift as an exact-composition failure', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed Gilded Goose composition');
  });
});
