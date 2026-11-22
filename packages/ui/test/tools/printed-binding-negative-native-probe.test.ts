/** Keep native trigger exclusions distinct from the local interaction receipts. */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('binds all three non-triggering entries to Binding Mummy under native control', () => {
  const config = JSON.parse(
    readFileSync('packages/ui/data/akh-binding-negative-native-probes-v1.json', 'utf8'),
  );
  expect(config.probes).toEqual([
    {
      id: 'binding-mummy-negative-engine-v1',
      scope: 'card',
      controller: 'engine',
      cardIds: ['akh-printed-v1:0006:fae54072-ae27-4aae-a2b7-71f4551934f6'],
      decisionFamilies: ['binding-mummy-entry-trigger-exclusions'],
      assertions: ['itself', 'own non-Zombie', 'opposing Zombie'].map(
        (entry) => `Native Binding Mummy does not trigger for ${entry}`,
      ),
      testFile: 'packages/forge-export/test/observed-akh-binding-negative-bot.integration.test.ts',
    },
  ]);
});
