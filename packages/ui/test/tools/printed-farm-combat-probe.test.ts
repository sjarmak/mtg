/** Farm combat evidence preserves controller-specific targeting coverage. */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('binds Farm combat destruction and targeting evidence to the exact split printing', () => {
  const config = JSON.parse(readFileSync('packages/ui/data/hou-farm-combat-probes-v1.json', 'utf8'));
  expect(config.probes).toEqual([
    {
      id: 'farm-combat-targets-local-v1',
      scope: 'card',
      controller: 'local',
      cardIds: ['hou-printed-v1:0148:d998db65-8785-4ee9-940e-fa9ab62e180f'],
      decisionFamilies: [
        'farm-combat-destruction-and-other-copy-preservation',
        'farm-local-attacking-and-blocking-target-legality',
      ],
      assertions: [
        'Farm destroys the selected attacking creature and leaves other copies alone',
        'Farm destroys the selected blocking creature and leaves other copies alone',
      ],
      testFile: 'packages/forge-export/test/observed-akh-farm.integration.test.ts',
    },
    {
      id: 'farm-combat-targets-engine-v1',
      scope: 'card',
      controller: 'engine',
      cardIds: ['hou-printed-v1:0148:d998db65-8785-4ee9-940e-fa9ab62e180f'],
      decisionFamilies: [
        'farm-combat-destruction-and-other-copy-preservation',
        'farm-native-attacker-destruction-and-other-copy-preservation',
      ],
      assertions: ['Forge casts Farm during combat and destroys one attacker while preserving other copies'],
      testFile: 'packages/forge-export/test/observed-hou-farm-bot.integration.test.ts',
    },
  ]);
});
