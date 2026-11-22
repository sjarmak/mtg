import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedSmugglersCopterRefusals, loadLegacyCubeSyntaxReview } from '@mtg/data';

const EXACT = [
  "Name:Smuggler's Copter",
  'ManaCost:2',
  'Types:Artifact Vehicle',
  'PT:3/3',
  'K:Flying',
  'T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ TrigLoot | TriggerDescription$ Whenever CARDNAME attacks or blocks, you may draw a card. If you do, discard a card.',
  'T:Mode$ Blocks | ValidCard$ Card.Self | Execute$ TrigLoot | Secondary$ True | TriggerDescription$ Whenever CARDNAME attacks or blocks, you may draw a card. If you do, discard a card.',
  'SVar:TrigLoot:AB$ Discard | Defined$ You | Mode$ TgtChoose | NumCards$ 1 | Cost$ Draw<1/You>',
  'K:Crew:1',
  "Oracle:Flying\\nWhenever Smuggler's Copter attacks or blocks, you may draw a card. If you do, discard a card.\\nCrew 1 (Tap any number of creatures you control with total power 1 or more: This Vehicle becomes an artifact creature until end of turn.)",
];

const inventory = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]) =>
  legacyCubeReviewedSmugglersCopterRefusals(new TextEncoder().encode(`${lines.join('\n')}\n`), inventory);

describe("Legacy Cube reviewed Smuggler's Copter boundary", () => {
  it('admits only the exact Crew 1 and attack-or-block loot composition', () => {
    expect(refusal(EXACT)).toEqual([]);
    for (const mutation of [
      EXACT.map((line) => line.replace("Name:Smuggler's Copter", 'Name:Other Vehicle')),
      EXACT.map((line) => line.replace('Mode$ Attacks', 'Mode$ Blocks')),
      EXACT.map((line) => line.replace('Mode$ Blocks', 'Mode$ Attacks')),
      EXACT.map((line) => line.replace('ValidCard$ Card.Self', 'ValidCard$ Vehicle')),
      EXACT.map((line) => line.replace('Secondary$ True', 'Secondary$ False')),
      EXACT.map((line) => line.replace('Defined$ You', 'Defined$ Opponent')),
      EXACT.map((line) => line.replace('Mode$ TgtChoose', 'Mode$ Random')),
      EXACT.map((line) => line.replace('NumCards$ 1', 'NumCards$ 2')),
      EXACT.map((line) => line.replace('Draw<1/You>', 'Draw<2/You>')),
      EXACT.map((line) => line.replace('K:Crew:1', 'K:Crew:2')),
      EXACT.filter((line) => !line.startsWith('SVar:TrigLoot:')),
      [...EXACT, 'SVar:Extra:DB$ Draw | Defined$ You'],
    ]) {
      expect(refusal(mutation)).toContain("exact reviewed Smuggler's Copter composition");
    }
  });
});
