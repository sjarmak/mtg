/** Bontu's activation pays with one other creature and resolves its complete chain. */
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
      name: 'Bontu pilot',
      controller: 'local',
      deck: { name: 'setup', cards: [{ name: 'Swamp', count: 60 }] },
    },
    {
      name: 'Observer',
      controller: 'local',
      deck: { name: 'setup', cards: [{ name: 'Island', count: 60 }] },
    },
  ],
  seed: 'akh-bontu-sacrifice-v1',
  maximumTurns: 3,
};

describe.skipIf(!required)('Bontu activation', () => {
  it('sacrifices the selected other creature, scries, drains, and gains life', async () => {
    if (!compiled && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
      throw new Error('Installed Forge required');
    const backend = await snapshotForgeScenarioBackend(
      {
        schemaVersion: 1,
        active: 0,
        phase: 'MAIN1',
        seats: [
          {
            life: 19,
            hand: [],
            battlefield: ['Bontu the Glorified', 'Grizzly Bears', 'Swamp', 'Swamp'],
            library: ['Forest', 'Plains'],
            graveyard: [],
          },
          { life: 20, hand: [], battlefield: [], library: ['Island'], graveyard: [] },
        ],
      },
      compiled ? { compiledBridgeClasses: compiled.classDirectory } : {},
    );
    if (backend === null) throw new Error('Installed Forge required');
    let session: ObservedSession | undefined;
    let activated = false;
    let sacrificed: string | undefined;
    let scried = false;
    const trace: string[] = [];
    try {
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      const bear = session.view.seats[0].battlefield.find((card) => card.name === 'Grizzly Bears');
      expect(bear).toBeDefined();
      for (let index = 0; index < 80 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Bontu decision');
        trace.push(`${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`);
        if (
          scried &&
          session.view.stack.length === 0 &&
          session.view.seats[0].life === 20 &&
          session.view.seats[1].life === 19
        )
          break;
        let move: string | undefined;
        if (decision.kind === 'priority') {
          const option = decision.options.find(
            (entry) => entry.text.startsWith('Bontu the Glorified:') && entry.text.includes('Scry 1'),
          );
          move = !activated
            ? option?.id
            : decision.options.find((entry) => entry.text === 'Pass priority')?.id;
          activated ||= move !== undefined && move === option?.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'cost-sacrifice-selection') {
          expect(decision.options.some((option) => option.targets[0]?.name === 'Bontu the Glorified')).toBe(
            false,
          );
          const option = decision.options.find((entry) => entry.targets[0]?.oid === bear?.oid);
          sacrificed = option?.targets[0]?.oid;
          move = option?.id;
        } else if (decision.kind === 'scry-move') {
          move = decision.options.find((option) => option.id === 'scry-move-done')?.id;
          scried = move !== undefined;
        } else if (decision.kind === 'scry-keep') {
          move = decision.options[0]?.id;
          scried = true;
        }
        if (move === undefined) throw new Error(`Unhandled Bontu decision\n${trace.slice(-10).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-10).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.join('\n')}\n${JSON.stringify(session.view)}`;
      expect(activated, evidence).toBe(true);
      expect(scried, evidence).toBe(true);
      expect(sacrificed, evidence).toBe(bear?.oid);
      expect(
        session.view.seats[0].graveyard.some((card) => card.oid === sacrificed),
        evidence,
      ).toBe(true);
      expect(
        session.view.seats.map((seat) => seat.life),
        evidence,
      ).toEqual([20, 19]);
    } finally {
      await session?.close();
      await backend.shutdown?.();
    }
  }, 180_000);
});
