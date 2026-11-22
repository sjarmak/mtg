/** Real-Forge evidence for Morph: the face-down cast is offered, resolves, and can be turned face up. Not a qualification probe. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessionSpec } from '@mtg/engine';
import { compileInstalledForgeBridge } from '../src/observed/installed';
import { snapshotForgeScenarioBackend } from './support/snapshot-backend';

const required = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1';
let compiled: ReturnType<typeof compileInstalledForgeBridge>;

beforeAll(() => {
  if (required && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
    compiled = compileInstalledForgeBridge();
});
afterAll(() => compiled?.dispose());

function table(controllers: readonly ['local' | 'engine', 'local' | 'engine'], seed: string): SessionSpec {
  return {
    content: { kind: 'printed', format: 'ktk' },
    seats: [
      {
        name: 'Seat zero',
        controller: controllers[0],
        deck: { name: 'setup-zero', cards: [{ name: 'Mountain', count: 60 }] },
      },
      {
        name: 'Seat one',
        controller: controllers[1],
        deck: { name: 'setup-one', cards: [{ name: 'Swamp', count: 60 }] },
      },
    ],
    seed,
    maximumTurns: 3,
  };
}

async function openScenario(spec: SessionSpec, state: Parameters<typeof snapshotForgeScenarioBackend>[0]) {
  if (!compiled && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
    throw new Error('Installed Forge required');
  const backend = await snapshotForgeScenarioBackend(state, {
    ...(compiled ? { compiledBridgeClasses: compiled.classDirectory } : {}),
    diagnosticCardNames: ['Canyon Lurkers', 'Mountain', 'Swamp'],
  });
  if (backend === null) throw new Error('Installed Forge required');
  const opened = await backend.open(spec);
  if (!opened.ok) {
    await backend.shutdown?.();
    throw new Error(opened.error.message);
  }
  return { backend, session: opened.session };
}

describe.skipIf(!required)('KTK morph', () => {
  it('casts Canyon Lurkers face down for three, then turns it face up for its morph cost', async () => {
    const running = await openScenario(table(['local', 'engine'], 'ktk-morph-local-v1'), {
      schemaVersion: 1,
      active: 0,
      phase: 'MAIN1',
      seats: [
        {
          life: 20,
          hand: ['Canyon Lurkers'],
          battlefield: Array.from({ length: 7 }, () => 'Mountain'),
          library: ['Mountain'],
          graveyard: [],
        },
        { life: 20, hand: [], battlefield: [], library: ['Swamp'], graveyard: [] },
      ],
    });
    let session = running.session;
    const trace: string[] = [];
    let step: 'cast' | 'unmorph' | 'done' = 'cast';
    let cast = false;
    let castPayments = 0;
    let unmorphPayments = 0;
    try {
      for (let index = 0; index < 60 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing morph decision');
        const face = session.view.seats[0].battlefield.find((card) => card.typeLine.startsWith('Creature'));
        let move: string | undefined;
        if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
          if (step === 'cast') castPayments += 1;
          else unmorphPayments += 1;
        } else if (decision.kind === 'priority' && step === 'cast' && !cast) {
          cast = true;
          move = decision.options.find((option) => option.text.includes('face down'))?.id;
        } else if (decision.kind === 'priority' && face !== undefined && step === 'cast') {
          // The face-down permanent is a nameless colorless 2/2 to its own controller's projection.
          expect(face).toMatchObject({ name: '', power: 2, toughness: 2, characteristics: { colors: [] } });
          const turnUp = decision.options.find((option) => option.text.includes('Morph {3}{R}'));
          expect(turnUp, trace.join('\n')).toBeDefined();
          step = 'unmorph';
          move = turnUp?.id;
        } else if (decision.kind === 'priority' && step === 'unmorph' && unmorphPayments === 4) {
          expect(face).toMatchObject({ name: 'Canyon Lurkers', power: 5, toughness: 2 });
          step = 'done';
          break;
        } else move = decision.options.find((option) => option.text === 'Pass priority')?.id;
        trace.push(`${decision.kind}: ${decision.prompt} -> ${move}`);
        if (move === undefined) throw new Error(`Unhandled morph decision\n${trace.join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.join('\n')}`);
        session = advanced.session;
      }
      expect(step, trace.join('\n')).toBe('done');
      expect(castPayments).toBe(3);
      expect(unmorphPayments).toBe(4);
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  }, 180_000);
});
