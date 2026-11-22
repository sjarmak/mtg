/** Casting evidence must distinguish red requirements from generic cycling. */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('binds Suns casting to local red-source cases and native public payment evidence', () => {
  const config = JSON.parse(readFileSync('packages/ui/data/akh-suns-cast-probes-v1.json', 'utf8'));
  expect(config.probes).toEqual([
    {
      id: 'suns-cast-payment-local-v1',
      scope: 'card',
      controller: 'local',
      cardIds: ['akh-printed-v1:0149:f11cd406-c6ae-4018-ae45-4e5577aa82ae'],
      decisionFamilies: ['suns-casting-three-mana-including-two-red'],
      assertions: [
        "Sweltering Suns casting requires two red sources: 'MMM'",
        "Sweltering Suns casting requires two red sources: 'MMP'",
        "Sweltering Suns casting requires two red sources: 'PPP'",
        "Sweltering Suns casting requires two red sources: 'MPP'",
      ],
      testFile: 'packages/forge-export/test/observed-akh-suns-cast.integration.test.ts',
    },
    {
      id: 'suns-cast-payment-engine-v1',
      scope: 'card',
      controller: 'engine',
      cardIds: ['akh-printed-v1:0149:f11cd406-c6ae-4018-ae45-4e5577aa82ae'],
      decisionFamilies: ['suns-casting-three-mana-including-two-red'],
      assertions: [
        'Forge pays three distinct lands including two Mountains to cast Sweltering Suns without drawing',
      ],
      testFile: 'packages/forge-export/test/observed-akh-suns-cast-bot.integration.test.ts',
    },
  ]);
});
