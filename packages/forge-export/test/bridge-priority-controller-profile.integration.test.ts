/** Proves bilateral priority handling for a passive exact Forge script. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeScenarioBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const SOURCE = 'Abandoned Sarcophagus';
const emptySeat = {
  life: 20,
  hand: [],
  library: Array<string>(20).fill('Swamp'),
  graveyard: [],
};

for (const controller of ['local', 'engine'] as const) {
  forgeIt(
    `Abandoned Sarcophagus ${controller} controller profile`,
    async () => {
      const sourceSeat = controller === 'local' ? 0 : 1;
      const state = {
        schemaVersion: 1 as const,
        active: sourceSeat,
        phase: 'MAIN1' as const,
        seats: [
          { ...emptySeat, battlefield: sourceSeat === 0 ? [SOURCE] : [] },
          { ...emptySeat, battlefield: sourceSeat === 1 ? [SOURCE] : [] },
        ] as const,
      };
      const backend = await snapshotForgeScenarioBackend(state, { timeoutMs: 180_000 });
      if (backend === null) throw new Error('Required installed Forge is absent');
      const table: SessionSpec = {
        content: { kind: 'printed', format: 'akh-hou' },
        seats: [
          {
            name: 'Local',
            controller: 'local',
            deck: { name: 'setup', cards: [{ name: 'Swamp', count: 60 }] },
          },
          {
            name: 'Native',
            controller: controller === 'engine' ? 'engine' : 'local',
            deck: { name: 'setup', cards: [{ name: 'Swamp', count: 60 }] },
          },
        ],
        seed: `abandoned-sarcophagus-${controller}-controller-profile-v1`,
        maximumTurns: 2,
      };
      let session: ObservedSession | undefined;
      try {
        const opened = await backend.open(table);
        if (!opened.ok) throw new Error(opened.error.message);
        session = opened.session;
        expect(session.view.seats[sourceSeat].battlefield).toContainEqual(
          expect.objectContaining({ name: SOURCE }),
        );
        expect(session.decision).toMatchObject({ kind: 'priority', seat: 0 });
        if (controller === 'engine') {
          expect(session.view.turn.active).toBe(1);
        }
        const pass = session.decision?.options.find((option) => option.text === 'Pass priority');
        if (pass === undefined) throw new Error('Missing pass-priority action');
        const advanced = await session.submit(pass.id);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        expect(session.view.seats[sourceSeat].battlefield).toContainEqual(
          expect.objectContaining({ name: SOURCE }),
        );
      } finally {
        try {
          await session?.close();
        } finally {
          await backend.shutdown?.();
        }
      }
    },
    180_000,
  );
}
