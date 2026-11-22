/** Shared Decimator combat evidence retains its distinct damage outcomes. */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('adds shared Decimator combat resolution in fresh versioned definitions', () => {
  const old = JSON.parse(readFileSync('packages/ui/data/akh-decimator-combat-probes-v1.json', 'utf8'));
  const current = JSON.parse(readFileSync('packages/ui/data/akh-decimator-combat-probes-v2.json', 'utf8'));
  expect(current).toEqual({
    ...old,
    probes: old.probes.map((probe: { id: string; decisionFamilies: string[] }) => ({
      ...probe,
      id: probe.id.replace(/v1$/, 'v2'),
      decisionFamilies: ['decimator-counter-removal-then-unblocked-combat', ...probe.decisionFamilies],
    })),
  });
});
