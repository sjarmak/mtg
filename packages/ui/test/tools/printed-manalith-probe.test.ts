/** Manalith's mana evidence is distinct from Mummy's artifact-target claim. */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('binds local and native Manalith mana plus Mummy artifact targets to exact cards', () => {
  const config = JSON.parse(readFileSync('packages/ui/data/hou-manalith-probes-v1.json', 'utf8'));
  const manalith = 'hou-printed-v1:0164:d4b420ed-75b8-4779-aaa2-e245e84202d1';
  expect(config.probes).toEqual([
    {
      id: 'manalith-mana-local-v1',
      scope: 'card',
      controller: 'local',
      cardIds: [manalith],
      decisionFamilies: ['manalith-five-color-mana'],
      assertions: ['W', 'U', 'B', 'R', 'G'].map(
        (color) => `Manalith produces exactly one ${color}, cannot tap twice, and untaps next turn`,
      ),
      testFile: 'packages/forge-export/test/observed-hou-manalith.integration.test.ts',
    },
    {
      id: 'manalith-mana-engine-v1',
      scope: 'card',
      controller: 'engine',
      cardIds: [manalith],
      decisionFamilies: ['manalith-five-color-mana'],
      assertions: [
        ['W', 'Those Who Serve'],
        ['U', 'Ancient Crab'],
        ['B', 'Dune Beetle'],
        ['R', 'Defiant Khenra'],
        ['G', 'Colossapede'],
      ].map(([color, spell]) => `Forge uses Manalith as its only '${color}' source to cast '${spell}'`),
      testFile: 'packages/forge-export/test/observed-hou-manalith-bot.integration.test.ts',
    },
    {
      id: 'binding-mummy-artifact-local-v1',
      scope: 'card',
      controller: 'local',
      cardIds: ['akh-printed-v1:0006:fae54072-ae27-4aae-a2b7-71f4551934f6'],
      decisionFamilies: ['binding-mummy-noncreature-artifact-target'],
      assertions: [true, false].map(
        (accept) => `Binding Mummy taps a noncreature artifact (accept: ${accept})`,
      ),
      testFile: 'packages/forge-export/test/observed-akh-binding-artifact.integration.test.ts',
    },
  ]);
});
