/** Controlled state, actual bridge choices; not a whole-card admission receipt. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeScenarioBackend, compileInstalledForgeBridge } from '../src/observed/installed';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const table: SessionSpec = {
  content: { kind: 'printed', format: 'akh-hou' },
  seats: [
    { name: 'Pilot 0', controller: 'local', deck: { name: 'setup', cards: [{ name: 'Island', count: 60 }] } },
    { name: 'Pilot 1', controller: 'local', deck: { name: 'setup', cards: [{ name: 'Island', count: 60 }] } },
  ],
  seed: 'bridge-scenario-v1',
  maximumTurns: 10,
};

forgeIt(
  'loads and verifies an exact state before real bridge priority',
  async () => {
    const compiled = compileInstalledForgeBridge();
    if (compiled === null) throw new Error('Installed Forge required');
    const initial = {
      schemaVersion: 1 as const,
      active: 0 as const,
      phase: 'MAIN1' as const,
      seats: [
        {
          life: 19,
          hand: ['Censor'],
          battlefield: ['Ahn-Crop Crasher'],
          library: ['Island', 'Mountain'],
          graveyard: [],
        },
        {
          life: 18,
          hand: [],
          battlefield: ['Adorned Pouncer', 'Adorned Pouncer'],
          library: ['Plains'],
          graveyard: [],
        },
      ] as const,
    };
    const backend = installedForgeScenarioBackend(initial, {
      compiledBridgeClasses: compiled.classDirectory,
    });
    if (backend === null) throw new Error('Installed Forge required');
    let session: ObservedSession | undefined;
    try {
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      expect(session.decision?.kind).toBe('priority');
      expect(session.view.turn).toMatchObject({ active: 0, step: 'MAIN1' });
      expect(session.view.seats[0]).toMatchObject({ life: 19, handSize: 1, librarySize: 2 });
      expect(session.view.seats[0].battlefield.map((card) => card.name)).toEqual(['Ahn-Crop Crasher']);
      expect(session.view.seats[1].battlefield.map((card) => card.name)).toEqual([
        'Adorned Pouncer',
        'Adorned Pouncer',
      ]);
      expect(new Set(session.view.seats[1].battlefield.map((card) => card.oid)).size).toBe(2);
    } finally {
      await session?.close();
      await backend.shutdown?.();
      compiled.dispose();
    }
  },
  60_000,
);
