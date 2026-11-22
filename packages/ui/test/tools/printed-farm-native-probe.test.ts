/** Farm's removal evidence is separate from Market's aftermath evidence. */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('binds native Farm combat removal to the exact split printing', () => {
  const config = JSON.parse(readFileSync('packages/ui/data/hou-farm-native-probes-v1.json', 'utf8'));
  expect(config.probes).toEqual([
    {
      id: 'farm-attacker-engine-v1',
      scope: 'card',
      controller: 'engine',
      cardIds: ['hou-printed-v1:0148:d998db65-8785-4ee9-940e-fa9ab62e180f'],
      decisionFamilies: ['farm-native-attacker-destruction-and-other-copy-preservation'],
      assertions: ['Forge casts Farm during combat and destroys one attacker while preserving other copies'],
      testFile: 'packages/forge-export/test/observed-hou-farm-bot.integration.test.ts',
    },
  ]);
});
