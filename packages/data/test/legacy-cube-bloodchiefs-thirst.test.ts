import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedBloodchiefsThirstRefusals, loadLegacyCubeSyntaxReview } from '@mtg/data';

const EXACT = [
  "Name:Bloodchief's Thirst",
  'ManaCost:B',
  'Types:Sorcery',
  'K:Kicker:2 B',
  'A:SP$ Destroy | ValidTgts$ Creature.cmcLE2,Planeswalker.cmcLE2 | TargetMin$ X | TargetMax$ X | TgtPrompt$ Select target creature or planeswalker with mana value 2 or less | SubAbility$ DBDestroy | AILogic$ AssumeAtLeastOneTarget | StackDescription$ SpellDescription | SpellDescription$ Destroy target creature or planeswalker with mana value 2 or less.',
  'SVar:DBDestroy:DB$ Destroy | TargetMin$ Y | TargetMax$ Y | ValidTgts$ Creature,Planeswalker | TgtPrompt$ Select target creature or planeswalker | StackDescription$ SpellDescription | SpellDescription$ If this spell was kicked, instead destroy target creature or planeswalker.',
  'SVar:X:Count$Kicked.0.1',
  'SVar:Y:Count$Kicked.1.0',
  'Oracle:Kicker {2}{B} (You may pay an additional {2}{B} as you cast this spell.)\\nDestroy target creature or planeswalker with mana value 2 or less. If this spell was kicked, instead destroy target creature or planeswalker.',
] as const;

const syntax = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedBloodchiefsThirstRefusals(Buffer.from(lines.join('\n')), syntax);

describe("Legacy Cube reviewed Bloodchief's Thirst boundary", () => {
  it('admits only the exact complete installed script', () => {
    expect(refusal(EXACT)).toEqual([]);
  });

  it.each([
    ['identity', EXACT.map((line) => line.replace("Name:Bloodchief's Thirst", 'Name:Bloodchief Thirst'))],
    ['mana cost', EXACT.map((line) => line.replace('ManaCost:B', 'ManaCost:1 B'))],
    ['type', EXACT.map((line) => line.replace('Types:Sorcery', 'Types:Instant'))],
    ['Kicker spelling', EXACT.map((line) => line.replace('K:Kicker:2 B', 'K:Buyback:2 B'))],
    ['Kicker cost', EXACT.map((line) => line.replace('K:Kicker:2 B', 'K:Kicker:1 B'))],
    ['root API', EXACT.map((line) => line.replace('A:SP$ Destroy', 'A:SP$ Draw'))],
    [
      'unkicked target filter',
      EXACT.map((line) => line.replace('Creature.cmcLE2,Planeswalker.cmcLE2', 'Creature,Planeswalker')),
    ],
    ['unkicked target minimum', EXACT.map((line) => line.replace('TargetMin$ X', 'TargetMin$ 1'))],
    ['unkicked target maximum', EXACT.map((line) => line.replace('TargetMax$ X', 'TargetMax$ 1'))],
    ['subability link', EXACT.map((line) => line.replace('SubAbility$ DBDestroy', 'SubAbility$ Other'))],
    [
      'unkicked prompt',
      EXACT.map((line) =>
        line.replace(
          'TgtPrompt$ Select target creature or planeswalker with mana value 2 or less',
          'TgtPrompt$ Select target permanent',
        ),
      ),
    ],
    ['kicked API', EXACT.map((line) => line.replace('DBDestroy:DB$ Destroy', 'DBDestroy:DB$ Draw'))],
    ['kicked target minimum', EXACT.map((line) => line.replace('TargetMin$ Y', 'TargetMin$ 1'))],
    ['kicked target maximum', EXACT.map((line) => line.replace('TargetMax$ Y', 'TargetMax$ 1'))],
    [
      'kicked target filter',
      EXACT.map((line) =>
        line.startsWith('SVar:DBDestroy:')
          ? line.replace('ValidTgts$ Creature,Planeswalker', 'ValidTgts$ Permanent')
          : line,
      ),
    ],
    [
      'kicked prompt',
      EXACT.map((line) =>
        line.startsWith('SVar:DBDestroy:')
          ? line.replace('TgtPrompt$ Select target creature or planeswalker', 'TgtPrompt$ Select permanent')
          : line,
      ),
    ],
    ['unkicked guard', EXACT.map((line) => line.replace('Count$Kicked.0.1', 'Count$Kicked.1.0'))],
    ['kicked guard', EXACT.map((line) => line.replace('Count$Kicked.1.0', 'Count$Kicked.0.1'))],
    [
      'Oracle text',
      EXACT.map((line) =>
        line.replace('instead destroy target creature or planeswalker', 'destroy any target'),
      ),
    ],
    ['ordering', [EXACT[1]!, EXACT[0]!, ...EXACT.slice(2)]],
    ['missing line', EXACT.filter((line) => line !== 'K:Kicker:2 B')],
    ['extra syntax', [...EXACT, 'SVar:Unreviewed:DB$ Draw | NumCards$ 1']],
  ])('refuses hostile %s drift', (_label, lines) => {
    expect(refusal(lines)).not.toEqual([]);
  });
});
