import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedTreasureCohortRefusals, loadLegacyCubeSyntaxReview } from '@mtg/data';

const GOLDSPAN = String.raw`Name:Goldspan Dragon
ManaCost:3 R R
Types:Creature Dragon
PT:4/4
K:Flying
K:Haste
T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ TrigToken | TriggerDescription$ Whenever CARDNAME attacks or becomes the target of a spell, create a Treasure token.
T:Mode$ BecomesTarget | ValidTarget$ Card.Self | ValidSource$ Spell | TriggerZones$ Battlefield | Execute$ TrigToken | Secondary$ True | TriggerDescription$ Whenever CARDNAME attacks or becomes the target of a spell, create a Treasure token.
SVar:TrigToken:DB$ Token | TokenScript$ c_a_treasure_sac
S:Mode$ Continuous | Affected$ Card.Treasure+YouCtrl | AddAbility$ Mana | Description$ Treasures you control have "{T}, Sacrifice this artifact: Add two mana of any one color."
SVar:Mana:AB$ Mana | Cost$ T Sac<1/CARDNAME/this artifact> | Produced$ Any | Amount$ 2 | SpellDescription$ Add two mana of any one color.
SVar:HasAttackEffect:TRUE
DeckHas:Ability$Token|Sacrifice & Type$Treasure|Artifact
Oracle:Flying, haste\nWhenever Goldspan Dragon attacks or becomes the target of a spell, create a Treasure token.\nTreasures you control have "{T}, Sacrifice this artifact: Add two mana of any one color."`;

const MAGDA = String.raw`Name:Magda, Brazen Outlaw
ManaCost:1 R
Types:Legendary Creature Dwarf Berserker
PT:2/1
S:Mode$ Continuous | Affected$ Dwarf.Other+YouCtrl | AddPower$ 1 | Description$ Other Dwarves you control get +1/+0.
T:Mode$ Taps | ValidCard$ Dwarf.YouCtrl | Execute$ TrigToken | TriggerZones$ Battlefield | TriggerDescription$ Whenever a Dwarf you control becomes tapped, create a Treasure token.
SVar:TrigToken:DB$ Token | TokenScript$ c_a_treasure_sac | TokenOwner$ You
A:AB$ ChangeZone | Cost$ Sac<5/Treasure> | Origin$ Library | Destination$ Battlefield | ChangeType$ Card.Artifact,Card.Dragon | ChangeNum$ 1 | StackDescription$ {p:You} searches their library for an Artifact or Dragon card, puts that card onto the battlefield, then shuffles their library. | SpellDescription$ Search your library for an artifact or Dragon card, put that card onto the battlefield, then shuffle.
SVar:BuffedBy:Dwarf
SVar:PlayMain1:TRUE
DeckNeeds:Type$Dwarf
DeckHints:Type$Dragon|Artifact
DeckHas:Ability$Token|Sacrifice
Oracle:Other Dwarves you control get +1/+0.\nWhenever a Dwarf you control becomes tapped, create a Treasure token.\nSacrifice five Treasures: Search your library for an artifact or Dragon card, put that card onto the battlefield, then shuffle.`;

const inventory = loadLegacyCubeSyntaxReview();
const refusal = (script: string) =>
  legacyCubeReviewedTreasureCohortRefusals(new TextEncoder().encode(`${script}\n`), inventory);

describe('Legacy Cube reviewed Treasure cohort boundary', () => {
  it('admits only Goldspan Dragon’s exact triggers and doubled Treasure ability', () => {
    expect(refusal(GOLDSPAN)).toEqual([]);
    for (const mutation of [
      GOLDSPAN.replace('Name:Goldspan Dragon', 'Name:Other Dragon'),
      GOLDSPAN.replace('Mode$ Attacks', 'Mode$ Blocks'),
      GOLDSPAN.replace('Mode$ BecomesTarget', 'Mode$ SpellCast'),
      GOLDSPAN.replace('ValidTarget$ Card.Self', 'ValidTarget$ Creature.YouCtrl'),
      GOLDSPAN.replace('ValidSource$ Spell', 'ValidSource$ Ability'),
      GOLDSPAN.replace('TokenScript$ c_a_treasure_sac', 'TokenScript$ c_a_food_sac'),
      GOLDSPAN.replace('Affected$ Card.Treasure+YouCtrl', 'Affected$ Card.Artifact+YouCtrl'),
      GOLDSPAN.replace('Sac<1/CARDNAME/this artifact>', 'Sac<1/Treasure>'),
      GOLDSPAN.replace('Produced$ Any', 'Produced$ R'),
      GOLDSPAN.replace('Amount$ 2', 'Amount$ 1'),
      `${GOLDSPAN}\nSVar:Extra:DB$ Draw | NumCards$ 1`,
    ]) {
      expect(refusal(mutation)).toContain('exact reviewed Treasure cohort composition');
    }
  });

  it('admits only Magda’s exact Dwarf-tap and five-Treasure search composition', () => {
    expect(refusal(MAGDA)).toEqual([]);
    for (const mutation of [
      MAGDA.replace('Name:Magda, Brazen Outlaw', 'Name:Other Outlaw'),
      MAGDA.replace('Affected$ Dwarf.Other+YouCtrl', 'Affected$ Dwarf+YouCtrl'),
      MAGDA.replace('Mode$ Taps', 'Mode$ Attacks'),
      MAGDA.replace('ValidCard$ Dwarf.YouCtrl', 'ValidCard$ Creature.YouCtrl'),
      MAGDA.replace('TokenScript$ c_a_treasure_sac', 'TokenScript$ c_a_food_sac'),
      MAGDA.replace('TokenOwner$ You', 'TokenOwner$ Opponent'),
      MAGDA.replace('Sac<5/Treasure>', 'Sac<4/Treasure>'),
      MAGDA.replace('Origin$ Library', 'Origin$ Graveyard'),
      MAGDA.replace('Destination$ Battlefield', 'Destination$ Hand'),
      MAGDA.replace('ChangeType$ Card.Artifact,Card.Dragon', 'ChangeType$ Card.Artifact'),
      MAGDA.replace('ChangeNum$ 1', 'ChangeNum$ 2'),
      `${MAGDA}\nSVar:Extra:DB$ Draw | NumCards$ 1`,
    ]) {
      expect(refusal(mutation)).toContain('exact reviewed Treasure cohort composition');
    }
  });
});
