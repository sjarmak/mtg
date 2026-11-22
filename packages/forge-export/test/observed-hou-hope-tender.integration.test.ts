/** Hope Tender pays its exact exert activation and untaps two distinct lands. */
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
      name: 'Hope Tender pilot',
      controller: 'local',
      deck: { name: 'setup', cards: [{ name: 'Forest', count: 60 }] },
    },
    {
      name: 'Observer',
      controller: 'local',
      deck: { name: 'setup', cards: [{ name: 'Island', count: 60 }] },
    },
  ],
  seed: 'hou-hope-tender-double-untap-v1',
  maximumTurns: 6,
};

describe.skipIf(!required)('Hope Tender exert activation', () => {
  it('selects two distinct tapped lands and skips the Tender next untap', async () => {
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
            hand: [],
            battlefield: ['Hope Tender', 'Forest', 'Forest', 'Forest'],
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
    const trace: string[] = [];
    let activated = false;
    let activationTurn: number | undefined;
    const chosen = new Set<string>();
    try {
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      const tender = session.view.seats[0].battlefield.find((card) => card.name === 'Hope Tender');
      const lands = session.view.seats[0].battlefield.filter((card) => card.name === 'Forest');
      expect(tender).toBeDefined();
      expect(lands).toHaveLength(3);

      for (let index = 0; index < 180 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Hope Tender decision');
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`,
        );
        const currentTender = session.view.seats[0].battlefield.find((card) => card.oid === tender?.oid);
        if (
          activationTurn !== undefined &&
          session.view.turn.active === 0 &&
          session.view.turn.number === activationTurn + 2 &&
          session.view.turn.step === 'UPKEEP'
        ) {
          expect(currentTender?.tapped, trace.slice(-20).join('\n')).toBe(true);
          break;
        }

        let move: string | undefined;
        if (decision.kind === 'priority') {
          const untappedLand = session.view.seats[0].battlefield.find(
            (card) => lands.some((land) => land.oid === card.oid) && !card.tapped,
          );
          const mana =
            untappedLand === undefined
              ? undefined
              : decision.options.find(
                  (option) =>
                    option.text.startsWith('Activate Forest for') &&
                    option.targets.some((target) => target.oid === untappedLand.oid),
                );
          const activation = decision.options.find(
            (option) => option.text.startsWith('Hope Tender:') && option.text.includes('Untap two'),
          );
          const tappedLands = session.view.seats[0].battlefield.filter(
            (card) => lands.some((land) => land.oid === card.oid) && card.tapped,
          );
          if (!activated && tappedLands.length < 2) move = mana?.id;
          else if (!activated) {
            move = activation?.id;
            activated = move !== undefined;
            activationTurn = session.view.turn.number;
          } else move = decision.options.find((option) => option.text === 'Pass priority')?.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'target-selection') {
          const option = decision.options.find(
            (entry) =>
              entry.targets[0] !== undefined &&
              lands.some((land) => land.oid === entry.targets[0]?.oid) &&
              !chosen.has(entry.targets[0].oid),
          );
          const oid = option?.targets[0]?.oid;
          if (oid !== undefined) chosen.add(oid);
          move = option?.id;
        }
        if (move === undefined)
          throw new Error(`Unhandled Hope Tender decision\n${trace.slice(-20).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-20).join('\n')}`);
        session = advanced.session;
      }

      const evidence = `${trace.join('\n')}\n${JSON.stringify(session.view)}`;
      expect(activated, evidence).toBe(true);
      expect(chosen.size, evidence).toBe(2);
      for (const oid of chosen) {
        expect(session.view.seats[0].battlefield.find((card) => card.oid === oid)?.tapped, evidence).toBe(
          false,
        );
      }
    } finally {
      await session?.close();
      await backend.shutdown?.();
    }
  }, 180_000);
});
