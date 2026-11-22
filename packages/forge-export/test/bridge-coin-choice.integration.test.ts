import { expect, it } from 'vitest';
import type { SessionSpec } from '@mtg/engine';
import { compileInstalledForgeBridge } from '@mtg/forge-export';
import { strongestForgeObservedPolicy } from '../src/observed/policy';
import { forgePolicyView } from '../src/observed/policy-observation';
import { snapshotForgeScenarioBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

forgeIt(
  'calls a coin through the strongest observed policy in a real Creepy Doll combat',
  async () => {
    const compiled = compileInstalledForgeBridge();
    if (compiled === null) throw new Error('Required installed Forge is absent');
    const delegate = await snapshotForgeScenarioBackend(
      {
        schemaVersion: 1,
        active: 0,
        phase: 'MAIN1',
        seats: [
          {
            life: 20,
            hand: [],
            battlefield: ['Creepy Doll'],
            library: ['Mountain'],
            graveyard: [],
          },
          {
            life: 20,
            hand: [],
            battlefield: ['Darkthicket Wolf'],
            library: ['Forest'],
            graveyard: [],
          },
        ],
      },
      {
        compiledBridgeClasses: compiled.classDirectory,
        diagnosticCardNames: ['Creepy Doll', 'Darkthicket Wolf', 'Forest', 'Mountain'],
      },
    );
    if (delegate === null) throw new Error('Required installed Forge is absent');
    const table: SessionSpec = {
      content: { kind: 'printed', format: 'isd' },
      seats: [
        {
          name: 'Strongest observed pilot',
          controller: 'local',
          deck: { name: 'coin-pilot', cards: [{ name: 'Mountain', count: 60 }] },
        },
        {
          name: 'Local witness',
          controller: 'local',
          deck: { name: 'coin-witness', cards: [{ name: 'Forest', count: 60 }] },
        },
      ],
      seed: 'coin-choice-strongest-v1',
      maximumTurns: 3,
    };
    let session;
    try {
      const opened = await delegate.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      let recordedCoinMove: string | null = null;
      for (let index = 0; index < 80 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Creepy Doll decision');
        const choice = strongestForgeObservedPolicy.choose({
          seat: decision.seat,
          view: forgePolicyView(session.view, decision.seat),
          decision,
          play: session.play,
        });
        if (choice.status !== 'chosen') {
          throw new Error(`Strongest policy rejected ${decision.kind}: ${choice.reason}`);
        }
        if (decision.kind === 'coin-choice') recordedCoinMove = choice.move;
        const advanced = await session.submit(choice.move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        if (recordedCoinMove !== null) break;
      }
      expect(recordedCoinMove).toBe('coin-choice-heads');
    } finally {
      await session?.close();
      await delegate.shutdown?.();
      compiled.dispose();
    }
  },
  180_000,
);
