import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedPiaSiegeGangRefusals, loadLegacyCubeSyntaxReview } from '@mtg/data';

const PIA_NALAAR = [
  'Name:Pia Nalaar',
  'ManaCost:2 R',
  'Types:Legendary Creature Human Artificer',
  'PT:2/2',
  'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigToken | TriggerDescription$ When CARDNAME enters, create a 1/1 colorless Thopter artifact creature token with flying.',
  'SVar:TrigToken:DB$ Token | TokenScript$ c_1_1_a_thopter_flying | TokenOwner$ You',
  'A:AB$ Pump | Cost$ 1 R | ValidTgts$ Creature.Artifact | NumAtt$ +1 | TgtPrompt$ Select target artifact creature. | SpellDescription$ Target artifact creature gets +1/+0 until end of turn.',
  "A:AB$ Pump | Cost$ 1 Sac<1/Artifact> | ValidTgts$ Creature | KW$ HIDDEN CARDNAME can't block. | IsCurse$ True | SpellDescription$ Target creature can't block this turn.",
  'DeckHas:Ability$Token',
  "Oracle:When Pia Nalaar enters, create a 1/1 colorless Thopter artifact creature token with flying.\\n{1}{R}: Target artifact creature gets +1/+0 until end of turn.\\n{1}, Sacrifice an artifact: Target creature can't block this turn.",
] as const;

const PIA_AND_KIRAN = [
  'Name:Pia and Kiran Nalaar',
  'ManaCost:2 R R',
  'Types:Legendary Creature Human Artificer',
  'PT:2/2',
  'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigToken | TriggerDescription$ When CARDNAME enters, create two 1/1 colorless Thopter artifact creature tokens with flying.',
  'SVar:TrigToken:DB$ Token | TokenAmount$ 2 | TokenScript$ c_1_1_a_thopter_flying | TokenOwner$ You',
  'A:AB$ DealDamage | Cost$ 2 R Sac<1/Artifact> | ValidTgts$ Any | NumDmg$ 2 | SpellDescription$ CARDNAME deals 2 damage to any target.',
  'DeckHas:Ability$Token',
  'Oracle:When Pia and Kiran Nalaar enters, create two 1/1 colorless Thopter artifact creature tokens with flying.\\n{2}{R}, Sacrifice an artifact: Pia and Kiran Nalaar deals 2 damage to any target.',
] as const;

const SIEGE_GANG = [
  'Name:Siege-Gang Commander',
  'ManaCost:3 R R',
  'Types:Creature Goblin',
  'PT:2/2',
  'A:AB$ DealDamage | Cost$ 1 R Sac<1/Goblin> | ValidTgts$ Any | NumDmg$ 2 | SpellDescription$ CARDNAME deals 2 damage to any target.',
  'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigToken | TriggerDescription$ When CARDNAME enters, create three 1/1 red Goblin creature tokens.',
  'SVar:TrigToken:DB$ Token | TokenAmount$ 3 | TokenScript$ r_1_1_goblin | TokenOwner$ You',
  'SVar:AIPreference:SacCost$Creature.Goblin+token,Creature.Goblin+cmcLE1',
  'DeckHas:Ability$Token',
  'DeckHints:Type$Goblin',
  'Oracle:When Siege-Gang Commander enters, create three 1/1 red Goblin creature tokens.\\n{1}{R}, Sacrifice a Goblin: Siege-Gang Commander deals 2 damage to any target.',
] as const;

const syntax = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedPiaSiegeGangRefusals(Buffer.from(lines.join('\n')), syntax);

function replace(lines: readonly string[], from: string, to: string): readonly string[] {
  const changed = lines.map((line) => line.replace(from, to));
  expect(changed).not.toEqual(lines);
  return changed;
}

describe('Legacy Cube reviewed Pia and Siege-Gang boundary', () => {
  it.each([
    ['Pia Nalaar', PIA_NALAAR],
    ['Pia and Kiran Nalaar', PIA_AND_KIRAN],
    ['Siege-Gang Commander', SIEGE_GANG],
  ])('admits only the exact complete %s script', (_name, exact) => {
    expect(refusal(exact)).toEqual([]);
  });

  it.each([
    ['identity', replace(PIA_NALAAR, 'Name:Pia Nalaar', 'Name:Near Nalaar')],
    ['printed mana', replace(PIA_NALAAR, 'ManaCost:2 R', 'ManaCost:1 R')],
    ['type line', replace(PIA_NALAAR, 'Human Artificer', 'Human Warrior')],
    ['power', replace(PIA_NALAAR, 'PT:2/2', 'PT:3/2')],
    ['entry origin', replace(PIA_NALAAR, 'Origin$ Any', 'Origin$ Stack')],
    ['token script', replace(PIA_NALAAR, 'c_1_1_a_thopter_flying', 'c_1_1_a_servo')],
    ['token owner', replace(PIA_NALAAR, 'TokenOwner$ You', 'TokenOwner$ Opponent')],
    ['pump mana', replace(PIA_NALAAR, 'Cost$ 1 R', 'Cost$ 2 R')],
    ['pump target', replace(PIA_NALAAR, 'ValidTgts$ Creature.Artifact', 'ValidTgts$ Creature')],
    ['pump amount', replace(PIA_NALAAR, 'NumAtt$ +1', 'NumAtt$ +2')],
    ['sacrifice count', replace(PIA_NALAAR, 'Sac<1/Artifact>', 'Sac<2/Artifact>')],
    ['sacrifice filter', replace(PIA_NALAAR, 'Sac<1/Artifact>', 'Sac<1/Creature>')],
    [
      'cannot-block target',
      replace(PIA_NALAAR, 'ValidTgts$ Creature | KW$', 'ValidTgts$ Creature.OppCtrl | KW$'),
    ],
    [
      'cannot-block keyword',
      replace(PIA_NALAAR, "HIDDEN CARDNAME can't block.", 'HIDDEN CARDNAME loses flying.'),
    ],
    ['curse direction', replace(PIA_NALAAR, 'IsCurse$ True', 'IsCurse$ False')],
    ['Pia and Kiran token count', replace(PIA_AND_KIRAN, 'TokenAmount$ 2', 'TokenAmount$ 1')],
    ['Pia and Kiran activation mana', replace(PIA_AND_KIRAN, 'Cost$ 2 R', 'Cost$ 1 R')],
    ['Pia and Kiran target', replace(PIA_AND_KIRAN, 'ValidTgts$ Any', 'ValidTgts$ Creature')],
    ['Pia and Kiran damage', replace(PIA_AND_KIRAN, 'NumDmg$ 2', 'NumDmg$ 3')],
    ['Siege-Gang token count', replace(SIEGE_GANG, 'TokenAmount$ 3', 'TokenAmount$ 2')],
    ['Siege-Gang token script', replace(SIEGE_GANG, 'r_1_1_goblin', 'r_1_1_elemental')],
    ['Siege-Gang sacrifice filter', replace(SIEGE_GANG, 'Sac<1/Goblin>', 'Sac<1/Artifact>')],
    ['Siege-Gang target', replace(SIEGE_GANG, 'ValidTgts$ Any', 'ValidTgts$ Player')],
    ['Siege-Gang AI preference', SIEGE_GANG.filter((line) => !line.startsWith('SVar:AIPreference:'))],
    ['line order', [PIA_AND_KIRAN[1], PIA_AND_KIRAN[0], ...PIA_AND_KIRAN.slice(2)]],
    ['extra mechanic', [...SIEGE_GANG, 'A:AB$ Draw | Cost$ 0 | NumCards$ 1']],
  ])('refuses %s drift as an exact-composition failure', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed Pia/Siege-Gang composition');
  });
});
