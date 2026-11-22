/** Native Dusk's power boundary is distinct from Dawn's graveyard recovery. */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('binds native Dusk power-boundary evidence to the exact split printing', () => {
  const config = JSON.parse(readFileSync('packages/ui/data/akh-dusk-power-probes-v1.json', 'utf8'));
  expect(config.probes).toEqual([
    {
      id: 'dusk-power-boundaries-engine-v1',
      scope: 'card',
      controller: 'engine',
      cardIds: ['akh-printed-v1:0210:937dbc51-b589-4237-9fce-ea5c757f7c48'],
      decisionFamilies: ['dusk-native-power-two-survives-power-three-dies'],
      assertions: ['Forge casts Dusk destroying power-three creatures while preserving power-two creatures'],
      testFile: 'packages/forge-export/test/observed-akh-dusk-bot.integration.test.ts',
    },
  ]);
});
