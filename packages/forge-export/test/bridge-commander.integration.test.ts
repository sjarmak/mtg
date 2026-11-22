/** A real 1v1 Commander game opened through the installed Forge and read back through the contract. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { COMMANDER_RULES } from '@mtg/engine';
import { compileInstalledForgeBridge, installedForgeBackend } from '../src/observed/installed';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

const standard: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    { name: 'Pilot 0', controller: 'local', deck: { name: 'red', cards: [{ name: 'Mountain', count: 60 }] } },
    { name: 'Pilot 1', controller: 'local', deck: { name: 'white', cards: [{ name: 'Plains', count: 60 }] } },
  ],
  seed: 'bridge-commander-v1',
  maximumTurns: 10,
};

const commander: SessionSpec = {
  ...standard,
  rules: COMMANDER_RULES,
  seats: [
    {
      name: 'Pilot 0',
      controller: 'local',
      deck: {
        name: 'ragavan',
        cards: [{ name: 'Mountain', count: 99 }],
        commanders: [{ name: 'Ragavan, Nimble Pilferer', count: 1 }],
      },
    },
    {
      name: 'Pilot 1',
      controller: 'local',
      deck: {
        name: 'thalia',
        cards: [{ name: 'Plains', count: 99 }],
        commanders: [{ name: 'Thalia, Guardian of Thraben', count: 1 }],
      },
    },
  ],
};

forgeIt(
  'opens a two-seat Commander game at forty life with each commander in its command zone',
  async () => {
    const compiled = compileInstalledForgeBridge();
    if (compiled === null) throw new Error('Installed Forge required');
    const backend = installedForgeBackend({ compiledBridgeClasses: compiled.classDirectory });
    if (backend === null) throw new Error('Installed Forge required');
    let session: ObservedSession | undefined;
    try {
      expect(await backend.supports(commander)).toEqual([]);
      const opened = await backend.open(commander);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      expect(session.view.seats.map((seat) => seat.life)).toEqual([40, 40]);
      expect(session.view.seats.map((seat) => seat.commandZone?.map((card) => card.name))).toEqual([
        ['Ragavan, Nimble Pilferer'],
        ['Thalia, Guardian of Thraben'],
      ]);
      expect(session.view.seats.map((seat) => seat.commanderDamage)).toEqual([{}, {}]);
      // Nobody has cast anything yet, so each general's tax counter reads zero.
      expect(session.view.seats.map((seat) => Object.values(seat.commanderCasts ?? {}))).toEqual([[0], [0]]);
      for (const seat of session.view.seats) {
        // The commander is dealt to the command zone, not into the 99.
        expect(seat.handSize + seat.librarySize).toBe(99);
        const generals = seat.commandZone ?? [];
        expect(generals).toHaveLength(1);
        expect(generals[0]?.controller).toBe(seat.id);
        const elsewhere = [...(seat.hand ?? []), ...seat.battlefield, ...seat.graveyard, ...seat.exile];
        expect(elsewhere.map((card) => card.oid)).not.toContain(generals[0]?.oid);
      }
      await session.close();
      session = undefined;

      const plain = await backend.open(standard);
      if (!plain.ok) throw new Error(plain.error.message);
      session = plain.session;
      expect(session.view.seats.map((seat) => seat.life)).toEqual([20, 20]);
      for (const seat of session.view.seats) {
        expect(seat).not.toHaveProperty('commandZone');
        expect(seat).not.toHaveProperty('commanderDamage');
        expect(seat).not.toHaveProperty('commanderCasts');
      }
    } finally {
      await session?.close();
      await backend.shutdown?.();
      compiled.dispose();
    }
  },
  120_000,
);
