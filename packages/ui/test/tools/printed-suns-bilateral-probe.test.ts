/** Bilateral native damage must retain its own printing-bound evidence. */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('binds native bilateral Suns damage to its exact printing and assertion', () => {
  const config = JSON.parse(readFileSync('packages/ui/data/akh-suns-bilateral-probes-v1.json', 'utf8'));
  expect(config.probes).toEqual([
    {
      id: 'suns-bilateral-damage-engine-v1',
      scope: 'card',
      controller: 'engine',
      cardIds: ['akh-printed-v1:0149:f11cd406-c6ae-4018-ae45-4e5577aa82ae'],
      decisionFamilies: ['suns-three-damage-both-sides-deaths-and-survivors'],
      assertions: ['Forge casts Sweltering Suns with deaths and four-toughness survivors on both sides'],
      testFile: 'packages/forge-export/test/observed-akh-suns-bilateral-bot.integration.test.ts',
    },
  ]);
});
