/** Shared semantic families retain the narrower claims of their actual fixtures. */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('binds both split faces to local and native atomic evidence without widening native Dusk', () => {
  const config = JSON.parse(readFileSync('packages/ui/data/akh-dusk-dawn-atomic-probes-v1.json', 'utf8'));
  const common = {
    scope: 'card',
    cardIds: ['akh-printed-v1:0210:937dbc51-b589-4237-9fce-ea5c757f7c48'],
  };
  expect(config.probes).toEqual([
    {
      ...common,
      id: 'dusk-dawn-atomic-local-v1',
      controller: 'local',
      decisionFamilies: [
        'dusk-power-cutoff-and-dawn-own-graveyard-recovery',
        'dusk-power-two-survives-power-three-dies',
        'dawn-own-low-power-recovery-high-power-and-opponent-exclusion',
      ],
      assertions: ['Dusk spares low power; Dawn excludes high power and the other graveyard'],
      testFile: 'packages/forge-export/test/observed-akh-dusk-dawn.integration.test.ts',
    },
    {
      ...common,
      id: 'dusk-atomic-engine-v1',
      controller: 'engine',
      decisionFamilies: [
        'dusk-native-power-two-survives-power-three-dies',
        'dusk-power-two-survives-power-three-dies',
      ],
      assertions: ['Forge casts Dusk destroying power-three creatures while preserving power-two creatures'],
      testFile: 'packages/forge-export/test/observed-akh-dusk-bot.integration.test.ts',
    },
    {
      ...common,
      id: 'dawn-atomic-engine-v1',
      controller: 'engine',
      decisionFamilies: [
        'dawn-native-low-power-recovery-high-power-and-opponent-exclusion',
        'dawn-own-low-power-recovery-high-power-and-opponent-exclusion',
      ],
      assertions: [
        'Forge Dawn recovers low power, excludes high power, and leaves the other graveyard unchanged',
      ],
      testFile: 'packages/forge-export/test/observed-akh-dawn-bot.integration.test.ts',
    },
  ]);
});
