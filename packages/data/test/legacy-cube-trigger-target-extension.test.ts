import { describe, expect, it } from 'vitest';
import {
  legacyCubeReviewedTriggerTargetRefusals,
  legacyCubeStatedOrderingTriggerTargetAndHiddenHandRefusals,
  legacyCubeStatedOrderingTriggerTargetRefusals,
  loadLegacyCubeSyntaxReview,
} from '../src/index';

const script = (lines: readonly string[]): Uint8Array =>
  new TextEncoder().encode(['Name:Trigger Target Fixture', 'ManaCost:2 W', ...lines].join('\n'));

const namedScript = (name: string, lines: readonly string[]): Uint8Array =>
  new TextEncoder().encode([`Name:${name}`, 'ManaCost:2 W', ...lines].join('\n'));

const inventory = loadLegacyCubeSyntaxReview();

describe('Legacy Cube stated-ordering trigger-target boundary', () => {
  it('admits a mandatory singleton target executed by a top-level trigger', () => {
    expect(
      legacyCubeStatedOrderingTriggerTargetRefusals(
        script([
          'T:Mode$ ChangesZone | ValidCard$ Card.Self | Destination$ Battlefield | Execute$ TrigLook',
          'SVar:TrigLook:DB$ Destroy | ValidTgts$ Opponent',
        ]),
        inventory,
      ),
    ).toEqual([]);
  });

  it.each([
    [
      [
        'T:Mode$ ChangesZone | ValidCard$ Card.Self | Destination$ Battlefield | Execute$ Trig',
        'SVar:Trig:DB$ RevealHand | ValidTgts$ Opponent | SubAbility$ Pick',
        'SVar:Pick:DB$ ChooseCard | ChoiceZone$ Hand | MinAmount$ 0 | Amount$ 1',
      ],
      'optional card selection',
    ],
    [
      [
        'T:Mode$ ChangesZone | ValidCard$ Card.Self | Destination$ Battlefield | Execute$ Trig',
        'SVar:Trig:DB$ RevealHand | ValidTgts$ Opponent | SubAbility$ Pick',
        'SVar:Pick:DB$ ChangeZone | Origin$ Hand | Destination$ Exile | Chooser$ You | ChangeNum$ 1',
      ],
      'nested zone-card selection',
    ],
    [
      [
        'T:Mode$ ChangesZone | ValidCard$ Card.Self | Destination$ Battlefield | Execute$ Trig',
        'SVar:Trig:DB$ Destroy | ValidTgts$ Creature | TargetMin$ 0',
      ],
      'optional target',
    ],
    [
      [
        'T:Mode$ ChangesZone | ValidCard$ Card.Self | Destination$ Battlefield | Execute$ Trig',
        'SVar:Trig:DB$ Destroy | ValidTgts$ Creature | TargetMax$ 2',
      ],
      'multiple targets',
    ],
    [
      [
        'T:Mode$ ChangesZone | ValidCard$ Card.Self | Destination$ Battlefield | Execute$ Trig',
        'SVar:Trig:DB$ Destroy | ValidTgts$ Creature',
        'A:AB$ Destroy | Cost$ 2 | ValidTgts$ Artifact',
      ],
      'non-trigger target',
    ],
    [
      [
        'T:Mode$ ChangesZone | ValidCard$ Card.Self | Destination$ Battlefield | Execute$ Trig',
        'SVar:Trig:DB$ Destroy | ValidTgts$ Creature',
        'A:AB$ Mana | Cost$ T | Produced$ Any',
      ],
      'independent mana-color choice',
    ],
    [
      [
        'T:Mode$ ChangesZone | ValidCard$ Card.Self | Destination$ Battlefield | Execute$ Trig',
        'SVar:Trig:DB$ Token | ValidTgts$ Player | TokenScript$ g_2_2_wolf',
      ],
      'generated-object dependency',
    ],
  ] as const)('refuses an independently unreviewed shape', (lines, refusal) => {
    expect(legacyCubeStatedOrderingTriggerTargetRefusals(script(lines), inventory)).toContain(refusal);
  });

  it.each([
    [
      'Elite Spellbinder',
      [
        'T:Mode$ ChangesZone | ValidCard$ Card.Self | Destination$ Battlefield | Execute$ TrigLook',
        'SVar:TrigLook:DB$ RevealHand | ValidTgts$ Opponent | Look$ True | RememberRevealed$ True | SubAbility$ DBChooseCard',
        'SVar:DBChooseCard:DB$ ChooseCard | ChoiceZone$ Hand | Choices$ Card.nonLand+IsRemembered | ChoiceTitle$ You may exile a nonland card from it | MinAmount$ 0 | Amount$ 1 | SubAbility$ DBChangeZone',
        'SVar:DBChangeZone:DB$ ChangeZone | Defined$ ChosenCard | Origin$ Hand | Destination$ Exile | Imprint$ True | SubAbility$ DBEffect',
      ],
    ],
    [
      'Kitesail Freebooter',
      [
        'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigReveal',
        'SVar:TrigReveal:DB$ RevealHand | Defined$ Targeted | ValidTgts$ Opponent | SubAbility$ ExileCard',
        'SVar:ExileCard:DB$ ChangeZone | Origin$ Hand | Destination$ Exile | DefinedPlayer$ Targeted | Chooser$ You | ChangeType$ Card.nonCreature+nonLand | ChangeNum$ 1 | IsCurse$ True | Duration$ UntilHostLeavesPlay',
      ],
    ],
  ] as const)('admits the exact reviewed %s hidden-hand trigger composition', (name, lines) => {
    expect(
      legacyCubeStatedOrderingTriggerTargetAndHiddenHandRefusals(namedScript(name, lines), inventory),
    ).toEqual([]);
  });

  it.each([
    [
      'Elite Spellbinder',
      [
        'T:Mode$ ChangesZone | ValidCard$ Card.Self | Destination$ Battlefield | Execute$ TrigLook',
        'SVar:TrigLook:DB$ RevealHand | ValidTgts$ Opponent | SubAbility$ DBChooseCard',
        'SVar:DBChooseCard:DB$ ChooseCard | ChoiceZone$ Hand | Choices$ Card.nonLand+IsRemembered | MinAmount$ 0 | Amount$ 2 | SubAbility$ DBChangeZone',
      ],
      'optional card selection',
    ],
    [
      'Kitesail Freebooter',
      [
        'T:Mode$ ChangesZone | ValidCard$ Card.Self | Destination$ Battlefield | Execute$ TrigReveal',
        'SVar:TrigReveal:DB$ RevealHand | ValidTgts$ Opponent | SubAbility$ ExileCard',
        'SVar:ExileCard:DB$ ChangeZone | Origin$ Hand | Destination$ Exile | DefinedPlayer$ Targeted | Chooser$ You | ChangeType$ Card.nonCreature+nonLand | ChangeNum$ 2 | IsCurse$ True | Duration$ UntilHostLeavesPlay',
      ],
      'nested zone-card selection',
    ],
  ] as const)('keeps a mutated %s hidden-hand composition refused', (name, lines, refusal) => {
    expect(
      legacyCubeStatedOrderingTriggerTargetAndHiddenHandRefusals(namedScript(name, lines), inventory),
    ).toContain(refusal);
  });
});

describe('Legacy Cube reviewed trigger-target compositions', () => {
  const reviewed = [
    [
      'Outpost Siege',
      [
        'K:ETBReplacement:Other:SiegeChoice',
        'S:Mode$ Continuous | Affected$ Card.Self+ChosenModeDragons | AddTrigger$ DragonsTrigger',
        'SVar:DragonsTrigger:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Any | ValidCard$ Creature.YouCtrl | TriggerZones$ Battlefield | Execute$ SmallBurnination',
        'SVar:SmallBurnination:DB$ DealDamage | ValidTgts$ Any | NumDmg$ 1',
      ],
    ],
    [
      'Klothys, God of Destiny',
      [
        'T:Mode$ Phase | Phase$ Main1 | ValidPlayer$ You | TriggerZones$ Battlefield | Execute$ TrigChangeZone',
        'SVar:TrigChangeZone:DB$ ChangeZone | Origin$ Graveyard | Destination$ Exile | ValidTgts$ Card | RememberChanged$ True | SubAbility$ DBMana',
        'SVar:DBMana:DB$ Mana | Amount$ 1 | Produced$ Combo R G | ConditionDefined$ Remembered | ConditionPresent$ Land | ConditionCompare$ EQ1',
      ],
    ],
    [
      'Tidehollow Sculler',
      [
        'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigExile',
        'SVar:TrigExile:DB$ ChangeZone | Origin$ Hand | Destination$ Exile | ValidTgts$ Opponent | DefinedPlayer$ Targeted | Chooser$ You | ChangeType$ Card.nonLand | ChangeNum$ 1 | IsCurse$ True | RememberChanged$ True | ForgetOtherRemembered$ True',
      ],
    ],
    [
      'Showdown of the Skalds',
      [
        'K:Chapter:3:TrigExile,TrigEffect,TrigEffect',
        'SVar:TrigEffect:DB$ Effect | Triggers$ CastSpell',
        'SVar:CastSpell:Mode$ SpellCast | ValidCard$ Card | ValidActivatingPlayer$ You | TriggerZones$ Command | Execute$ DBPutCounter',
        'SVar:DBPutCounter:DB$ PutCounter | CounterType$ P1P1 | CounterNum$ 1 | ValidTgts$ Creature.YouCtrl',
      ],
    ],
    [
      'Restoration Angel',
      [
        'T:Mode$ ChangesZone | ValidCard$ Card.Self | Origin$ Any | Destination$ Battlefield | Execute$ RestorationExile | OptionalDecider$ You',
        'SVar:RestorationExile:DB$ ChangeZone | ValidTgts$ Creature.nonAngel+YouCtrl | Origin$ Battlefield | Destination$ Exile | RememberTargets$ True | ForgetOtherTargets$ True | SubAbility$ RestorationReturn',
        'SVar:RestorationReturn:DB$ ChangeZone | Defined$ Remembered | Origin$ Exile | Destination$ Battlefield | GainControl$ True',
      ],
    ],
    [
      'Sun Titan',
      [
        'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigChange | OptionalDecider$ You',
        'T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ TrigChange | TriggerZones$ Battlefield | OptionalDecider$ You | Secondary$ True',
        'SVar:TrigChange:DB$ ChangeZone | Origin$ Graveyard | Destination$ Battlefield | ValidTgts$ Permanent.YouCtrl+cmcLE3',
      ],
    ],
    [
      'Reclamation Sage',
      [
        'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDestroy | OptionalDecider$ You',
        'SVar:TrigDestroy:DB$ Destroy | ValidTgts$ Artifact,Enchantment',
      ],
    ],
    [
      'Eternal Witness',
      [
        'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigChangeZone | OptionalDecider$ You',
        'SVar:TrigChangeZone:DB$ ChangeZone | Origin$ Graveyard | Destination$ Hand | ValidTgts$ Card.YouCtrl',
      ],
    ],
    [
      'Duplicant',
      [
        'T:Mode$ ChangesZone | ValidCard$ Card.Self | Origin$ Any | Destination$ Battlefield | OptionalDecider$ You | Execute$ TrigExile',
        'SVar:TrigExile:DB$ ChangeZone | Unimprint$ True | Imprint$ True | ImprintLast$ True | Origin$ Battlefield | Destination$ Exile | ValidTgts$ Creature.!token',
      ],
    ],
    [
      'Cast Out',
      [
        'K:Flash',
        'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigExile',
        'SVar:TrigExile:DB$ ChangeZone | Origin$ Battlefield | Destination$ Exile | ValidTgts$ Permanent.nonLand+OppCtrl | TgtPrompt$ Select target nonland permanent an opponent controls | Duration$ UntilHostLeavesPlay',
        'K:Cycling:W',
      ],
    ],
    [
      'Pestermite',
      [
        'K:Flying',
        'K:Flash',
        'T:Mode$ ChangesZone | ValidCard$ Card.Self | Origin$ Any | Destination$ Battlefield | Execute$ TrigTapOrUntap | OptionalDecider$ You',
        'SVar:TrigTapOrUntap:DB$ TapOrUntap | ValidTgts$ Permanent',
      ],
    ],
    [
      'Riftwing Cloudskate',
      [
        'K:Flying',
        'K:Suspend:3:1 U',
        'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigChangeZone',
        'SVar:TrigChangeZone:DB$ ChangeZone | ValidTgts$ Permanent | Origin$ Battlefield | Destination$ Hand',
      ],
    ],
    [
      'Bone Shredder',
      [
        'K:Flying',
        'K:Echo:2 B',
        'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDestroy',
        'SVar:TrigDestroy:DB$ Destroy | ValidTgts$ Creature.nonArtifact+nonBlack | TgtPrompt$ Select target nonartifact, nonblack creature.',
      ],
    ],
    [
      'Shriekmaw',
      [
        'K:Fear',
        'K:Evoke:1 B',
        'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDestroy',
        'SVar:TrigDestroy:DB$ Destroy | ValidTgts$ Creature.nonBlack+nonArtifact | TgtPrompt$ Select target nonartifact, nonblack creature.',
        'SVar:NeedsToPlayEvoked:Creature.OppCtrl+nonArtifact+nonBlack',
      ],
    ],
    [
      'Solitude',
      [
        'K:Flash',
        'K:Lifelink',
        'K:Evoke:ExileFromHand<1/Card.White+Other/white card>',
        "T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigExile | TriggerDescription$ When CARDNAME enters, exile up to one other target creature. That creature's controller gains life equal to its power.",
        'SVar:TrigExile:DB$ ChangeZone | Origin$ Battlefield | Destination$ Exile | ValidTgts$ Creature.Other | TgtPrompt$ Select up to one other target creature | TargetMin$ 0 | TargetMax$ 1 | SubAbility$ DBGainLife',
        'SVar:DBGainLife:DB$ GainLife | Defined$ TargetedController | LifeAmount$ X',
        'SVar:X:Targeted$CardPower',
      ],
    ],
    [
      'Avalanche Riders',
      [
        'K:Haste',
        'K:Echo:3 R',
        'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDestroy',
        'SVar:TrigDestroy:DB$ Destroy | ValidTgts$ Land',
      ],
    ],
    [
      'Frost Titan',
      [
        'T:Mode$ BecomesTarget | ValidSource$ SpellAbility.OppCtrl | ValidTarget$ Card.Self | TriggerZones$ Battlefield | Execute$ TrigCounter',
        'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigTap',
        'T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ TrigTap | Secondary$ True',
        'SVar:TrigTap:DB$ Tap | ValidTgts$ Permanent | SubAbility$ DBPump',
        "SVar:DBPump:DB$ Pump | Defined$ Targeted | Duration$ Permanent | KW$ HIDDEN This card doesn't untap during your next untap step.",
        'SVar:TrigCounter:DB$ Counter | Defined$ TriggeredSourceSA | UnlessCost$ 2 | UnlessPayer$ TriggeredSourceSAController',
        'SVar:HasAttackEffect:TRUE',
      ],
    ],
    [
      'Gatekeeper of Malakir',
      [
        'K:Kicker:B',
        'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self+kicked | Execute$ TrigKicker',
        'SVar:TrigKicker:DB$ Sacrifice | ValidTgts$ Player | SacValid$ Creature',
        'SVar:NeedsToPlayKicked:Creature.YouDontCtrl',
        'SVar:PlayMain1:TRUE',
      ],
    ],
    [
      'Flametongue Yearling',
      [
        'K:Multikicker:2',
        'K:etbCounter:P1P1:XKicked:no Condition:CARDNAME enters with a +1/+1 counter on it for each time it was kicked.',
        'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDealDamage',
        'SVar:TrigDealDamage:DB$ DealDamage | ValidTgts$ Creature | NumDmg$ Y',
        'SVar:X:Count$CardCounters.P1P1',
        'SVar:XKicked:Count$TimesKicked',
        'SVar:Y:Count$CardPower',
        'DeckHas:Ability$Counters',
      ],
    ],
    [
      'Den Protector',
      [
        "S:Mode$ CantBlockBy | ValidAttacker$ Creature.Self | ValidBlocker$ Creature.powerLTX | Description$ Creatures with power less than CARDNAME's power can't block it.",
        'SVar:X:Count$CardPower',
        'K:Megamorph:1 G',
        'T:Mode$ TurnFaceUp | ValidCard$ Card.Self | Execute$ TrigReturn | TriggerZones$ Battlefield',
        'SVar:TrigReturn:DB$ ChangeZone | ValidTgts$ Card.YouOwn | Origin$ Graveyard | Destination$ Hand',
      ],
    ],
    [
      'Stratus Dancer',
      [
        'K:Flying',
        'K:Megamorph:1 U',
        'T:Mode$ TurnFaceUp | ValidCard$ Card.Self | Execute$ TrigCounter | TriggerZones$ Battlefield | TriggerDescription$ When CARDNAME is turned face up, counter target instant or sorcery spell.',
        'SVar:TrigCounter:DB$ Counter | TargetType$ Spell | ValidTgts$ Instant,Sorcery | TgtPrompt$ Select target instant or sorcery spell',
      ],
    ],
    [
      'Vendilion Clique',
      [
        'K:Flying',
        'K:Flash',
        'T:Mode$ ChangesZone | ValidCard$ Card.Self | Origin$ Any | Destination$ Battlefield | Execute$ TrigPickCard',
        'SVar:TrigPickCard:DB$ ChangeZone | ValidTgts$ Player | Origin$ Hand | Destination$ Library | LibraryPosition$ -1 | ChangeType$ Card.nonLand | ChangeNum$ 1 | Hidden$ True | RememberChanged$ True | Chooser$ You | Optional$ True | IsCurse$ True | SubAbility$ DBDraw',
        'SVar:DBDraw:DB$ Draw | Defined$ Targeted | NumCards$ 1 | SubAbility$ DBCleanup | ConditionDefined$ Remembered | ConditionPresent$ Card | ConditionCompare$ EQ1',
        'SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True',
      ],
    ],
    [
      'Venser, Shaper Savant',
      [
        'K:Flash',
        "T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ VensersBounce | TriggerDescription$ When CARDNAME enters, return target spell or permanent to its owner's hand.",
        'SVar:VensersBounce:DB$ ChangeZone | ValidTgts$ Permanent,Card.inZoneStack | TgtZone$ Stack,Battlefield | Origin$ Battlefield,Stack | Destination$ Hand',
      ],
    ],
    [
      'Torrential Gearhulk',
      [
        'K:Flash',
        'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigPlay',
        'SVar:TrigPlay:DB$ Play | TgtZone$ Graveyard | ValidTgts$ Instant.YouCtrl | ValidSA$ Spell | TgtPrompt$ Choose target instant card from your graveyard | WithoutManaCost$ True | Optional$ True | ReplaceGraveyard$ Exile | AILogic$ ReplaySpell',
      ],
    ],
    [
      'Gonti, Lord of Luxury',
      [
        'K:Deathtouch',
        'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDig',
        'SVar:TrigDig:DB$ Dig | ValidTgts$ Opponent | DigNum$ 4 | ChangeNum$ 1 | DestinationZone$ Exile | DestinationZone2$ Library | LibraryPosition$ -1 | RestRandomOrder$ True | ExileFaceDown$ True | WithMayLook$ True | ChangeValid$ Card | RememberChanged$ True | SubAbility$ DBEffect',
        'SVar:DBEffect:DB$ Effect | RememberObjects$ Remembered | StaticAbilities$ STPlay | Duration$ Permanent | ForgetOnMoved$ Exile | SubAbility$ DBCleanup',
        'SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True',
      ],
    ],
    [
      'Cavalier of Night',
      [
        'K:Lifelink',
        'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigSac',
        'SVar:TrigSac:AB$ ImmediateTrigger | Cost$ Sac<1/Creature.Other/another creature> | Execute$ TrigDestroy',
        'SVar:TrigDestroy:DB$ Destroy | ValidTgts$ Creature.OppCtrl | TgtPrompt$ Select target creature an opponent controls',
        'T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Card.Self | Execute$ TrigChange',
        'SVar:TrigChange:DB$ ChangeZone | Origin$ Graveyard | Destination$ Battlefield | ValidTgts$ Creature.YouOwn+cmcLE3',
      ],
    ],
    [
      'Necromancy',
      [
        'K:MayFlashSac',
        'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | IsPresent$ Card.StrictlySelf | Execute$ RaiseDead',
        'SVar:RaiseDead:DB$ ChangeZone | Origin$ Graveyard | Destination$ Battlefield | GainControl$ True | RememberChanged$ True | TgtPrompt$ Select target creature card in a graveyard | ValidTgts$ Creature | ChangeNum$ 1 | SubAbility$ Aurify',
        'SVar:Aurify:DB$ Animate | Types$ Aura | Keywords$ Enchant:Creature.IsRemembered:creature put onto the battlefield with CARDNAME | Duration$ Permanent | SubAbility$ NecromAttach',
        'SVar:NecromAttach:DB$ Attach | Defined$ Remembered | SubAbility$ DBDelay',
        'SVar:TrigSacrifice:DB$ SacrificeAll | Defined$ DelayTriggerRememberedLKI',
      ],
    ],
    [
      'Chandra, Torch of Defiance',
      [
        'A:AB$ DealDamage | Cost$ SubCounter<3/LOYALTY> | Planeswalker$ True | ValidTgts$ Creature | NumDmg$ 4 | SpellDescription$ CARDNAME deals 4 damage to target creature.',
        'A:AB$ Effect | Cost$ SubCounter<7/LOYALTY> | Planeswalker$ True | Ultimate$ True | Name$ Emblem — Chandra, Torch of Defiance | Image$ emblem_chandra_torch_of_defiance | Triggers$ TrigSpellCast | Duration$ Permanent | AILogic$ Always | SpellDescription$ You get an emblem with "Whenever you cast a spell, this emblem deals 5 damage to any target."',
        'SVar:TrigSpellCast:Mode$ SpellCast | ValidActivatingPlayer$ You | Execute$ EffSpellCast | TriggerDescription$ Whenever you cast a spell, this emblem deals 5 damage to any target.',
        'SVar:EffSpellCast:DB$ DealDamage | ValidTgts$ Any | NumDmg$ 5',
        'SVar:DBPlay:DB$ Play | Valid$ Card.IsImprinted | ValidSA$ Spell | ValidZone$ Exile | Controller$ You | Optional$ True | Amount$ All | RememberPlayed$ True | ShowCardToActivator$ True | SubAbility$ DBDamage',
      ],
    ],
    [
      'Zareth San, the Trickster',
      [
        'K:Flash',
        'A:AB$ ChangeZone | Cost$ 2 U B Return<1/Rogue.unblocked+attacking+YouCtrl/unblocked attacking Rogue you control> | ActivationZone$ Hand | Defined$ Self | Origin$ Hand | Destination$ Battlefield | Tapped$ True | Attacking$ True | SpellDescription$ Put CARDNAME from your hand onto the battlefield tapped and attacking.',
        'T:Mode$ DamageDone | ValidSource$ Card.Self | ValidTarget$ Player | CombatDamage$ True | Execute$ TrigGainControl | OptionalDecider$ You',
        "SVar:TrigGainControl:DB$ ChangeZone | Origin$ Graveyard | Destination$ Battlefield | GainControl$ True | ValidTgts$ Permanent | TargetsWithDefinedController$ TriggeredTarget | TgtPrompt$ Select target permanent in opponent's graveyard",
      ],
    ],
    [
      'Teferi, Hero of Dominaria',
      [
        'SVar:TrigUntap:DB$ Untap | UntapUpTo$ True | UntapType$ Land | Amount$ 2 | Defined$ You',
        "A:AB$ ChangeZone | Cost$ SubCounter<3/LOYALTY> | Planeswalker$ True | ValidTgts$ Permanent.nonLand | TgtPrompt$ Select target nonland permanent | Origin$ Battlefield | Destination$ Library | LibraryPosition$ 2 | IsCurse$ True | SpellDescription$ Put target nonland permanent into its owner's library third from the top.",
        'A:AB$ Effect | Cost$ SubCounter<8/LOYALTY> | Planeswalker$ True | Ultimate$ True | Name$ Emblem — Teferi, Hero of Dominaria | Image$ emblem_teferi_hero_of_dominaria | Triggers$ TrigDraw | Duration$ Permanent | AILogic$ Always | SpellDescription$ You get an emblem with "Whenever you draw a card, exile target permanent an opponent controls."',
        'SVar:TrigDraw:Mode$ Drawn | ValidCard$ Card.YouCtrl | Execute$ EffSpellCast | TriggerDescription$ Whenever you draw a card, exile target permanent an opponent controls.',
        'SVar:EffSpellCast:DB$ ChangeZone | Origin$ Battlefield | Destination$ Exile | ValidTgts$ Permanent.OppCtrl | TgtPrompt$ Select target permanent an opponent controls',
      ],
    ],
    [
      'Emrakul, the Promised End',
      [
        'K:Flying',
        'K:Trample',
        'K:Protection:Instant:instants',
        'T:Mode$ SpellCast | ValidCard$ Card.Self | Execute$ TrigControlPlayer',
        'SVar:TrigControlPlayer:DB$ ControlPlayer | ValidTgts$ Opponent | SubAbility$ DBDelTrig',
        'SVar:DBDelTrig:DB$ DelayedTrigger | Mode$ Phase | DelayedTriggerDefinedPlayer$ Targeted | RememberObjects$ Targeted | Phase$ Cleanup | Execute$ DBAddTurn | Static$ True',
        'SVar:DBAddTurn:DB$ AddTurn | Defined$ DelayTriggerRemembered | NumTurns$ 1',
      ],
    ],
    [
      'Ulamog, the Ceaseless Hunger',
      [
        'T:Mode$ SpellCast | ValidCard$ Card.Self | Execute$ TrigChange | TriggerDescription$ When you cast this spell, exile two target permanents.',
        'SVar:TrigChange:DB$ ChangeZone | ValidTgts$ Permanent | TargetMin$ 2 | TargetMax$ 2 | Origin$ Battlefield | Destination$ Exile',
        'K:Indestructible',
        'T:Mode$ Attacks | ValidCard$ Card.Self | TriggerZones$ Battlefield | Execute$ TrigExile | TriggerDescription$ Whenever CARDNAME attacks, defending player exiles the top twenty cards of their library.',
        'SVar:TrigExile:DB$ Dig | Defined$ TriggeredDefendingPlayer | DestinationZone$ Exile | DigNum$ 20 | ChangeNum$ All',
        'SVar:PlayMain1:TRUE',
        'SVar:HasAttackEffect:TRUE',
      ],
    ],
  ] as const;

  it.each(reviewed)('admits the exact reviewed %s trigger route', (name, lines) => {
    expect(legacyCubeReviewedTriggerTargetRefusals(namedScript(name, lines), inventory)).toEqual([]);
  });

  it.each(reviewed)('refuses a target-shape mutation of %s', (name, lines) => {
    const mutated = lines.map((line) => (line.includes('ValidTgts$') ? `${line} | TargetMax$ 2` : line));
    expect(legacyCubeReviewedTriggerTargetRefusals(namedScript(name, mutated), inventory)).not.toEqual([]);
  });

  it.each(reviewed.filter(([, lines]) => lines.some((line) => line.includes('OptionalDecider$ You'))))(
    'refuses a foreign optional decider on %s',
    (name, lines) => {
      const mutated = lines.map((line) => line.replace('OptionalDecider$ You', 'OptionalDecider$ Opponent'));
      expect(legacyCubeReviewedTriggerTargetRefusals(namedScript(name, mutated), inventory)).not.toEqual([]);
    },
  );

  it('does not grant the reviewed exception to another identity', () => {
    expect(
      legacyCubeReviewedTriggerTargetRefusals(namedScript('Unreviewed Siege', reviewed[0][1]), inventory),
    ).toContain('exact reviewed trigger-target composition');
  });
});
