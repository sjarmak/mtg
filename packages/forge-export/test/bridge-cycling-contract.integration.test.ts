/** Fixed-cost cycling reuses one state/action/outcome scenario across formats. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ObservedSession, SessionSpec, SubmitResult } from '@mtg/engine';
import { compileInstalledForgeBridge } from '../src/observed/installed';
import { snapshotForgeScenarioBackend } from './support/snapshot-backend';

const required = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1';
let compiled: ReturnType<typeof compileInstalledForgeBridge>;
beforeAll(() => {
  if (required && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
    compiled = compileInstalledForgeBridge();
});
afterAll(() => compiled?.dispose());

describe.skipIf(!required)('fixed-cost cycling contract', () => {
  it.each([
    { name: 'Censor', format: 'akh-hou', land: 'Island', cost: 1 },
    { name: 'Sweltering Suns', format: 'akh-hou', land: 'Mountain', cost: 3 },
    { name: 'Desert of the Indomitable', format: 'akh-hou', land: 'Forest', cost: 2 },
    { name: 'Miscalculation', format: 'legacy-cube-2021-08', land: 'Island', cost: 2 },
  ])(
    '$name: discard source, pay $cost, draw exactly one',
    async (fixture) => {
      if (!compiled && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
        throw new Error('Installed Forge required');
      const seat = { life: 20, library: ['Mountain', 'Island'], graveyard: [] };
      const backend = await snapshotForgeScenarioBackend(
        {
          schemaVersion: 1,
          active: 0,
          phase: 'MAIN1',
          seats: [
            { ...seat, hand: [fixture.name], battlefield: Array<string>(fixture.cost).fill(fixture.land) },
            { ...seat, hand: [], battlefield: [] },
          ],
        },
        compiled ? { compiledBridgeClasses: compiled.classDirectory } : {},
      );
      if (!backend) throw new Error('Installed Forge required');
      const table: SessionSpec = {
        content: { kind: 'printed', format: fixture.format },
        seats: [
          {
            name: 'Pilot',
            controller: 'local',
            deck: { name: 'setup', cards: [{ name: 'Island', count: 60 }] },
          },
          {
            name: 'Other',
            controller: 'local',
            deck: { name: 'setup', cards: [{ name: 'Island', count: 60 }] },
          },
        ],
        seed: 'cycling-contract-v1',
        maximumTurns: 2,
      };
      let session: ObservedSession | undefined;
      try {
        const opened = await backend.open(table);
        if (!opened.ok) throw new Error(opened.error.message);
        session = opened.session;
        const source = session.view.seats[0].hand![0]!.oid;
        const cycle = session.decision?.options.filter((o) => o.text.includes('Cycling'));
        expect(cycle).toHaveLength(1);
        let move = cycle![0]!.id;
        let stacked = false,
          resolved = false;
        for (let index = 0; index < 25; index++) {
          const advanced: SubmitResult<ObservedSession> = await session.submit(move);
          if (!advanced.ok) throw new Error(advanced.error.message);
          session = advanced.session;
          const own = session.view.seats[0];
          if (session.view.stack.some((c) => c.oid === source)) {
            expect(own.graveyard.some((c) => c.oid === source)).toBe(true);
            expect(own.handSize).toBe(0);
            expect(own.librarySize).toBe(2);
            stacked = true;
          }
          if (stacked && session.view.stack.length === 0) {
            expect(own.graveyard.map((c) => c.oid)).toEqual([source]);
            expect(own.hand?.map((c) => c.name)).toEqual(['Mountain']);
            expect(own.librarySize).toBe(1);
            expect(own.battlefield.filter((c) => c.tapped)).toHaveLength(fixture.cost);
            resolved = true;
            break;
          }
          const decision = session.decision;
          const selected =
            decision?.kind === 'mana-payment'
              ? decision.options.find((o) => o.id.startsWith('mana-source-'))
              : decision?.kind === 'priority'
                ? decision.options.find((o) => o.text === 'Pass priority')
                : undefined;
          if (!selected) throw new Error(`Unexpected cycling decision: ${decision?.kind}`);
          move = selected.id;
        }
        expect(resolved).toBe(true);
      } finally {
        await session?.close();
        await backend.shutdown?.();
      }
    },
    30_000,
  );
});
