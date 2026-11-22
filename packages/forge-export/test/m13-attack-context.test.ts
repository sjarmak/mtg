import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';

function exported(input: CardInput): string {
  const result = transpileCard(parseCard(input));
  if (!result.ok) throw new Error(result.rejections.map((entry) => entry.message).join('\n'));
  return result.script.text;
}

describe('M13 attackers-declared Forge parity', () => {
  it('exports Odric with the corpus-attested trigger and combat authority effect', () => {
    expect(
      exported({
        kind: 'creature',
        id: 'odric',
        name: 'Odric, Master Tactician',
        rarity: 'rare',
        set: { code: 'M13', collectorNumber: 23 },
        manaCost: { generic: 2, W: 2 },
        colors: ['W'],
        supertypes: ['legendary'],
        subtypes: ['Human', 'Soldier'],
        keywords: ['firstStrike'],
        power: 3,
        toughness: 4,
        abilities: [
          {
            kind: 'triggered',
            condition: 'selfAndThreeOthersAttack',
            effects: [{ kind: 'chooseBlockersThisCombat' }],
          },
        ],
      }),
    ).toBe(`Name:Odric, Master Tactician
ManaCost:2 W W
Types:Legendary Creature Human Soldier
PT:3/4
K:First Strike
T:Mode$ Attacks | ValidCard$ Card.Self | TriggerZones$ Battlefield | IsPresent$ Creature.attacking+Other | PresentCompare$ GE3 | NoResolvingCheck$ True | Execute$ Trig1Effect1 | TriggerDescription$ Whenever CARDNAME and at least three other creatures attack, you choose which creatures block this combat and how those creatures block.
SVar:Trig1Effect1:DB$ Effect | StaticAbilities$ DeclareCombatants | Duration$ UntilEndOfCombat
SVar:DeclareCombatants:Mode$ Continuous | Affected$ Player | DeclaresBlockers$ You | Description$ You choose which creatures block this combat and how those creatures block.
Oracle:First strike\\nWhenever Odric, Master Tactician and at least three other creatures attack, you choose which creatures block this combat and how those creatures block.
`);
  });

  it('exports Blood Reckoning and Nefarox retained players exactly', () => {
    const blood = exported({
      kind: 'enchantment',
      id: 'blood',
      name: 'Blood Reckoning',
      rarity: 'uncommon',
      set: { code: 'M13', collectorNumber: 81 },
      manaCost: { generic: 3, B: 1 },
      colors: ['B'],
      subtypes: [],
      abilities: [
        {
          kind: 'triggered',
          condition: 'creatureAttacksYouOrPlaneswalkerYouControl',
          effects: [{ kind: 'loseLife', amount: 1, target: { kind: 'triggeringPlayer' } }],
        },
      ],
    });
    expect(blood).toBe(`Name:Blood Reckoning
ManaCost:3 B
Types:Enchantment
T:Mode$ Attacks | ValidCard$ Creature.YouDontCtrl | Attacked$ You,Planeswalker.YouCtrl | TriggerZones$ Battlefield | Execute$ Trig1Effect1 | TriggerDescription$ Whenever a creature attacks you or a planeswalker you control, that creature's controller loses 1 life.
SVar:Trig1Effect1:DB$ LoseLife | Defined$ TriggeredAttackerController | LifeAmount$ 1
Oracle:Whenever a creature attacks you or a planeswalker you control, that creature's controller loses 1 life.
`);

    const nefarox = exported({
      kind: 'creature',
      id: 'nefarox',
      name: 'Nefarox, Overlord of Grixis',
      rarity: 'rare',
      set: { code: 'M13', collectorNumber: 103 },
      manaCost: { generic: 4, B: 2 },
      colors: ['B'],
      supertypes: ['legendary'],
      subtypes: ['Demon'],
      keywords: ['flying'],
      power: 5,
      toughness: 5,
      abilities: [
        {
          kind: 'triggered',
          condition: 'controlledCreatureAttacksAlone',
          effects: [
            { kind: 'pumpUntilEndOfTurn', power: 1, toughness: 1, target: { kind: 'triggeringCreature' } },
          ],
        },
        {
          kind: 'triggered',
          condition: 'selfAttacksAlone',
          effects: [
            {
              kind: 'sacrificePermanent',
              target: { kind: 'triggeringPlayer' },
              filter: { cardTypes: ['creature'] },
            },
          ],
        },
      ],
    });
    expect(nefarox).toBe(`Name:Nefarox, Overlord of Grixis
ManaCost:4 B B
Types:Legendary Creature Demon
PT:5/5
K:Flying
K:Exalted
T:Mode$ Attacks | ValidCard$ Card.Self | Alone$ True | Execute$ Trig2Effect1 | TriggerDescription$ Whenever CARDNAME attacks alone, defending player sacrifices a creature of their choice.
SVar:Trig2Effect1:DB$ Sacrifice | Defined$ TriggeredDefendingPlayer | SacValid$ Creature
DeckHas:Ability$Sacrifice
Oracle:Flying\\nExalted\\nWhenever Nefarox, Overlord of Grixis attacks alone, defending player sacrifices a creature of their choice.
`);
  });
});
