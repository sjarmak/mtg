import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedPhantasmalImageRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const exact = [
  'Name:Phantasmal Image',
  'ManaCost:1 U',
  'Types:Creature Illusion',
  'PT:0/0',
  '# Make Svars for granting abilities and triggers on clones distinct to avoid SVars getting overwritten when cloning a clone',
  'K:ETBReplacement:Copy:DBCopy:Optional',
  'SVar:DBCopy:DB$ Clone | Choices$ Creature.Other | AddTypes$ Illusion | AddTriggers$ PhantasmalImageTgtTrig | AddSVars$ PhantasmalImageSac,Targeting | SpellDescription$ You may have CARDNAME enter as a copy of any creature on the battlefield, except it\'s an Illusion in addition to its other types and it has "When this creature becomes the target of a spell or ability, sacrifice it."',
  'SVar:PhantasmalImageTgtTrig:Mode$ BecomesTarget | ValidTarget$ Card.Self | Execute$ PhantasmalImageSac | TriggerDescription$ When this creature becomes the target of a spell or ability, sacrifice it.',
  'SVar:PhantasmalImageSac:DB$ Sacrifice',
  'SVar:Targeting:Dies',
  'SVar:NeedsToPlay:Creature',
  'Oracle:You may have Phantasmal Image enter as a copy of any creature on the battlefield, except it\'s an Illusion in addition to its other types and it has "When this creature becomes the target of a spell or ability, sacrifice it."',
];

const inventory = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]) =>
  legacyCubeReviewedPhantasmalImageRefusals(new TextEncoder().encode(`${lines.join('\n')}\n`), inventory);

describe('Legacy Cube reviewed Phantasmal Image boundary', () => {
  it('admits only the exact optional-copy replacement and granted trigger', () => {
    expect(refusal(exact)).toEqual([]);
    for (const mutation of [
      exact.map((line) => line.replace('Name:Phantasmal Image', 'Name:Other')),
      exact.map((line) => line.replace(':Optional', ':Mandatory')),
      exact.map((line) => line.replace('Choices$ Creature.Other', 'Choices$ Creature')),
      exact.map((line) => line.replace('AddTriggers$ PhantasmalImageTgtTrig', '')),
      exact.map((line) => line.replace('ValidTarget$ Card.Self', 'ValidTarget$ Creature')),
      exact.filter((line) => line !== 'SVar:PhantasmalImageSac:DB$ Sacrifice'),
      [...exact, 'SVar:Extra:DB$ Clone | Choices$ Creature'],
    ]) {
      expect(refusal(mutation)).toContain('exact reviewed Phantasmal Image composition');
    }
  });
});
