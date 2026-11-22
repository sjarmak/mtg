/** Both controllers must prove targeted prevention and recovery after exert. */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('binds Crasher boundaries to distinct local and native installed tests', () => {
  const config = JSON.parse(readFileSync('packages/ui/data/akh-crasher-boundaries-probes-v1.json', 'utf8'));
  expect(config.probes).toEqual([
    {
      id: 'crasher-boundaries-local-v1',
      scope: 'card',
      controller: 'local',
      cardIds: ['akh-printed-v1:0117:dd5db68c-24d5-44ce-9809-e446f26fac5d'],
      decisionFamilies: ['exert-targeted-blocking-prevention-and-one-skipped-untap'],
      assertions: ['Ahn-Crop Crasher can decline exert, then stop one exact blocker and skip one untap'],
      testFile: 'packages/forge-export/test/observed-akh-exert.integration.test.ts',
    },
    {
      id: 'crasher-boundaries-engine-v1',
      scope: 'card',
      controller: 'engine',
      cardIds: ['akh-printed-v1:0117:dd5db68c-24d5-44ce-9809-e446f26fac5d'],
      decisionFamilies: ['exert-targeted-blocking-prevention-and-one-skipped-untap'],
      assertions: ['Forge Crasher disables one of two blockers and untaps after exactly one skipped untap'],
      testFile: 'packages/forge-export/test/observed-akh-exert-boundaries-bot.integration.test.ts',
    },
  ]);
});
