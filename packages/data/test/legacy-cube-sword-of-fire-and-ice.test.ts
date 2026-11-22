import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedSwordOfFireAndIceRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const EXACT = [
  'Name:Sword of Fire and Ice',
  'ManaCost:3',
  'Types:Artifact Equipment',
  'K:Equip:2',
  'S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddPower$ 2 | AddToughness$ 2 | AddSVar$ SwordOfFireAndIceCE | AddKeyword$ Protection from red & Protection from blue | Description$ Equipped creature gets +2/+2 and has protection from red and from blue.',
  'T:Mode$ DamageDone | ValidSource$ Creature.EquippedBy | ValidTarget$ Player | CombatDamage$ True | Execute$ TrigDealDamage | TriggerZones$ Battlefield | TriggerDescription$ Whenever equipped creature deals combat damage to a player, CARDNAME deals 2 damage to any target and you draw a card.',
  'SVar:TrigDealDamage:DB$ DealDamage | ValidTgts$ Any | NumDmg$ 2 | SubAbility$ DBDraw',
  'SVar:DBDraw:DB$ Draw | Defined$ You | NumCards$ 1',
  'SVar:SwordOfFireAndIceCE:SVar:MustBeBlocked:AttackingPlayerConservative',
  'Oracle:Equipped creature gets +2/+2 and has protection from red and from blue.\\nWhenever equipped creature deals combat damage to a player, Sword of Fire and Ice deals 2 damage to any target and you draw a card.\\nEquip {2}',
] as const;

const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedSwordOfFireAndIceRefusals(
    new TextEncoder().encode(`${lines.join('\n')}\n`),
    loadLegacyCubeSyntaxReview(),
  );

describe('Legacy Cube reviewed Sword of Fire and Ice boundary', () => {
  it('lifts exactly the installed Equip and combat-trigger target composition', () => {
    expect(refusal(EXACT)).toEqual([]);
  });

  it.each([
    ['identity', EXACT.map((line) => line.replace('Name:Sword of Fire and Ice', 'Name:Near Sword'))],
    ['Equip cost', EXACT.map((line) => line.replace('K:Equip:2', 'K:Equip:3'))],
    ['power bonus', EXACT.map((line) => line.replace('AddPower$ 2', 'AddPower$ 3'))],
    ['protection', EXACT.map((line) => line.replace('Protection from blue', 'Protection from white'))],
    ['trigger root', EXACT.map((line) => line.replace('T:Mode$ DamageDone', 'T:Mode$ Attacks'))],
    ['combat condition', EXACT.map((line) => line.replace('CombatDamage$ True', 'CombatDamage$ False'))],
    ['target domain', EXACT.map((line) => line.replace('ValidTgts$ Any', 'ValidTgts$ Player'))],
    ['damage amount', EXACT.map((line) => line.replace('NumDmg$ 2', 'NumDmg$ 3'))],
    ['draw amount', EXACT.map((line) => line.replace('NumCards$ 1', 'NumCards$ 2'))],
    ['draw recipient', EXACT.map((line) => line.replace('Defined$ You', 'Defined$ Opponent'))],
    ['subability', EXACT.map((line) => line.replace('SubAbility$ DBDraw', 'SubAbility$ Other'))],
    ['missing line', EXACT.filter((line) => !line.startsWith('SVar:DBDraw:'))],
    ['line order', [EXACT[0], EXACT[1], EXACT[2], EXACT[4], EXACT[3], ...EXACT.slice(5)]],
    ['additional line', [...EXACT, 'SVar:Unreviewed:DB$ Draw | NumCards$ 1']],
  ] as const)('keeps a hostile %s mutation closed', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed Sword of Fire and Ice composition');
  });
});
