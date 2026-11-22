/** Shared claims require fresh definitions, not relabeled historical receipts. */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('binds both Desert controllers to the same three demonstrated land behaviors', () => {
  const previous = JSON.parse(readFileSync('packages/ui/data/hou-desert-land-probes-v1.json', 'utf8'));
  const current = JSON.parse(readFileSync('packages/ui/data/hou-desert-land-probes-v2.json', 'utf8'));
  expect(current).toEqual({
    ...previous,
    probes: previous.probes.map((probe: { id: string }) => ({
      ...probe,
      id: probe.id.replace(/v1$/, 'v2'),
      decisionFamilies: ['desert-land-enters-tapped', 'desert-green-mana-use', 'desert-untap-after-mana-use'],
    })),
  });
});
