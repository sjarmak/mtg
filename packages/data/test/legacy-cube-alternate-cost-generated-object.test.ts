import { describe, expect, it } from 'vitest';
import {
  LEGACY_CUBE_REVIEWED_ALTERNATE_COST_GENERATED_OBJECT_SAFE_POSITIONS,
  legacyCubeReviewedAlternateCostGeneratedObjectRefusals,
  loadLegacyCubeSyntaxReview,
} from '@mtg/data';

const SHARK_TYPHOON = String.raw`Name:Shark Typhoon
ManaCost:5 U
Types:Enchantment
T:Mode$ SpellCast | ValidCard$ Card.nonCreature | ValidActivatingPlayer$ You | Execute$ TrigToken | TriggerZones$ Battlefield | TriggerDescription$ Whenever you cast a noncreature spell, create an X/X blue Shark creature token with flying, where X is that spell's mana value.
SVar:TrigToken:DB$ Token | TokenScript$ u_x_x_shark_flying | TokenOwner$ You | TokenPower$ Y | TokenToughness$ Y
SVar:Y:TriggeredSpellAbility$CardManaCostLKI
K:Cycling:X 1 U
T:Mode$ Cycled | ValidCard$ Card.Self | Execute$ TrigToken2 | TriggerDescription$ When you cycle CARDNAME, create an X/X blue Shark creature token with flying.
SVar:TrigToken2:DB$ Token | TokenScript$ u_x_x_shark_flying | TokenOwner$ You | TokenPower$ X | TokenToughness$ X
SVar:X:Count$xPaid
DeckHas:Ability$Token
Oracle:Whenever you cast a noncreature spell, create an X/X blue Shark creature token with flying, where X is that spell's mana value.\nCycling {X}{1}{U} ({X}{1}{U}, Discard this card: Draw a card.)\nWhen you cycle Shark Typhoon, create an X/X blue Shark creature token with flying.`;

const RAGAVAN = String.raw`Name:Ragavan, Nimble Pilferer
ManaCost:R
Types:Legendary Creature Monkey Pirate
PT:2/1
T:Mode$ DamageDone | ValidSource$ Card.Self | ValidTarget$ Player | CombatDamage$ True | Execute$ TrigTreasure | TriggerDescription$ Whenever CARDNAME deals combat damage to a player, create a Treasure token and exile the top card of that player's library. Until end of turn, you may cast that card.
SVar:TrigTreasure:DB$ Token | TokenScript$ c_a_treasure_sac | TokenOwner$ You | SubAbility$ TrigExile
SVar:TrigExile:DB$ Dig | Defined$ TriggeredTarget | DigNum$ 1 | ChangeNum$ All | DestinationZone$ Exile | RememberChanged$ True | SubAbility$ DBEffect
SVar:DBEffect:DB$ Effect | StaticAbilities$ STPlay | ForgetOnMoved$ Exile | RememberObjects$ Remembered | SubAbility$ DBCleanup
SVar:STPlay:Mode$ Continuous | MayPlay$ True | Affected$ Card.IsRemembered+nonLand | AffectedZone$ Exile | Description$ Until end of turn, you may cast that card and you may spend mana as though it were mana of any color to cast that spell.
SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True
K:Dash:1 R
Oracle:Whenever Ragavan, Nimble Pilferer deals combat damage to a player, create a Treasure token and exile the top card of that player's library. Until end of turn, you may cast that card.\nDash {1}{R} (You may cast this spell for its dash cost. If you do, it gains haste, and it's returned from the battlefield to its owner's hand at the beginning of the next end step.)`;

const inventory = loadLegacyCubeSyntaxReview();
const refusal = (script: string): readonly string[] =>
  legacyCubeReviewedAlternateCostGeneratedObjectRefusals(new TextEncoder().encode(script), inventory);

describe('Legacy Cube alternate-cost generated-object boundary', () => {
  it('admits exactly Shark Typhoon and Ragavan', () => {
    expect(refusal(SHARK_TYPHOON)).toEqual([]);
    expect(refusal(RAGAVAN)).toEqual([]);
    expect(LEGACY_CUBE_REVIEWED_ALTERNATE_COST_GENERATED_OBJECT_SAFE_POSITIONS).toEqual([132, 254]);
  });

  it.each([
    ['Shark identity', SHARK_TYPHOON.replace('Name:Shark Typhoon', 'Name:Near Shark')],
    ['Shark keyword', SHARK_TYPHOON.replace('K:Cycling:X 1 U', 'K:Dash:1 U')],
    ['Shark token', SHARK_TYPHOON.replaceAll('u_x_x_shark_flying', 'g_3_3_beast')],
    ['Shark cycling amount', SHARK_TYPHOON.replace('TokenPower$ X', 'TokenPower$ Y')],
    ['Shark spell amount', SHARK_TYPHOON.replace('TokenToughness$ Y', 'TokenToughness$ X')],
    ['Ragavan identity', RAGAVAN.replace('Name:Ragavan, Nimble Pilferer', 'Name:Near Ragavan')],
    ['Ragavan keyword', RAGAVAN.replace('K:Dash:1 R', 'K:Cycling:1 R')],
    ['Ragavan token', RAGAVAN.replace('c_a_treasure_sac', 'c_a_food_sac')],
    ['Ragavan exile amount', RAGAVAN.replace('DigNum$ 1', 'DigNum$ 2')],
    ['Ragavan lifetime', RAGAVAN.replace('ForgetOnMoved$ Exile', 'ForgetOnMoved$ Battlefield')],
    ['extra ability', `${RAGAVAN}\nA:AB$ Draw | Cost$ 0 | NumCards$ 1`],
  ])('refuses %s drift', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed alternate-cost generated-object composition');
  });
});
