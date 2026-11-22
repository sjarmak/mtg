/** Local ordering and native resolution are separate evidence claims. */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('binds independent Binding Mummy triggers to both controller routes', () => {
  const config = JSON.parse(readFileSync('packages/ui/data/akh-binding-multiple-probes-v1.json', 'utf8'));
  expect(config.probes).toEqual([
    {
      id: 'binding-mummy-multiple-local-v1',
      scope: 'card',
      controller: 'local',
      cardIds: ['akh-printed-v1:0006:fae54072-ae27-4aae-a2b7-71f4551934f6'],
      decisionFamilies: ['binding-mummy-simultaneous-optional-triggers'],
      assertions: ['two Binding Mummy triggers resolve independently against the same creature'],
      testFile: 'packages/forge-export/test/observed-akh-binding-multiple.integration.test.ts',
    },
    {
      id: 'binding-mummy-multiple-engine-v1',
      scope: 'card',
      controller: 'engine',
      cardIds: ['akh-printed-v1:0006:fae54072-ae27-4aae-a2b7-71f4551934f6'],
      decisionFamilies: ['binding-mummy-simultaneous-optional-triggers'],
      assertions: ['Forge resolves two independent Binding Mummy triggers without exposing bot choices'],
      testFile: 'packages/forge-export/test/observed-akh-binding-multiple-bot.integration.test.ts',
    },
  ]);
});
