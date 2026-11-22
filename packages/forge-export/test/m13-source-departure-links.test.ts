import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const UPSTREAM_THRAGTUSK = `Name:Thragtusk
ManaCost:4 G
Types:Creature Beast
PT:5/3
T:Mode$ ChangesZone | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ Life | TriggerDescription$ When CARDNAME enters, you gain 5 life.
T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Any | ValidCard$ Card.Self | Execute$ Token | TriggerDescription$ When CARDNAME leaves the battlefield, create a 3/3 green Beast creature token.
SVar:Token:DB$ Token | TokenOwner$ You | TokenScript$ g_3_3_beast
SVar:Life:DB$ GainLife | Defined$ You | LifeAmount$ 5
Oracle:When Thragtusk enters, you gain 5 life.\\nWhen Thragtusk leaves the battlefield, create a 3/3 green Beast creature token.
`;

const GENERATED_THRAGTUSK = `Name:Thragtusk
ManaCost:4 G
Types:Creature Beast
PT:5/3
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ Trig1Effect1 | TriggerDescription$ When CARDNAME enters the battlefield, you gain 5 life.
SVar:Trig1Effect1:DB$ GainLife | Defined$ You | LifeAmount$ 5
T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Any | ValidCard$ Card.Self | Execute$ Trig2Effect1 | TriggerDescription$ When CARDNAME leaves the battlefield, create a 3/3 green Beast creature token.
SVar:Trig2Effect1:DB$ Token | TokenScript$ g_3_3_beast | TokenOwner$ You
DeckHas:Ability$LifeGain|Token
Oracle:When Thragtusk enters the battlefield, you gain 5 life.\\nWhen Thragtusk leaves the battlefield, create a 3/3 green Beast creature token.
`;

const UPSTREAM_RANCOR = `Name:Rancor
ManaCost:G
Types:Enchantment Aura
K:Enchant:Creature
SVar:AttachAILogic:Pump
S:Mode$ Continuous | Affected$ Creature.EnchantedBy | AddPower$ 2 | AddKeyword$ Trample | Description$ Enchanted creature gets +2/+0 and has trample.
T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Card.Self | Execute$ TrigChangeZone | TriggerDescription$ When CARDNAME is put into a graveyard from the battlefield, return CARDNAME to its owner's hand.
SVar:TrigChangeZone:DB$ ChangeZone | Origin$ Graveyard | Destination$ Hand | Defined$ TriggeredNewCardLKICopy
SVar:SacMe:2
Oracle:Enchant creature\\nEnchanted creature gets +2/+0 and has trample.\\nWhen Rancor is put into a graveyard from the battlefield, return Rancor to its owner's hand.
`;

const GENERATED_RANCOR = `Name:Rancor
ManaCost:G
Types:Enchantment Aura
K:Enchant:Creature
SVar:AttachAILogic:Pump
S:Mode$ Continuous | Affected$ Creature.EnchantedBy | AddPower$ 2 | AddToughness$ 0 | AddKeyword$ Trample | Description$ Enchanted creature gets +2/+0 and has trample.
T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Card.Self | Execute$ Trig1Effect1 | TriggerDescription$ When CARDNAME is put into a graveyard from the battlefield, return CARDNAME to its owner's hand.
SVar:Trig1Effect1:DB$ ChangeZone | Origin$ Graveyard | Destination$ Hand | Defined$ TriggeredNewCardLKICopy
Oracle:Enchant creature\\nEnchanted creature gets +2/+0 and has trample.\\nWhen Rancor is put into a graveyard from the battlefield, return Rancor to its owner's hand.
`;

const UPSTREAM_OBLIVION_RING = `Name:Oblivion Ring
ManaCost:2 W
Types:Enchantment
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigExile | TriggerDescription$ When CARDNAME enters, exile another target nonland permanent.
T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Any | ValidCard$ Card.Self | Execute$ TrigReturn | TriggerDescription$ When CARDNAME leaves the battlefield, return the exiled card to the battlefield under its owner's control.
SVar:TrigExile:DB$ ChangeZone | IsCurse$ True | ValidTgts$ Permanent.nonLand+Other | TgtPrompt$ Choose another target nonland permanent | Origin$ Battlefield | Destination$ Exile
SVar:TrigReturn:DB$ ChangeZone | Defined$ ExiledWith | Origin$ Exile | Destination$ Battlefield
SVar:PlayMain1:TRUE
SVar:OblivionRing:TRUE
Oracle:When Oblivion Ring enters, exile another target nonland permanent.\\nWhen Oblivion Ring leaves the battlefield, return the exiled card to the battlefield under its owner's control.
`;

const GENERATED_OBLIVION_RING = `Name:Oblivion Ring
ManaCost:2 W
Types:Enchantment
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ Trig1Effect1 | TriggerDescription$ When CARDNAME enters the battlefield, exile another target nonland permanent.
SVar:Trig1Effect1:DB$ ChangeZone | ValidTgts$ Permanent.nonLand+Other | Origin$ Battlefield | Destination$ Exile
T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Any | ValidCard$ Card.Self | Execute$ Trig2Effect1 | TriggerDescription$ When CARDNAME leaves the battlefield, return the exiled card to the battlefield under its owner's control.
SVar:Trig2Effect1:DB$ ChangeZone | Defined$ ExiledWith | Origin$ Exile | Destination$ Battlefield
Oracle:When Oblivion Ring enters the battlefield, exile another target nonland permanent.\\nWhen Oblivion Ring leaves the battlefield, return the exiled card to the battlefield under its owner's control.
`;

describe('M13 source-departure Forge scripts', () => {
  it('exports Thragtusk with the pinned any-destination leave trigger', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'm13-193-thragtusk-forge',
      name: 'Thragtusk',
      rarity: 'rare',
      set: { code: 'M13', collectorNumber: 193 },
      manaCost: { generic: 4, G: 1 },
      colors: ['G'],
      subtypes: ['Beast'],
      power: 5,
      toughness: 3,
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfEnters',
          effects: [{ kind: 'gainLife', amount: 5, target: { kind: 'noTarget' } }],
        },
        {
          kind: 'triggered',
          condition: 'selfLeavesBattlefield',
          effects: [
            {
              kind: 'createToken',
              count: 1,
              token: {
                name: 'Beast',
                colors: ['G'],
                subtypes: ['Beast'],
                power: 3,
                toughness: 3,
                keywords: [],
              },
            },
          ],
        },
      ],
    });

    const text = mustTranspile(card);
    expect(text).toBe(GENERATED_THRAGTUSK);
    expect(UPSTREAM_THRAGTUSK).toContain(
      'Mode$ ChangesZone | Origin$ Battlefield | Destination$ Any | ValidCard$ Card.Self',
    );
    expect(text).toContain(
      'Mode$ ChangesZone | Origin$ Battlefield | Destination$ Any | ValidCard$ Card.Self',
    );
  });

  it('exports Rancor with Forge’s exact LKI-copy graveyard return', () => {
    const card = parseCard({
      kind: 'enchantment',
      id: 'm13-185-rancor-forge',
      name: 'Rancor',
      rarity: 'uncommon',
      set: { code: 'M13', collectorNumber: 185 },
      manaCost: { G: 1 },
      colors: ['G'],
      subtypes: ['Aura'],
      aura: {
        enchant: 'creature',
        modifications: [
          { kind: 'statBonus', power: 2, toughness: 0 },
          { kind: 'grantKeyword', keyword: 'trample' },
        ],
      },
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfPutIntoGraveyardFromBattlefield',
          effects: [{ kind: 'returnDepartedSourceToOwnerHand' }],
        },
      ],
    });
    const text = mustTranspile(card);
    expect(text).toBe(GENERATED_RANCOR);
    const exactReturn =
      'DB$ ChangeZone | Origin$ Graveyard | Destination$ Hand | Defined$ TriggeredNewCardLKICopy';
    expect(UPSTREAM_RANCOR).toContain(exactReturn);
    expect(text).toContain(exactReturn);
  });

  it('exports Oblivion Ring with Forge’s exact Other selector and ExiledWith return', () => {
    const card = parseCard({
      kind: 'enchantment',
      id: 'm13-22-oblivion-ring-forge',
      name: 'Oblivion Ring',
      rarity: 'uncommon',
      set: { code: 'M13', collectorNumber: 22 },
      manaCost: { generic: 2, W: 1 },
      colors: ['W'],
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfEnters',
          effects: [
            {
              kind: 'exileTarget',
              target: {
                kind: 'targetPermanent',
                filter: { excludeCardTypes: ['land'] },
                excludeSource: true,
              },
              linkToSource: true,
            },
          ],
        },
        {
          kind: 'triggered',
          condition: 'selfLeavesBattlefield',
          effects: [{ kind: 'moveSourceLinkedExile', destination: 'battlefieldUnderOwner' }],
        },
      ],
    });
    const text = mustTranspile(card);
    expect(text).toBe(GENERATED_OBLIVION_RING);
    expect(UPSTREAM_OBLIVION_RING).toContain('ValidTgts$ Permanent.nonLand+Other');
    expect(text).toContain('ValidTgts$ Permanent.nonLand+Other');
    const exactReturn = 'DB$ ChangeZone | Defined$ ExiledWith | Origin$ Exile | Destination$ Battlefield';
    expect(UPSTREAM_OBLIVION_RING).toContain(exactReturn);
    expect(text).toContain(exactReturn);
  });
});
