/** Haste and non-exert evidence must cover both controllers with exact test names. */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('binds Crasher haste and non-exert branches to paired installed cases', () => {
  const config = JSON.parse(readFileSync('packages/ui/data/akh-crasher-decline-probes-v1.json', 'utf8'));
  expect(config.probes).toEqual(
    ['local', 'engine'].map((controller) => ({
      id: `crasher-decline-${controller}-v1`,
      scope: 'card',
      controller,
      cardIds: ['akh-printed-v1:0117:dd5db68c-24d5-44ce-9809-e446f26fac5d'],
      decisionFamilies: ['haste-same-turn-attack', 'optional-exert-decline-and-normal-untap'],
      assertions: [
        `Crasher ${controller} casts and attacks with haste without exerting, then untaps normally`,
      ],
      testFile: 'packages/forge-export/test/observed-akh-crasher-decline.integration.test.ts',
    })),
  );
});
