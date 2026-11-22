import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedBlueLibrarySelectionRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const AUGUR = [
  'Name:Augur of Bolas',
  'ManaCost:1 U',
  'Types:Creature Merfolk Wizard',
  'PT:1/3',
  'T:Mode$ ChangesZone | ValidCard$ Card.Self | Origin$ Any | Destination$ Battlefield | Execute$ TrigDig | TriggerDescription$ When CARDNAME enters, look at the top three cards from your library. You may reveal an instant or sorcery card from among them and put it into your hand. Put the rest on the bottom of your library in any order.',
  'SVar:TrigDig:DB$ Dig | DigNum$ 3 | ChangeNum$ 1 | Optional$ True | ChangeValid$ Instant,Sorcery',
  'Oracle:When Augur of Bolas enters, look at the top three cards of your library. You may reveal an instant or sorcery card from among them and put it into your hand. Put the rest on the bottom of your library in any order.',
] as const;

const NARSET = [
  'Name:Narset, Parter of Veils',
  'ManaCost:1 U U',
  'Types:Legendary Planeswalker Narset',
  'Loyalty:5',
  "S:Mode$ CantDraw | ValidPlayer$ Opponent | DrawLimit$ 1 | Description$ Each opponent can't draw more than one card each turn.",
  'A:AB$ Dig | Cost$ SubCounter<2/LOYALTY> | Planeswalker$ True | DigNum$ 4 | ChangeNum$ 1 | Optional$ True | ChangeValid$ Card.nonCreature+nonLand | ChangeValidDesc$ noncreature, nonland | RestRandomOrder$ True | ForceRevealToController$ True | SpellDescription$ Look at the top four cards of your library. You may reveal a noncreature, nonland card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.',
  "Oracle:Each opponent can't draw more than one card each turn.\\n[-2]: Look at the top four cards of your library. You may reveal a noncreature, nonland card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.",
] as const;

const SEARCH = [
  'Name:Search for Azcanta',
  'ManaCost:1 U',
  'Types:Legendary Enchantment',
  'T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | TriggerZones$ Battlefield | Execute$ TrigSurveil | TriggerDescription$ At the beginning of your upkeep, surveil 1. Then if you have seven or more cards in your graveyard, you may transform CARDNAME. (Look at the top card of your library. You may put that card into your graveyard.)',
  'SVar:TrigSurveil:DB$ Surveil | Amount$ 1 | SubAbility$ DBTransform | SpellDescription$ Surveil 1. Then if you have seven or more cards in your graveyard, you may transform CARDNAME (Look at the top card of your library. You may put that card into your graveyard.)',
  'SVar:DBTransform:DB$ SetState | Defined$ Self | Mode$ Transform | Optional$ True | ConditionPresent$ Card.YouOwn | ConditionZone$ Graveyard | ConditionCompare$ GE7',
  'DeckHas:Ability$Surveil|Graveyard',
  'AlternateMode:DoubleFaced',
  'Oracle:At the beginning of your upkeep, surveil 1. Then if you have seven or more cards in your graveyard, you may transform Search for Azcanta. (Look at the top card of your library. You may put that card into your graveyard.)',
  '',
  'ALTERNATE',
  '',
  'Name:Azcanta, the Sunken Ruin',
  'ManaCost:no cost',
  'Types:Legendary Land',
  'A:AB$ Mana | Cost$ T | Produced$ U | Amount$ 1 | SpellDescription$ Add {U}.',
  'A:AB$ Dig | Cost$ 2 U T | DigNum$ 4 | ChangeNum$ 1 | Optional$ True | ChangeValid$ Card.nonCreature+nonLand | SpellDescription$ Look at the top four cards of your library. You may reveal a noncreature, nonland card from among them and put it into your hand. Put the rest on the bottom of your library in any order.',
  'Oracle:(Transforms from Search for Azcanta.)\\n{T}: Add {U}.\\n{2}{U}, {T}: Look at the top four cards of your library. You may reveal a noncreature, nonland card from among them and put it into your hand. Put the rest on the bottom of your library in any order.',
] as const;

const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedBlueLibrarySelectionRefusals(
    new TextEncoder().encode(`${lines.join('\n')}\n`),
    loadLegacyCubeSyntaxReview(),
  );

describe('Legacy Cube reviewed blue library-selection boundary', () => {
  it.each([
    ['Augur of Bolas', AUGUR],
    ['Narset, Parter of Veils', NARSET],
    ['Search for Azcanta', SEARCH],
  ] as const)('lifts exactly %s', (_name, script) => {
    expect(refusal(script)).toEqual([]);
  });

  it.each([
    ['identity', AUGUR.map((line) => line.replace('Name:Augur of Bolas', 'Name:Other'))],
    ['Augur Dig count', AUGUR.map((line) => line.replace('DigNum$ 3', 'DigNum$ 4'))],
    ['Augur filter', AUGUR.map((line) => line.replace('ChangeValid$ Instant,Sorcery', 'ChangeValid$ Card'))],
    ['Augur optionality', AUGUR.map((line) => line.replace('Optional$ True', 'Optional$ False'))],
    ['Narset loyalty', NARSET.map((line) => line.replace('Loyalty:5', 'Loyalty:6'))],
    ['Narset draw limit', NARSET.map((line) => line.replace('DrawLimit$ 1', 'DrawLimit$ 2'))],
    [
      'Narset selection filter',
      NARSET.map((line) => line.replace('Card.nonCreature+nonLand', 'Card.nonLand')),
    ],
    ['Narset remainder order', NARSET.map((line) => line.replace('RestRandomOrder$ True', ''))],
    ['Search upkeep phase', SEARCH.map((line) => line.replace('Phase$ Upkeep', 'Phase$ End of Turn'))],
    ['Search surveil count', SEARCH.map((line) => line.replace('Amount$ 1', 'Amount$ 2'))],
    [
      'Search graveyard threshold',
      SEARCH.map((line) => line.replace('ConditionCompare$ GE7', 'ConditionCompare$ GE6')),
    ],
    ['Search alternate mode', SEARCH.map((line) => line.replace('AlternateMode:DoubleFaced', ''))],
    ['Azcanta mana color', SEARCH.map((line) => line.replace('Produced$ U', 'Produced$ G'))],
    ['Azcanta activation cost', SEARCH.map((line) => line.replace('Cost$ 2 U T', 'Cost$ U T'))],
    [
      'Azcanta selection filter',
      SEARCH.map((line) => line.replace('Card.nonCreature+nonLand', 'Card.nonLand')),
    ],
    ['additional line', [...SEARCH, 'SVar:Unreviewed:DB$ Draw | NumCards$ 1']],
  ] as const)('keeps a hostile %s mutation closed', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed blue library-selection composition');
  });
});
