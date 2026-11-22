import { describe, expect, it } from 'vitest';
import {
  legacyCubeChosenCostPaymentRefusals,
  legacyCubeReviewedGrimLavamancerRefusals,
  loadLegacyCubeSyntaxReview,
} from '../src/index';

const exact = [
  'Name:Grim Lavamancer',
  'ManaCost:R',
  'Types:Creature Human Wizard',
  'PT:1/1',
  'A:AB$ DealDamage | Cost$ R T ExileFromGrave<2/Card> | ValidTgts$ Any | NumDmg$ 2 | SpellDescription$ CARDNAME deals 2 damage to any target.',
  'SVar:NonCombatPriority:1',
  'Oracle:{R}, {T}, Exile two cards from your graveyard: Grim Lavamancer deals 2 damage to any target.',
];

const inventory = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]) =>
  legacyCubeReviewedGrimLavamancerRefusals(new TextEncoder().encode(`${lines.join('\n')}\n`), inventory);

describe('Legacy Cube reviewed Grim Lavamancer boundary', () => {
  it('keeps graveyard exile closed outside its exact reviewed payment profile', () => {
    const bytes = new TextEncoder().encode(`${exact.join('\n')}\n`);
    expect(legacyCubeChosenCostPaymentRefusals(bytes)).toContain(
      'chosen cost payment ExileFromGrave<2/Card>',
    );
    expect(
      legacyCubeChosenCostPaymentRefusals(bytes, {
        allowReviewedGraveyardExileCostPart: true,
      }),
    ).toEqual([]);
  });

  it('admits only the exact whole-card composition', () => {
    expect(refusal(exact)).toEqual([]);
    for (const mutation of [
      exact.map((line) => line.replace('Name:Grim Lavamancer', 'Name:Other')),
      exact.map((line) => line.replace('ExileFromGrave<2/Card>', 'ExileFromGrave<1/Card>')),
      exact.map((line) => line.replace('ExileFromGrave<2/Card>', 'Exile<2/Card>')),
      exact.map((line) => line.replace('ExileFromGrave<2/Card>', 'ExileFromGrave<2/Creature>')),
      exact.map((line) => line.replace('ValidTgts$ Any', 'ValidTgts$ Creature')),
      exact.map((line) => line.replace('NumDmg$ 2', 'NumDmg$ 3')),
      exact.filter((line) => !line.startsWith('SVar:')),
      [...exact, 'SVar:Extra:DB$ Draw'],
    ]) {
      expect(refusal(mutation)).toContain('exact reviewed Grim Lavamancer composition');
    }
  });
});
