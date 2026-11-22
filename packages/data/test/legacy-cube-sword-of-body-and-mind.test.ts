import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedSwordOfBodyAndMindRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const EXACT = [
  'Name:Sword of Body and Mind',
  'ManaCost:3',
  'Types:Artifact Equipment',
  'K:Equip:2',
  'S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddPower$ 2 | AddToughness$ 2 | AddSVar$ SwordOfBodyAndMindCE | AddKeyword$ Protection from green & Protection from blue | Description$ Equipped creature gets +2/+2 and has protection from green and from blue.',
  'T:Mode$ DamageDone | ValidSource$ Creature.EquippedBy | ValidTarget$ Player | CombatDamage$ True | Execute$ TrigToken | TriggerZones$ Battlefield | TriggerDescription$ Whenever equipped creature deals combat damage to a player, you create a 2/2 green Wolf creature token and that player mills ten cards.',
  'SVar:TrigToken:DB$ Token | TokenScript$ g_2_2_wolf | TokenOwner$ You | SubAbility$ DBMill',
  'SVar:DBMill:DB$ Mill | Defined$ TriggeredTarget | NumCards$ 10',
  'SVar:SwordOfBodyAndMindCE:SVar:MustBeBlocked:AttackingPlayerConservative',
  'DeckHas:Ability$Token',
  'Oracle:Equipped creature gets +2/+2 and has protection from green and from blue.\\nWhenever equipped creature deals combat damage to a player, you create a 2/2 green Wolf creature token and that player mills ten cards.\\nEquip {2}',
] as const;

const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedSwordOfBodyAndMindRefusals(
    new TextEncoder().encode(`${lines.join('\n')}\n`),
    loadLegacyCubeSyntaxReview(),
  );

describe('Legacy Cube reviewed Sword of Body and Mind boundary', () => {
  it('lifts exactly the installed Equip, Wolf-token, and mill-ten composition', () => {
    expect(refusal(EXACT)).toEqual([]);
  });

  it.each([
    ['identity', EXACT.map((line) => line.replace('Name:Sword of Body and Mind', 'Name:Near Sword'))],
    ['Equip cost', EXACT.map((line) => line.replace('K:Equip:2', 'K:Equip:3'))],
    ['power bonus', EXACT.map((line) => line.replace('AddPower$ 2', 'AddPower$ 3'))],
    ['protection', EXACT.map((line) => line.replace('Protection from blue', 'Protection from white'))],
    ['trigger root', EXACT.map((line) => line.replace('T:Mode$ DamageDone', 'T:Mode$ Attacks'))],
    ['combat condition', EXACT.map((line) => line.replace('CombatDamage$ True', 'CombatDamage$ False'))],
    [
      'token script',
      EXACT.map((line) => line.replace('TokenScript$ g_2_2_wolf', 'TokenScript$ g_3_3_beast')),
    ],
    ['token owner', EXACT.map((line) => line.replace('TokenOwner$ You', 'TokenOwner$ Opponent'))],
    ['mill amount', EXACT.map((line) => line.replace('NumCards$ 10', 'NumCards$ 9'))],
    ['mill recipient', EXACT.map((line) => line.replace('Defined$ TriggeredTarget', 'Defined$ You'))],
    ['subability', EXACT.map((line) => line.replace('SubAbility$ DBMill', 'SubAbility$ Other'))],
    ['missing mill', EXACT.filter((line) => !line.startsWith('SVar:DBMill:'))],
    ['line order', [EXACT[0], EXACT[1], EXACT[2], EXACT[4], EXACT[3], ...EXACT.slice(5)]],
    ['additional line', [...EXACT, 'SVar:Unreviewed:DB$ Draw | NumCards$ 1']],
  ] as const)('keeps a hostile %s mutation closed', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed Sword of Body and Mind composition');
  });
});
