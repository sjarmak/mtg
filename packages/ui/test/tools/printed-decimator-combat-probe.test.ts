/** Exact-printing combat evidence is distinct from linked target-choice evidence. */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('binds Decimator counter removal and unblocked combat to its exact printing', () => {
  const config = JSON.parse(readFileSync('packages/ui/data/akh-decimator-combat-probes-v1.json', 'utf8'));
  expect(config.probes.slice(0, 1)).toEqual([
    {
      id: 'decimator-unblocked-combat-local-v1',
      scope: 'card',
      controller: 'local',
      cardIds: ['akh-printed-v1:0197:6b75e834-fa46-4833-ae9f-1bc2809ece2f'],
      decisionFamilies: ['decimator-own-counter-removal-and-four-unblocked-damage'],
      assertions: ['Decimator Beetle removes its counter and deals four unblocked combat damage'],
      testFile: 'packages/forge-export/test/observed-akh-decimator-combat.integration.test.ts',
    },
  ]);
});

it('binds native Decimator lethal combat to its exact printing', () => {
  const config = JSON.parse(readFileSync('packages/ui/data/akh-decimator-combat-probes-v1.json', 'utf8'));
  expect(config.probes).toHaveLength(2);
  expect(config.probes[1]).toEqual({
    id: 'decimator-unblocked-combat-engine-v1',
    scope: 'card',
    controller: 'engine',
    cardIds: ['akh-printed-v1:0197:6b75e834-fa46-4833-ae9f-1bc2809ece2f'],
    decisionFamilies: ['decimator-native-counter-removal-and-twelve-unblocked-damage'],
    assertions: ['Forge Decimators remove their counter and deal twelve unblocked combat damage'],
    testFile: 'packages/forge-export/test/observed-akh-decimator-combat-bot.integration.test.ts',
  });
});
