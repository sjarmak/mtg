import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedHuntmasterRefusals, loadLegacyCubeSyntaxReview } from '@mtg/data';

const EXACT = [
  'Name:Huntmaster of the Fells',
  'ManaCost:2 R G',
  'Types:Creature Human Werewolf',
  'PT:2/2',
  'T:Mode$ ChangesZone | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TokenAndLife | TriggerDescription$ Whenever this creature enters or transforms into CARDNAME, create a 2/2 green Wolf creature token and you gain 2 life.',
  'T:Mode$ Transformed | ValidCard$ Card.Self | Execute$ TokenAndLife | Secondary$ True | TriggerDescription$ Whenever this creature enters or transforms into CARDNAME, create a 2/2 green Wolf creature token and you gain 2 life.',
  'SVar:TokenAndLife:DB$ Token | TokenOwner$ You | TokenScript$ g_2_2_wolf | SubAbility$ Life',
  'SVar:Life:DB$ GainLife | Defined$ You | LifeAmount$ 2',
  'T:Mode$ Phase | Phase$ Upkeep | WerewolfTransformCondition$ True | TriggerZones$ Battlefield | Execute$ TrigTransform | TriggerDescription$ At the beginning of each upkeep, if no spells were cast last turn, transform CARDNAME.',
  'SVar:TrigTransform:DB$ SetState | Defined$ Self | Mode$ Transform',
  'AlternateMode:DoubleFaced',
  'Oracle:Whenever this creature enters or transforms into Huntmaster of the Fells, create a 2/2 green Wolf creature token and you gain 2 life.\\nAt the beginning of each upkeep, if no spells were cast last turn, transform Huntmaster of the Fells.',
  '',
  'ALTERNATE',
  '',
  'Name:Ravager of the Fells',
  'ManaCost:no cost',
  'Colors:green,red',
  'Types:Creature Werewolf',
  'PT:4/4',
  'K:Trample',
  "T:Mode$ Transformed | ValidCard$ Card.Self | Execute$ DamageAndMoreDamage | TriggerDescription$ Whenever this creature transforms into CARDNAME, it deals 2 damage to target opponent or planeswalker and 2 damage to up to one target creature that player or that planeswalker's controller controls.",
  'SVar:DamageAndMoreDamage:DB$ DealDamage | ValidTgts$ Opponent,Planeswalker | TgtPrompt$ Select target player or planeswalker | NumDmg$ 2 | DamageMap$ True | SubAbility$ MoreDamage',
  "SVar:MoreDamage:DB$ DealDamage | ValidTgts$ Creature.ControlledBy TargetedOrController | TgtPrompt$ Select up to one target creature that player or that planeswalker's controller controls | TargetMin$ 0 | TargetMax$ 1 | NumDmg$ 2 | SubAbility$ DBDamageResolve",
  'SVar:DBDamageResolve:DB$ DamageResolve',
  'T:Mode$ Phase | Phase$ Upkeep | WerewolfUntransformCondition$ True | TriggerZones$ Battlefield | Execute$ TrigTransform | TriggerDescription$ At the beginning of each upkeep, if a player cast two or more spells last turn, transform CARDNAME.',
  'SVar:TrigTransform:DB$ SetState | Defined$ Self | Mode$ Transform',
  "Oracle:Trample\\nWhenever this creature transforms into Ravager of the Fells, it deals 2 damage to target opponent or planeswalker and 2 damage to up to one target creature that player or that planeswalker's controller controls.\\nAt the beginning of each upkeep, if a player cast two or more spells last turn, transform Ravager of the Fells.",
] as const;

const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedHuntmasterRefusals(Buffer.from(lines.join('\n')), loadLegacyCubeSyntaxReview());

describe('Legacy Cube reviewed Huntmaster boundary', () => {
  it('admits only the complete installed double-faced script', () => {
    expect(refusal(EXACT)).toEqual([]);
  });

  it.each([
    ['front identity', EXACT.map((line) => line.replace('Name:Huntmaster of the Fells', 'Name:Nearmaster'))],
    ['front cost', EXACT.map((line) => line.replace('ManaCost:2 R G', 'ManaCost:1 R G'))],
    ['entry subject', EXACT.map((line) => line.replace('ValidCard$ Card.Self', 'ValidCard$ Card.YouCtrl'))],
    ['token owner', EXACT.map((line) => line.replace('TokenOwner$ You', 'TokenOwner$ Opponent'))],
    [
      'token script',
      EXACT.map((line) => line.replace('TokenScript$ g_2_2_wolf', 'TokenScript$ g_3_3_beast')),
    ],
    ['life amount', EXACT.map((line) => line.replace('LifeAmount$ 2', 'LifeAmount$ 3'))],
    [
      'front spell condition',
      EXACT.map((line) =>
        line.replace('WerewolfTransformCondition$ True', 'WerewolfTransformCondition$ False'),
      ),
    ],
    [
      'back spell condition',
      EXACT.map((line) =>
        line.replace('WerewolfUntransformCondition$ True', 'WerewolfUntransformCondition$ False'),
      ),
    ],
    ['back identity', EXACT.map((line) => line.replace('Name:Ravager of the Fells', 'Name:Near Ravager'))],
    [
      'first damage API',
      EXACT.map((line) =>
        line.replace('DamageAndMoreDamage:DB$ DealDamage', 'DamageAndMoreDamage:DB$ LoseLife'),
      ),
    ],
    [
      'first target filter',
      EXACT.map((line) => line.replace('ValidTgts$ Opponent,Planeswalker', 'ValidTgts$ Any')),
    ],
    [
      'first damage',
      EXACT.map((line) => line.replace('NumDmg$ 2 | DamageMap$ True', 'NumDmg$ 3 | DamageMap$ True')),
    ],
    ['damage map', EXACT.map((line) => line.replace('DamageMap$ True', 'DamageMap$ False'))],
    [
      'second target relationship',
      EXACT.map((line) => line.replace('ControlledBy TargetedOrController', 'OppCtrl')),
    ],
    ['second target minimum', EXACT.map((line) => line.replace('TargetMin$ 0', 'TargetMin$ 1'))],
    ['second target maximum', EXACT.map((line) => line.replace('TargetMax$ 1', 'TargetMax$ 2'))],
    [
      'damage resolution',
      EXACT.map((line) => line.replace('DBDamageResolve:DB$ DamageResolve', 'DBDamageResolve:DB$ Draw')),
    ],
    [
      'alternate marker',
      EXACT.map((line) => line.replace('AlternateMode:DoubleFaced', 'AlternateMode:Split')),
    ],
    ['line order', [EXACT[1], EXACT[0], ...EXACT.slice(2)]],
    ['extra mechanic', [...EXACT, 'A:AB$ Draw | Cost$ 0 | NumCards$ 1']],
  ] as const)('refuses %s drift as an exact-composition failure', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed Huntmaster composition');
  });
});
