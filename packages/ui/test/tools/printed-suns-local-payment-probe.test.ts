/** Local payment proof must include a nonred source of generic mana. */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('binds Suns local cycling payment to both basic-land cases', () => {
  const config = JSON.parse(readFileSync('packages/ui/data/akh-suns-local-payment-probes-v1.json', 'utf8'));
  expect(config.probes).toEqual([
    {
      id: 'suns-cycling-payment-local-v1',
      scope: 'card',
      controller: 'local',
      cardIds: ['akh-printed-v1:0149:f11cd406-c6ae-4018-ae45-4e5577aa82ae'],
      decisionFamilies: ['suns-cycling-three-generic-payment'],
      assertions: [
        'Local pilot pays exactly three Mountain sources to cycle Sweltering Suns',
        'Local pilot pays exactly three Plains sources to cycle Sweltering Suns',
      ],
      testFile: 'packages/forge-export/test/observed-akh-suns-local-payment.integration.test.ts',
    },
  ]);
});
