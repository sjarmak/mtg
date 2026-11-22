import { describe, expect, it } from 'vitest';
import {
  LEGACY_CUBE_REVIEWED_GENERATED_OBJECT_BOUNDED_CHOICE_SAFE_POSITIONS,
  legacyCubeReviewedGeneratedObjectBoundedChoiceRefusals,
  loadLegacyCubeSyntaxReview,
} from '@mtg/data';

const LILIANA = String.raw`Name:Liliana, the Last Hope
ManaCost:1 B B
Types:Legendary Planeswalker Liliana
Loyalty:3
A:AB$ Pump | Cost$ AddCounter<1/LOYALTY> | Planeswalker$ True | NumAtt$ -2 | NumDef$ -1 | IsCurse$ True | Duration$ UntilYourNextTurn | TargetMin$ 0 | TargetMax$ 1 | ValidTgts$ Creature | SpellDescription$ Up to one target creature gets -2/-1 until your next turn.
A:AB$ Mill | Cost$ SubCounter<2/LOYALTY> | NumCards$ 2 | AILogic$ LilianaMill | Planeswalker$ True | Defined$ You | SubAbility$ DBChangeZone | SpellDescription$ Mill two cards, then you may return a creature card from your graveyard to your hand.
SVar:DBChangeZone:DB$ ChangeZone | Origin$ Graveyard | Destination$ Hand | ChangeType$ Creature.YouOwn | Hidden$ True
A:AB$ Effect | Cost$ SubCounter<7/LOYALTY> | Name$ Emblem — Liliana, the Last Hope | Image$ emblem_liliana_the_last_hope | Triggers$ TrigToken | Planeswalker$ True | Ultimate$ True | Duration$ Permanent | AILogic$ Always | SpellDescription$ You get an emblem with "At the beginning of your end step, create X 2/2 black Zombie creature tokens, where X is two plus the number of Zombies you control."
SVar:TrigToken:Mode$ Phase | Phase$ End of Turn | ValidPlayer$ You | TriggerZones$ Command | Execute$ DBToken | TriggerDescription$ At the beginning of your end step, create X 2/2 black Zombie creature tokens, where X is two plus the number of Zombies you control.
SVar:DBToken:DB$ Token | TokenAmount$ X | TokenScript$ b_2_2_zombie | TokenOwner$ You
SVar:X:Count$Valid Card.Zombie+YouCtrl/Plus.2
SVar:PlayMain1:TRUE
DeckHas:Ability$Token|Graveyard
DeckHints:Type$Zombie
Oracle:[+1]: Up to one target creature gets -2/-1 until your next turn.\n[-2]: Mill two cards, then you may return a creature card from your graveyard to your hand.\n[-7]: You get an emblem with "At the beginning of your end step, create X 2/2 black Zombie creature tokens, where X is two plus the number of Zombies you control."`;

const RANGER_CLASS = String.raw`Name:Ranger Class
ManaCost:1 G
Types:Enchantment Class
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigToken | TriggerDescription$ When CARDNAME enters, create a 2/2 green Wolf creature token.
SVar:TrigToken:DB$ Token | TokenScript$ g_2_2_wolf | TokenOwner$ You
K:Class:2:1 G:AddTrigger$ TriggerAttackersDeclared
SVar:TriggerAttackersDeclared:Mode$ AttackersDeclared | AttackingPlayer$ You | TriggerZones$ Battlefield | Execute$ TrigPutCounter | Secondary$ True | TriggerDescription$ Whenever you attack, put a +1/+1 counter on target attacking creature.
SVar:TrigPutCounter:DB$ PutCounter | ValidTgts$ Creature.attacking | TgtPrompt$ Select target attacking creature | CounterType$ P1P1 | CounterNum$ 1
K:Class:3:3 G:AddStaticAbility$ SMayLook & SMayPlay
SVar:SMayLook:Mode$ Continuous | Affected$ Card.TopLibrary+YouCtrl | AffectedZone$ Library | MayLookAt$ You | Secondary$ True | Description$ You may look at the top card of your library any time.
SVar:SMayPlay:Mode$ Continuous | Affected$ Creature.nonLand+TopLibrary+YouCtrl | AffectedZone$ Library | MayPlay$ True | Secondary$ True | Description$ You may cast creature spells from the top of your library.
DeckHas:Ability$Token|Counters
Oracle:(Gain the next level as a sorcery to add its ability.)\nWhen Ranger Class enters, create a 2/2 green Wolf creature token.\n{1}{G}: Level 2\nWhenever you attack, put a +1/+1 counter on target attacking creature.\n{3}{G}: Level 3\nYou may look at the top card of your library any time.\nYou may cast creature spells from the top of your library.`;

const VIVIEN = String.raw`Name:Vivien, Monsters' Advocate
ManaCost:3 G G
Types:Legendary Planeswalker Vivien
Loyalty:3
S:Mode$ Continuous | Affected$ Card.TopLibrary+YouCtrl | AffectedZone$ Library | MayLookAt$ You | Description$ You may look at the top card of your library any time.
S:Mode$ Continuous | Affected$ Creature.TopLibrary+YouCtrl | MayPlay$ True | AffectedZone$ Library | Description$ You may cast creature spells from the top of your library.
SVar:NonStackingEffect:True
A:AB$ Token | Cost$ AddCounter<1/LOYALTY> | Planeswalker$ True | TokenScript$ g_3_3_beast | TokenOwner$ You | RememberTokens$ True | SubAbility$ DBCounter | SpellDescription$ Create a 3/3 green Beast creature token. Put your choice of a vigilance counter, a reach counter, or a trample counter on it.
SVar:DBCounter:DB$ PutCounter | Defined$ Remembered | CounterType$ Vigilance,Reach,Trample | CounterNum$ 1 | SubAbility$ DBCleanup
SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True
A:AB$ Effect | Cost$ SubCounter<2/LOYALTY> | Planeswalker$ True | Ultimate$ True | Triggers$ TrigSearch | AILogic$ WillCastCreature | SpellDescription$ When you cast your next creature spell this turn, search your library for a creature card with lesser mana value, put it onto the battlefield, then shuffle.
SVar:TrigSearch:Mode$ SpellCast | ValidCard$ Creature | ValidActivatingPlayer$ You | OneOff$ True | TriggerZones$ Command | Execute$ DBSearch | TriggerDescription$ When you cast your next creature spell this turn, search your library for a creature card with lesser mana value, put it onto the battlefield, then shuffle.
SVar:DBSearch:DB$ ChangeZone | Origin$ Library | Destination$ Battlefield | ChangeType$ Creature.cmcLTX | ChangeNum$ 1
SVar:X:TriggeredSpellAbility$CardManaCostLKI
DeckHas:Ability$Token|Counters
Oracle:You may look at the top card of your library any time.\nYou may cast creature spells from the top of your library.\n[+1]: Create a 3/3 green Beast creature token. Put your choice of a vigilance counter, a reach counter, or a trample counter on it.\n[-2]: When you cast your next creature spell this turn, search your library for a creature card with lesser mana value, put it onto the battlefield, then shuffle.`;

const syntax = loadLegacyCubeSyntaxReview();
const refusal = (script: string): readonly string[] =>
  legacyCubeReviewedGeneratedObjectBoundedChoiceRefusals(Buffer.from(script), syntax);

describe('Legacy Cube reviewed generated-object bounded-choice boundary', () => {
  it('admits exactly the three reviewed whole scripts', () => {
    expect(refusal(LILIANA)).toEqual([]);
    expect(refusal(RANGER_CLASS)).toEqual([]);
    expect(refusal(VIVIEN)).toEqual([]);
    expect(LEGACY_CUBE_REVIEWED_GENERATED_OBJECT_BOUNDED_CHOICE_SAFE_POSITIONS).toEqual([181, 345, 389]);
  });

  it.each([
    ['identity', LILIANA.replace('Name:Liliana, the Last Hope', 'Name:Near Liliana')],
    ['optional minimum', LILIANA.replace('TargetMin$ 0', 'TargetMin$ 1')],
    ['optional maximum', LILIANA.replace('TargetMax$ 1', 'TargetMax$ 2')],
    ['duration', LILIANA.replace('Duration$ UntilYourNextTurn', 'Duration$ EndOfTurn')],
    ['Liliana mill amount', LILIANA.replace('NumCards$ 2', 'NumCards$ 3')],
    ['Liliana return domain', LILIANA.replace('ChangeType$ Creature.YouOwn', 'ChangeType$ Card.YouOwn')],
    ['Liliana hidden return', LILIANA.replace('Hidden$ True', 'Hidden$ False')],
    ['Liliana token', LILIANA.replace('TokenScript$ b_2_2_zombie', 'TokenScript$ g_2_2_wolf')],
    ['Ranger target', RANGER_CLASS.replace('Creature.attacking', 'Creature')],
    ['Ranger counter', RANGER_CLASS.replace('CounterType$ P1P1', 'CounterType$ M1M1')],
    [
      'Ranger prompt',
      RANGER_CLASS.replace('TgtPrompt$ Select target attacking creature', 'TgtPrompt$ Choose attacker'),
    ],
    ['Vivien counter menu', VIVIEN.replace('Vigilance,Reach,Trample', 'Reach,Vigilance,Trample')],
    ['Vivien remembered target', VIVIEN.replace('Defined$ Remembered', 'Defined$ Self')],
    ['Vivien search bound', VIVIEN.replace('Creature.cmcLTX', 'Creature.cmcLEX')],
    ['Vivien trigger lifetime', VIVIEN.replace('OneOff$ True', 'OneOff$ False')],
    ['extra ability', `${RANGER_CLASS}\nA:AB$ Draw | Cost$ 0 | NumCards$ 1`],
  ])('refuses %s drift', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed generated-object bounded-choice composition');
  });

  it('keeps adjacent payment policies closed', () => {
    expect(
      refusal(
        RANGER_CLASS.replace('Name:Ranger Class', 'Name:Shark Typhoon').replace(
          'K:Class:2:1 G:AddTrigger$ TriggerAttackersDeclared',
          'K:Cycling:1 U',
        ),
      ),
    ).not.toEqual([]);
  });
});
