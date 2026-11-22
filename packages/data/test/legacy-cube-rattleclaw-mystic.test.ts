import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedRattleclawMysticRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const exact = [
  'Name:Rattleclaw Mystic',
  'ManaCost:1 G',
  'Types:Creature Human Shaman',
  'PT:2/1',
  'K:Morph:2',
  'A:AB$ Mana | Cost$ T | Produced$ Combo G U R | SpellDescription$ Add {G}, {U}, or {R}.',
  'T:Mode$ TurnFaceUp | ValidCard$ Card.Self | Execute$ TrigMana | TriggerZones$ Battlefield | TriggerDescription$ When CARDNAME is turned face up, add {G}{U}{R}.',
  'SVar:TrigMana:DB$ Mana | Produced$ G U R',
  'Oracle:{T}: Add {G}, {U}, or {R}.\\nMorph {2} (You may cast this card face down as a 2/2 creature for {3}. Turn it face up any time for its morph cost.)\\nWhen Rattleclaw Mystic is turned face up, add {G}{U}{R}.',
];

const inventory = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]) =>
  legacyCubeReviewedRattleclawMysticRefusals(new TextEncoder().encode(`${lines.join('\n')}\n`), inventory);

describe('Legacy Cube reviewed Rattleclaw Mystic boundary', () => {
  it('admits only the exact Morph and face-up mana-trigger composition', () => {
    expect(refusal(exact)).toEqual([]);
    for (const mutation of [
      exact.map((line) => line.replace('Name:Rattleclaw Mystic', 'Name:Other')),
      exact.map((line) => line.replace('K:Morph:2', 'K:Morph:3')),
      exact.map((line) => line.replace('Mode$ TurnFaceUp', 'Mode$ ChangesZone')),
      exact.map((line) => line.replace('ValidCard$ Card.Self', 'ValidCard$ Creature')),
      exact.map((line) => line.replace('Execute$ TrigMana', 'Execute$ Other')),
      exact.map((line) => line.replace('Produced$ G U R', 'Produced$ G G G')),
      exact.filter((line) => !line.startsWith('SVar:TrigMana:')),
      [...exact, 'SVar:Extra:DB$ Mana | Produced$ R'],
    ]) {
      expect(refusal(mutation)).toContain('exact reviewed Rattleclaw Mystic composition');
    }
  });
});
