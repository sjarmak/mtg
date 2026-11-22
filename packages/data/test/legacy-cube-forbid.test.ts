import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedForbidRefusals, loadLegacyCubeSyntaxReview } from '@mtg/data';

const EXACT = [
  'Name:Forbid',
  'ManaCost:1 U U',
  'Types:Instant',
  'K:Buyback:Discard<2/Card>',
  'A:SP$ Counter | TargetType$ Spell | TgtPrompt$ Select target spell | ValidTgts$ Card | Destination$ Graveyard | SpellDescription$ Counter target spell.',
  'AI:RemoveDeck:All',
  'Oracle:Buyback—Discard two cards. (You may discard two cards in addition to any other costs as you cast this spell. If you do, put this card into your hand as it resolves.)\\nCounter target spell.',
] as const;

const syntax = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedForbidRefusals(Buffer.from(lines.join('\n')), syntax);

describe('Legacy Cube reviewed Forbid boundary', () => {
  it('admits only the exact complete installed script', () => {
    expect(refusal(EXACT)).toEqual([]);
  });

  it.each([
    ['identity', EXACT.map((line) => line.replace('Name:Forbid', 'Name:Near Forbid'))],
    ['mana cost', EXACT.map((line) => line.replace('ManaCost:1 U U', 'ManaCost:2 U'))],
    ['card type', EXACT.map((line) => line.replace('Types:Instant', 'Types:Sorcery'))],
    ['keyword', EXACT.map((line) => line.replace('K:Buyback:', 'K:Kicker:'))],
    ['discard count', EXACT.map((line) => line.replace('Discard<2/Card>', 'Discard<1/Card>'))],
    ['discard filter', EXACT.map((line) => line.replace('Discard<2/Card>', 'Discard<2/Card.Blue>'))],
    ['counter API', EXACT.map((line) => line.replace('A:SP$ Counter', 'A:SP$ Destroy'))],
    ['target type', EXACT.map((line) => line.replace('TargetType$ Spell', 'TargetType$ Permanent'))],
    ['target filter', EXACT.map((line) => line.replace('ValidTgts$ Card', 'ValidTgts$ Card.nonCreature'))],
    [
      'counter destination',
      EXACT.map((line) => line.replace('Destination$ Graveyard', 'Destination$ Exile')),
    ],
    ['Oracle text', EXACT.map((line) => line.replace('Discard two cards', 'Discard a card'))],
    ['AI marker', EXACT.filter((line) => line !== 'AI:RemoveDeck:All')],
    ['line order', [EXACT[1], EXACT[0], ...EXACT.slice(2)]],
    ['extra mechanic', [...EXACT, 'A:AB$ Draw | Cost$ 0 | NumCards$ 1']],
  ])('refuses %s drift as an exact-composition failure', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed Forbid composition');
  });
});
