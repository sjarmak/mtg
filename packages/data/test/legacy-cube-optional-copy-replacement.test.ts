import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedOptionalCopyReplacementRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const GLASSPOOL = [
  'Name:Glasspool Mimic',
  'ManaCost:2 U',
  'Types:Creature Shapeshifter Rogue',
  'PT:0/0',
  'K:ETBReplacement:Copy:DBCopy:Optional',
  "SVar:DBCopy:DB$ Clone | Choices$ Creature.YouCtrl | AddTypes$ Shapeshifter & Rogue | SpellDescription$ You may have CARDNAME enter as a copy of a creature you control, except it's a Shapeshifter Rogue in addition to its other types.",
  'AlternateMode:Modal',
  "Oracle:You may have Glasspool Mimic enter as a copy of a creature you control, except it's a Shapeshifter Rogue in addition to its other types.",
  '',
  'ALTERNATE',
  '',
  'Name:Glasspool Shore',
  'ManaCost:no cost',
  'Types:Land',
  'R:Event$ Moved | ValidCard$ Card.Self | Destination$ Battlefield | ReplacementResult$ Updated | ReplaceWith$ ETBTapped | Description$ CARDNAME enters tapped.',
  'SVar:ETBTapped:DB$ Tap | Defined$ Self | ETB$ True',
  'A:AB$ Mana | Cost$ T | Produced$ U | SpellDescription$ Add {U}.',
  'Oracle:Glasspool Shore enters tapped.\\n{T}: Add {U}.',
] as const;

const METAMORPH = [
  'Name:Phyrexian Metamorph',
  'ManaCost:3 UP',
  'Types:Artifact Creature Phyrexian Shapeshifter',
  'PT:0/0',
  'K:ETBReplacement:Copy:DBCopy:Optional',
  "SVar:DBCopy:DB$ Clone | Choices$ Creature.Other,Artifact.Other | AddTypes$ Artifact | SpellDescription$ You may have CARDNAME enter as a copy of any artifact or creature on the battlefield, except it's an artifact in addition to its other types.",
  "Oracle:({U/P} can be paid with either {U} or 2 life.)\\nYou may have Phyrexian Metamorph enter as a copy of any artifact or creature on the battlefield, except it's an artifact in addition to its other types.",
] as const;

const inventory = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedOptionalCopyReplacementRefusals(
    new TextEncoder().encode(`${lines.join('\n')}\n`),
    inventory,
  );

describe('Legacy Cube reviewed optional-copy replacement boundary', () => {
  it.each([
    ['Glasspool Mimic', GLASSPOOL],
    ['Phyrexian Metamorph', METAMORPH],
  ] as const)('admits the exact %s script', (_name, script) => {
    expect(refusal(script)).toEqual([]);
  });

  it.each([
    ['Glasspool identity', GLASSPOOL.map((line) => line.replace('Name:Glasspool Mimic', 'Name:Other'))],
    ['Glasspool copy filter', GLASSPOOL.map((line) => line.replace('Creature.YouCtrl', 'Creature.Other'))],
    [
      'Glasspool added types',
      GLASSPOOL.map((line) => line.replace('AddTypes$ Shapeshifter & Rogue', 'AddTypes$ Rogue')),
    ],
    ['Glasspool modal marker', GLASSPOOL.filter((line) => line !== 'AlternateMode:Modal')],
    ['Glasspool land identity', GLASSPOOL.map((line) => line.replace('Name:Glasspool Shore', 'Name:Other'))],
    ['Glasspool land replacement', GLASSPOOL.map((line) => line.replace('ReplaceWith$ ETBTapped', ''))],
    ['Glasspool mana color', GLASSPOOL.map((line) => line.replace('Produced$ U', 'Produced$ G'))],
    ['Metamorph identity', METAMORPH.map((line) => line.replace('Name:Phyrexian Metamorph', 'Name:Other'))],
    ['Metamorph payment', METAMORPH.map((line) => line.replace('ManaCost:3 UP', 'ManaCost:3 U'))],
    [
      'Metamorph copy filter',
      METAMORPH.map((line) => line.replace('Creature.Other,Artifact.Other', 'Creature.Other')),
    ],
    ['Metamorph added type', METAMORPH.map((line) => line.replace('AddTypes$ Artifact', ''))],
    ['copy optionality', METAMORPH.map((line) => line.replace(':Optional', ':Mandatory'))],
    ['additional line', [...METAMORPH, 'SVar:Unreviewed:DB$ Clone | Choices$ Land.Other']],
  ] as const)('keeps a hostile %s mutation closed', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed optional-copy replacement composition');
  });
});
