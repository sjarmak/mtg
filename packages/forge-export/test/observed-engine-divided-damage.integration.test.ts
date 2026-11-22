/** Reproduces Forge full-simulation failure on a divided-damage choice. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeScenarioBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

forgeIt(
  'keeps engine-controlled Electrolyze simulation allocations attached to their targets',
  async () => {
    const state = {
      schemaVersion: 1 as const,
      active: 1 as const,
      phase: 'MAIN1' as const,
      seats: [
        {
          life: 20,
          hand: [],
          battlefield: ['Llanowar Elves', 'Llanowar Elves', 'Llanowar Elves'],
          library: Array<string>(20).fill('Forest'),
          graveyard: [],
        },
        {
          life: 20,
          hand: ['Electrolyze'],
          battlefield: ['Volcanic Island', 'Volcanic Island', 'Volcanic Island'],
          library: Array<string>(20).fill('Island'),
          graveyard: [],
        },
      ] as const,
    };
    const backend = await snapshotForgeScenarioBackend(state, { timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    const table: SessionSpec = {
      content: { kind: 'printed', format: 'legacy-cube-2021-08' },
      seats: [
        {
          name: 'Local',
          controller: 'local',
          deck: { name: 'setup', cards: [{ name: 'Forest', count: 60 }] },
        },
        {
          name: 'Engine',
          controller: 'engine',
          deck: { name: 'setup', cards: [{ name: 'Island', count: 60 }] },
        },
      ],
      seed: 'engine-divided-damage-v1',
      maximumTurns: 2,
    };
    let session: ObservedSession | undefined;
    try {
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      expect(session.view.turn.active).toBe(1);
      expect(session.decision).toMatchObject({ kind: 'priority', seat: 0 });
      expect(session.view.stack).toContainEqual(expect.objectContaining({ name: 'Electrolyze' }));
      const pass = session.decision?.options.find((option) => option.text === 'Pass priority');
      if (pass === undefined) throw new Error('Missing pass-priority action');
      const resolved = await session.submit(pass.id);
      if (!resolved.ok) throw new Error(resolved.error.message);
      session = resolved.session;
      expect(session.view.stack).toEqual([]);
      expect(session.view.seats[1].graveyard).toContainEqual(
        expect.objectContaining({ name: 'Electrolyze' }),
      );
      expect(session.view.seats[0].battlefield.filter((card) => card.name === 'Llanowar Elves')).toHaveLength(
        1,
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
