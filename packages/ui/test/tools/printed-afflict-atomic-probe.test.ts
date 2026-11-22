/** Shared combat resolution does not mean both combats have the same outcome. */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('adds shared Khenra combat resolution in fresh versioned definitions', () => {
  const old = JSON.parse(readFileSync('packages/ui/data/hou-afflict-trade-probes-v1.json', 'utf8'));
  const current = JSON.parse(readFileSync('packages/ui/data/hou-afflict-combat-probes-v2.json', 'utf8'));
  expect(current).toEqual({
    ...old,
    probes: old.probes.map((probe: { id: string; decisionFamilies: string[] }) => ({
      ...probe,
      id: probe.id.replace(/v1$/, 'v2'),
      decisionFamilies: ['afflict-one-then-blocked-combat-resolution', ...probe.decisionFamilies],
    })),
  });
});
