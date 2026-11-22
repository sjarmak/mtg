import { describe, expect, it } from 'vitest';
import {
  LEGACY_CUBE_REVIEWED_GENERATED_TOKEN_SACRIFICE_SAFE_POSITIONS,
  legacyCubeReviewedGeneratedTokenSacrificeRefusals,
  loadLegacyCubeSyntaxReview,
} from '@mtg/data';

const KOMA = String.raw`Name:Koma, Cosmos Serpent
ManaCost:3 G G U U
Types:Legendary Creature Serpent
PT:6/6
R:Event$ Counter | ValidCard$ Card.Self | ValidSA$ Spell | Layer$ CantHappen | Description$ This spell can't be countered.
T:Mode$ Phase | Phase$ Upkeep | TriggerZones$ Battlefield | Execute$ TrigToken | TriggerDescription$ At the beginning of each upkeep, create a 3/3 blue Serpent creature token named Koma's Coil.
SVar:TrigToken:DB$ Token | TokenScript$ komas_coil | TokenOwner$ You
A:AB$ Charm | Cost$ Sac<1/Serpent.Other/another Serpent> | Choices$ DBTap,DBPump
SVar:DBTap:DB$ Tap | ValidTgts$ Permanent | SubAbility$ DBConstrict | StackDescription$ Tap {c:Targeted}. Its activated abilities can't be activated this turn. | SpellDescription$ Tap target permanent. Its activated abilities can't be activated this turn.
SVar:DBConstrict:DB$ Effect | RememberObjects$ ParentTarget | StaticAbilities$ DBCantBeActivated | ForgetOnMoved$ Battlefield
SVar:DBCantBeActivated:Mode$ CantBeActivated | ValidCard$ Card.IsRemembered | Description$ Remembered activated abilities can't be activated.
SVar:DBPump:DB$ Pump | Defined$ Self | KW$ Indestructible | SpellDescription$ CARDNAME gains indestructible until end of turn.
DeckHas:Ability$Token|Sacrifice
Oracle:This spell can't be countered.\nAt the beginning of each upkeep, create a 3/3 blue Serpent creature token named Koma's Coil.\nSacrifice another Serpent: Choose one —\n• Tap target permanent. Its activated abilities can't be activated this turn.\n• Koma, Cosmos Serpent gains indestructible until end of turn.`;

const FOUNDRY = String.raw`Name:Retrofitter Foundry
ManaCost:1
Types:Artifact
A:AB$ Untap | Cost$ 3 | SpellDescription$ Untap CARDNAME.
A:AB$ Token | Cost$ 2 T | TokenScript$ c_1_1_a_servo | TokenOwner$ You | SpellDescription$ Create a 1/1 colorless Servo artifact creature token.
A:AB$ Token | Cost$ 1 T Sac<1/Servo> | TokenScript$ c_1_1_a_thopter_flying | TokenOwner$ You | SpellDescription$ Create a 1/1 colorless Thopter artifact creature token with flying.
DeckHas:Ability$Token
A:AB$ Token | Cost$ T Sac<1/Thopter> | TokenScript$ c_4_4_a_construct | TokenOwner$ You | SpellDescription$ Create a 4/4 colorless Construct artifact creature token.
SVar:AIPreference:SacCost$Creature.token
Oracle:{3}: Untap Retrofitter Foundry.\n{2}, {T}: Create a 1/1 colorless Servo artifact creature token.\n{1}, {T}, Sacrifice a Servo: Create a 1/1 colorless Thopter artifact creature token with flying.\n{T}, Sacrifice a Thopter: Create a 4/4 colorless Construct artifact creature token.`;

const MAP = String.raw`Name:Treasure Map
ManaCost:2
Types:Artifact
A:AB$ Scry | Cost$ 1 T | ScryNum$ 1 | SubAbility$ DBLandmark | SpellDescription$ Scry 1. Put a landmark counter on CARDNAME. Then if there are three or more landmark counters on it, remove those counters, transform CARDNAME, and create three Treasure tokens.
SVar:DBLandmark:DB$ PutCounter | Defined$ Self | CounterType$ LANDMARK | CounterNum$ 1 | SubAbility$ DBBranch
SVar:DBBranch:DB$ Branch | BranchConditionSVar$ XMarksTheSpot | TrueSubAbility$ DBRemoveCtrs
SVar:DBRemoveCtrs:DB$ RemoveCounter | Defined$ Self | CounterType$ LANDMARK | CounterNum$ All | SubAbility$ DBTransform
SVar:DBTransform:DB$ SetState | Defined$ Self | Mode$ Transform | SubAbility$ DBTreasureTokens
SVar:DBTreasureTokens:DB$ Token | TokenAmount$ 3 | TokenScript$ c_a_treasure_sac | TokenOwner$ You
SVar:XMarksTheSpot:Count$Valid Card.Self+counters_GE3_LANDMARK
DeckHas:Ability$Token
AlternateMode:DoubleFaced
Oracle:{1}, {T}: Scry 1. Put a landmark counter on Treasure Map. Then if there are three or more landmark counters on it, remove those counters, transform Treasure Map, and create three Treasure tokens. (They're artifacts with "{T}, Sacrifice this token: Add one mana of any color.")

ALTERNATE

Name:Treasure Cove
ManaCost:no cost
Types:Land
A:AB$ Mana | Cost$ T | Produced$ C | SpellDescription$ Add {C}.
A:AB$ Draw | Cost$ T Sac<1/Treasure> | NumCards$ 1 | SpellDescription$ Draw a card.
Oracle:(Transforms from Treasure Map.)\n{T}: Add {C}.\n{T}, Sacrifice a Treasure: Draw a card.`;

const syntax = loadLegacyCubeSyntaxReview();
const refusal = (script: string): readonly string[] =>
  legacyCubeReviewedGeneratedTokenSacrificeRefusals(Buffer.from(script), syntax);

describe('Legacy Cube reviewed generated-token sacrifice boundary', () => {
  it('admits exactly the three complete reviewed scripts', () => {
    expect(refusal(KOMA)).toEqual([]);
    expect(refusal(FOUNDRY)).toEqual([]);
    expect(refusal(MAP)).toEqual([]);
    expect(LEGACY_CUBE_REVIEWED_GENERATED_TOKEN_SACRIFICE_SAFE_POSITIONS).toEqual([430, 479, 518]);
  });

  it.each([
    ['identity', KOMA.replace('Name:Koma, Cosmos Serpent', 'Name:Near Koma')],
    ['Koma token', KOMA.replace('TokenScript$ komas_coil', 'TokenScript$ g_3_3_beast')],
    [
      'Koma sacrifice filter',
      KOMA.replace('Serpent.Other/another Serpent', 'Creature.Other/another creature'),
    ],
    ['Koma modes', KOMA.replace('Choices$ DBTap,DBPump', 'Choices$ DBPump,DBTap')],
    ['Koma target', KOMA.replace('ValidTgts$ Permanent', 'ValidTgts$ Creature')],
    ['Foundry untap cost', FOUNDRY.replace('Cost$ 3', 'Cost$ 2')],
    [
      'Foundry Servo amount',
      FOUNDRY.replace('A:AB$ Token | Cost$ 2 T', 'A:AB$ Token | TokenAmount$ 2 | Cost$ 2 T'),
    ],
    ['Foundry sacrifice type', FOUNDRY.replace('Sac<1/Servo>', 'Sac<1/Artifact>')],
    ['Foundry progression', FOUNDRY.replace('TokenScript$ c_4_4_a_construct', 'TokenScript$ c_1_1_a_servo')],
    ['Map scry amount', MAP.replace('ScryNum$ 1', 'ScryNum$ 2')],
    ['Map threshold', MAP.replace('counters_GE3_LANDMARK', 'counters_GE2_LANDMARK')],
    ['Map token amount', MAP.replace('TokenAmount$ 3', 'TokenAmount$ 2')],
    ['Map state', MAP.replace('Mode$ Transform', 'Mode$ TurnFaceUp')],
    ['Cove sacrifice type', MAP.replace('Sac<1/Treasure>', 'Sac<1/Artifact>')],
    ['line order', `${KOMA.split('\n')[1]}\n${KOMA.split('\n')[0]}\n${KOMA.split('\n').slice(2).join('\n')}`],
    ['extra ability', `${FOUNDRY}\nA:AB$ Draw | Cost$ 0 | NumCards$ 1`],
  ])('refuses %s drift', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed generated-token sacrifice composition');
  });

  it('keeps neighboring generated and sacrifice shapes closed', () => {
    expect(refusal(KOMA.replace('Name:Koma, Cosmos Serpent', 'Name:Generic Serpent'))).not.toEqual([]);
    expect(
      refusal(
        'Name:Specimen\nTypes:Artifact\nA:AB$ Token | Cost$ T Sac<1/Thopter> | TokenScript$ c_4_4_a_construct',
      ),
    ).not.toEqual([]);
  });
});
