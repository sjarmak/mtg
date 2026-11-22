import { describe, expect, it } from 'vitest';
import {
  LEGACY_CUBE_REVIEWED_MULTI_TARGET_TRANSFORMATION_SAFE_POSITIONS,
  legacyCubeReviewedMultiTargetTransformationRefusals,
  loadLegacyCubeSyntaxReview,
} from '@mtg/data';

const TERASTODON = String.raw`Name:Terastodon
ManaCost:6 G G
Types:Creature Elephant
PT:9/9
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDestroy | TriggerDescription$ When CARDNAME enters, you may destroy up to three target noncreature permanents. For each permanent put into a graveyard this way, its controller creates a 3/3 green Elephant creature token.
SVar:TrigDestroy:DB$ Destroy | TargetMin$ 0 | TargetMax$ 3 | ValidTgts$ Permanent.nonCreature | TgtPrompt$ Choose up to three noncreature permanents. | SubAbility$ MakeTokens
SVar:MakeTokens:DB$ RepeatEach | RepeatSubAbility$ DBToken | DefinedCards$ Targeted | ChangeZoneTable$ True
SVar:DBToken:DB$ Token | ConditionDefined$ Remembered | ConditionPresent$ Card.inRealZoneGraveyard | TokenScript$ g_3_3_elephant | TokenOwner$ RememberedController
DeckHints:Ability$Token
Oracle:When Terastodon enters, you may destroy up to three target noncreature permanents. For each permanent put into a graveyard this way, its controller creates a 3/3 green Elephant creature token.`;

const OKO = String.raw`Name:Oko, Thief of Crowns
ManaCost:1 G U
Types:Legendary Planeswalker Oko
Loyalty:4
A:AB$ Token | Cost$ AddCounter<2/LOYALTY> | Planeswalker$ True | TokenScript$ c_a_food_sac | TokenOwner$ You | SpellDescription$ Create a Food token. (It's an artifact with "{2}, {T}, Sacrifice this token: You gain 3 life.")
A:AB$ Animate | Cost$ AddCounter<1/LOYALTY> | Planeswalker$ True | ValidTgts$ Artifact,Creature | TgtPrompt$ Select target artifact or creature | Power$ 3 | Toughness$ 3 | RemoveAllAbilities$ True | Colors$ Green | OverwriteColors$ True | Types$ Creature,Elk | RemoveCreatureTypes$ True | RemoveCardTypes$ True | Duration$ Permanent | SpellDescription$ Target artifact or creature loses all abilities and becomes a green Elk creature with base power and toughness 3/3.
A:AB$ Pump | Cost$ SubCounter<5/LOYALTY> | Planeswalker$ True | Ultimate$ True | AITgts$ Artifact.YouCtrl+cmcLE1 | ValidTgts$ Artifact.YouCtrl,Creature.YouCtrl | TgtPrompt$ Choose target artifact or creature you control | SubAbility$ OkoExchange | SpellDescription$ Exchange control of target artifact or creature you control and target creature an opponent controls with power 3 or less.
SVar:OkoExchange:DB$ ExchangeControl | Defined$ ParentTarget | ValidTgts$ Creature.OppCtrl+powerLE3 | TgtPrompt$ Choose target creature an opponent controls with power 3 or less
DeckHas:Ability$Token|LifeGain|Food
Oracle:[+2]: Create a Food token. (It's an artifact with "{2}, {T}, Sacrifice this token: You gain 3 life.")\n[+1]: Target artifact or creature loses all abilities and becomes a green Elk creature with base power and toughness 3/3.\n[-5]: Exchange control of target artifact or creature you control and target creature an opponent controls with power 3 or less.`;

const SAHEELI = String.raw`Name:Saheeli, Sublime Artificer
ManaCost:1 UR UR
Types:Legendary Planeswalker Saheeli
Loyalty:5
T:Mode$ SpellCast | ValidCard$ Card.nonCreature | ValidActivatingPlayer$ You | TriggerZones$ Battlefield | Execute$ TrigToken | TriggerDescription$ Whenever you cast a noncreature spell, create a 1/1 colorless Servo artifact creature token.
SVar:TrigToken:DB$ Token | TokenScript$ c_1_1_a_servo | TokenOwner$ You
SVar:BuffedBy:Card.nonCreature+nonLand
A:AB$ Pump | Cost$ SubCounter<2/LOYALTY> | Planeswalker$ True | ValidTgts$ Artifact.YouCtrl | TgtPrompt$ Select target artifact you control | SubAbility$ SaheeliCopy | StackDescription$ None | SpellDescription$ Target artifact you control becomes a copy of another target artifact or creature you control until end of turn, except it's an artifact in addition to its other types.
SVar:SaheeliCopy:DB$ Clone | CloneTarget$ ParentTarget | ValidTgts$ Artifact.YouCtrl,Creature.YouCtrl | TgtPrompt$ Select another target artifact or creature you control | AddTypes$ Artifact | Duration$ UntilEndOfTurn
SVar:BuffedBy:Card.nonCreature+nonLand
DeckHas:Ability$Token
Oracle:Whenever you cast a noncreature spell, create a 1/1 colorless Servo artifact creature token.\n[-2]: Target artifact you control becomes a copy of another target artifact or creature you control until end of turn, except it's an artifact in addition to its other types.`;

const inventory = loadLegacyCubeSyntaxReview();
const refusal = (script: string): readonly string[] =>
  legacyCubeReviewedMultiTargetTransformationRefusals(new TextEncoder().encode(script), inventory);

describe('Legacy Cube residual multi-target transformation boundary', () => {
  it('admits exactly Terastodon, Oko, and Saheeli', () => {
    expect(refusal(TERASTODON)).toEqual([]);
    expect(refusal(OKO)).toEqual([]);
    expect(refusal(SAHEELI)).toEqual([]);
    expect(LEGACY_CUBE_REVIEWED_MULTI_TARGET_TRANSFORMATION_SAFE_POSITIONS).toEqual([396, 429, 437]);
  });

  it.each([
    ['Terastodon identity', TERASTODON.replace('Name:Terastodon', 'Name:Near Terastodon')],
    ['Terastodon minimum', TERASTODON.replace('TargetMin$ 0', 'TargetMin$ 1')],
    ['Terastodon maximum', TERASTODON.replace('TargetMax$ 3', 'TargetMax$ 2')],
    ['Terastodon target kind', TERASTODON.replace('Permanent.nonCreature', 'Permanent')],
    ['Terastodon remembered route', TERASTODON.replace('DefinedCards$ Targeted', 'DefinedCards$ Remembered')],
    ['Terastodon zone table', TERASTODON.replace('ChangeZoneTable$ True', 'ChangeZoneTable$ False')],
    ['Terastodon token condition', TERASTODON.replace('Card.inRealZoneGraveyard', 'Card')],
    ['Terastodon token owner', TERASTODON.replace('RememberedController', 'You')],
    ['Terastodon token root', TERASTODON.replace('g_3_3_elephant', 'g_2_2_wolf')],
    ['Oko identity', OKO.replace('Name:Oko, Thief of Crowns', 'Name:Near Oko')],
    ['Oko animate type', OKO.replace('Types$ Creature,Elk', 'Types$ Creature,Ox')],
    ['Oko animate lifetime', OKO.replace('Duration$ Permanent', 'Duration$ UntilEndOfTurn')],
    ['Oko first exchange target', OKO.replace('Artifact.YouCtrl,Creature.YouCtrl', 'Permanent.YouCtrl')],
    ['Oko second exchange target', OKO.replace('Creature.OppCtrl+powerLE3', 'Creature.OppCtrl')],
    ['Oko exchange relation', OKO.replace('Defined$ ParentTarget', 'Defined$ Self')],
    ['Saheeli identity', SAHEELI.replace('Name:Saheeli, Sublime Artificer', 'Name:Near Saheeli')],
    ['Saheeli trigger filter', SAHEELI.replace('Card.nonCreature', 'Card')],
    ['Saheeli token root', SAHEELI.replace('c_1_1_a_servo', 'c_1_1_thopter_flying')],
    ['Saheeli first copy target', SAHEELI.replace('Artifact.YouCtrl |', 'Permanent.YouCtrl |')],
    ['Saheeli copy relation', SAHEELI.replace('CloneTarget$ ParentTarget', 'CloneTarget$ Self')],
    ['Saheeli added type', SAHEELI.replace('AddTypes$ Artifact', 'AddTypes$ Creature')],
    ['Saheeli copy lifetime', SAHEELI.replace('Duration$ UntilEndOfTurn', 'Duration$ Permanent')],
    ['extra ability', `${SAHEELI}\nA:AB$ Draw | Cost$ 0 | NumCards$ 1`],
  ])('refuses %s drift', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed multi-target transformation composition');
  });
});
