/** Format-qualified public pregame outcomes; no claims about the hidden bot policy. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const table: SessionSpec = {
  content: { kind: 'printed', format: 'akh-hou' },
  seats: [
    {
      name: 'Local pilot',
      controller: 'local',
      deck: {
        name: 'local opening',
        cards: [
          { name: 'Plains', count: 30 },
          { name: 'Adorned Pouncer', count: 30 },
        ],
      },
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
  // Reuse the universal pregame fixture's local toss-winner seed.
  seed: '1514',
  maximumTurns: 4,
};

async function submit(session: ObservedSession, id: string) {
  const result = await session.submit(id);
  if (!result.ok) throw new Error(result.error.message);
  return result.session;
}

async function withSession(check: (session: ObservedSession) => Promise<ObservedSession>) {
  const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  let session: ObservedSession | undefined;
  try {
    expect(await backend.supports(table)).toEqual([]);
    const opened = await backend.open(table);
    if (!opened.ok) throw new Error(opened.error.message);
    session = opened.session;
    session = await check(session);
  } finally {
    try {
      await session?.close();
    } finally {
      await backend.shutdown?.();
    }
  }
}

for (const first of [0, 1] as const) {
  forgeIt(
    `AKH/HOU local starting choice honors seat ${first} and reaches legal priority`,
    async () => {
      await withSession(async (initial) => {
        expect(initial.decision).toMatchObject({ kind: 'starting-player', seat: 0, complete: true });
        expect(initial.decision?.options.map((option) => option.id).sort()).toEqual([
          'pregame-start-seat-0',
          'pregame-start-seat-1',
        ]);
        expect(initial.view.seats[1].hand).toBeNull();
        expect((await initial.submit('pregame-start-seat-2')).ok).toBe(false);
        let session = await submit(initial, `pregame-start-seat-${first}`);
        expect(session.decision).toMatchObject({ kind: 'mulligan', seat: 0, complete: true });
        expect(session.view.seats[0].hand).toHaveLength(7);
        session = await submit(session, 'pregame-keep');
        expect(session.decision).toMatchObject({ kind: 'priority', seat: 0, complete: true });
        expect(session.view.turn.active).toBe(first);
        expect(session.view.priority).toBe(0);
        expect(session.view.seats[1].hand).toBeNull();
        const pass = session.decision?.options.find((option) => option.text === 'Pass priority');
        expect(pass).toBeDefined();
        expect((await session.submit(`pregame-start-seat-${first}`)).ok).toBe(false);
        const next = await submit(session, pass!.id);
        expect(next.status).toBe('awaiting');
        expect(next.view.turn.active).toBe(first);
        expect(next.view.seats[1].hand).toBeNull();
        return next;
      });
    },
    180_000,
  );
}

forgeIt(
  'AKH/HOU local London mulligans bottom exact visible cards and preserve library counts',
  async () => {
    await withSession(async (initial) => {
      let session = await submit(initial, 'pregame-start-seat-0');
      for (const count of [1, 2]) {
        session = await submit(session, 'pregame-mulligan');
        expect(session.decision).toMatchObject({ kind: 'mulligan-bottom', seat: 0, complete: true });
        expect(session.view.seats[0].hand).toHaveLength(7);
        expect(session.view.seats[0].librarySize).toBe(53);
        expect(session.decision?.options).toHaveLength(count === 1 ? 7 : 21);
        const choice = session.decision!.options.at(-1)!;
        const bottomed = [...choice.text.matchAll(/\[(forge-card-\d+)\]/gu)].map((match) => match[1]!);
        expect(bottomed).toHaveLength(count);
        const before = session.view.seats[0].hand!.map((card) => card.oid);
        expect(bottomed.every((id) => before.includes(id))).toBe(true);
        session = await submit(session, choice.id);
        expect(session.decision).toMatchObject({ kind: 'mulligan', seat: 0, complete: true });
        expect(session.view.seats[0].hand!.map((card) => card.oid).sort()).toEqual(
          before.filter((id) => !bottomed.includes(id)).sort(),
        );
        expect(session.view.seats[0].handSize).toBe(7 - count);
        expect(session.view.seats[0].librarySize).toBe(53 + count);
        expect(session.view.seats[0].graveyard).toHaveLength(0);
        expect(session.view.seats[0].exile).toHaveLength(0);
        expect(session.view.seats[1].hand).toBeNull();
        expect((await session.submit(choice.id)).ok).toBe(false);
      }
      session = await submit(session, 'pregame-keep');
      expect(session.decision).toMatchObject({ kind: 'priority', seat: 0, complete: true });
      expect(session.view.seats[0].handSize).toBe(5);
      expect(session.view.seats[0].librarySize).toBe(55);
      return session;
    });
  },
  180_000,
);
