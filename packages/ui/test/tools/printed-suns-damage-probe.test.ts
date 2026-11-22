/** Suns spell damage evidence is distinct from its cycling evidence. */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('binds Suns damage-boundary evidence to the exact printing', () => {
  const config = JSON.parse(readFileSync('packages/ui/data/akh-suns-damage-probes-v1.json', 'utf8'));
  expect(config.probes).toEqual([
    {
      id: 'suns-damage-boundaries-local-v1',
      scope: 'card',
      controller: 'local',
      cardIds: ['akh-printed-v1:0149:f11cd406-c6ae-4018-ae45-4e5577aa82ae'],
      decisionFamilies: ['suns-three-damage-both-sides-deaths-and-survivors'],
      assertions: [
        'Sweltering Suns kills two- and three-toughness creatures and marks four-toughness survivors on both sides',
      ],
      testFile: 'packages/forge-export/test/observed-akh-suns-damage.integration.test.ts',
    },
    {
      id: 'suns-damage-boundaries-engine-v1',
      scope: 'card',
      controller: 'engine',
      cardIds: ['akh-printed-v1:0149:f11cd406-c6ae-4018-ae45-4e5577aa82ae'],
      decisionFamilies: ['suns-native-small-creature-deaths-and-four-toughness-survivor'],
      assertions: [
        'Forge casts Sweltering Suns to kill small creatures while a four-toughness creature survives',
      ],
      testFile: 'packages/forge-export/test/observed-akh-suns-damage-bot.integration.test.ts',
    },
  ]);
});
