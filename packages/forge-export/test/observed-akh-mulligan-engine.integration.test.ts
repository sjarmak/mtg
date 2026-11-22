/** Public native mulligan events and zone counts, not hidden-card selection quality. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

async function submit(session: ObservedSession, move: string): Promise<ObservedSession> {
  const advanced = await session.submit(move);
  if (!advanced.ok) throw new Error(advanced.error.message);
  return advanced.session;
}

forgeIt(
  'AKH/HOU native mulligans emit public evidence and conserve the hidden opening deck',
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
            name: 'land-light opening',
            cards: [
              { name: 'Plains', count: 12 },
              { name: 'Adorned Pouncer', count: 48 },
            ],
          },
        },
      ],
      seed: '1514',
      maximumTurns: 2,
    };
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    try {
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      expect(session.decision).toMatchObject({ kind: 'starting-player', seat: 0 });
      for (const move of ['pregame-start-seat-0', 'pregame-keep']) {
        session = await submit(session, move);
      }
      expect(session.decision).toMatchObject({ kind: 'priority', seat: 0, complete: true });
      expect(session.view.turn.active).toBe(0);
      const bot = session.view.seats[1];
      expect(bot.hand).toBeNull();
      expect(bot.handSize).toBeGreaterThan(0);
      expect(bot.handSize).toBeLessThan(7);
      expect(bot.handSize + bot.librarySize).toBe(60);
      expect(bot.battlefield).toHaveLength(0);
      expect(bot.graveyard).toHaveLength(0);
      expect(bot.exile).toHaveLength(0);
      const logs = session.events.filter((event) => event.type === 'Mulligan');
      const native = logs.filter((event) => event.text.startsWith('Native pilot has mulliganed'));
      expect(native.length, JSON.stringify(session.events)).toBeGreaterThan(0);
      const counts = native.map((event) => {
        expect(event.reveals).toHaveLength(0);
        const match = /^Native pilot has mulliganed down to (\d+) cards\.$/u.exec(event.text);
        expect(match).not.toBeNull();
        return Number(match![1]);
      });
      expect(Math.min(...counts)).toBe(bot.handSize);
      expect(logs.some((event) => event.text.startsWith('Observer has mulliganed'))).toBe(false);
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
