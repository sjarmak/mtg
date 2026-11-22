import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedAgadeemsAwakeningRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const EXACT = [
  "Name:Agadeem's Awakening",
  'ManaCost:X B B B',
  'Types:Sorcery',
  'A:SP$ ChangeZone | Origin$ Graveyard | Destination$ Battlefield | TargetMin$ 0 | TargetMax$ Y | ValidTgts$ Creature.YouOwn+cmcLEX | TgtPrompt$ Select any number of target creature cards in your graveyard with different mana value X or less | TargetsWithDifferentCMC$ True | StackDescription$ {p:You} returns {c:Targeted} from the graveyard to the battlefield. | SpellDescription$ Return from your graveyard to the battlefield any number of target creature cards that each have a different mana value X or less.',
  'SVar:X:Count$xPaid',
  'SVar:Y:Count$ValidGraveyard Creature.YouOwn',
  'DeckHas:Ability$Graveyard',
  'AlternateMode:Modal',
  'Oracle:Return from your graveyard to the battlefield any number of target creature cards that each have a different mana value X or less.',
  '',
  'ALTERNATE',
  '',
  'Name:Agadeem, the Undercrypt',
  'ManaCost:no cost',
  'Types:Land',
  "R:Event$ Moved | ValidCard$ Card.Self | Destination$ Battlefield | ReplaceWith$ DBTap | ReplacementResult$ Updated | Description$ As CARDNAME enters, you may pay 3 life. If you don't, it enters tapped.",
  'SVar:DBTap:DB$ Tap | ETB$ True | Defined$ Self | UnlessCost$ PayLife<3> | UnlessPayer$ You | StackDescription$ enters tapped.',
  'A:AB$ Mana | Cost$ T | Produced$ B | SpellDescription$ Add {B}.',
  "Oracle:As Agadeem, the Undercrypt enters, you may pay 3 life. If you don't, it enters tapped.\\n{T}: Add {B}.",
] as const;

const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedAgadeemsAwakeningRefusals(
    new TextEncoder().encode(`${lines.join('\n')}\n`),
    loadLegacyCubeSyntaxReview(),
  );

describe("Legacy Cube reviewed Agadeem's Awakening boundary", () => {
  it('lifts exactly the installed X-reanimation and pay-three-life MDFC composition', () => {
    expect(refusal(EXACT)).toEqual([]);
  });

  it.each([
    ['front identity', EXACT.map((line) => line.replace("Name:Agadeem's Awakening", 'Name:Agadeem Awakens'))],
    ['front mana cost', EXACT.map((line) => line.replace('ManaCost:X B B B', 'ManaCost:X B B'))],
    ['front type', EXACT.map((line) => line.replace('Types:Sorcery', 'Types:Instant'))],
    ['front API', EXACT.map((line) => line.replace('A:SP$ ChangeZone', 'A:SP$ Dig'))],
    ['origin', EXACT.map((line) => line.replace('Origin$ Graveyard', 'Origin$ Library'))],
    ['destination', EXACT.map((line) => line.replace('Destination$ Battlefield', 'Destination$ Hand'))],
    ['target minimum', EXACT.map((line) => line.replace('TargetMin$ 0', 'TargetMin$ 1'))],
    ['target maximum', EXACT.map((line) => line.replace('TargetMax$ Y', 'TargetMax$ 3'))],
    ['target ownership', EXACT.map((line) => line.replace('Creature.YouOwn+cmcLEX', 'Creature+cmcLEX'))],
    ['target mana value', EXACT.map((line) => line.replace('Creature.YouOwn+cmcLEX', 'Creature.YouOwn'))],
    [
      'distinct mana values',
      EXACT.map((line) => line.replace('TargetsWithDifferentCMC$ True', 'TargetsWithDifferentCMC$ False')),
    ],
    ['X derivation', EXACT.map((line) => line.replace('SVar:X:Count$xPaid', 'SVar:X:Number$3'))],
    [
      'Y derivation',
      EXACT.map((line) => line.replace('SVar:Y:Count$ValidGraveyard Creature.YouOwn', 'SVar:Y:Number$3')),
    ],
    [
      'front prompt',
      EXACT.map((line) =>
        line.replace('Select any number of target creature cards', 'Select target creature cards'),
      ),
    ],
    [
      'alternate marker',
      EXACT.map((line) => line.replace('AlternateMode:Modal', 'AlternateMode:DoubleFaced')),
    ],
    ['separator', EXACT.filter((line) => line !== 'ALTERNATE')],
    [
      'land identity',
      EXACT.map((line) => line.replace('Name:Agadeem, the Undercrypt', 'Name:Agadeem, the Crypt')),
    ],
    ['land mana cost', EXACT.map((line) => line.replace('ManaCost:no cost', 'ManaCost:B'))],
    ['land type', EXACT.map((line) => line.replace('Types:Land', 'Types:Artifact'))],
    ['replacement event', EXACT.map((line) => line.replace('R:Event$ Moved', 'R:Event$ Tapped'))],
    ['replacement subject', EXACT.map((line) => line.replace('ValidCard$ Card.Self', 'ValidCard$ Land'))],
    [
      'replacement destination',
      EXACT.map((line) => line.replace('Destination$ Battlefield', 'Destination$ Graveyard')),
    ],
    [
      'replacement result',
      EXACT.map((line) => line.replace('ReplacementResult$ Updated', 'ReplacementResult$ Replaced')),
    ],
    ['life amount', EXACT.map((line) => line.replace('PayLife<3>', 'PayLife<2>'))],
    ['life payer', EXACT.map((line) => line.replace('UnlessPayer$ You', 'UnlessPayer$ Opponent'))],
    ['tap subject', EXACT.map((line) => line.replace('Defined$ Self', 'Defined$ You'))],
    ['mana cost', EXACT.map((line) => line.replace('Cost$ T', 'Cost$ 1 T'))],
    ['mana color', EXACT.map((line) => line.replace('Produced$ B', 'Produced$ U'))],
    ['Oracle text', EXACT.map((line) => line.replace('may pay 3 life', 'may pay 2 life'))],
    ['missing line', EXACT.filter((line) => !line.startsWith('SVar:Y:'))],
    ['additional line', [...EXACT, 'SVar:Unreviewed:DB$ ChangeZone | Origin$ Library']],
  ] as const)('keeps a hostile %s mutation closed', (_label, mutation) => {
    expect(refusal(mutation)).toContain("exact reviewed Agadeem's Awakening composition");
  });
});
