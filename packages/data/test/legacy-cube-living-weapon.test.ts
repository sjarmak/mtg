import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedLivingWeaponRefusals, loadLegacyCubeSyntaxReview } from '../src/index';
import { generatedTokenScriptNames } from '../src/printed-card/token-references';

const KALDRA = [
  'Name:Kaldra Compleat',
  'ManaCost:7',
  'Types:Legendary Artifact Equipment',
  'K:Living Weapon',
  'K:Indestructible',
  'S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddPower$ 5 | AddToughness$ 5 | AddKeyword$ First Strike & Trample & Indestructible & Haste | AddTrigger$ TrigDamageDone | Description$ Equipped creature gets +5/+5 and has first strike, trample, indestructible, haste, and "Whenever this creature deals combat damage to a creature, exile that creature."',
  'SVar:TrigDamageDone:Mode$ DamageDone | CombatDamage$ True | ValidSource$ Card.Self | ValidTarget$ Creature | Execute$ TrigChangeZone | TriggerDescription$ Whenever this creature deals combat damage to a creature, exile that creature.',
  'SVar:TrigChangeZone:DB$ ChangeZone | Defined$ TriggeredTarget | Origin$ Battlefield | Destination$ Exile',
  'K:Equip:7',
  'Oracle:Living weapon\\nIndestructible\\nEquipped creature gets +5/+5 and has first strike, trample, indestructible, haste, and "Whenever this creature deals combat damage to a creature, exile that creature."\\nEquip {7}',
] as const;

const BATTERSKULL = [
  'Name:Batterskull',
  'ManaCost:5',
  'Types:Artifact Equipment',
  'K:Living Weapon',
  'K:Equip:5',
  'S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddPower$ 4 | AddToughness$ 4 | AddKeyword$ Vigilance & Lifelink | Description$ Equipped creature gets +4/+4 and has vigilance and lifelink.',
  "A:AB$ ChangeZone | Cost$ 3 | Origin$ Battlefield | Destination$ Hand | SpellDescription$ Return CARDNAME to its owner's hand.",
  'DeckHas:Ability$Token',
  "Oracle:Living weapon (When this Equipment enters, create a 0/0 black Phyrexian Germ creature token, then attach this to it.)\\nEquipped creature gets +4/+4 and has vigilance and lifelink.\\n{3}: Return Batterskull to its owner's hand.\\nEquip {5}",
] as const;

const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedLivingWeaponRefusals(
    new TextEncoder().encode(`${lines.join('\n')}\n`),
    loadLegacyCubeSyntaxReview(),
  );

describe('Legacy Cube reviewed Living Weapon boundary', () => {
  it.each([
    ['Kaldra Compleat', KALDRA],
    ['Batterskull', BATTERSKULL],
  ] as const)('resolves the implicit Phyrexian Germ dependency for %s', (_name, lines) => {
    expect(generatedTokenScriptNames(new TextEncoder().encode(`${lines.join('\n')}\n`))).toEqual([
      'b_0_0_phyrexian_germ',
    ]);
  });

  it.each([
    ['Kaldra Compleat', KALDRA],
    ['Batterskull', BATTERSKULL],
  ] as const)('lifts the exact reviewed %s composition', (_name, lines) => {
    expect(refusal(lines)).toEqual([]);
  });

  it.each([
    ['Kaldra identity', KALDRA.map((line) => line.replace('Name:Kaldra Compleat', 'Name:False Kaldra'))],
    ['Kaldra mana', KALDRA.map((line) => line.replace('ManaCost:7', 'ManaCost:6'))],
    ['Kaldra Living Weapon', KALDRA.filter((line) => line !== 'K:Living Weapon')],
    ['Kaldra power', KALDRA.map((line) => line.replace('AddPower$ 5', 'AddPower$ 4'))],
    [
      'Kaldra keywords',
      KALDRA.map((line) => line.replace('First Strike & Trample', 'Double Strike & Trample')),
    ],
    [
      'Kaldra combat trigger',
      KALDRA.map((line) => line.replace('CombatDamage$ True', 'CombatDamage$ False')),
    ],
    [
      'Kaldra exile destination',
      KALDRA.map((line) => line.replace('Destination$ Exile', 'Destination$ Graveyard')),
    ],
    ['Kaldra Equip', KALDRA.map((line) => line.replace('K:Equip:7', 'K:Equip:6'))],
    ['Batterskull identity', BATTERSKULL.map((line) => line.replace('Name:Batterskull', 'Name:Falseskull'))],
    ['Batterskull mana', BATTERSKULL.map((line) => line.replace('ManaCost:5', 'ManaCost:4'))],
    ['Batterskull Living Weapon', BATTERSKULL.filter((line) => line !== 'K:Living Weapon')],
    ['Batterskull power', BATTERSKULL.map((line) => line.replace('AddPower$ 4', 'AddPower$ 3'))],
    ['Batterskull keywords', BATTERSKULL.map((line) => line.replace('Vigilance & Lifelink', 'Vigilance'))],
    ['Batterskull return cost', BATTERSKULL.map((line) => line.replace('Cost$ 3', 'Cost$ 2'))],
    [
      'Batterskull return destination',
      BATTERSKULL.map((line) => line.replace('Destination$ Hand', 'Destination$ Exile')),
    ],
    ['Batterskull Equip', BATTERSKULL.map((line) => line.replace('K:Equip:5', 'K:Equip:4'))],
    ['additional line', [...BATTERSKULL, 'SVar:Unreviewed:DB$ Draw | NumCards$ 1']],
  ] as const)('keeps hostile %s mutation closed', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed Living Weapon composition');
  });
});
