import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedGideonGarrukBloodlineRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const GIDEON = [
  'Name:Gideon Blackblade',
  'ManaCost:1 W W',
  'Types:Legendary Planeswalker Gideon',
  'Loyalty:4',
  "S:Mode$ Continuous | Affected$ Card.Self | EffectZone$ Battlefield | Condition$ PlayerTurn | SetPower$ 4 | SetToughness$ 4 | AddType$ Creature & Human & Soldier | AddKeyword$ Indestructible | Description$ During your turn, CARDNAME is a 4/4 Human Soldier creature with indestructible that's still a planeswalker.",
  'R:Event$ DamageDone | Prevent$ True | ValidTarget$ Card.Self | PlayerTurn$ True | Description$ Prevent all damage that would be dealt to CARDNAME during your turn.',
  'A:AB$ Pump | Cost$ AddCounter<1/LOYALTY> | Planeswalker$ True | TargetMin$ 0 | TargetMax$ 1 | ValidTgts$ Creature.YouCtrl+Other | TgtPrompt$ Select up to one target creature you control | KWChoice$ Vigilance,Lifelink,Indestructible | ConditionDefined$ Targeted | ConditionPresent$ Card | ConditionCompare$ GE1 | AILogic$ GideonBlackblade | SpellDescription$ Up to one other target creature you control gains your choice of vigilance, lifelink, or indestructible until end of turn. | StackDescription$ SpellDescription',
  'A:AB$ ChangeZone | Cost$ SubCounter<6/LOYALTY> | Planeswalker$ True | Ultimate$ True | ValidTgts$ Permanent.nonLand | TgtPrompt$ Select target nonland permanent | Origin$ Battlefield | Destination$ Exile | SpellDescription$ Exile target nonland permanent.',
  'DeckHints:Ability$LifeGain',
  "Oracle:During your turn, Gideon Blackblade is a 4/4 Human Soldier creature with indestructible that's still a planeswalker.\\nPrevent all damage that would be dealt to Gideon Blackblade during your turn.\\n[+1]: Up to one other target creature you control gains your choice of vigilance, lifelink, or indestructible until end of turn.\\n[-6]: Exile target nonland permanent.",
] as const;

const BLOODLINE = [
  'Name:Bloodline Keeper',
  'ManaCost:2 B B',
  'Types:Creature Vampire',
  'PT:3/3',
  'K:Flying',
  'A:AB$ Token | Cost$ T | TokenOwner$ You | TokenScript$ b_2_2_vampire_flying | SpellDescription$ Create a 2/2 black Vampire creature token with flying.',
  'A:AB$ SetState | Cost$ B | Defined$ Self | IsPresent$ Card.Vampire+YouCtrl | PresentCompare$ GE5 | Mode$ Transform | SpellDescription$ Transform CARDNAME. Activate only if you control five or more Vampires.',
  'AlternateMode:DoubleFaced',
  'Oracle:Flying\\n{T}: Create a 2/2 black Vampire creature token with flying.\\n{B}: Transform Bloodline Keeper. Activate only if you control five or more Vampires.',
  '',
  'ALTERNATE',
  '',
  'Name:Lord of Lineage',
  'ManaCost:no cost',
  'Colors:black',
  'Types:Creature Vampire',
  'PT:5/5',
  'K:Flying',
  'S:Mode$ Continuous | Affected$ Creature.Vampire+Other+YouCtrl | AddPower$ 2 | AddToughness$ 2 | Description$ Other Vampire creatures you control get +2/+2.',
  'A:AB$ Token | Cost$ T | TokenOwner$ You | TokenScript$ b_2_2_vampire_flying | SpellDescription$ Create a 2/2 black Vampire creature token with flying.',
  'Oracle:Flying\\nOther Vampire creatures you control get +2/+2.\\n{T}: Create a 2/2 black Vampire creature token with flying.',
] as const;

const GARRUK = [
  'Name:Garruk Wildspeaker',
  'ManaCost:2 G G',
  'Types:Legendary Planeswalker Garruk',
  'Loyalty:3',
  'A:AB$ Untap | Cost$ AddCounter<1/LOYALTY> | Planeswalker$ True | ValidTgts$ Land | TargetMin$ 2 | TargetMax$ 2 | SpellDescription$ Untap two target lands.',
  'A:AB$ Token | Cost$ SubCounter<1/LOYALTY> | Planeswalker$ True | TokenScript$ g_3_3_beast | TokenOwner$ You | SpellDescription$ Create a 3/3 green Beast creature token.',
  'A:AB$ PumpAll | Cost$ SubCounter<4/LOYALTY> | Planeswalker$ True | Ultimate$ True | ValidCards$ Creature.YouCtrl | NumAtt$ +3 | NumDef$ +3 | KW$ Trample | SpellDescription$ Creatures you control get +3/+3 and gain trample until end of turn.',
  'Oracle:[+1]: Untap two target lands.\\n[-1]: Create a 3/3 green Beast creature token.\\n[-4]: Creatures you control get +3/+3 and gain trample until end of turn.',
] as const;

const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedGideonGarrukBloodlineRefusals(
    new TextEncoder().encode(`${lines.join('\n')}\n`),
    loadLegacyCubeSyntaxReview(),
  );

describe('Legacy Cube reviewed Gideon/Garruk/Bloodline boundary', () => {
  it.each([
    ['Gideon Blackblade', GIDEON],
    ['Bloodline Keeper', BLOODLINE],
    ['Garruk Wildspeaker', GARRUK],
  ] as const)('lifts exactly %s', (_name, script) => {
    expect(refusal(script)).toEqual([]);
  });

  it.each([
    ['identity', GIDEON.map((line) => line.replace('Name:Gideon Blackblade', 'Name:Other'))],
    ['Gideon loyalty', GIDEON.map((line) => line.replace('Loyalty:4', 'Loyalty:5'))],
    ['Gideon own-turn condition', GIDEON.map((line) => line.replace('Condition$ PlayerTurn', ''))],
    ['Gideon power', GIDEON.map((line) => line.replace('SetPower$ 4', 'SetPower$ 5'))],
    ['Gideon target minimum', GIDEON.map((line) => line.replace('TargetMin$ 0', 'TargetMin$ 1'))],
    [
      'Gideon keyword menu',
      GIDEON.map((line) => line.replace('Vigilance,Lifelink,Indestructible', 'Vigilance,Lifelink')),
    ],
    ['Gideon exile filter', GIDEON.map((line) => line.replace('Permanent.nonLand', 'Permanent'))],
    ['Bloodline token', BLOODLINE.map((line) => line.replace('b_2_2_vampire_flying', 'g_3_3_beast'))],
    [
      'Bloodline threshold',
      BLOODLINE.map((line) => line.replace('PresentCompare$ GE5', 'PresentCompare$ GE4')),
    ],
    ['Bloodline alternate mode', BLOODLINE.map((line) => line.replace('AlternateMode:DoubleFaced', ''))],
    ['Bloodline anthem', BLOODLINE.map((line) => line.replace('AddPower$ 2', 'AddPower$ 3'))],
    ['Garruk target minimum', GARRUK.map((line) => line.replace('TargetMin$ 2', 'TargetMin$ 1'))],
    [
      'Garruk target filter',
      GARRUK.map((line) => line.replace('ValidTgts$ Land', 'ValidTgts$ Land.YouCtrl')),
    ],
    ['Garruk token', GARRUK.map((line) => line.replace('g_3_3_beast', 'g_2_2_wolf'))],
    ['Garruk ultimate amount', GARRUK.map((line) => line.replace('NumAtt$ +3', 'NumAtt$ +4'))],
    ['additional line', [...GARRUK, 'SVar:Unreviewed:DB$ Draw | NumCards$ 1']],
  ] as const)('keeps a hostile %s mutation closed', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed Gideon/Garruk/Bloodline composition');
  });
});
