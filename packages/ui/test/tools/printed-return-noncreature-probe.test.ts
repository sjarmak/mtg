/** Return's legal targets include noncreatures for both controller paths. */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('binds Return noncreature evidence to local and native assertions', () => {
  const config = JSON.parse(readFileSync('packages/ui/data/akh-return-noncreature-probes-v1.json', 'utf8'));
  const cardIds = ['akh-printed-v1:0212:a4b32135-7061-4278-a01a-4fcbaadc9706'];
  expect(config.probes).toEqual([
    {
      id: 'return-noncreature-local-v1',
      scope: 'card',
      controller: 'local',
      cardIds,
      decisionFamilies: ['return-noncreature-graveyard-target'],
      assertions: [
        'Return exiles a selected card from seat 0 and creates one Zombie',
        'Return exiles a selected card from seat 1 and creates one Zombie',
      ],
      testFile: 'packages/forge-export/test/observed-akh-return.integration.test.ts',
    },
    {
      id: 'return-noncreature-engine-v1',
      scope: 'card',
      controller: 'engine',
      cardIds,
      decisionFamilies: ['return-noncreature-graveyard-target'],
      assertions: ['Forge casts Return with only noncreature graveyard targets'],
      testFile: 'packages/forge-export/test/observed-akh-return-noncreature-bot.integration.test.ts',
    },
  ]);
});
