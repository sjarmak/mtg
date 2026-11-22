/** Native cycling payment is a narrow, exact-printing observation. */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('binds native Desert cycling payment to the observed green-only sources', () => {
  const config = JSON.parse(readFileSync('packages/ui/data/hou-desert-cycle-payment-probes-v1.json', 'utf8'));
  expect(config.probes).toEqual([
    {
      id: 'desert-cycle-payment-engine-v1',
      scope: 'card',
      controller: 'engine',
      cardIds: ['hou-printed-v1:0172:7d42aa0c-0408-4b0d-bec5-9861dbcf9ee1'],
      decisionFamilies: ['desert-native-two-green-source-cycling-payment-and-single-draw'],
      assertions: [
        "Forge AI cycles 'Desert of the Indomitable' using two prior untapped green sources and draws once",
      ],
      testFile: 'packages/forge-export/test/observed-hou-desert-cycle-payment.integration.test.ts',
    },
  ]);
});
