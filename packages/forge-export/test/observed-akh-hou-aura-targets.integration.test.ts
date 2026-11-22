/** Exact ordinary Aura targeting for the two AKH/HOU sweep regressions. */
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
      name: 'Aura pilot',
      controller: 'local',
      deck: { name: 'setup', cards: [{ name: 'Island', count: 60 }] },
    },
    {
      name: 'Target pilot',
      controller: 'local',
      deck: { name: 'setup', cards: [{ name: 'Island', count: 60 }] },
    },
  ],
  seed: 'akh-hou-ordinary-aura-target-v1',
  maximumTurns: 3,
};

describe.skipIf(!required)('AKH/HOU ordinary Aura target contract', () => {
  it.each([
    {
      aura: 'Cartouche of Ambition',
      lands: ['Swamp', 'Swamp', 'Swamp'],
      targetSeat: 0,
      target: 'Grizzly Bears',
    },
    {
      aura: 'Unquenchable Thirst',
      lands: ['Island', 'Island'],
      targetSeat: 1,
      target: 'Hill Giant',
    },
  ] as const)(
    '$aura attaches to its exact legal creature',
    async ({ aura, lands, targetSeat, target }) => {
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
              hand: [aura],
              battlefield: [...lands, 'Grizzly Bears'],
              library: ['Forest', 'Plains'],
              graveyard: [],
            },
            {
              life: 20,
              hand: [],
              battlefield: ['Hill Giant'],
              library: ['Mountain', 'Plains'],
              graveyard: [],
            },
          ],
        },
        compiled ? { compiledBridgeClasses: compiled.classDirectory } : {},
      );
      if (backend === null) throw new Error('Installed Forge required');
      let session: ObservedSession | undefined;
      const trace: string[] = [];
      let cast = false;
      let targetOid: string | undefined;
      try {
        const opened = await backend.open(table);
        if (!opened.ok) throw new Error(opened.error.message);
        session = opened.session;
        targetOid = session.view.seats[targetSeat].battlefield.find((card) => card.name === target)?.oid;
        expect(targetOid).toMatch(/^forge-card-/u);
        for (let index = 0; index < 80 && session.status === 'awaiting'; index += 1) {
          const decision = session.decision;
          if (decision === null) throw new Error('Missing Forge decision');
          trace.push(`${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`);
          const attached = session.view.seats[0].battlefield.some((card) => card.name === aura);
          if (cast && attached && session.view.stack.length === 0) break;

          let move: string | undefined;
          if (decision.kind === 'priority') {
            const option = decision.options.find((entry) => entry.text.startsWith(`${aura}:`));
            move = !cast ? option?.id : decision.options.find((entry) => entry.text === 'Pass priority')?.id;
            cast ||= move !== undefined && move === option?.id;
          } else if (decision.kind === 'mana-payment') {
            move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
          } else if (decision.kind === 'target-selection') {
            expect(
              new Set(decision.options.flatMap((option) => option.targets.map((entry) => entry.oid))),
            ).toContain(targetOid);
            move = decision.options.find((option) =>
              option.targets.some((entry) => entry.oid === targetOid),
            )?.id;
          } else if (decision.kind === 'binary') {
            move = decision.options.find((option) => option.text === 'No')?.id;
          }
          if (move === undefined) throw new Error(`Unhandled Aura decision\n${trace.slice(-10).join('\n')}`);
          const advanced = await session.submit(move);
          if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-10).join('\n')}`);
          session = advanced.session;
        }
        const evidence = `${trace.join('\n')}\n${JSON.stringify(session.view)}`;
        expect(cast, evidence).toBe(true);
        expect(
          session.view.seats[0].battlefield.some((card) => card.name === aura),
          evidence,
        ).toBe(true);
        expect(
          session.view.seats[targetSeat].battlefield.some((card) => card.oid === targetOid),
          evidence,
        ).toBe(true);
      } finally {
        await session?.close();
        await backend.shutdown?.();
      }
    },
    180_000,
  );
});
