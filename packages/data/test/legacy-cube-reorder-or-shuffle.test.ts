import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedReorderOrShuffleRefusals, loadLegacyCubeSyntaxReview } from '@mtg/data';

const PONDER = [
  'Name:Ponder',
  'ManaCost:U',
  'Types:Sorcery',
  'A:SP$ RearrangeTopOfLibrary | Defined$ You | NumCards$ 3 | MayShuffle$ True | SubAbility$ DBDraw | SpellDescription$ Look at the top three cards of your library, then put them back in any order. You may shuffle. Draw a card.',
  'SVar:DBDraw:DB$ Draw | Defined$ You | NumCards$ 1',
  'Oracle:Look at the top three cards of your library, then put them back in any order. You may shuffle.\\nDraw a card.',
] as const;

const PORTENT = [
  'Name:Portent',
  'ManaCost:U',
  'Types:Sorcery',
  "A:SP$ RearrangeTopOfLibrary | ValidTgts$ Player | NumCards$ 3 | MayShuffle$ True | SubAbility$ DelTrigSlowtrip | SpellDescription$ Look at the top three cards of target player's library, then put them back in any order. You may have that player shuffle. Draw a card at the beginning of the next turn's upkeep.",
  'SVar:DelTrigSlowtrip:DB$ DelayedTrigger | NextTurn$ True | Mode$ Phase | Phase$ Upkeep | ValidPlayer$ Player | Execute$ DrawSlowtrip | TriggerDescription$ Draw a card.',
  'SVar:DrawSlowtrip:DB$ Draw | Defined$ You',
  "Oracle:Look at the top three cards of target player's library, then put them back in any order. You may have that player shuffle.\\nDraw a card at the beginning of the next turn's upkeep.",
] as const;

const syntax = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedReorderOrShuffleRefusals(Buffer.from(lines.join('\n')), syntax);

describe('Legacy Cube reviewed reorder-or-shuffle cohort', () => {
  it.each([
    ['Ponder', PONDER],
    ['Portent', PORTENT],
  ] as const)('admits only the exact complete installed %s script', (_name, lines) => {
    expect(refusal(lines)).toEqual([]);
  });

  it.each([
    ['identity', PONDER.map((line) => line.replace('Name:Ponder', 'Name:Preordain'))],
    ['mana cost', PONDER.map((line) => line.replace('ManaCost:U', 'ManaCost:1 U'))],
    ['card type', PONDER.map((line) => line.replace('Types:Sorcery', 'Types:Instant'))],
    ['defined player', PONDER.map((line) => line.replace('Defined$ You', 'Defined$ Opponent'))],
    ['look count', PONDER.map((line) => line.replace('NumCards$ 3', 'NumCards$ 4'))],
    ['mandatory shuffle', PONDER.map((line) => line.replace('MayShuffle$ True', 'Shuffle$ True'))],
    ['subability link', PONDER.map((line) => line.replace('SubAbility$ DBDraw', 'SubAbility$ Other'))],
    ['draw API', PONDER.map((line) => line.replace('DBDraw:DB$ Draw', 'DBDraw:DB$ Mill'))],
    ['draw controller', PONDER.map((line) => line.replace('Defined$ You', 'Defined$ Opponent'))],
    ['draw count', PONDER.map((line) => line.replace('NumCards$ 1', 'NumCards$ 2'))],
    ['Ponder Oracle', PONDER.map((line) => line.replace('Draw a card.', 'Draw two cards.'))],
    ['target filter', PORTENT.map((line) => line.replace('ValidTgts$ Player', 'ValidTgts$ Opponent'))],
    ['delayed API', PORTENT.map((line) => line.replace('DB$ DelayedTrigger', 'DB$ Draw'))],
    ['next-turn guard', PORTENT.map((line) => line.replace('NextTurn$ True', 'NextTurn$ False'))],
    ['delayed mode', PORTENT.map((line) => line.replace('Mode$ Phase', 'Mode$ SpellCast'))],
    ['delayed phase', PORTENT.map((line) => line.replace('Phase$ Upkeep', 'Phase$ End of Turn'))],
    ['valid player', PORTENT.map((line) => line.replace('ValidPlayer$ Player', 'ValidPlayer$ You'))],
    ['delayed execute link', PORTENT.map((line) => line.replace('Execute$ DrawSlowtrip', 'Execute$ Other'))],
    [
      'slowtrip draw API',
      PORTENT.map((line) => line.replace('DrawSlowtrip:DB$ Draw', 'DrawSlowtrip:DB$ Mill')),
    ],
    ['slowtrip controller', PORTENT.map((line) => line.replace('Defined$ You', 'Defined$ Targeted'))],
    ['Portent Oracle', PORTENT.map((line) => line.replace('next turn', 'next end step'))],
    ['ordering', [PONDER[1]!, PONDER[0]!, ...PONDER.slice(2)]],
    ['missing line', PONDER.filter((line) => !line.startsWith('SVar:DBDraw:'))],
    ['extra syntax', [...PORTENT, 'SVar:Unreviewed:DB$ Draw | NumCards$ 1']],
  ])('refuses hostile %s drift', (_label, lines) => {
    expect(refusal(lines)).not.toEqual([]);
  });

  it('refuses hostile unknown ability API drift at the syntax-inventory boundary', () => {
    expect(() => refusal(PONDER.map((line) => line.replace('RearrangeTopOfLibrary', 'ReorderZone')))).toThrow(
      'unknown Forge decision syntax ability-api "ReorderZone"',
    );
  });
});
