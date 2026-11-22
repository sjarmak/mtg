import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedMaulOfTheSkyclavesRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const EXACT = [
  'Name:Maul of the Skyclaves',
  'ManaCost:2 W',
  'Types:Artifact Equipment',
  'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigAttach | TriggerDescription$ When CARDNAME enters, attach it to target creature you control.',
  'SVar:TrigAttach:DB$ Attach | ValidTgts$ Creature.YouCtrl | TgtPrompt$ Select target creature you control',
  'S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddPower$ 2 | AddToughness$ 2 | AddKeyword$ Flying & First Strike | Description$ Equipped creature gets +2/+2 and has flying and first strike.',
  'K:Equip:2 W W',
  'SVar:NeedsToPlay:Creature.YouCtrl',
  'Oracle:When Maul of the Skyclaves enters, attach it to target creature you control.\\nEquipped creature gets +2/+2 and has flying and first strike.\\nEquip {2}{W}{W}',
] as const;

const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedMaulOfTheSkyclavesRefusals(
    new TextEncoder().encode(`${lines.join('\n')}\n`),
    loadLegacyCubeSyntaxReview(),
  );

describe('Legacy Cube reviewed Maul of the Skyclaves boundary', () => {
  it('lifts exactly the installed whole-card trigger-Attach and Equip composition', () => {
    expect(refusal(EXACT)).toEqual([]);
  });

  it.each([
    ['identity', EXACT.map((line) => line.replace('Name:Maul of the Skyclaves', 'Name:Near Maul'))],
    ['trigger root', EXACT.map((line) => line.replace('T:Mode$ ChangesZone', 'T:Mode$ Phase'))],
    ['Attach API', EXACT.map((line) => line.replace('DB$ Attach', 'DB$ Pump'))],
    ['Attach target', EXACT.map((line) => line.replace('Creature.YouCtrl', 'Creature.OppCtrl'))],
    ['Equip cost', EXACT.map((line) => line.replace('K:Equip:2 W W', 'K:Equip:2 W'))],
    ['Equip keyword', EXACT.filter((line) => line !== 'K:Equip:2 W W')],
    ['additional line', [...EXACT, 'SVar:Unreviewed:DB$ Draw | NumCards$ 1']],
  ] as const)('keeps a hostile %s mutation closed', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed Maul of the Skyclaves composition');
  });
});
