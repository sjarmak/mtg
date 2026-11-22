import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedSwordOfLightAndShadowRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const EXACT = [
  'Name:Sword of Light and Shadow',
  'ManaCost:3',
  'Types:Artifact Equipment',
  'K:Equip:2',
  'S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddPower$ 2 | AddToughness$ 2 | AddSVar$ SwordOfLightAndShadowCE | AddKeyword$ Protection from white & Protection from black | Description$ Equipped creature gets +2/+2 and has protection from white and from black.',
  'T:Mode$ DamageDone | ValidSource$ Creature.EquippedBy | ValidTarget$ Player | CombatDamage$ True | Execute$ TrigGainLife | TriggerZones$ Battlefield | TriggerDescription$ Whenever equipped creature deals combat damage to a player, you gain 3 life and you may return up to one target creature card from your graveyard to your hand.',
  'SVar:TrigGainLife:DB$ GainLife | Defined$ You | LifeAmount$ 3 | SubAbility$ DBReturn',
  'SVar:DBReturn:DB$ ChangeZone | Optional$ You | Origin$ Graveyard | Destination$ Hand | ValidTgts$ Creature.YouCtrl | TargetMin$ 0 | TargetMax$ 1 | TgtPrompt$ Select target creature in your graveyard | SpellDescription$ You may return up to one target creature card from your graveyard to your hand.',
  'SVar:SwordOfLightAndShadowCE:SVar:MustBeBlocked:AttackingPlayerConservative',
  'Oracle:Equipped creature gets +2/+2 and has protection from white and from black.\\nWhenever equipped creature deals combat damage to a player, you gain 3 life and you may return up to one target creature card from your graveyard to your hand.\\nEquip {2}',
] as const;

const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedSwordOfLightAndShadowRefusals(
    new TextEncoder().encode(`${lines.join('\n')}\n`),
    loadLegacyCubeSyntaxReview(),
  );

describe('Legacy Cube reviewed Sword of Light and Shadow boundary', () => {
  it('lifts exactly the installed Equip, life-gain, and optional graveyard-target composition', () => {
    expect(refusal(EXACT)).toEqual([]);
  });

  it.each([
    ['identity', EXACT.map((line) => line.replace('Name:Sword of Light and Shadow', 'Name:Near Sword'))],
    ['Equip cost', EXACT.map((line) => line.replace('K:Equip:2', 'K:Equip:3'))],
    ['power bonus', EXACT.map((line) => line.replace('AddPower$ 2', 'AddPower$ 3'))],
    ['protection', EXACT.map((line) => line.replace('Protection from black', 'Protection from green'))],
    ['trigger root', EXACT.map((line) => line.replace('T:Mode$ DamageDone', 'T:Mode$ Attacks'))],
    ['combat condition', EXACT.map((line) => line.replace('CombatDamage$ True', 'CombatDamage$ False'))],
    ['life amount', EXACT.map((line) => line.replace('LifeAmount$ 3', 'LifeAmount$ 4'))],
    ['life recipient', EXACT.map((line) => line.replace('Defined$ You', 'Defined$ Opponent'))],
    ['optional decider', EXACT.map((line) => line.replace('Optional$ You', 'Optional$ Opponent'))],
    ['origin', EXACT.map((line) => line.replace('Origin$ Graveyard', 'Origin$ Exile'))],
    ['destination', EXACT.map((line) => line.replace('Destination$ Hand', 'Destination$ Battlefield'))],
    [
      'target domain',
      EXACT.map((line) => line.replace('ValidTgts$ Creature.YouCtrl', 'ValidTgts$ Card.YouCtrl')),
    ],
    ['minimum', EXACT.map((line) => line.replace('TargetMin$ 0', 'TargetMin$ 1'))],
    ['maximum', EXACT.map((line) => line.replace('TargetMax$ 1', 'TargetMax$ 2'))],
    ['subability', EXACT.map((line) => line.replace('SubAbility$ DBReturn', 'SubAbility$ Other'))],
    ['missing line', EXACT.filter((line) => !line.startsWith('SVar:DBReturn:'))],
    ['line order', [EXACT[0], EXACT[1], EXACT[2], EXACT[4], EXACT[3], ...EXACT.slice(5)]],
    ['additional line', [...EXACT, 'SVar:Unreviewed:DB$ Draw | NumCards$ 1']],
  ] as const)('keeps a hostile %s mutation closed', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed Sword of Light and Shadow composition');
  });
});
