/** Cancellation receipts bind the declined cost to each exact printed source. */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('binds token cost cancellation and retry to exact local assertions', () => {
  const config = JSON.parse(readFileSync('packages/ui/data/akh-token-cancel-probes-v1.json', 'utf8'));
  expect(config.probes).toEqual([
    {
      id: 'sacred-cat-cost-cancel-local-v1',
      scope: 'card',
      controller: 'local',
      cardIds: ['akh-printed-v1:0027:08891c78-13c1-4d84-aa9c-78346b3b7d18'],
      decisionFamilies: ['embalm-exile-cost-decline-preserves-source-and-retry'],
      assertions: ["canceling 'Sacred Cat' exile leaves the source available for a successful retry"],
      testFile: 'packages/forge-export/test/observed-akh-token-cancel.integration.test.ts',
    },
    {
      id: 'pouncer-cost-cancel-local-v1',
      scope: 'card',
      controller: 'local',
      cardIds: ['hou-printed-v1:0002:865e267d-450c-4eeb-b61d-bd0ec5d8534a'],
      decisionFamilies: ['eternalize-exile-cost-decline-preserves-source-and-retry'],
      assertions: ["canceling 'Adorned Pouncer' exile leaves the source available for a successful retry"],
      testFile: 'packages/forge-export/test/observed-akh-token-cancel.integration.test.ts',
    },
  ]);
});
