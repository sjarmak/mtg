import { describe, expect, it } from 'vitest';
import {
  legacyCubeChosenCostPaymentRefusals,
  legacyCubeReviewedBaralRefusals,
  loadLegacyCubeSyntaxReview,
} from '../src/index';

const exact = [
  'Name:Baral, Chief of Compliance',
  'ManaCost:1 U',
  'Types:Legendary Creature Human Wizard',
  'PT:1/3',
  'S:Mode$ ReduceCost | ValidCard$ Instant,Sorcery | Type$ Spell | Activator$ You | Amount$ 1 | Description$ Instant and sorcery spells you cast cost {1} less to cast.',
  'T:Mode$ Countered | ValidCause$ SpellAbility.YouCtrl | ValidSA$ Spell | TriggerZones$ Battlefield | Execute$ TrigLoot | TriggerDescription$ Whenever a spell or ability you control counters a spell, you may draw a card. If you do, discard a card.',
  'SVar:TrigLoot:AB$ Discard | Defined$ You | Mode$ TgtChoose | NumCards$ 1 | Cost$ Draw<1/You>',
  'DeckHints:Type$Instant|Sorcery',
  'Oracle:Instant and sorcery spells you cast cost {1} less to cast.\\nWhenever a spell or ability you control counters a spell, you may draw a card. If you do, discard a card.',
];

const inventory = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]) =>
  legacyCubeReviewedBaralRefusals(new TextEncoder().encode(`${lines.join('\n')}\n`), inventory);

describe('Legacy Cube reviewed Baral boundary', () => {
  it('keeps draw as a cost closed outside its exact reviewed profile', () => {
    const bytes = new TextEncoder().encode(`${exact.join('\n')}\n`);
    expect(legacyCubeChosenCostPaymentRefusals(bytes)).toContain('chosen cost payment Draw<1/You>');
    expect(legacyCubeChosenCostPaymentRefusals(bytes, { allowReviewedDrawCostPart: true })).toEqual([]);
  });

  it('admits only the exact whole-card composition', () => {
    expect(refusal(exact)).toEqual([]);
    for (const mutation of [
      exact.map((line) => line.replace('Name:Baral, Chief of Compliance', 'Name:Other')),
      exact.map((line) => line.replace('ValidCause$ SpellAbility.YouCtrl', 'ValidCause$ SpellAbility')),
      exact.map((line) => line.replace('Defined$ You', 'Defined$ Opponent')),
      exact.map((line) => line.replace('Mode$ TgtChoose', 'Mode$ Random')),
      exact.map((line) => line.replace('NumCards$ 1', 'NumCards$ 2')),
      exact.map((line) => line.replace('Draw<1/You>', 'Draw<2/You>')),
      exact.filter((line) => !line.startsWith('SVar:TrigLoot:')),
      [...exact, 'SVar:Extra:DB$ Draw'],
    ]) {
      expect(refusal(mutation)).toContain('exact reviewed Baral composition');
    }
  });
});
