/** Negative trigger evidence remains a separate, exact-printing claim. */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('binds all three non-triggering entries to Binding Mummy under local control', () => {
  const config = JSON.parse(readFileSync('packages/ui/data/akh-binding-negative-probes-v1.json', 'utf8'));
  expect(config.probes).toEqual([
    {
      id: 'binding-mummy-negative-local-v1',
      scope: 'card',
      controller: 'local',
      cardIds: ['akh-printed-v1:0006:fae54072-ae27-4aae-a2b7-71f4551934f6'],
      decisionFamilies: ['binding-mummy-entry-trigger-exclusions'],
      assertions: ['itself', 'own non-Zombie', 'opposing Zombie'].map(
        (entry) => `Binding Mummy does not trigger for ${entry}`,
      ),
      testFile: 'packages/forge-export/test/observed-akh-binding-mummy-negative.integration.test.ts',
    },
  ]);
});
