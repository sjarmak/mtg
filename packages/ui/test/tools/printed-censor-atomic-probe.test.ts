/** Shared counter evidence must not imply native tax-payment coverage. */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('adds shared Censor unpaid-counter evidence with fresh IDs and preserves narrower claims', () => {
  const original = JSON.parse(readFileSync('packages/ui/data/akh-hou-probes-v1.json', 'utf8'));
  const current = JSON.parse(readFileSync('packages/ui/data/akh-censor-counter-probes-v2.json', 'utf8'));
  expect(current).toEqual({
    ...original,
    probes: original.probes
      .filter((probe: { id: string }) =>
        ['censor-counter-local-v1', 'censor-counter-engine-v1'].includes(probe.id),
      )
      .map((probe: { id: string; decisionFamilies: string[] }) => ({
        ...probe,
        id: probe.id.replace(/v1$/, 'v2'),
        decisionFamilies: ['censor-unpaid-tax-counters-exact-spell', ...probe.decisionFamilies],
      })),
  });
});
