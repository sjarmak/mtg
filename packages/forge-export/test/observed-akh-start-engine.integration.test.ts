/** Native starting choice is observed through pregame and the first public turn. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

forgeIt(
  'AKH/HOU engine-controlled starting choice reaches its first turn without a local starting move',
  async () => {
    const table: SessionSpec = {
      content: { kind: 'printed', format: 'akh-hou' },
      seats: [
        {
          name: 'Observer',
          controller: 'local',
          deck: { name: 'observer', cards: [{ name: 'Plains', count: 60 }] },
        },
        {
          name: 'Native pilot',
          controller: 'engine',
          deck: {
            name: 'native opening',
            cards: [
              { name: 'Plains', count: 30 },
              { name: 'Adorned Pouncer', count: 30 },
            ],
          },
        },
      ],
      // This seed gave the engine the starting choice in the local pregame probe.
      seed: 'akh-hou-local-pregame-v1',
      maximumTurns: 2,
    };
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    try {
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      expect(session.decision).toMatchObject({ kind: 'mulligan', seat: 0, complete: true });
      expect(session.view.seats[0].hand).toHaveLength(7);
      expect(session.view.seats[1].hand).toBeNull();
      expect(session.decision?.options.some((move) => move.id.startsWith('pregame-start-'))).toBe(false);
      expect((await session.submit('pregame-start-seat-0')).ok).toBe(false);
      const kept = await session.submit('pregame-keep');
      if (!kept.ok) throw new Error(kept.error.message);
      session = kept.session;
      expect(session.decision).toMatchObject({ kind: 'priority', seat: 0, complete: true });
      expect(session.view.turn).toMatchObject({ active: 1, number: 1 });
      expect(session.view.priority).toBe(0);
      expect(session.view.stack).toHaveLength(0);
      expect(session.view.seats[1].hand).toBeNull();
      expect(session.view.seats[1].battlefield).toHaveLength(0);
      expect(session.view.seats[1].graveyard).toHaveLength(0);
      expect(session.view.seats[1].exile).toHaveLength(0);
      expect(session.view.seats[1].handSize + session.view.seats[1].librarySize).toBe(60);
      expect(session.view.seats[0].handSize).toBe(7);
      expect(session.view.seats[0].librarySize).toBe(53);
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
