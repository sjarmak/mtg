import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedFinalSixRefusals, loadLegacyCubeSyntaxReview } from '@mtg/data';

const YAWGMOTH = String.raw`Name:Yawgmoth, Thran Physician
ManaCost:2 B B
Types:Legendary Creature Human Cleric
PT:2/4
K:Protection:Human
A:AB$ PutCounter | Cost$ PayLife<1> Sac<1/Creature.Other/another creature> | ValidTgts$ Creature | IsCurse$ True | CounterType$ M1M1 | CounterNum$ 1 | TargetMin$ 0 | TargetMax$ 1 | SubAbility$ DBDraw | SpellDescription$ Put a -1/-1 counter on up to one target creature and draw a card.
SVar:DBDraw:DB$ Draw | Defined$ You | NumCards$ 1
A:AB$ Proliferate | Cost$ B B Discard<1/Card> | SpellDescription$ Proliferate.
SVar:AIPreference:DiscardCost$Card
DeckHas:Ability$Proliferate
DeckNeeds:Ability$Counters
Oracle:Protection from Humans\nPay 1 life, Sacrifice another creature: Put a -1/-1 counter on up to one target creature and draw a card.\n{B}{B}, Discard a card: Proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)`;

const MASTER = String.raw`Name:Master of the Wild Hunt
ManaCost:2 G G
Types:Creature Human Shaman
PT:3/3
T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | TriggerZones$ Battlefield | Execute$ TrigToken | TriggerDescription$ At the beginning of your upkeep, create a 2/2 green Wolf creature token.
SVar:TrigToken:DB$ Token | TokenScript$ g_2_2_wolf | TokenOwner$ You
A:AB$ DealDamage | Cost$ T | SubAbility$ TapWolves | ValidTgts$ Creature | NumDmg$ 0 | AILogic$ WildHunt | SpellDescription$ Tap all untapped Wolf creatures you control. Each Wolf tapped this way deals damage equal to its power to target creature. That creature deals damage equal to its power divided as its controller chooses among any number of those Wolves. | StackDescription$ Tap all untapped Wolf creatures you control. Each Wolf tapped this way deals damage equal to its power to {c:Targeted}. That creature deals damage equal to its power divided as its controller chooses among any number of those Wolves.
SVar:TapWolves:DB$ TapAll | ValidCards$ Creature.Wolf+YouCtrl+untapped | RememberTapped$ True | SubAbility$ WildHuntDamage | StackDescription$ None
SVar:WildHuntDamage:DB$ RepeatEach | RepeatSubAbility$ WolfStrike | UseImprinted$ True | RepeatCards$ Card.IsRemembered | DamageMap$ True | SubAbility$ HuntedDamage | StackDescription$ None
SVar:WolfStrike:DB$ DealDamage | DamageSource$ Imprinted | NumDmg$ X | Defined$ ParentTarget | StackDescription$ None
SVar:HuntedDamage:DB$ DealDamage | DamageSource$ ParentTarget | OptionalDecider$ ParentTargetedController | NumDmg$ Y | DividerOnResolution$ ParentTargetedController | Defined$ Remembered | SubAbility$ DBDamageResolve | StackDescription$ None
SVar:DBDamageResolve:DB$ DamageResolve
SVar:X:Imprinted$CardPower
SVar:Y:Targeted$CardPower
Oracle:At the beginning of your upkeep, create a 2/2 green Wolf creature token.\n{T}: Tap all untapped Wolf creatures you control. Each Wolf tapped this way deals damage equal to its power to target creature. That creature deals damage equal to its power divided as its controller chooses among any number of those Wolves.`;

const SYLVAN_LIBRARY = String.raw`Name:Sylvan Library
ManaCost:1 G
Types:Enchantment
T:Mode$ Phase | Phase$ Draw | ValidPlayer$ You | TriggerZones$ Battlefield | Execute$ TrigDraw | TriggerDescription$ At the beginning of your draw step, you may draw two additional cards. If you do, choose two cards in your hand drawn this turn. For each of those cards, pay 4 life or put the card on top of your library.
SVar:TrigDraw:AB$ ChooseCard | ChoiceZone$ Hand | Choices$ Card.YouOwn+DrawnThisTurn | Cost$ Draw<2/You> | Amount$ 2 | Mandatory$ True | AILogic$ WorstCard | SubAbility$ DBPayOrReturn | NoReveal$ True
SVar:DBPayOrReturn:DB$ RepeatEach | RepeatCards$ Card.ChosenCard | Zone$ Hand | RepeatSubAbility$ DBReplace | SubAbility$ DBCleanup | ChooseOrder$ True
SVar:DBReplace:DB$ ChangeZone | Origin$ Hand | Destination$ Library | ChangeType$ Card.ChosenCard | UnlessCost$ PayLife<4> | Mandatory$ True | UnlessPayer$ TriggeredPlayer | NoReveal$ True
SVar:DBCleanup:DB$ Cleanup | ClearChosenCard$ True
AI:RemoveDeck:All
Oracle:At the beginning of your draw step, you may draw two additional cards. If you do, choose two cards in your hand drawn this turn. For each of those cards, pay 4 life or put the card on top of your library.`;

const WHISPERWOOD = String.raw`Name:Whisperwood Elemental
ManaCost:3 G G
Types:Creature Elemental
PT:4/4
T:Mode$ Phase | Phase$ End of Turn | ValidPlayer$ You | TriggerZones$ Battlefield | Execute$ TrigManifest | TriggerDescription$ At the beginning of your end step, manifest the top card of your library. (Put it onto the battlefield face down as a 2/2 creature. Turn it face up any time for its mana cost if it's a creature card.)
SVar:TrigManifest:DB$ Manifest
A:AB$ AnimateAll | Cost$ Sac<1/CARDNAME> | ValidCards$ Creature.YouCtrl+!token+faceUp | Triggers$ Trig | SpellDescription$ Until end of turn, face-up, nontoken creatures you control gain "When this creature dies, manifest the top card of your library."
SVar:Trig:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Card.Self | Execute$ TrigManifest | TriggerDescription$ When this creature dies, manifest the top card of your library.
Oracle:At the beginning of your end step, manifest the top card of your library. (Put it onto the battlefield face down as a 2/2 creature. Turn it face up any time for its mana cost if it's a creature card.)\nSacrifice Whisperwood Elemental: Until end of turn, face-up nontoken creatures you control gain "When this creature dies, manifest the top card of your library."`;

const SAWTUSK = String.raw`Name:Sawtusk Demolisher
ManaCost:4 G G
Types:Creature Beast
PT:6/6
K:Mutate:3 G
K:Trample
T:Mode$ Mutates | ValidCard$ Card.Self | TriggerZones$ Battlefield | Execute$ TrigDestroy | TriggerDescription$ Whenever this creature mutates, destroy target noncreature permanent. Its controller creates a 3/3 green Beast creature token.
SVar:TrigDestroy:DB$ Destroy | ValidTgts$ Permanent.nonCreature | TgtPrompt$ Select target noncreature permanent | AITgts$ Card.cmcGE4 | SubAbility$ DBToken
SVar:DBToken:DB$ Token | TokenScript$ g_3_3_beast | TokenOwner$ TargetedController
DeckHas:Ability$Token
Oracle:Mutate {3}{G} (If you cast this spell for its mutate cost, put it over or under target non-Human creature you own. They mutate into the creature on top plus all abilities from under it.)\nTrample\nWhenever this creature mutates, destroy target noncreature permanent. Its controller creates a 3/3 green Beast creature token.`;

const MINDSLAVER = String.raw`Name:Mindslaver
ManaCost:6
Types:Legendary Artifact
A:AB$ ControlPlayer | Cost$ 4 T Sac<1/CARDNAME> | ValidTgts$ Player | SpellDescription$ You control target player during that player's next turn.
AI:RemoveDeck:All
Oracle:{4}, {T}, Sacrifice Mindslaver: You control target player during that player's next turn. (You see all cards that player could see and make all decisions for the player.)`;

const scripts = { YAWGMOTH, MASTER, SYLVAN_LIBRARY, WHISPERWOOD, SAWTUSK, MINDSLAVER } as const;
const refusals = (script: string): readonly string[] =>
  legacyCubeReviewedFinalSixRefusals(Buffer.from(script), loadLegacyCubeSyntaxReview());

describe('Legacy Cube final-six exact-script boundary', () => {
  it.each(Object.entries(scripts))('admits the exact installed %s script', (_name, script) => {
    expect(refusals(script)).toEqual([]);
  });

  it.each([
    ['Yawgmoth target maximum', YAWGMOTH.replace('TargetMax$ 1', 'TargetMax$ 2')],
    ['Master Wolf filter', MASTER.replace('Creature.Wolf+YouCtrl+untapped', 'Creature.Wolf+YouCtrl')],
    ['Sylvan payment', SYLVAN_LIBRARY.replace('PayLife<4>', 'PayLife<3>')],
    ['Whisperwood filter', WHISPERWOOD.replace('Creature.YouCtrl+!token+faceUp', 'Creature.YouCtrl')],
    ['Sawtusk target', SAWTUSK.replace('Permanent.nonCreature', 'Permanent')],
    ['Mindslaver cost', MINDSLAVER.replace('Cost$ 4 T', 'Cost$ 3 T')],
    [
      'line order',
      [MINDSLAVER.split('\n')[1], MINDSLAVER.split('\n')[0], ...MINDSLAVER.split('\n').slice(2)].join('\n'),
    ],
    ['extra mechanic', `${MASTER}\nA:AB$ Draw | Cost$ 0 | NumCards$ 1`],
  ] as const)('refuses %s drift as an exact-composition failure', (_label, script) => {
    expect(refusals(script)).toContain('exact reviewed final-six composition');
  });
});
