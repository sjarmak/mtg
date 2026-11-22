import { describe, expect, it } from 'vitest';
import {
  LEGACY_CUBE_REVIEWED_PLANESWALKER_UNLESS_SACRIFICE_SAFE_POSITIONS,
  legacyCubeReviewedPlaneswalkerUnlessSacrificeRefusals,
  loadLegacyCubeSyntaxReview,
} from '@mtg/data';

const GARRUK = String.raw`Name:Garruk Relentless
ManaCost:3 G
Types:Legendary Planeswalker Garruk
Loyalty:3
T:Mode$ Always | TriggerZones$ Battlefield | IsPresent$ Card.Self+counters_LE2_LOYALTY | Execute$ TrigTransform | TriggerDescription$ When CARDNAME has two or fewer loyalty counters on him, transform him.
A:AB$ DealDamage | Cost$ AddCounter<0/LOYALTY> | ValidTgts$ Creature | NumDmg$ 3 | SubAbility$ DamageThis | Planeswalker$ True | SpellDescription$ CARDNAME deals 3 damage to target creature. That creature deals damage equal to its power to him.
A:AB$ Token | Cost$ AddCounter<0/LOYALTY> | TokenScript$ g_2_2_wolf | TokenOwner$ You | Planeswalker$ True | SpellDescription$ Create a 2/2 green Wolf creature token.
SVar:DamageThis:DB$ DealDamage | Defined$ Self | DamageSource$ Targeted | NumDmg$ Y
SVar:Y:Targeted$CardPower
SVar:TrigTransform:DB$ SetState | Defined$ Self | Mode$ Transform
AlternateMode:DoubleFaced
Oracle:When Garruk Relentless has two or fewer loyalty counters on him, transform him.\n[0]: Garruk Relentless deals 3 damage to target creature. That creature deals damage equal to its power to him.\n[0]: Create a 2/2 green Wolf creature token.

ALTERNATE

Name:Garruk, the Veil-Cursed
ManaCost:no cost
Colors:green,black
Types:Legendary Planeswalker Garruk
Loyalty:0
A:AB$ Token | Cost$ AddCounter<1/LOYALTY> | TokenScript$ b_1_1_wolf_deathtouch | TokenOwner$ You | Planeswalker$ True | SpellDescription$ Create a 1/1 black Wolf creature token with deathtouch.
A:AB$ ChangeZone | Cost$ SubCounter<1/LOYALTY> | UnlessCost$ Sac<1/Creature> | UnlessSwitched$ True | UnlessPayer$ You | Origin$ Library | Destination$ Hand | ChangeType$ Creature | ChangeNum$ 1 | Planeswalker$ True | SpellDescription$ Sacrifice a creature. If you do, search your library for a creature card, reveal it, put it into your hand, then shuffle.
A:AB$ PumpAll | Cost$ SubCounter<3/LOYALTY> | ValidCards$ Creature.YouCtrl | KW$ Trample | NumAtt$ +X | NumDef$ +X | Planeswalker$ True | Ultimate$ True | SpellDescription$ Creatures you control gain trample and get +X/+X until end of turn, where X is the number of creature cards in your graveyard.
SVar:X:Count$ValidGraveyard Creature.YouOwn
Oracle:[+1]: Create a 1/1 black Wolf creature token with deathtouch.\n[-1]: Sacrifice a creature. If you do, search your library for a creature card, reveal it, put it into your hand, then shuffle.\n[-3]: Creatures you control gain trample and get +X/+X until end of turn, where X is the number of creature cards in your graveyard.`;

const DARETTI = String.raw`Name:Daretti, Ingenious Iconoclast
ManaCost:1 B R
Types:Legendary Planeswalker Daretti
Loyalty:3
A:AB$ Token | Cost$ AddCounter<1/LOYALTY> | Planeswalker$ True | TokenScript$ c_1_1_a_construct_defender | TokenOwner$ You | SpellDescription$ Create a 1/1 colorless Construct artifact creature token with defender.
A:AB$ Destroy | Cost$ SubCounter<1/LOYALTY> | Planeswalker$ True | ValidTgts$ Artifact,Creature | TgtPrompt$ Select target artifact or creature | UnlessCost$ Sac<1/Artifact> | UnlessSwitched$ True | UnlessPayer$ You | SpellDescription$ You may sacrifice an artifact. If you do, destroy target artifact or creature. | StackDescription$ SpellDescription
A:AB$ CopyPermanent | Cost$ SubCounter<6/LOYALTY> | Planeswalker$ True | Ultimate$ True | ValidTgts$ Artifact | TgtZone$ Battlefield,Graveyard | TgtPrompt$ Select target artifact card in a graveyard or artifact on the battlefield | NumCopies$ 3 | SpellDescription$ Choose target artifact card in a graveyard or artifact on the battlefield. Create three tokens that are copies of it.
Oracle:[+1]: Create a 1/1 colorless Construct artifact creature token with defender.\n[-1]: You may sacrifice an artifact. If you do, destroy target artifact or creature.\n[-6]: Choose target artifact card in a graveyard or artifact on the battlefield. Create three tokens that are copies of it.`;

const GRIST = String.raw`Name:Grist, the Hunger Tide
ManaCost:1 B G
Types:Legendary Planeswalker Grist
Loyalty:3
S:Mode$ Continuous | Affected$ Card.Self | ExcludeZone$ Battlefield | SetPower$ 1 | SetToughness$ 1 | AddType$ Creature & Insect | CharacteristicDefining$ True | Description$ As long as CARDNAME isn't on the battlefield, it's a 1/1 Insect creature in addition to its other types.
A:AB$ Repeat | Cost$ AddCounter<1/LOYALTY> | Planeswalker$ True | RepeatSubAbility$ CleanupBegin | RepeatCheckSVar$ MilledInsect | RepeatSVarCompare$ EQ1 | SubAbility$ DBCleanup | SpellDescription$ Create a 1/1 black and green Insect creature token, then mill a card. If an Insect card was milled this way, put a loyalty counter on NICKNAME and repeat this process. | StackDescription$ SpellDescription
SVar:CleanupBegin:DB$ Cleanup | ClearRemembered$ True | SubAbility$ DBToken
SVar:DBToken:DB$ Token | TokenScript$ bg_1_1_insect | TokenOwner$ You | Planeswalker$ True | SubAbility$ DBMill | SpellDescription$ Create a 1/1 black and green Insect creature token, then mill a card. If an Insect card was milled this way, put a loyalty counter on Grist and repeat this process.
SVar:DBMill:DB$ Mill | Defined$ You | NumCards$ 1 | RememberMilled$ True | SubAbility$ DBPutCounter
SVar:DBPutCounter:DB$ PutCounter | Defined$ Self | CounterType$ LOYALTY | CounterNum$ 1 | ConditionDefined$ Remembered | ConditionPresent$ Card.Insect | ConditionCompare$ EQ1
SVar:MilledInsect:Remembered$Valid Card.Insect
SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True
A:AB$ ImmediateTrigger | Cost$ SubCounter<2/LOYALTY> | Planeswalker$ True | Execute$ TrigDestroy | UnlessCost$ Sac<1/Creature> | UnlessPayer$ You | UnlessSwitched$ True | AILogic$ WeakerCreature | SpellDescription$ You may sacrifice a creature. When you do, destroy target creature or planeswalker.
SVar:TrigDestroy:DB$ Destroy | ValidTgts$ Creature,Planeswalker | TgtPrompt$ Select target creature or planeswalker
A:AB$ LoseLife | Cost$ SubCounter<5/LOYALTY> | LifeAmount$ X | Defined$ Player.Opponent | Planeswalker$ True | Ultimate$ True | SpellDescription$ Each opponent loses life equal to the number of creature cards in your graveyard.
SVar:X:Count$ValidGraveyard Creature.YouOwn
DeckHas:Ability$Token|Mill
DeckHints:Type$Insect
Oracle:As long as Grist, the Hunger Tide isn't on the battlefield, it's a 1/1 Insect creature in addition to its other types.\n[+1]: Create a 1/1 black and green Insect creature token, then mill a card. If an Insect card was milled this way, put a loyalty counter on Grist and repeat this process.\n[-2]: You may sacrifice a creature. When you do, destroy target creature or planeswalker.\n[-5]: Each opponent loses life equal to the number of creature cards in your graveyard.`;

const inventory = loadLegacyCubeSyntaxReview();
const refusal = (script: string): readonly string[] =>
  legacyCubeReviewedPlaneswalkerUnlessSacrificeRefusals(new TextEncoder().encode(script), inventory);

describe('Legacy Cube planeswalker UnlessCost sacrifice boundary', () => {
  it('admits exactly Garruk Relentless, Daretti, and Grist', () => {
    expect(refusal(GARRUK)).toEqual([]);
    expect(refusal(DARETTI)).toEqual([]);
    expect(refusal(GRIST)).toEqual([]);
    expect(LEGACY_CUBE_REVIEWED_PLANESWALKER_UNLESS_SACRIFICE_SAFE_POSITIONS).toEqual([383, 451, 466]);
  });

  it.each([
    ['Garruk identity', GARRUK.replace('Name:Garruk Relentless', 'Name:Near Garruk')],
    ['Garruk payment', GARRUK.replace('Sac<1/Creature>', 'Sac<2/Creature>')],
    ['Garruk destination', GARRUK.replace('Destination$ Hand', 'Destination$ Battlefield')],
    ['Daretti identity', DARETTI.replace('Name:Daretti, Ingenious Iconoclast', 'Name:Near Daretti')],
    ['Daretti payment', DARETTI.replace('Sac<1/Artifact>', 'Sac<1/Creature>')],
    ['Daretti target', DARETTI.replace('ValidTgts$ Artifact,Creature', 'ValidTgts$ Permanent')],
    ['Grist identity', GRIST.replace('Name:Grist, the Hunger Tide', 'Name:Near Grist')],
    ['Grist payment', GRIST.replace('Sac<1/Creature>', 'Sac<1/Artifact>')],
    ['Grist target', GRIST.replace('ValidTgts$ Creature,Planeswalker', 'ValidTgts$ Creature')],
    ['extra ability', `${GRIST}\nA:AB$ Draw | Cost$ 0 | NumCards$ 1`],
  ])('refuses %s drift', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed planeswalker UnlessCost sacrifice composition');
  });
});
