import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedRangerCaptainOfEosRefusals, loadLegacyCubeSyntaxReview } from '@mtg/data';

const EXACT = [
  'Name:Ranger-Captain of Eos',
  'ManaCost:1 W W',
  'Types:Creature Human Soldier Ranger',
  'PT:3/3',
  'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | OptionalDecider$ You | Execute$ TrigChange | TriggerDescription$ When CARDNAME enters, you may search your library for a creature card with mana value 1 or less, reveal that card, reveal it, put it into your hand, then shuffle.',
  'SVar:TrigChange:DB$ ChangeZone | Origin$ Library | Destination$ Hand | ChangeType$ Creature.cmcLE1 | ChangeNum$ 1 | ShuffleNonMandatory$ True',
  "A:AB$ Effect | Cost$ Sac<1/CARDNAME> | StaticAbilities$ STCantBeCast | SpellDescription$ Your opponents can't cast noncreature spells this turn.",
  "SVar:STCantBeCast:Mode$ CantBeCast | ValidCard$ Card.nonCreature | Caster$ Opponent | Description$ Your opponents can't cast noncreature spells this turn.",
  "Oracle:When Ranger-Captain of Eos enters, you may search your library for a creature card with mana value 1 or less, reveal it, put it into your hand, then shuffle.\\nSacrifice Ranger-Captain of Eos: Your opponents can't cast noncreature spells this turn.",
] as const;

const syntax = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedRangerCaptainOfEosRefusals(Buffer.from(lines.join('\n')), syntax);

describe('Legacy Cube reviewed Ranger-Captain of Eos boundary', () => {
  it('admits only the exact complete installed script', () => {
    expect(refusal(EXACT)).toEqual([]);
  });

  it.each([
    ['identity', EXACT.map((line) => line.replace('Name:Ranger-Captain of Eos', 'Name:Near Captain'))],
    ['mana cost', EXACT.map((line) => line.replace('ManaCost:1 W W', 'ManaCost:2 W'))],
    [
      'card type',
      EXACT.map((line) =>
        line.replace('Types:Creature Human Soldier Ranger', 'Types:Creature Human Soldier'),
      ),
    ],
    ['power and toughness', EXACT.map((line) => line.replace('PT:3/3', 'PT:3/4'))],
    ['trigger mode', EXACT.map((line) => line.replace('Mode$ ChangesZone', 'Mode$ SpellCast'))],
    ['trigger origin', EXACT.map((line) => line.replace('Origin$ Any', 'Origin$ Hand'))],
    [
      'trigger destination',
      EXACT.map((line) => line.replace('Destination$ Battlefield', 'Destination$ Graveyard')),
    ],
    ['trigger identity', EXACT.map((line) => line.replace('ValidCard$ Card.Self', 'ValidCard$ Creature'))],
    [
      'optional decider',
      EXACT.map((line) => line.replace('OptionalDecider$ You', 'OptionalDecider$ Opponent')),
    ],
    ['trigger execute', EXACT.map((line) => line.replace('Execute$ TrigChange', 'Execute$ Other'))],
    ['search API', EXACT.map((line) => line.replace('TrigChange:DB$ ChangeZone', 'TrigChange:DB$ Dig'))],
    [
      'search destination',
      EXACT.map((line) =>
        line.replace('Destination$ Hand | ChangeType$', 'Destination$ Battlefield | ChangeType$'),
      ),
    ],
    ['search filter', EXACT.map((line) => line.replace('Creature.cmcLE1', 'Creature.cmcLE2'))],
    ['search count', EXACT.map((line) => line.replace('ChangeNum$ 1', 'ChangeNum$ 2'))],
    ['search shuffle', EXACT.map((line) => line.replace('ShuffleNonMandatory$ True', 'Shuffle$ True'))],
    ['activation API', EXACT.map((line) => line.replace('A:AB$ Effect', 'A:AB$ Draw'))],
    ['sacrifice count', EXACT.map((line) => line.replace('Sac<1/CARDNAME>', 'Sac<2/CARDNAME>'))],
    ['sacrifice identity', EXACT.map((line) => line.replace('Sac<1/CARDNAME>', 'Sac<1/Creature>'))],
    [
      'static reference',
      EXACT.map((line) => line.replace('StaticAbilities$ STCantBeCast', 'StaticAbilities$ Other')),
    ],
    ['restriction mode', EXACT.map((line) => line.replace('Mode$ CantBeCast', 'Mode$ Continuous'))],
    ['restriction card', EXACT.map((line) => line.replace('ValidCard$ Card.nonCreature', 'ValidCard$ Card'))],
    ['restriction caster', EXACT.map((line) => line.replace('Caster$ Opponent', 'Caster$ You'))],
    ['Oracle text', EXACT.map((line) => line.replace('mana value 1 or less', 'mana value 2 or less'))],
    ['line order', [EXACT[1], EXACT[0], ...EXACT.slice(2)]],
    ['extra mechanic', [...EXACT, 'A:AB$ Draw | Cost$ 0 | NumCards$ 1']],
  ])('refuses %s drift as an exact-composition failure', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed Ranger-Captain of Eos composition');
  });
});
