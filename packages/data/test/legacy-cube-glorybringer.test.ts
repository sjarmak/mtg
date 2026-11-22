import { describe, expect, it } from 'vitest';
import {
  legacyCubeChosenCostPaymentRefusals,
  legacyCubeReviewedGlorybringerRefusals,
  loadLegacyCubeSyntaxReview,
} from '../src/index';

const exact = [
  'Name:Glorybringer',
  'ManaCost:3 R R',
  'Types:Creature Dragon',
  'PT:4/4',
  'K:Flying',
  'K:Haste',
  'S:Mode$ OptionalAttackCost | ValidCard$ Card.Self | Trigger$ TrigDealDamage | Cost$ Exert<1/CARDNAME> | Description$ You may exert CARDNAME as it attacks. When you do, it deals 4 damage to target non-Dragon creature an opponent controls.',
  'SVar:TrigDealDamage:DB$ DealDamage | ValidTgts$ Creature.nonDragon+OppCtrl | TgtPrompt$ Select target non-Dragon creature an opponent controls | NumDmg$ 4 | SpellDescription$ When you exert CARDNAME, it deals 4 damage to target non-Dragon creature an opponent controls.',
  "Oracle:Flying, haste\\nYou may exert Glorybringer as it attacks. When you do, it deals 4 damage to target non-Dragon creature an opponent controls. (An exerted creature won't untap during your next untap step.)",
];

const inventory = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]) =>
  legacyCubeReviewedGlorybringerRefusals(new TextEncoder().encode(`${lines.join('\n')}\n`), inventory);

describe('Legacy Cube reviewed Glorybringer boundary', () => {
  it('keeps the exert payment closed outside its reviewed profile', () => {
    const bytes = new TextEncoder().encode(`${exact.join('\n')}\n`);
    expect(legacyCubeChosenCostPaymentRefusals(bytes)).toContain('chosen cost payment Exert<1/CARDNAME>');
    expect(legacyCubeChosenCostPaymentRefusals(bytes, { allowReviewedExertCostPart: true })).toEqual([]);
  });

  it('admits only the exact whole-card composition', () => {
    expect(refusal(exact)).toEqual([]);
    for (const mutation of [
      exact.map((line) => line.replace('Name:Glorybringer', 'Name:Other')),
      exact.map((line) => line.replace('Exert<1/CARDNAME>', 'Exert<2/CARDNAME>')),
      exact.map((line) => line.replace('Creature.nonDragon+OppCtrl', 'Creature+OppCtrl')),
      exact.map((line) => line.replace('NumDmg$ 4', 'NumDmg$ 3')),
      exact.filter((line) => !line.startsWith('SVar:')),
      [...exact, 'SVar:Extra:DB$ Draw'],
    ]) {
      expect(refusal(mutation)).toContain('exact reviewed Glorybringer composition');
    }
  });
});
