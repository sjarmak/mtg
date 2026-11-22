import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedLingeringSoulsRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const EXACT = [
  'Name:Lingering Souls',
  'ManaCost:2 W',
  'Types:Sorcery',
  'K:Flashback:1 B',
  'A:SP$ Token | TokenAmount$ 2 | TokenScript$ w_1_1_spirit_flying | TokenOwner$ You | SpellDescription$ Create two 1/1 white Spirit creature tokens with flying.',
  'DeckHas:Ability$Token',
  'Oracle:Create two 1/1 white Spirit creature tokens with flying.\\nFlashback {1}{B} (You may cast this card from your graveyard for its flashback cost. Then exile it.)',
] as const;

const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedLingeringSoulsRefusals(
    new TextEncoder().encode(`${lines.join('\n')}\n`),
    loadLegacyCubeSyntaxReview(),
  );

describe('Legacy Cube reviewed Lingering Souls boundary', () => {
  it('lifts exactly the installed whole-card token and Flashback composition', () => {
    expect(refusal(EXACT)).toEqual([]);
  });

  it.each([
    ['identity', EXACT.map((line) => line.replace('Name:Lingering Souls', 'Name:Lingering Shapes'))],
    ['mana cost', EXACT.map((line) => line.replace('ManaCost:2 W', 'ManaCost:1 W'))],
    ['spell API', EXACT.map((line) => line.replace('A:SP$ Token', 'A:SP$ Pump'))],
    ['token amount', EXACT.map((line) => line.replace('TokenAmount$ 2', 'TokenAmount$ 3'))],
    ['token script', EXACT.map((line) => line.replace('w_1_1_spirit_flying', 'w_1_1_spirit'))],
    ['token owner', EXACT.map((line) => line.replace('TokenOwner$ You', 'TokenOwner$ Opponent'))],
    ['Flashback keyword', EXACT.map((line) => line.replace('K:Flashback:1 B', 'K:Cycling:1 B'))],
    ['Flashback cost', EXACT.map((line) => line.replace('K:Flashback:1 B', 'K:Flashback:2 B'))],
    ['removed line', EXACT.filter((line) => !line.startsWith('DeckHas:'))],
    ['additional line', [...EXACT, 'SVar:Unreviewed:DB$ Draw | NumCards$ 1']],
  ] as const)('keeps a hostile %s mutation closed', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed Lingering Souls composition');
  });
});
