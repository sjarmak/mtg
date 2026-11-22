import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedManaComboRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const inventory = loadLegacyCubeSyntaxReview();
const bytes = (lines: readonly string[]): Uint8Array => new TextEncoder().encode(lines.join('\n'));
const relic = [
  'Name:Coalition Relic',
  'ManaCost:3',
  'Types:Artifact',
  'A:AB$ Mana | Cost$ T | Produced$ Any | Amount$ 1 | SpellDescription$ Add one mana of any color.',
  'A:AB$ PutCounter | Cost$ T | CounterType$ CHARGE | CounterNum$ 1 | SpellDescription$ Put a charge counter on CARDNAME.',
  'T:Mode$ Phase | Phase$ Main1 | ValidPlayer$ You | TriggerZones$ Battlefield | Execute$ TrigRemove | TriggerDescription$ At the beginning of your first main phase, remove all charge counters from CARDNAME. Add one mana of any color for each charge counter removed this way.',
  'SVar:TrigRemove:DB$ RemoveCounter | CounterType$ CHARGE | CounterNum$ All | RememberRemoved$ True | SubAbility$ TrigGetMana',
  'SVar:TrigGetMana:DB$ Mana | Produced$ Combo Any | Amount$ NumRemoved | SubAbility$ DBCleanup',
  'SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True',
  'SVar:NumRemoved:Count$RememberedSize',
] as const;

describe('Legacy Cube reviewed mana combo', () => {
  it('admits the exact Coalition Relic trigger', () => {
    expect(legacyCubeReviewedManaComboRefusals(bytes(relic), inventory)).toEqual([]);
  });

  it.each([
    ['another identity', relic.map((line) => line.replace('Name:Coalition Relic', 'Name:Other'))],
    ['another counter', relic.map((line) => line.replaceAll('CHARGE', 'P1P1'))],
    ['another color set', relic.map((line) => line.replace('Produced$ Combo Any', 'Produced$ Combo R G'))],
    ['another amount', relic.map((line) => line.replace('Amount$ NumRemoved', 'Amount$ 2'))],
  ] as const)('refuses %s', (_label, script) => {
    expect(legacyCubeReviewedManaComboRefusals(bytes(script), inventory)).not.toEqual([]);
  });
});
