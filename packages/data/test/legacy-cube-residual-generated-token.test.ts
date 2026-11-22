import { describe, expect, it } from 'vitest';
import {
  LEGACY_CUBE_REVIEWED_RESIDUAL_GENERATED_TOKEN_SAFE_POSITIONS,
  legacyCubeReviewedResidualGeneratedTokenRefusals,
  loadLegacyCubeSyntaxReview,
} from '@mtg/data';

const DERANGED_HERMIT = String.raw`Name:Deranged Hermit
ManaCost:3 G G
Types:Creature Elf
PT:1/1
K:Echo:3 G G
S:Mode$ Continuous | Affected$ Creature.Squirrel | AddPower$ 1 | AddToughness$ 1 | Description$ Squirrel creatures get +1/+1.
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigToken | TriggerDescription$ When CARDNAME enters, create four 1/1 green Squirrel creature tokens.
SVar:TrigToken:DB$ Token | TokenAmount$ 4 | TokenScript$ g_1_1_squirrel | TokenOwner$ You
SVar:PlayMain1:TRUE
Oracle:Echo {3}{G}{G} (At the beginning of your upkeep, if this came under your control since the beginning of your last upkeep, sacrifice it unless you pay its echo cost.)\nWhen Deranged Hermit enters, create four 1/1 green Squirrel creature tokens.\nSquirrel creatures get +1/+1.`;

const XENAGOS = String.raw`Name:Xenagos, the Reveler
ManaCost:2 R G
Types:Legendary Planeswalker Xenagos
Loyalty:3
A:AB$ Mana | Cost$ AddCounter<1/LOYALTY> | Amount$ X | Produced$ Combo R G | Planeswalker$ True | SpellDescription$ Add X mana in any combination of {R} and/or {G}, where X is the number of creatures you control.
SVar:X:Count$Valid Creature.YouCtrl
A:AB$ Token | Cost$ AddCounter<0/LOYALTY> | TokenScript$ rg_2_2_satyr_haste | TokenOwner$ You | Planeswalker$ True | SpellDescription$ Create a 2/2 red and green Satyr creature token with haste.
A:AB$ Dig | Cost$ SubCounter<6/LOYALTY> | DigNum$ 7 | ChangeNum$ All | DestinationZone$ Exile | RememberChanged$ True | Planeswalker$ True | Ultimate$ True | SubAbility$ DBChangeZone | SpellDescription$ Exile the top seven cards of your library. You may put any number of creature and/or land cards from among them onto the battlefield.
SVar:DBChangeZone:DB$ ChangeZone | Origin$ Exile | Destination$ Battlefield | ChangeType$ Creature.IsRemembered,Land.IsRemembered | Hidden$ True | ChangeNum$ Y | SubAbility$ DBCleanup
SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True
SVar:Y:Count$ValidExile Creature.IsRemembered,Land.IsRemembered
AI:RemoveDeck:All
DeckHas:Ability$Token
Oracle:[+1]: Add X mana in any combination of {R} and/or {G}, where X is the number of creatures you control.\n[0]: Create a 2/2 red and green Satyr creature token with haste.\n[-6]: Exile the top seven cards of your library. You may put any number of creature and/or land cards from among them onto the battlefield.`;

const inventory = loadLegacyCubeSyntaxReview();
const refusal = (script: string): readonly string[] =>
  legacyCubeReviewedResidualGeneratedTokenRefusals(new TextEncoder().encode(script), inventory);

describe('Legacy Cube residual generated-token boundary', () => {
  it('admits exactly Deranged Hermit and Xenagos', () => {
    expect(refusal(DERANGED_HERMIT)).toEqual([]);
    expect(refusal(XENAGOS)).toEqual([]);
    expect(LEGACY_CUBE_REVIEWED_RESIDUAL_GENERATED_TOKEN_SAFE_POSITIONS).toEqual([361, 418]);
  });

  it.each([
    ['Hermit identity', DERANGED_HERMIT.replace('Name:Deranged Hermit', 'Name:Near Hermit')],
    ['Hermit Echo', DERANGED_HERMIT.replace('K:Echo:3 G G', 'K:Echo:2 G G')],
    ['Hermit token amount', DERANGED_HERMIT.replace('TokenAmount$ 4', 'TokenAmount$ 3')],
    ['Hermit token root', DERANGED_HERMIT.replace('g_1_1_squirrel', 'g_2_2_wolf')],
    ['Hermit lord power', DERANGED_HERMIT.replace('AddPower$ 1', 'AddPower$ 2')],
    ['Hermit lord filter', DERANGED_HERMIT.replace('Creature.Squirrel', 'Creature.Elf')],
    ['Xenagos identity', XENAGOS.replace('Name:Xenagos, the Reveler', 'Name:Near Xenagos')],
    ['Xenagos mana count', XENAGOS.replace('Count$Valid Creature.YouCtrl', 'Count$Valid Land.YouCtrl')],
    ['Xenagos mana colors', XENAGOS.replace('Produced$ Combo R G', 'Produced$ Combo R W')],
    ['Xenagos token root', XENAGOS.replace('rg_2_2_satyr_haste', 'g_2_2_wolf')],
    ['Xenagos dig amount', XENAGOS.replace('DigNum$ 7', 'DigNum$ 6')],
    ['Xenagos destination', XENAGOS.replace('Destination$ Battlefield', 'Destination$ Hand')],
    ['Xenagos eligibility', XENAGOS.replace('Creature.IsRemembered,Land.IsRemembered', 'Card.IsRemembered')],
    ['Xenagos cleanup', XENAGOS.replace('ClearRemembered$ True', 'ClearRemembered$ False')],
    ['extra ability', `${XENAGOS}\nA:AB$ Draw | Cost$ 0 | NumCards$ 1`],
  ])('refuses %s drift', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed residual generated-token composition');
  });
});
