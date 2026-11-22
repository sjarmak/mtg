import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedPrimalMightRefusals, loadLegacyCubeSyntaxReview } from '@mtg/data';

const EXACT = [
  'Name:Primal Might',
  'ManaCost:X G',
  'Types:Sorcery',
  "A:SP$ Pump | ValidTgts$ Creature.YouCtrl | TgtPrompt$ Select target creature you control | NumAtt$ +X | NumDef$ +X | SubAbility$ DBFight | SpellDescription$ Target creature you control gets +X/+X until end of turn. Then it fights up to one target creature you don't control.",
  "SVar:DBFight:DB$ Fight | Defined$ ParentTarget | ValidTgts$ Creature.YouDontCtrl | TargetMin$ 0 | TargetMax$ 1 | TgtPrompt$ Select up to one target creature you don't control",
  'SVar:X:Count$xPaid',
  'SVar:PlayMain1:TRUE',
  "Oracle:Target creature you control gets +X/+X until end of turn. Then it fights up to one target creature you don't control.",
] as const;

const syntax = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedPrimalMightRefusals(Buffer.from(lines.join('\n')), syntax);

describe('Legacy Cube reviewed Primal Might boundary', () => {
  it('admits only the exact complete installed script', () => {
    expect(refusal(EXACT)).toEqual([]);
  });

  it.each([
    ['identity', EXACT.map((line) => line.replace('Name:Primal Might', 'Name:Primal Strength'))],
    ['mana cost', EXACT.map((line) => line.replace('ManaCost:X G', 'ManaCost:X R'))],
    ['type', EXACT.map((line) => line.replace('Types:Sorcery', 'Types:Instant'))],
    ['root API', EXACT.map((line) => line.replace('A:SP$ Pump', 'A:SP$ Fight'))],
    [
      'root target filter',
      EXACT.map((line) => line.replace('ValidTgts$ Creature.YouCtrl', 'ValidTgts$ Creature')),
    ],
    [
      'root target prompt',
      EXACT.map((line) =>
        line.replace('TgtPrompt$ Select target creature you control', 'TgtPrompt$ Select target creature'),
      ),
    ],
    ['power amount', EXACT.map((line) => line.replace('NumAtt$ +X', 'NumAtt$ +1'))],
    ['toughness amount', EXACT.map((line) => line.replace('NumDef$ +X', 'NumDef$ +1'))],
    ['subability link', EXACT.map((line) => line.replace('SubAbility$ DBFight', 'SubAbility$ Other'))],
    ['nested API', EXACT.map((line) => line.replace('DBFight:DB$ Fight', 'DBFight:DB$ Destroy'))],
    ['parent target binding', EXACT.map((line) => line.replace('Defined$ ParentTarget', 'Defined$ Self'))],
    [
      'nested target filter',
      EXACT.map((line) => line.replace('ValidTgts$ Creature.YouDontCtrl', 'ValidTgts$ Creature')),
    ],
    ['nested target minimum', EXACT.map((line) => line.replace('TargetMin$ 0', 'TargetMin$ 1'))],
    ['nested target maximum', EXACT.map((line) => line.replace('TargetMax$ 1', 'TargetMax$ 2'))],
    [
      'nested target prompt',
      EXACT.map((line) =>
        line.replace(
          "TgtPrompt$ Select up to one target creature you don't control",
          'TgtPrompt$ Select target creature',
        ),
      ),
    ],
    ['X binding', EXACT.map((line) => line.replace('Count$xPaid', 'Count$ChosenNumber'))],
    ['main-phase hint', EXACT.filter((line) => line !== 'SVar:PlayMain1:TRUE')],
    [
      'Oracle text',
      EXACT.map((line) =>
        line.replace('Then it fights up to one target creature', 'Then it fights target creature'),
      ),
    ],
    ['ordering', [EXACT[1]!, EXACT[0]!, ...EXACT.slice(2)]],
    ['missing line', EXACT.filter((line) => line !== 'SVar:X:Count$xPaid')],
    ['extra syntax', [...EXACT, 'SVar:Unreviewed:DB$ Draw | NumCards$ 1']],
  ])('refuses hostile %s drift', (_label, lines) => {
    expect(refusal(lines)).not.toEqual([]);
  });
});
