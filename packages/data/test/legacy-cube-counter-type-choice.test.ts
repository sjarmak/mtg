import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedCounterTypeChoiceRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const inventory = loadLegacyCubeSyntaxReview();
const script = (name: string, counterLine: string): Uint8Array =>
  new TextEncoder().encode(
    [
      `Name:${name}`,
      'ManaCost:3 W W',
      'Types:Enchantment Saga',
      'K:Chapter:3:DBExile,DBEffect,DBReturn',
      'SVar:DBReturn:DB$ ChangeZone | Origin$ Graveyard | Destination$ Battlefield | ValidTgts$ Creature.YouOwn,Planeswalker.YouOwn | TgtPrompt$ Select target creature or planeswalker | RememberChanged$ True | SubAbility$ AddCounter | SpellDescription$ Return target creature or planeswalker card from your graveyard to the battlefield. Put a +1/+1 counter or a loyalty counter on it.',
      counterLine,
      'SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True',
    ].join('\n'),
  );

describe('Legacy Cube reviewed counter-type choice', () => {
  const exact =
    'SVar:AddCounter:DB$ PutCounter | Defined$ Remembered | CounterType$ P1P1,LOYALTY | CounterNum$ 1 | SubAbility$ DBCleanup';

  it('admits Elspeth Conquers Death choosing the counter appropriate to its returned object', () => {
    expect(
      legacyCubeReviewedCounterTypeChoiceRefusals(script('Elspeth Conquers Death', exact), inventory),
    ).toEqual([]);
  });

  it.each([
    ['another identity', 'Unreviewed Saga', exact],
    ['another counter set', 'Elspeth Conquers Death', exact.replace('P1P1,LOYALTY', 'P1P1,LORE')],
    ['another amount', 'Elspeth Conquers Death', exact.replace('CounterNum$ 1', 'CounterNum$ 2')],
  ])('refuses %s', (_label, name, line) => {
    expect(legacyCubeReviewedCounterTypeChoiceRefusals(script(name, line), inventory)).not.toEqual([]);
  });
});
