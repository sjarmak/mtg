/** Native priority actions proven through public stack transitions, never hidden hands. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

forgeIt(
  'AKH/HOU native priority casts a creature and yields before its exact resolution',
  async () => {
    const table: SessionSpec = {
      content: { kind: 'printed', format: 'akh-hou' },
      seats: [
        {
          name: 'Observer',
          controller: 'local',
          deck: { name: 'passive', cards: [{ name: 'Plains', count: 60 }] },
        },
        {
          name: 'Native pilot',
          controller: 'engine',
          deck: {
            name: 'native priority',
            cards: [
              { name: 'Plains', count: 30 },
              { name: 'Adorned Pouncer', count: 30 },
            ],
          },
        },
      ],
      seed: 'akh-hou-native-priority-v1',
      maximumTurns: 12,
    };
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let resolved = false;
    try {
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 600 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing local decision');
        expect(decision.seat).toBe(0);
        expect(session.view.seats[1].hand).toBeNull();
        const creature = session.view.stack.find((card) => card.name === 'Adorned Pouncer');
        if (creature !== undefined) {
          expect(decision).toMatchObject({ kind: 'priority', complete: true });
          expect(session.view.priority).toBe(0);
          expect(session.view.turn.active).toBe(1);
          expect(session.view.seats[1].battlefield.filter((card) => card.tapped)).toHaveLength(2);
          const handSize = session.view.seats[1].handSize;
          const pass = decision.options.find((option) => option.text === 'Pass priority');
          expect(pass).toBeDefined();
          const advanced = await session.submit(pass!.id);
          if (!advanced.ok) throw new Error(advanced.error.message);
          session = advanced.session;
          expect(session.view.stack.some((card) => card.oid === creature.oid)).toBe(false);
          expect(session.view.seats[1].battlefield.find((card) => card.oid === creature.oid)).toMatchObject({
            name: 'Adorned Pouncer',
          });
          expect(session.view.seats[1].handSize).toBe(handSize);
          expect(session.view.seats[1].hand).toBeNull();
          resolved = true;
          break;
        }
        const move =
          decision.options.find((option) => option.text === 'Play Plains') ??
          decision.options.find((option) =>
            ['Play first', 'Keep this hand', 'Pass priority'].includes(option.text),
          );
        if (move === undefined) throw new Error(`Unexpected local decision: ${decision.kind}`);
        const advanced = await session.submit(move.id);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }
      expect(resolved, 'Native pilot must cast and resolve a creature within the fixture').toBe(true);
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
