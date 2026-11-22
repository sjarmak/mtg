import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedBlessedAllianceRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const exact = [
  'Name:Blessed Alliance',
  'ManaCost:1 W',
  'Types:Instant',
  'K:Escalate:2',
  'A:SP$ Charm | MinCharmNum$ 1 | CharmNum$ 3 | Choices$ DBGainLife,DBUntap,DBSacrifice',
  'SVar:DBGainLife:DB$ GainLife | ValidTgts$ Player | TgtPrompt$ Select target player (to gain 4 life) | LifeAmount$ 4 | SpellDescription$ Target player gains 4 life.',
  'SVar:DBUntap:DB$ Untap | ValidTgts$ Creature | TargetMin$ 0 | TargetMax$ 2 | SpellDescription$ Untap up to two target creatures.',
  'SVar:DBSacrifice:DB$ Sacrifice | ValidTgts$ Opponent | TgtPrompt$ Select target player (to sacrifice an attacking creature) | SacValid$ Creature.attacking | SacMessage$ Creature | SpellDescription$ Target opponent sacrifices an attacking creature.',
  'Oracle:Escalate {2} (Pay this cost for each mode chosen beyond the first.)\\nChoose one or more —\\n• Target player gains 4 life.\\n• Untap up to two target creatures.\\n• Target opponent sacrifices an attacking creature.',
];

const inventory = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]) =>
  legacyCubeReviewedBlessedAllianceRefusals(new TextEncoder().encode(`${lines.join('\n')}\n`), inventory);

describe('Legacy Cube reviewed Blessed Alliance boundary', () => {
  it('admits only the exact one-to-three-mode Escalate composition', () => {
    expect(refusal(exact)).toEqual([]);
  });

  it.each([
    ['identity', 'Name:Blessed Alliance', 'Name:Other Alliance'],
    ['mana cost', 'ManaCost:1 W', 'ManaCost:W'],
    ['Escalate cost', 'K:Escalate:2', 'K:Escalate:1'],
    ['minimum modes', 'MinCharmNum$ 1', 'MinCharmNum$ 0'],
    ['maximum modes', 'CharmNum$ 3', 'CharmNum$ 2'],
    ['mode order', 'DBGainLife,DBUntap,DBSacrifice', 'DBUntap,DBGainLife,DBSacrifice'],
    ['life amount', 'LifeAmount$ 4', 'LifeAmount$ 5'],
    ['untap minimum', 'TargetMin$ 0', 'TargetMin$ 1'],
    ['untap maximum', 'TargetMax$ 2', 'TargetMax$ 3'],
    ['sacrifice player', 'ValidTgts$ Opponent', 'ValidTgts$ Player'],
    ['sacrifice filter', 'SacValid$ Creature.attacking', 'SacValid$ Creature'],
  ] as const)('refuses a changed %s', (_label, from, to) => {
    expect(refusal(exact.map((line) => line.replace(from, to)))).toContain(
      'exact reviewed Blessed Alliance composition',
    );
  });

  it('refuses extra script composition', () => {
    expect(refusal([...exact, 'SVar:Extra:DB$ GainLife | LifeAmount$ 1'])).toContain(
      'exact reviewed Blessed Alliance composition',
    );
  });
});
