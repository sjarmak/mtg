/** Both-controller native Dusk evidence uses a fresh retained probe identity. */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('binds native Dusk evidence for both controllers to the exact split printing', () => {
  const config = JSON.parse(readFileSync('packages/ui/data/akh-dusk-bilateral-probes-v1.json', 'utf8'));
  expect(config.probes).toEqual([
    {
      id: 'dusk-bilateral-engine-v1',
      scope: 'card',
      controller: 'engine',
      cardIds: ['akh-printed-v1:0210:937dbc51-b589-4237-9fce-ea5c757f7c48'],
      decisionFamilies: [
        'dusk-native-both-controllers-power-two-survives-power-three-dies',
        'dusk-power-two-survives-power-three-dies',
      ],
      assertions: ['Forge Dusk preserves power two and destroys power three on both sides of the board'],
      testFile: 'packages/forge-export/test/observed-akh-dusk-bilateral-bot.integration.test.ts',
    },
  ]);
});
