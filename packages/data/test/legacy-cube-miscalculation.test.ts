import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedMiscalculationRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const exact = [
  'Name:Miscalculation',
  'ManaCost:1 U',
  'Types:Instant',
  'A:SP$ Counter | TargetType$ Spell | TgtPrompt$ Select target spell | ValidTgts$ Card | UnlessCost$ 2 | SpellDescription$ Counter target spell unless its controller pays {2}.',
  'K:Cycling:2',
  'Oracle:Counter target spell unless its controller pays {2}.\\nCycling {2} ({2}, Discard this card: Draw a card.)',
] as const;

const inventory = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]) =>
  legacyCubeReviewedMiscalculationRefusals(new TextEncoder().encode(`${lines.join('\n')}\n`), inventory);

describe('Legacy Cube reviewed Miscalculation boundary', () => {
  it('admits only the exact whole-card Stack-counter and Cycling composition', () => {
    expect(refusal(exact)).toEqual([]);
    for (const mutation of [
      exact.map((line) => line.replace(/^Name:.*/u, 'Name:Other')),
      exact.map((line) => line.replace('TargetType$ Spell', 'TargetType$ Ability')),
      exact.map((line) => line.replace('UnlessCost$ 2', 'UnlessCost$ 3')),
      exact.map((line) => line.replace('K:Cycling:2', 'K:Cycling:3')),
      exact.map((line) => line.replace('ValidTgts$ Card', 'ValidTgts$ Card.nonCreature')),
      [...exact, 'SVar:Extra:DB$ Draw | NumCards$ 1'],
    ]) {
      expect(refusal(mutation)).toContain('exact reviewed Miscalculation composition');
    }
  });
});
