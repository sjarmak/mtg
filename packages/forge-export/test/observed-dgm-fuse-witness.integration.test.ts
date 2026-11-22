/** Real-Forge witness that Dragon's Maze's fuse reaches the controller contracts: the fused half-pair is offered and cast from hand. */
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

type Decision = NonNullable<ObservedSession['decision']>;

function describeDecision(decision: Decision): string {
  return `${decision.kind}: ${decision.prompt} [${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}]`;
}

const table: SessionSpec = {
  content: { kind: 'printed', format: 'dgm' },
  seats: [
    {
      name: 'Seat zero',
      controller: 'local',
      deck: { name: 'setup-zero', cards: [{ name: 'Forest', count: 60 }] },
    },
    {
      name: 'Seat one',
      controller: 'engine',
      deck: { name: 'setup-one', cards: [{ name: 'Plains', count: 60 }] },
    },
  ],
  seed: 'dgm-alive-well-fuse-local-contract-v1',
  maximumTurns: 3,
};

describe.skipIf(!required)('DGM fuse witness', () => {
  it('offers the fused Alive // Well from hand and resolves both halves', async () => {
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
            hand: ['Alive // Well'],
            battlefield: ['Forest', 'Forest', 'Forest', 'Forest', 'Plains'],
            library: ['Forest', 'Forest', 'Forest', 'Forest'],
            graveyard: [],
          },
          { life: 20, hand: [], battlefield: [], library: ['Plains', 'Plains', 'Plains'], graveyard: [] },
        ],
      },
      {
        ...(compiled ? { compiledBridgeClasses: compiled.classDirectory } : {}),
        diagnosticCardNames: ['Forest', 'Plains', 'Alive // Well', 'Alive', 'Well'],
      },
    );
    if (backend === null) throw new Error('Installed Forge required');
    const opened = await backend.open(table);
    if (!opened.ok) {
      await backend.shutdown?.();
      throw new Error(opened.error.message);
    }
    let session = opened.session;
    const trace: string[] = [];
    let fusedOffered = false;
    let cast = false;
    let resolved = false;
    try {
      for (let index = 0; index < 60 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing fuse decision');
        trace.push(describeDecision(decision));
        let move: string | undefined;
        if (decision.kind === 'priority') {
          const fused = decision.options.find((option) => option.text.startsWith('Alive // Well: Fuse'));
          fusedOffered ||= fused !== undefined;
          move = fused?.id ?? decision.options.find((option) => option.text === 'Pass priority')?.id;
          cast ||= fused !== undefined;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'entity-selection' || decision.kind === 'confirm-action') {
          move = decision.options[0]?.id;
        }
        if (move === undefined) throw new Error(`Unhandled fuse decision\n${trace.join('\n')}`);
        trace.push(`  -> ${move}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.join('\n')}`);
        session = advanced.session;
        if (cast && session.view.seats[0].battlefield.some((card) => card.name.startsWith('Centaur'))) {
          resolved = true;
          break;
        }
      }
      expect(fusedOffered, trace.join('\n')).toBe(true);
      expect(cast, trace.join('\n')).toBe(true);
      expect(resolved, trace.join('\n')).toBe(true);
      expect(session.view.seats[0].life, trace.join('\n')).toBe(22);
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  }, 180_000);
});
