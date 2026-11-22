import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedModalLandSpellRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const EMERIA = [
  "Name:Emeria's Call",
  'ManaCost:4 W W W',
  'Types:Sorcery',
  'A:SP$ Token | TokenAmount$ 2 | TokenScript$ w_4_4_angel_warrior_flying | SubAbility$ DBPumpAll | SpellDescription$ Create two 4/4 white Angel Warrior creature tokens with flying. Non-Angel creatures you control gain indestructible until your next turn.',
  'SVar:DBPumpAll:DB$ PumpAll | ValidCards$ Creature.nonAngel+YouCtrl | KW$ Indestructible | Duration$ UntilYourNextTurn',
  'DeckHas:Ability$Token',
  'AlternateMode:Modal',
  'Oracle:Create two 4/4 white Angel Warrior creature tokens with flying. Non-Angel creatures you control gain indestructible until your next turn.',
  '',
  'ALTERNATE',
  '',
  'Name:Emeria, Shattered Skyclave',
  'ManaCost:no cost',
  'Types:Land',
  "R:Event$ Moved | ValidCard$ Card.Self | Destination$ Battlefield | ReplaceWith$ DBTap | ReplacementResult$ Updated | Description$ As CARDNAME enters, you may pay 3 life. If you don't, it enters tapped.",
  'SVar:DBTap:DB$ Tap | ETB$ True | Defined$ Self | UnlessCost$ PayLife<3> | UnlessPayer$ You | StackDescription$ enters tapped.',
  'A:AB$ Mana | Cost$ T | Produced$ W | SpellDescription$ Add {W}.',
  "Oracle:As Emeria, Shattered Skyclave enters, you may pay 3 life. If you don't, it enters tapped.\\n{T}: Add {W}.",
] as const;

const TURNTIMBER = [
  'Name:Turntimber Symbiosis',
  'ManaCost:4 G G G',
  'Types:Sorcery',
  'A:SP$ Dig | DigNum$ 7 | ChangeNum$ 1 | Optional$ True | ForceRevealToController$ True | ChangeValid$ Creature | PrimaryPrompt$ You may choose a creature card to put on the battlefield | DestinationZone$ Library | LibraryPosition$ 0 | RememberChanged$ True | RestRandomOrder$ True | SubAbility$ DBChangeZone | StackDescription$ SpellDescription | SpellDescription$ Look at the top seven cards of your library. You may put a creature card from among them onto the battlefield. If that card has mana value 3 or less, it enters with three additional +1/+1 counters on it. Put the rest on the bottom of your library in a random order.',
  'SVar:DBChangeZone:DB$ ChangeZone | Origin$ All | Destination$ Battlefield | Defined$ Remembered | ConditionDefined$ Remembered | ConditionPresent$ Creature.cmcGT3 | SubAbility$ DBChangeZone2',
  'SVar:DBChangeZone2:DB$ ChangeZone | Origin$ All | Destination$ Battlefield | WithCountersType$ P1P1 | WithCountersAmount$ 3 | Defined$ Remembered | ConditionDefined$ Remembered | ConditionPresent$ Creature.cmcLE3 | SubAbility$ DBCleanup',
  'SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True',
  'DeckHas:Ability$Counters',
  'AlternateMode:Modal',
  'Oracle:Look at the top seven cards of your library. You may put a creature card from among them onto the battlefield. If that card has mana value 3 or less, it enters with three additional +1/+1 counters on it. Put the rest on the bottom of your library in a random order.',
  '',
  'ALTERNATE',
  '',
  'Name:Turntimber, Serpentine Wood',
  'ManaCost:no cost',
  'Types:Land',
  "R:Event$ Moved | ValidCard$ Card.Self | Destination$ Battlefield | ReplaceWith$ DBTap | ReplacementResult$ Updated | Description$ As CARDNAME enters, you may pay 3 life. If you don't, it enters tapped.",
  'SVar:DBTap:DB$ Tap | ETB$ True | Defined$ Self | UnlessCost$ PayLife<3> | UnlessPayer$ You | StackDescription$ enters tapped.',
  'A:AB$ Mana | Cost$ T | Produced$ G | SpellDescription$ Add {G}.',
  "Oracle:As Turntimber, Serpentine Wood enters, you may pay 3 life. If you don't, it enters tapped.\\n{T}: Add {G}.",
] as const;

const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedModalLandSpellRefusals(
    new TextEncoder().encode(`${lines.join('\n')}\n`),
    loadLegacyCubeSyntaxReview(),
  );

describe('Legacy Cube reviewed modal land spell boundary', () => {
  it.each([
    ["Emeria's Call", EMERIA],
    ['Turntimber Symbiosis', TURNTIMBER],
  ] as const)('lifts exactly %s', (_name, script) => {
    expect(refusal(script)).toEqual([]);
  });

  it.each([
    ['Emeria identity', EMERIA.map((line) => line.replace("Name:Emeria's Call", 'Name:Other Call'))],
    ['Emeria token count', EMERIA.map((line) => line.replace('TokenAmount$ 2', 'TokenAmount$ 3'))],
    [
      'Emeria token script',
      EMERIA.map((line) =>
        line.replace('w_4_4_angel_warrior_flying', 'w_4_4_angel_warrior_flying_vigilance'),
      ),
    ],
    [
      'Emeria affected filter',
      EMERIA.map((line) => line.replace('Creature.nonAngel+YouCtrl', 'Creature.YouCtrl')),
    ],
    ['Emeria duration', EMERIA.map((line) => line.replace('UntilYourNextTurn', 'UntilEndOfTurn'))],
    ['Emeria land payment', EMERIA.map((line) => line.replace('PayLife<3>', 'PayLife<2>'))],
    ['Emeria mana color', EMERIA.map((line) => line.replace('Produced$ W', 'Produced$ U'))],
    [
      'Turntimber identity',
      TURNTIMBER.map((line) => line.replace('Name:Turntimber Symbiosis', 'Name:Other')),
    ],
    ['Turntimber look count', TURNTIMBER.map((line) => line.replace('DigNum$ 7', 'DigNum$ 6'))],
    ['Turntimber optionality', TURNTIMBER.map((line) => line.replace('Optional$ True', 'Optional$ False'))],
    [
      'Turntimber filter',
      TURNTIMBER.map((line) => line.replace('ChangeValid$ Creature', 'ChangeValid$ Land')),
    ],
    [
      'Turntimber bottom order',
      TURNTIMBER.map((line) => line.replace('RestRandomOrder$ True', 'RestRandomOrder$ False')),
    ],
    ['Turntimber threshold', TURNTIMBER.map((line) => line.replace('Creature.cmcLE3', 'Creature.cmcLE4'))],
    [
      'Turntimber counter amount',
      TURNTIMBER.map((line) => line.replace('WithCountersAmount$ 3', 'WithCountersAmount$ 2')),
    ],
    ['Turntimber land payment', TURNTIMBER.map((line) => line.replace('PayLife<3>', 'PayLife<2>'))],
    ['Turntimber mana color', TURNTIMBER.map((line) => line.replace('Produced$ G', 'Produced$ U'))],
    ['additional line', [...TURNTIMBER, 'SVar:Unreviewed:DB$ Draw | NumCards$ 1']],
  ] as const)('keeps a hostile %s mutation closed', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed modal land spell composition');
  });
});
