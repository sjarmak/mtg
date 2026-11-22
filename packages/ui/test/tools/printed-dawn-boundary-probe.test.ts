/** Dawn's native graveyard boundary must bind to the exact split printing. */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('binds native Dawn power and opponent-graveyard evidence to the exact split printing', () => {
  const config = JSON.parse(readFileSync('packages/ui/data/akh-dawn-boundary-probes-v1.json', 'utf8'));
  expect(config.probes).toEqual([
    {
      id: 'dawn-graveyard-boundaries-engine-v1',
      scope: 'card',
      controller: 'engine',
      cardIds: ['akh-printed-v1:0210:937dbc51-b589-4237-9fce-ea5c757f7c48'],
      decisionFamilies: ['dawn-native-low-power-recovery-high-power-and-opponent-exclusion'],
      assertions: [
        'Forge Dawn recovers low power, excludes high power, and leaves the other graveyard unchanged',
      ],
      testFile: 'packages/forge-export/test/observed-akh-dawn-bot.integration.test.ts',
    },
  ]);
});
