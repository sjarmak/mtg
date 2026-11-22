/** Installed-Forge proof for typecycling's cloned source-discard payment. */
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

describe.skipIf(!required)('typecycling source-discard contract', () => {
  it('discards Timeless Dragon and finds a Plains card', async () => {
    if (!compiled && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
      throw new Error('Installed Forge required');
    const seat = { life: 20, graveyard: [] as string[] };
    const backend = await snapshotForgeScenarioBackend(
      {
        schemaVersion: 1,
        active: 0,
        phase: 'MAIN1',
        seats: [
          {
            ...seat,
            hand: ['Timeless Dragon'],
            library: ['Plains', 'Mountain'],
            battlefield: ['Plains', 'Plains'],
          },
          { ...seat, hand: [], library: ['Island'], battlefield: [] },
        ],
      },
      compiled ? { compiledBridgeClasses: compiled.classDirectory } : {},
    );
    if (!backend) throw new Error('Installed Forge required');
    const table: SessionSpec = {
      content: { kind: 'printed', format: 'legacy-cube-2021-08' },
      seats: [
        {
          name: 'Pilot',
          controller: 'local',
          deck: { name: 'setup', cards: [{ name: 'Plains', count: 60 }] },
        },
        {
          name: 'Other',
          controller: 'local',
          deck: { name: 'setup', cards: [{ name: 'Island', count: 60 }] },
        },
      ],
      seed: 'plainscycling-contract-v1',
      maximumTurns: 2,
    };
    let sessionToClose: ObservedSession | undefined;
    try {
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      let currentSession: ObservedSession = opened.session;
      sessionToClose = currentSession;
      const source = currentSession.view.seats[0].hand![0]!.oid;
      let move = currentSession.decision?.options.find((option) => option.text.includes('Plainscycling'))?.id;
      expect(move).toBeDefined();
      for (let index = 0; index < 30; index += 1) {
        const advanced = await currentSession.submit(move!);
        if (!advanced.ok) throw new Error(advanced.error.message);
        currentSession = advanced.session;
        sessionToClose = currentSession;
        const own = currentSession.view.seats[0];
        if (
          own.graveyard.some((card) => card.oid === source) &&
          own.hand?.some((card) => card.name === 'Plains') &&
          own.librarySize === 1 &&
          currentSession.view.stack.length === 0
        ) {
          expect(own.battlefield.filter((card) => card.tapped)).toHaveLength(2);
          return;
        }
        const decision = currentSession.decision;
        move =
          (decision?.kind === 'mana-payment'
            ? decision.options.find((option) => option.id.startsWith('mana-source-'))?.id
            : undefined) ??
          decision?.options.find((option) => option.targets.some((target) => target.name === 'Plains'))?.id ??
          decision?.options.find((option) => option.text === 'Pass priority')?.id;
        if (move === undefined) throw new Error(`Unexpected Plainscycling decision: ${decision?.kind}`);
      }
      throw new Error('Timeless Dragon Plainscycling did not resolve');
    } finally {
      await sessionToClose?.close();
      await backend.shutdown?.();
    }
  }, 30_000);
});
