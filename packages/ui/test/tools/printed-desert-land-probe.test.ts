/** Direct land-play evidence is distinct from cycling evidence. */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('binds the direct Desert land-play observation to its exact printing', () => {
  const config = JSON.parse(readFileSync('packages/ui/data/hou-desert-land-probes-v1.json', 'utf8'));
  expect(config.probes.slice(0, 1)).toEqual([
    {
      id: 'desert-land-local-v1',
      scope: 'card',
      controller: 'local',
      cardIds: ['hou-printed-v1:0172:7d42aa0c-0408-4b0d-bec5-9861dbcf9ee1'],
      decisionFamilies: ['desert-direct-land-play-tapped-entry-green-mana-and-untap'],
      assertions: [
        'Desert of the Indomitable enters tapped from hand, produces only G, and untaps after use',
      ],
      testFile: 'packages/forge-export/test/observed-hou-desert-land.integration.test.ts',
    },
  ]);
});

it('binds native Desert payment and untap without claiming hidden bot decisions', () => {
  const config = JSON.parse(readFileSync('packages/ui/data/hou-desert-land-probes-v1.json', 'utf8'));
  expect(config.probes).toHaveLength(2);
  expect(config.probes[1]).toEqual({
    id: 'desert-land-engine-v1',
    scope: 'card',
    controller: 'engine',
    cardIds: ['hou-printed-v1:0172:7d42aa0c-0408-4b0d-bec5-9861dbcf9ee1'],
    decisionFamilies: ['desert-native-tapped-land-play-green-spell-payment-and-untap'],
    assertions: ['Forge plays tapped Deserts, pays for Colossapede, and untaps the paid sources'],
    testFile: 'packages/forge-export/test/observed-hou-desert-land-bot.integration.test.ts',
  });
});
