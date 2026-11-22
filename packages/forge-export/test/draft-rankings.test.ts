import { expect, it } from 'vitest';
import { parseForgeDraftRankingOutput } from '../src/draft-rankings';

it('parses one framed Forge rank for every requested card in order', () => {
  expect(
    parseForgeDraftRankingOutput(
      [
        'Forge diagnostic noise',
        '@@MTG_FORGE_DRAFT_RANK@@0|0.008032128514056224',
        '@@MTG_FORGE_DRAFT_RANK@@1|null',
        '@@MTG_FORGE_DRAFT_RANK@@2|0.4939759036144578',
      ].join('\n'),
      3,
    ),
  ).toEqual([0.008032128514056224, null, 0.4939759036144578]);
});

it('rejects duplicate, missing, out-of-range, and unframed ranking output', () => {
  expect(() =>
    parseForgeDraftRankingOutput('@@MTG_FORGE_DRAFT_RANK@@0|0.1\n@@MTG_FORGE_DRAFT_RANK@@0|0.2', 1),
  ).toThrow(/duplicate/);
  expect(() => parseForgeDraftRankingOutput('@@MTG_FORGE_DRAFT_RANK@@0|1.1', 1)).toThrow(/range/);
  expect(() => parseForgeDraftRankingOutput('diagnostic only', 1)).toThrow(/expected 1/);
});
