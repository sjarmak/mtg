/** Afflict timing alone is not evidence of the subsequent combat trade. */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('binds exact Khenra blocked-combat outcomes separately from trigger timing', () => {
  const config = JSON.parse(readFileSync('packages/ui/data/hou-afflict-trade-probes-v1.json', 'utf8'));
  expect(config.probes.slice(0, 1)).toEqual([
    {
      id: 'khenra-combat-trade-local-v1',
      scope: 'card',
      controller: 'local',
      cardIds: ['hou-printed-v1:0066:abbdc277-4a76-44a9-aeda-edabab1f579e'],
      decisionFamilies: ['afflict-one-then-exact-blocked-combat-trade'],
      assertions: [
        'Khenra Eternal trades with 1 exact blocker after Afflict and preserves the unblocked copy',
      ],
      testFile: 'packages/forge-export/test/observed-hou-afflict-trade.integration.test.ts',
    },
  ]);
});

it('binds native blocked-combat survival without claiming a two-creature trade', () => {
  const config = JSON.parse(readFileSync('packages/ui/data/hou-afflict-trade-probes-v1.json', 'utf8'));
  expect(config.probes).toHaveLength(2);
  expect(config.probes[1]).toEqual({
    id: 'khenra-combat-survival-engine-v1',
    scope: 'card',
    controller: 'engine',
    cardIds: ['hou-printed-v1:0066:abbdc277-4a76-44a9-aeda-edabab1f579e'],
    decisionFamilies: ['afflict-one-then-blocked-combat-survival-and-lifelink'],
    assertions: ['Forge Khenra kills its Cat blocker after Afflict and survives with one damage'],
    testFile: 'packages/forge-export/test/observed-hou-afflict-combat-bot.integration.test.ts',
  });
});
