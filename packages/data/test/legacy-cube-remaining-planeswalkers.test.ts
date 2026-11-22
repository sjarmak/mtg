import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedRemainingPlaneswalkersRefusals, loadLegacyCubeSyntaxReview } from '@mtg/data';

const KYTHEON = String.raw`Name:Kytheon, Hero of Akros
ManaCost:W
Types:Legendary Creature Human Soldier
PT:2/1
T:Mode$ Phase | Phase$ EndCombat | IsPresent$ Card.Self+attackedThisCombat GE3 | Execute$ TrigExile | TriggerDescription$ At end of combat, if CARDNAME and at least two other creatures attacked this combat, exile NICKNAME, then return him to the battlefield transformed under his owner's control.
SVar:TrigExile:DB$ ChangeZone | Origin$ Battlefield | Destination$ Exile | RememberChanged$ True | SubAbility$ DBReturn
SVar:DBReturn:DB$ ChangeZone | Defined$ Remembered | Origin$ Exile | Destination$ Battlefield | Transformed$ True | ForgetOtherRemembered$ True | SubAbility$ DBCleanup
SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True
A:AB$ Pump | Cost$ 2 W | Defined$ Self | KW$ Indestructible | SpellDescription$ NICKNAME gains indestructible until end of turn.
AlternateMode:DoubleFaced
Oracle:At end of combat, if Kytheon, Hero of Akros and at least two other creatures attacked this combat, exile Kytheon, then return him to the battlefield transformed under his owner's control.\n{2}{W}: Kytheon gains indestructible until end of turn.

ALTERNATE

Name:Gideon, Battle-Forged
ManaCost:no cost
Colors:white
Types:Legendary Planeswalker Gideon
Loyalty:3
A:AB$ DelayedTrigger | Cost$ AddCounter<2/LOYALTY> | Planeswalker$ True | TargetMin$ 0 | TargetMax$ 1 | ValidTgts$ Creature.OppCtrl | TgtPrompt$ Select target creature an opponent controls | Mode$ Phase | Phase$ Upkeep-> | ValidPlayer$ Player.controlsCard.IsTriggerRemembered | UpcomingTurn$ True | RememberObjects$ Targeted | Execute$ TrigEffect | Static$ True | SpellDescription$ Up to one target creature an opponent controls attacks CARDNAME during its controller's next turn if able.
SVar:TrigEffect:DB$ Effect | RememberObjects$ DelayTriggerRemembered | StaticAbilities$ MustAttack
SVar:MustAttack:Mode$ MustAttack | ValidCreature$ Creature.IsRemembered | MustAttack$ EffectSource | Description$ This creature attacks EFFECTSOURCE during its controller's next turn if able.
A:AB$ Pump | Cost$ AddCounter<1/LOYALTY> | Planeswalker$ True | ValidTgts$ Creature | KW$ Indestructible | Duration$ UntilYourNextTurn | SubAbility$ DBUntap | SpellDescription$ Until your next turn, target creature gains indestructible. Untap that creature.
SVar:DBUntap:DB$ Untap | Defined$ Targeted
A:AB$ Animate | Cost$ AddCounter<0/LOYALTY> | Defined$ Self | Power$ 4 | Toughness$ 4 | Types$ Creature,Human,Soldier | Keywords$ Indestructible | SubAbility$ DBPrevent | Planeswalker$ True | Ultimate$ True | SpellDescription$ Until end of turn, CARDNAME becomes a 4/4 Human Soldier creature with indestructible that's still a planeswalker. Prevent all damage that would be dealt to him this turn.
SVar:DBPrevent:DB$ Effect | ReplacementEffects$ RPrevent | Duration$ UntilHostLeavesPlayOrEOT
SVar:RPrevent:Event$ DamageDone | Prevent$ True | ValidTarget$ Card.EffectSource | Description$ Prevent all damage that would be dealt to EFFECTSOURCE this turn.
Oracle:[+2]: Up to one target creature an opponent controls attacks Gideon, Battle-Forged during its controller's next turn if able.\n[+1]: Until your next turn, target creature gains indestructible. Untap that creature.\n[0]: Until end of turn, Gideon, Battle-Forged becomes a 4/4 Human Soldier creature with indestructible that's still a planeswalker. Prevent all damage that would be dealt to him this turn.`;

const JACE = String.raw`Name:Jace, Vryn's Prodigy
ManaCost:1 U
Types:Legendary Creature Human Wizard
PT:0/2
A:AB$ Draw | Cost$ T | NumCards$ 1 | SubAbility$ DBDiscard | StackDescription$ SpellDescription | SpellDescription$ Draw a card, then discard a card. If there are five or more cards in your graveyard, exile CARDNAME, then return him to the battlefield transformed under his owner's control.
SVar:DBDiscard:DB$ Discard | Defined$ You | NumCards$ 1 | Mode$ TgtChoose | SubAbility$ DBExile | StackDescription$ None
SVar:DBExile:DB$ ChangeZone | Origin$ Battlefield | Destination$ Exile | RememberChanged$ True | ConditionCheckSVar$ X | ConditionSVarCompare$ GE5 | SubAbility$ DBReturn | StackDescription$ None
SVar:DBReturn:DB$ ChangeZone | Defined$ Remembered | Origin$ Exile | Destination$ Battlefield | Transformed$ True | ForgetOtherRemembered$ True | SubAbility$ DBCleanup | StackDescription$ None
SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True
SVar:X:Count$ValidGraveyard Card.YouOwn
DeckHas:Ability$Graveyard
AlternateMode:DoubleFaced
Oracle:{T}: Draw a card, then discard a card. If there are five or more cards in your graveyard, exile Jace, Vryn's Prodigy, then return him to the battlefield transformed under his owner's control.

ALTERNATE

Name:Jace, Telepath Unbound
ManaCost:no cost
Colors:blue
Types:Legendary Planeswalker Jace
Loyalty:5
A:AB$ Pump | Cost$ AddCounter<1/LOYALTY> | Planeswalker$ True | NumAtt$ -2 | IsCurse$ True | Duration$ UntilYourNextTurn | TargetMin$ 0 | TargetMax$ 1 | ValidTgts$ Creature | SpellDescription$ Up to one target creature gets -2/-0 until your next turn.
A:AB$ Effect | Cost$ SubCounter<3/LOYALTY> | Planeswalker$ True | ValidTgts$ Instant.YouCtrl,Sorcery.YouCtrl | TgtZone$ Graveyard | TgtPrompt$ Select target instant or sorcery card | RememberObjects$ Targeted | StaticAbilities$ Play | ExileOnMoved$ Graveyard | SubAbility$ DBEffect | SpellDescription$ You may cast target instant or sorcery card from your graveyard this turn. If that spell would be put into your graveyard this turn, exile it instead.
SVar:Play:Mode$ Continuous | MayPlay$ True | Affected$ Card.IsRemembered+nonLand | AffectedZone$ Graveyard | Description$ You may play remembered card.
SVar:DBEffect:DB$ Effect | RememberObjects$ Targeted | ExileOnMoved$ Stack | ReplacementEffects$ ReplaceGraveyard
SVar:ReplaceGraveyard:Event$ Moved | ValidCard$ Card.IsRemembered | Origin$ Stack | Destination$ Graveyard | ReplaceWith$ MoveExile | Description$ If that card would be put into your graveyard this turn, exile it instead.
SVar:MoveExile:DB$ ChangeZone | Defined$ ReplacedCard | Origin$ Stack | Destination$ Exile
A:AB$ Effect | Cost$ SubCounter<9/LOYALTY> | Planeswalker$ True | Ultimate$ True | Name$ Emblem — Jace, Telepath Unbound | Image$ emblem_jace_telepath_unbound | Triggers$ TrigSpellCast | Duration$ Permanent | AILogic$ Always | SpellDescription$ You get an emblem with "Whenever you cast a spell, target opponent mills five cards."
SVar:TrigSpellCast:Mode$ SpellCast | ValidActivatingPlayer$ You | Execute$ EffSpellCast | TriggerDescription$ Whenever you cast a spell, target opponent mills five cards.
SVar:EffSpellCast:DB$ Mill | NumCards$ 5 | ValidTgts$ Opponent | TgtPrompt$ Select target opponent
Oracle:[+1]: Up to one target creature gets -2/-0 until your next turn.\n[-3]: You may cast target instant or sorcery card from your graveyard this turn. If that spell would be put into your graveyard this turn, exile it instead.\n[-9]: You get an emblem with "Whenever you cast a spell, target opponent mills five cards."`;

const CHANDRA = String.raw`Name:Chandra, Acolyte of Flame
ManaCost:1 R R
Types:Legendary Planeswalker Chandra
Loyalty:4
A:AB$ PutCounterAll | Cost$ AddCounter<0/LOYALTY> | Planeswalker$ True | ValidCards$ Planeswalker.YouCtrl+Red | CounterType$ LOYALTY | CounterNum$ 1 | SpellDescription$ Put a loyalty counter on each red planeswalker you control.
A:AB$ Token | Cost$ AddCounter<0/LOYALTY> | Planeswalker$ True | TokenAmount$ 2 | TokenScript$ r_1_1_elemental | TokenOwner$ You | AtEOT$ Sacrifice | PumpKeywords$ Haste | SpellDescription$ Create two 1/1 red Elemental creature tokens. They gain haste. Sacrifice them at the beginning of the next end step.
A:AB$ Play | Cost$ SubCounter<2/LOYALTY> | Planeswalker$ True | ValidTgts$ Instant.YouCtrl+cmcLE3,Sorcery.YouCtrl+cmcLE3 | TgtZone$ Graveyard | TgtPrompt$ Select target instant or sorcery card with mana cost 3 or less | AILogic$ ReplaySpell | ValidSA$ Spell | Optional$ True | ExileOnMoved$ Graveyard | ReplaceGraveyard$ Exile | SpellDescription$ You may cast target instant or sorcery card with mana cost 3 or less from your graveyard. If that card would be put into your graveyard this turn, exile it instead.
DeckHas:Ability$Token
Oracle:[0]: Put a loyalty counter on each red planeswalker you control.\n[0]: Create two 1/1 red Elemental creature tokens. They gain haste. Sacrifice them at the beginning of the next end step.\n[-2]: You may cast target instant or sorcery card with mana value 3 or less from your graveyard. If that spell would be put into your graveyard this turn, exile it instead.`;

const NISSA = String.raw`Name:Nissa, Vastwood Seer
ManaCost:2 G
Types:Legendary Creature Elf Scout
PT:2/2
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigChange | OptionalDecider$ You | TriggerDescription$ When CARDNAME enters, you may search your library for a basic Forest card, reveal it, put it into your hand, then shuffle.
SVar:TrigChange:DB$ ChangeZone | Origin$ Library | Destination$ Hand | ChangeType$ Forest.Basic | ChangeNum$ 1 | ShuffleNonMandatory$ True
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Land.YouCtrl | TriggerZones$ Battlefield | IsPresent$ Land.YouCtrl | PresentCompare$ GE7 | Execute$ TrigExile | TriggerDescription$ Whenever a land you control enters, if you control seven or more lands, exile NICKNAME, then return her to the battlefield transformed under her owner's control.
SVar:TrigExile:DB$ ChangeZone | Origin$ Battlefield | Destination$ Exile | RememberChanged$ True | SubAbility$ DBReturn
SVar:DBReturn:DB$ ChangeZone | Defined$ Remembered | Origin$ Exile | Destination$ Battlefield | Transformed$ True | ForgetOtherRemembered$ True | SubAbility$ DBCleanup
SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True
AlternateMode:DoubleFaced
Oracle:When Nissa, Vastwood Seer enters, you may search your library for a basic Forest card, reveal it, put it into your hand, then shuffle.\nWhenever a land you control enters, if you control seven or more lands, exile Nissa, then return her to the battlefield transformed under her owner's control.

ALTERNATE

Name:Nissa, Sage Animist
ManaCost:no cost
Colors:green
Types:Legendary Planeswalker Nissa
Loyalty:3
A:AB$ Dig | Cost$ AddCounter<1/LOYALTY> | Planeswalker$ True | DigNum$ 1 | Reveal$ True | ChangeNum$ All | ChangeValid$ Land | DestinationZone$ Battlefield | DestinationZone2$ Hand | SpellDescription$ Reveal the top card of your library. If it's a land card, put it onto the battlefield. Otherwise, put it into your hand.
A:AB$ Token | Cost$ SubCounter<2/LOYALTY> | Planeswalker$ True | TokenScript$ ashaya_the_awoken_world | TokenOwner$ You | SpellDescription$ Create Ashaya, the Awoken World, a legendary 4/4 green Elemental creature token.
A:AB$ Untap | Cost$ SubCounter<7/LOYALTY> | Planeswalker$ True | Ultimate$ True | ValidTgts$ Land | TgtPrompt$ Choose target land | TargetMin$ 0 | TargetMax$ 6 | SubAbility$ DBAnimate | SpellDescription$ Untap up to six target lands. They become 6/6 Elemental creatures. They're still lands.
SVar:DBAnimate:DB$ Animate | Defined$ Targeted | Power$ 6 | Toughness$ 6 | Types$ Creature,Elemental | Duration$ Permanent
Oracle:[+1]: Reveal the top card of your library. If it's a land card, put it onto the battlefield. Otherwise, put it into your hand.\n[-2]: Create Ashaya, the Awoken World, a legendary 4/4 green Elemental creature token.\n[-7]: Untap up to six target lands. They become 6/6 Elemental creatures. They're still lands.`;

const scripts = { KYTHEON, JACE, CHANDRA, NISSA } as const;
const refusal = (script: string): readonly string[] =>
  legacyCubeReviewedRemainingPlaneswalkersRefusals(Buffer.from(script), loadLegacyCubeSyntaxReview());

describe('Legacy Cube remaining planeswalker boundary', () => {
  it.each(Object.entries(scripts))('admits only the complete installed %s script', (_name, script) => {
    expect(refusal(script)).toEqual([]);
  });

  it.each([
    ['Kytheon attack threshold', KYTHEON.replace('GE3', 'GE2')],
    ['Kytheon delayed target minimum', KYTHEON.replace('TargetMin$ 0', 'TargetMin$ 1')],
    ['Jace graveyard threshold', JACE.replace('GE5', 'GE4')],
    ['Jace emblem mill amount', JACE.replace('NumCards$ 5', 'NumCards$ 4')],
    ['Chandra token amount', CHANDRA.replace('TokenAmount$ 2', 'TokenAmount$ 3')],
    ['Chandra replay filter', CHANDRA.replaceAll('cmcLE3', 'cmcLE4')],
    ['Nissa land threshold', NISSA.replace('PresentCompare$ GE7', 'PresentCompare$ GE6')],
    ['Nissa ultimate maximum', NISSA.replace('TargetMax$ 6', 'TargetMax$ 7')],
    ['line order', [NISSA.split('\n')[1], NISSA.split('\n')[0], ...NISSA.split('\n').slice(2)].join('\n')],
    ['extra mechanic', `${CHANDRA}\nA:AB$ Draw | Cost$ 0 | NumCards$ 1`],
  ] as const)('refuses %s drift as an exact-composition failure', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed remaining planeswalker composition');
  });
});
