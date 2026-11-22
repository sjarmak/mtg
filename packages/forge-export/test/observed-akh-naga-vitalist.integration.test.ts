/** Naga Vitalist is both a priority mana action and a legal fourth source for a spell. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { compileInstalledForgeBridge } from '../src/observed/installed';
import { snapshotForgeScenarioBackend } from './support/snapshot-backend';

const required = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1';
let compiled: ReturnType<typeof compileInstalledForgeBridge>;

beforeAll(() => {
  if (required && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
    compiled = compileInstalledForgeBridge();
});
afterAll(() => compiled?.dispose());

const table: SessionSpec = {
  content: { kind: 'printed', format: 'akh-hou' },
  seats: [
    {
      name: 'Vitalist pilot',
      controller: 'local',
      deck: { name: 'setup', cards: [{ name: 'Forest', count: 60 }] },
    },
    {
      name: 'Observer',
      controller: 'local',
      deck: { name: 'setup', cards: [{ name: 'Island', count: 60 }] },
    },
  ],
  seed: 'akh-naga-vitalist-mana-v1',
  maximumTurns: 2,
};

describe.skipIf(!required)('Naga Vitalist mana', () => {
  it('activates before casting and pays a four-mana spell with three lands', async () => {
    if (!compiled && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
      throw new Error('Installed Forge required');
    const backend = await snapshotForgeScenarioBackend(
      {
        schemaVersion: 1,
        active: 0,
        phase: 'MAIN1',
        seats: [
          {
            life: 20,
            hand: ['Quarry Hauler'],
            battlefield: ['Naga Vitalist', 'Forest', 'Forest', 'Forest'],
            library: ['Forest', 'Forest'],
            graveyard: [],
          },
          { life: 20, hand: [], battlefield: [], library: ['Island', 'Island'], graveyard: [] },
        ],
      },
      compiled ? { compiledBridgeClasses: compiled.classDirectory } : {},
    );
    if (backend === null) throw new Error('Installed Forge required');
    let session: ObservedSession | undefined;
    try {
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      const decision = session.decision;
      if (decision === null) throw new Error('Missing priority decision');
      const vitalist = session.view.seats[0].battlefield.find((card) => card.name === 'Naga Vitalist');
      expect(vitalist).toBeDefined();
      expect(decision.kind).toBe('priority');
      expect(
        session.play?.objectActions
          .filter((action) => action.oid === vitalist?.oid && action.category === 'mana')
          .map((action) => action.manaOutput),
      ).toEqual(['G']);
      const proactive = session.play?.objectActions.find(
        (action) => action.oid === vitalist?.oid && action.category === 'mana',
      );
      if (proactive === undefined) throw new Error('Missing Naga Vitalist mana action');
      const activated = await session.submit(proactive.move);
      if (!activated.ok) throw new Error(activated.error.message);
      session = activated.session;
      expect(session.view.seats[0].battlefield.find((card) => card.oid === vitalist?.oid)?.tapped).toBe(true);
      expect(session.play?.manaPools?.[0]).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 });

      const undo = session.play?.undo;
      if (undo === null || undo === undefined) throw new Error('Missing priority mana undo');
      const undone = await session.submit(undo);
      if (!undone.ok) throw new Error(undone.error.message);
      session = undone.session;
      expect(session.view.seats[0].battlefield.find((card) => card.oid === vitalist?.oid)?.tapped).toBe(
        false,
      );

      const spell = session.view.seats[0].hand?.find((card) => card.name === 'Quarry Hauler');
      const cast = session.play?.objectActions.find(
        (action) => action.oid === spell?.oid && action.category === 'cast',
      );
      if (cast === undefined) throw new Error('Missing Quarry Hauler cast action');
      const casting = await session.submit(cast.move);
      if (!casting.ok) throw new Error(casting.error.message);
      session = casting.session;

      for (let sources = 0; sources < 4; sources += 1) {
        expect(session.decision?.kind).toBe('mana-payment');
        const source = session.play?.objectActions.find(
          (action) =>
            action.category === 'mana' &&
            (sources === 0 ? action.oid === vitalist?.oid : action.oid !== vitalist?.oid),
        );
        if (source === undefined) throw new Error(`Missing mana payment source ${String(sources + 1)}`);
        const paid = await session.submit(source.move);
        if (!paid.ok) throw new Error(paid.error.message);
        session = paid.session;
      }

      expect(session.view.stack).toHaveLength(1);
      expect(session.view.stack[0]).toMatchObject({ name: 'Quarry Hauler' });
      expect(session.view.seats[0].battlefield.filter((card) => card.tapped)).toHaveLength(4);
    } finally {
      await session?.close();
      await backend.shutdown?.();
    }
  }, 60_000);
});
