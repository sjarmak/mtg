import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedSwordOfHearthAndHomeRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const EXACT = [
  'Name:Sword of Hearth and Home',
  'ManaCost:3',
  'Types:Artifact Equipment',
  'K:Equip:2',
  'S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddPower$ 2 | AddToughness$ 2 | AddSVar$ SwordOfHearthAndHomeCE | AddKeyword$ Protection from green & Protection from white | Description$ Equipped creature gets +2/+2 and has protection from green and from white.',
  'T:Mode$ DamageDone | ValidSource$ Creature.EquippedBy | ValidTarget$ Player | CombatDamage$ True | Execute$ TrigBlink | TriggerZones$ Battlefield | TriggerDescription$ Whenever equipped creature deals combat damage to a player, exile up to one target creature you own, then search your library for a basic land card. Put both cards onto the battlefield under your control, then shuffle.',
  'SVar:TrigBlink:DB$ ChangeZone | Origin$ Battlefield | Destination$ Exile | RememberChanged$ True | ValidTgts$ Creature.YouOwn | TargetMin$ 0 | TargetMax$ 1 | TgtPrompt$ Select target creature you own | SubAbility$ DBLand',
  'SVar:DBLand:DB$ ChangeZone | Origin$ Library | Destination$ Library | ChangeType$ Land.Basic | ChangeTypeDesc$ basic land | RememberChanged$ True | SubAbility$ DBReturn',
  'SVar:DBReturn:DB$ ChangeZone | Defined$ Remembered | Origin$ All | Destination$ Battlefield | GainControl$ True | SubAbility$ DBCleanup',
  'SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True',
  'SVar:SwordOfHearthAndHomeCE:SVar:MustBeBlocked:AttackingPlayerConservative',
  'Oracle:Equipped creature gets +2/+2 and has protection from green and from white.\\nWhenever equipped creature deals combat damage to a player, exile up to one target creature you own, then search your library for a basic land card. Put both cards onto the battlefield under your control, then shuffle.\\nEquip {2}',
] as const;

const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedSwordOfHearthAndHomeRefusals(
    new TextEncoder().encode(`${lines.join('\n')}\n`),
    loadLegacyCubeSyntaxReview(),
  );

describe('Legacy Cube reviewed Sword of Hearth and Home boundary', () => {
  it('lifts exactly the installed Equip, optional blink, basic search, and return composition', () => {
    expect(refusal(EXACT)).toEqual([]);
  });

  it.each([
    ['identity', EXACT.map((line) => line.replace('Name:Sword of Hearth and Home', 'Name:Near Sword'))],
    ['Equip cost', EXACT.map((line) => line.replace('K:Equip:2', 'K:Equip:3'))],
    ['power bonus', EXACT.map((line) => line.replace('AddPower$ 2', 'AddPower$ 3'))],
    ['protection', EXACT.map((line) => line.replace('Protection from white', 'Protection from blue'))],
    ['trigger root', EXACT.map((line) => line.replace('T:Mode$ DamageDone', 'T:Mode$ Attacks'))],
    ['combat condition', EXACT.map((line) => line.replace('CombatDamage$ True', 'CombatDamage$ False'))],
    ['blink origin', EXACT.map((line) => line.replace('Origin$ Battlefield', 'Origin$ Graveyard'))],
    ['blink destination', EXACT.map((line) => line.replace('Destination$ Exile', 'Destination$ Hand'))],
    ['blink domain', EXACT.map((line) => line.replace('ValidTgts$ Creature.YouOwn', 'ValidTgts$ Creature'))],
    ['blink minimum', EXACT.map((line) => line.replace('TargetMin$ 0', 'TargetMin$ 1'))],
    ['blink maximum', EXACT.map((line) => line.replace('TargetMax$ 1', 'TargetMax$ 2'))],
    ['search origin', EXACT.map((line) => line.replace('Origin$ Library', 'Origin$ Graveyard'))],
    ['search filter', EXACT.map((line) => line.replace('ChangeType$ Land.Basic', 'ChangeType$ Land'))],
    ['return definition', EXACT.map((line) => line.replace('Defined$ Remembered', 'Defined$ You'))],
    [
      'return destination',
      EXACT.map((line) => line.replace('Destination$ Battlefield', 'Destination$ Hand')),
    ],
    ['return control', EXACT.map((line) => line.replace('GainControl$ True', 'GainControl$ False'))],
    ['cleanup', EXACT.map((line) => line.replace('ClearRemembered$ True', 'ClearRemembered$ False'))],
    ['missing line', EXACT.filter((line) => !line.startsWith('SVar:DBCleanup:'))],
    ['line order', [EXACT[0], EXACT[1], EXACT[2], EXACT[4], EXACT[3], ...EXACT.slice(5)]],
    ['additional line', [...EXACT, 'SVar:Unreviewed:DB$ Draw | NumCards$ 1']],
  ] as const)('keeps a hostile %s mutation closed', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed Sword of Hearth and Home composition');
  });
});
