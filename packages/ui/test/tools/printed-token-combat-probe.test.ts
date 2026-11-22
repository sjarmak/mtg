/** Native copied-token combat evidence stays separate for each physical printing. */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('binds native token combat abilities to their exact printed sources', () => {
  const config = JSON.parse(readFileSync('packages/ui/data/akh-token-combat-probes-v1.json', 'utf8'));
  expect(config.probes).toEqual([
    {
      id: 'pouncer-token-combat-engine-v1',
      scope: 'card',
      controller: 'engine',
      cardIds: ['hou-printed-v1:0002:865e267d-450c-4eeb-b61d-bd0ec5d8534a'],
      decisionFamilies: ['eternalize-native-token-combat-double-strike'],
      assertions: [
        "Forge 'Adorned Pouncer' token retains its copied combat ability after graveyard activation",
      ],
      testFile: 'packages/forge-export/test/observed-akh-token-combat-bot.integration.test.ts',
    },
    {
      id: 'sacred-cat-token-combat-engine-v1',
      scope: 'card',
      controller: 'engine',
      cardIds: ['akh-printed-v1:0027:08891c78-13c1-4d84-aa9c-78346b3b7d18'],
      decisionFamilies: ['embalm-native-token-combat-lifelink'],
      assertions: ["Forge 'Sacred Cat' token retains its copied combat ability after graveyard activation"],
      testFile: 'packages/forge-export/test/observed-akh-token-combat-bot.integration.test.ts',
    },
  ]);
});
