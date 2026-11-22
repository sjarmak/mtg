import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedLightningPhoenixRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const exact = [
  'Name:Lightning Phoenix',
  'ManaCost:2 R',
  'Types:Creature Phoenix',
  'PT:2/2',
  'K:Flying',
  'K:Haste',
  "S:Mode$ CantBlock | ValidCard$ Card.Self | Description$ CARDNAME can't block.",
  'T:Mode$ Phase | Phase$ End of Turn | ValidPlayer$ You | Execute$ TrigReturn | TriggerZones$ Graveyard | CheckSVar$ X | SVarCompare$ GE3 | TriggerDescription$ At the beginning of your end step, if an opponent was dealt 3 or more damage this turn, you may pay {R}. If you do, return CARDNAME from your graveyard to the battlefield.',
  'SVar:TrigReturn:AB$ ChangeZone | Cost$ R | Defined$ Self | Origin$ Graveyard | Destination$ Battlefield',
  'SVar:X:Count$MaxOppDamageThisTurn',
  "Oracle:Flying, haste\\nLightning Phoenix can't block.\\nAt the beginning of your end step, if an opponent was dealt 3 or more damage this turn, you may pay {R}. If you do, return Lightning Phoenix from your graveyard to the battlefield.",
];

const inventory = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]) =>
  legacyCubeReviewedLightningPhoenixRefusals(new TextEncoder().encode(`${lines.join('\n')}\n`), inventory);

describe('Legacy Cube reviewed Lightning Phoenix boundary', () => {
  it('admits only the exact paid graveyard-trigger composition', () => {
    expect(refusal(exact)).toEqual([]);
    for (const mutation of [
      exact.map((line) => line.replace('Name:Lightning Phoenix', 'Name:Other')),
      exact.map((line) => line.replace('Phase$ End of Turn', 'Phase$ Upkeep')),
      exact.map((line) => line.replace('TriggerZones$ Graveyard', 'TriggerZones$ Battlefield')),
      exact.map((line) => line.replace('SVarCompare$ GE3', 'SVarCompare$ GE2')),
      exact.map((line) => line.replace('Cost$ R', 'Cost$ 1 R')),
      exact.map((line) => line.replace('Defined$ Self', 'Defined$ You')),
      exact.filter((line) => !line.startsWith('SVar:X:')),
      [...exact, 'SVar:Extra:DB$ ChangeZone | Origin$ Graveyard'],
    ]) {
      expect(refusal(mutation)).toContain('exact reviewed Lightning Phoenix composition');
    }
  });
});
