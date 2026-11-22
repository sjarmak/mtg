import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedHideawayRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const WINDBRISK = [
  'Name:Windbrisk Heights',
  'ManaCost:no cost',
  'Types:Land',
  'K:Hideaway:4',
  'R:Event$ Moved | ValidCard$ Card.Self | Destination$ Battlefield | ReplacementResult$ Updated | ReplaceWith$ ETBTapped | Description$ CARDNAME enters tapped.',
  'SVar:ETBTapped:DB$ Tap | Defined$ Self | ETB$ True',
  'A:AB$ Mana | Cost$ T | Produced$ W | SpellDescription$ Add {W}.',
  'A:AB$ Play | Cost$ W T | Defined$ ExiledWith | Amount$ All | Controller$ You | WithoutManaCost$ True | Optional$ True | ConditionCheckSVar$ X | ConditionSVarCompare$ GE3 | PlayerTurn$ True | SpellDescription$ You may play the exiled card without paying its mana cost if you attacked with three or more creatures this turn.',
  'SVar:X:Count$AttackersDeclared',
  'Oracle:Hideaway 4 (When this permanent enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom of your library.)\\nWindbrisk Heights enters tapped.\\n{T}: Add {W}.\\n{W}, {T}: You may play the exiled card without paying its mana cost if you attacked with three or more creatures this turn.',
] as const;

const SHELLDOCK = [
  'Name:Shelldock Isle',
  'ManaCost:no cost',
  'Types:Land',
  'K:Hideaway:4',
  'R:Event$ Moved | ValidCard$ Card.Self | Destination$ Battlefield | ReplacementResult$ Updated | ReplaceWith$ ETBTapped | Description$ CARDNAME enters tapped.',
  'SVar:ETBTapped:DB$ Tap | Defined$ Self | ETB$ True',
  'A:AB$ Mana | Cost$ T | Produced$ U | SpellDescription$ Add {U}.',
  'A:AB$ Play | Cost$ U T | Defined$ ExiledWith | Amount$ All | Controller$ You | WithoutManaCost$ True | Optional$ True | ConditionCheckSVar$ X | ConditionSVarCompare$ LE20 | SpellDescription$ You may play the exiled card without paying its mana cost if a library has twenty or fewer cards in it.',
  'SVar:X:PlayerCountPlayers$LowestValidLibrary Card.YouOwn',
  'AI:RemoveDeck:Random',
  'Oracle:Hideaway 4 (When this permanent enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom of your library.)\\nShelldock Isle enters tapped.\\n{T}: Add {U}.\\n{U}, {T}: You may play the exiled card without paying its mana cost if a library has twenty or fewer cards in it.',
] as const;

const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedHideawayRefusals(
    new TextEncoder().encode(`${lines.join('\n')}\n`),
    loadLegacyCubeSyntaxReview(),
  );

describe('Legacy Cube reviewed Hideaway-four boundary', () => {
  it.each([
    ['Windbrisk Heights', WINDBRISK],
    ['Shelldock Isle', SHELLDOCK],
  ] as const)('lifts exactly %s', (_name, script) => {
    expect(refusal(script)).toEqual([]);
  });

  it.each([
    ['identity', WINDBRISK.map((line) => line.replace('Name:Windbrisk Heights', 'Name:Other'))],
    ['Hideaway amount', WINDBRISK.map((line) => line.replace('K:Hideaway:4', 'K:Hideaway:5'))],
    [
      'entry destination',
      WINDBRISK.map((line) => line.replace('Destination$ Battlefield', 'Destination$ Graveyard')),
    ],
    [
      'entry tap effect',
      WINDBRISK.map((line) => line.replace('ReplaceWith$ ETBTapped', 'ReplaceWith$ Other')),
    ],
    ['mana color', WINDBRISK.map((line) => line.replace('Produced$ W', 'Produced$ U'))],
    ['activation cost', WINDBRISK.map((line) => line.replace('Cost$ W T', 'Cost$ 1 W T'))],
    ['linked object', WINDBRISK.map((line) => line.replace('Defined$ ExiledWith', 'Defined$ Remembered'))],
    ['free play', WINDBRISK.map((line) => line.replace('WithoutManaCost$ True', 'WithoutManaCost$ False'))],
    ['optional play', WINDBRISK.map((line) => line.replace('Optional$ True', 'Optional$ False'))],
    [
      'attack condition variable',
      WINDBRISK.map((line) => line.replace('ConditionCheckSVar$ X', 'ConditionCheckSVar$ Y')),
    ],
    [
      'attack threshold',
      WINDBRISK.map((line) => line.replace('ConditionSVarCompare$ GE3', 'ConditionSVarCompare$ GE2')),
    ],
    ['own-turn condition', WINDBRISK.map((line) => line.replace('PlayerTurn$ True', 'PlayerTurn$ False'))],
    [
      'attack count source',
      WINDBRISK.map((line) => line.replace('Count$AttackersDeclared', 'Count$YourLife')),
    ],
    [
      'Shelldock threshold',
      SHELLDOCK.map((line) => line.replace('ConditionSVarCompare$ LE20', 'ConditionSVarCompare$ LE21')),
    ],
    [
      'Shelldock count source',
      SHELLDOCK.map((line) =>
        line.replace('PlayerCountPlayers$LowestValidLibrary Card.YouOwn', 'Count$YourLife'),
      ),
    ],
    ['additional line', [...SHELLDOCK, 'SVar:Unreviewed:DB$ Draw | NumCards$ 1']],
  ] as const)('keeps a hostile %s mutation closed', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed Hideaway-four composition');
  });
});
