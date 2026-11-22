/** Payment evidence must exercise native activation, including nonred mana. */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('binds Suns native generic cycling payment to both basic-land cases', () => {
  const config = JSON.parse(readFileSync('packages/ui/data/akh-suns-payment-probes-v1.json', 'utf8'));
  expect(config.probes).toEqual([
    {
      id: 'suns-cycling-payment-engine-v1',
      scope: 'card',
      controller: 'engine',
      cardIds: ['akh-printed-v1:0149:f11cd406-c6ae-4018-ae45-4e5577aa82ae'],
      decisionFamilies: ['suns-cycling-three-generic-payment'],
      assertions: [
        'Forge pays exactly three Mountain sources to cycle Sweltering Suns',
        'Forge pays exactly three Plains sources to cycle Sweltering Suns',
      ],
      testFile: 'packages/forge-export/test/observed-akh-suns-payment-bot.integration.test.ts',
    },
  ]);
});
