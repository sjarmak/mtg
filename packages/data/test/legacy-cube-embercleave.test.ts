import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedEmbercleaveRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const EXACT = [
  'Name:Embercleave',
  'ManaCost:4 R R',
  'Types:Legendary Artifact Equipment',
  'K:Flash',
  'S:Mode$ ReduceCost | ValidCard$ Card.Self | Type$ Spell | Amount$ X | EffectZone$ All | Description$ This spell costs {1} less to cast for each attacking creature you control.',
  'SVar:X:Count$Valid Creature.attacking+YouCtrl',
  'SVar:BuffedBy:Creature.attacking',
  'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigAttach | TriggerDescription$ When CARDNAME enters, attach it to target creature you control.',
  'SVar:TrigAttach:DB$ Attach | ValidTgts$ Creature.YouCtrl | TgtPrompt$ Select target creature you control.',
  'SVar:NeedsToPlay:Creature.YouCtrl',
  'AI:RemoveDeck:All',
  'S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddPower$ 1 | AddToughness$ 1 | AddKeyword$ Double Strike & Trample | Description$ Equipped creature gets +1/+1 and has double strike and trample.',
  'K:Equip:3',
  'Oracle:Flash\\nThis spell costs {1} less to cast for each attacking creature you control.\\nWhen Embercleave enters, attach it to target creature you control.\\nEquipped creature gets +1/+1 and has double strike and trample.\\nEquip {3}',
] as const;

const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedEmbercleaveRefusals(
    new TextEncoder().encode(`${lines.join('\n')}\n`),
    loadLegacyCubeSyntaxReview(),
  );

describe('Legacy Cube reviewed Embercleave boundary', () => {
  it('lifts exactly the installed attack discount, triggered Attach, and Equip composition', () => {
    expect(refusal(EXACT)).toEqual([]);
  });

  it.each([
    ['identity', EXACT.map((line) => line.replace('Name:Embercleave', 'Name:Nearcleave'))],
    ['mana cost', EXACT.map((line) => line.replace('ManaCost:4 R R', 'ManaCost:3 R R'))],
    ['Flash', EXACT.filter((line) => line !== 'K:Flash')],
    ['reducer type', EXACT.map((line) => line.replace('Type$ Spell', 'Type$ Ability'))],
    ['reducer amount', EXACT.map((line) => line.replace('Amount$ X', 'Amount$ 1'))],
    [
      'attacker count expression',
      EXACT.map((line) => line.replace('Creature.attacking+YouCtrl', 'Creature.attacking')),
    ],
    [
      'BuffedBy filter',
      EXACT.map((line) => line.replace('BuffedBy:Creature.attacking', 'BuffedBy:Creature')),
    ],
    ['trigger root', EXACT.map((line) => line.replace('T:Mode$ ChangesZone', 'T:Mode$ Phase'))],
    ['Attach API', EXACT.map((line) => line.replace('DB$ Attach', 'DB$ Pump'))],
    ['Attach target', EXACT.map((line) => line.replace('Creature.YouCtrl', 'Creature.OppCtrl'))],
    ['NeedsToPlay', EXACT.filter((line) => !line.startsWith('SVar:NeedsToPlay:'))],
    ['continuous power', EXACT.map((line) => line.replace('AddPower$ 1', 'AddPower$ 2'))],
    ['continuous toughness', EXACT.map((line) => line.replace('AddToughness$ 1', 'AddToughness$ 2'))],
    [
      'continuous keyword',
      EXACT.map((line) => line.replace('Double Strike & Trample', 'First Strike & Trample')),
    ],
    ['Equip cost', EXACT.map((line) => line.replace('K:Equip:3', 'K:Equip:2'))],
    ['additional line', [...EXACT, 'SVar:Unreviewed:DB$ Draw | NumCards$ 1']],
  ] as const)('keeps a hostile %s mutation closed', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed Embercleave composition');
  });
});
