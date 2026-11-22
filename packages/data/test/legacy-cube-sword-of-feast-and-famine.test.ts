import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedSwordOfFeastAndFamineRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const EXACT = [
  'Name:Sword of Feast and Famine',
  'ManaCost:3',
  'Types:Artifact Equipment',
  'K:Equip:2',
  'S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddPower$ 2 | AddToughness$ 2 | AddSVar$ SwordOfFeastAndFamineCE | AddKeyword$ Protection from black & Protection from green | Description$ Equipped creature gets +2/+2 and has protection from black and from green.',
  'T:Mode$ DamageDone | ValidSource$ Creature.EquippedBy | ValidTarget$ Player | CombatDamage$ True | Execute$ TrigDiscard | TriggerZones$ Battlefield | TriggerDescription$ Whenever equipped creature deals combat damage to a player, that player discards a card and you untap all lands you control.',
  'SVar:TrigDiscard:DB$ Discard | Defined$ TriggeredTarget | NumCards$ 1 | Mode$ TgtChoose | SubAbility$ DBUntapAll',
  'SVar:DBUntapAll:DB$ UntapAll | ValidCards$ Land.YouCtrl',
  'SVar:SwordOfFeastAndFamineCE:SVar:MustBeBlocked:AttackingPlayerConservative',
  'Oracle:Equipped creature gets +2/+2 and has protection from black and from green.\\nWhenever equipped creature deals combat damage to a player, that player discards a card and you untap all lands you control.\\nEquip {2}',
] as const;

const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedSwordOfFeastAndFamineRefusals(
    new TextEncoder().encode(`${lines.join('\n')}\n`),
    loadLegacyCubeSyntaxReview(),
  );

describe('Legacy Cube reviewed Sword of Feast and Famine boundary', () => {
  it('lifts exactly the installed Equip and combat-trigger discard/untap composition', () => {
    expect(refusal(EXACT)).toEqual([]);
  });

  it.each([
    ['identity', EXACT.map((line) => line.replace('Name:Sword of Feast and Famine', 'Name:Near Sword'))],
    ['Equip cost', EXACT.map((line) => line.replace('K:Equip:2', 'K:Equip:3'))],
    ['power bonus', EXACT.map((line) => line.replace('AddPower$ 2', 'AddPower$ 3'))],
    ['protection', EXACT.map((line) => line.replace('Protection from green', 'Protection from white'))],
    ['trigger root', EXACT.map((line) => line.replace('T:Mode$ DamageDone', 'T:Mode$ Attacks'))],
    ['combat condition', EXACT.map((line) => line.replace('CombatDamage$ True', 'CombatDamage$ False'))],
    ['discard recipient', EXACT.map((line) => line.replace('Defined$ TriggeredTarget', 'Defined$ You'))],
    ['discard amount', EXACT.map((line) => line.replace('NumCards$ 1', 'NumCards$ 2'))],
    ['discard mode', EXACT.map((line) => line.replace('Mode$ TgtChoose', 'Mode$ Random'))],
    ['untap domain', EXACT.map((line) => line.replace('ValidCards$ Land.YouCtrl', 'ValidCards$ Land'))],
    ['subability', EXACT.map((line) => line.replace('SubAbility$ DBUntapAll', 'SubAbility$ Other'))],
    ['missing line', EXACT.filter((line) => !line.startsWith('SVar:DBUntapAll:'))],
    ['line order', [EXACT[0], EXACT[1], EXACT[2], EXACT[4], EXACT[3], ...EXACT.slice(5)]],
    ['additional line', [...EXACT, 'SVar:Unreviewed:DB$ Draw | NumCards$ 1']],
  ] as const)('keeps a hostile %s mutation closed', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed Sword of Feast and Famine composition');
  });
});
