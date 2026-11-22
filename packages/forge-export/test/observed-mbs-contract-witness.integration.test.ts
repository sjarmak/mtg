/** Bilateral real-Forge witnesses that Mirrodin Besieged scripts reach the reusable controller contracts. */
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

function routineMove(decision: Decision): string | undefined {
  if (decision.kind === 'mana-payment')
    return decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
  return decision.options.find(
    (option) =>
      option.text === 'Pass priority' ||
      option.text === 'Keep this hand' ||
      option.text === 'Play first' ||
      option.id === 'combat-attackers-commit' ||
      option.id === 'combat-blockers-commit',
  )?.id;
}

function table(controllers: readonly ['local' | 'engine', 'local' | 'engine'], seed: string): SessionSpec {
  return {
    content: { kind: 'printed', format: 'mbs' },
    seats: [
      {
        name: 'Seat zero',
        controller: controllers[0],
        deck: { name: 'setup-zero', cards: [{ name: 'Swamp', count: 60 }] },
      },
      {
        name: 'Seat one',
        controller: controllers[1],
        deck: { name: 'setup-one', cards: [{ name: 'Forest', count: 60 }] },
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
    diagnosticCardNames: [
      'Forest',
      'Go for the Throat',
      'Leonin Skyhunter',
      'Ogre Resister',
      'Plains',
      'Swamp',
    ],
  });
  if (backend === null) throw new Error('Installed Forge required');
  const opened = await backend.open(spec);
  if (!opened.ok) {
    await backend.shutdown?.();
    throw new Error(opened.error.message);
  }
  return { backend, session: opened.session };
}

describe.skipIf(!required)('MBS controller contract witnesses', () => {
  it('lets the local Go for the Throat caster choose and destroy the only legal creature', async () => {
    const running = await openScenario(table(['local', 'engine'], 'mbs-throat-local-contract-v1'), {
      schemaVersion: 1,
      active: 0,
      phase: 'MAIN1',
      seats: [
        {
          life: 20,
          hand: ['Go for the Throat'],
          battlefield: ['Swamp', 'Swamp'],
          library: ['Swamp'],
          graveyard: [],
        },
        { life: 20, hand: [], battlefield: ['Ogre Resister'], library: ['Forest'], graveyard: [] },
      ],
    });
    let session = running.session;
    let cast = false;
    let targeted = false;
    let stacked = false;
    const target = session.view.seats[1].battlefield[0]?.oid;
    const trace: string[] = [];
    try {
      for (let index = 0; index < 100 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Go for the Throat decision');
        stacked ||= session.view.stack.some((card) => card.name === 'Go for the Throat');
        if (stacked && session.view.stack.length === 0) break;
        trace.push(`${decision.kind}: ${decision.prompt}`);
        let move: string | undefined;
        if (decision.kind === 'priority') {
          move = !cast
            ? decision.options.find((option) => option.text.startsWith('Go for the Throat:'))?.id
            : decision.options.find((option) => option.text === 'Pass priority')?.id;
          cast ||= move !== undefined && move !== 'priority-pass';
        } else if (decision.kind === 'target-selection') {
          const legal = decision.options.filter((option) => option.targets.length > 0);
          expect(legal.map((option) => option.targets[0]?.oid)).toEqual([target]);
          move = legal[0]?.id;
          targeted = true;
        } else move = routineMove(decision);
        if (move === undefined) throw new Error(`Unhandled Throat decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        session = advanced.session;
      }
      expect(cast, trace.join('\n')).toBe(true);
      expect(targeted, trace.join('\n')).toBe(true);
      expect(stacked, trace.join('\n')).toBe(true);
      expect(session.view.seats[1].battlefield).toEqual([]);
      expect(session.view.seats[1].graveyard.map((card) => card.name)).toEqual(['Ogre Resister']);
      expect(session.view.seats[1].hand).toBeNull();
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  }, 180_000);

  it('lets Forge attack with Leonin Skyhunter while the local seat only answers its own decisions', async () => {
    const running = await openScenario(table(['local', 'engine'], 'mbs-skyhunter-engine-contract-v1'), {
      schemaVersion: 1,
      active: 1,
      phase: 'MAIN1',
      seats: [
        { life: 20, hand: [], battlefield: [], library: ['Swamp'], graveyard: [] },
        {
          life: 20,
          hand: [],
          battlefield: ['Leonin Skyhunter', 'Plains', 'Plains'],
          library: ['Forest'],
          graveyard: [],
        },
      ],
    });
    let session = running.session;
    let attacked = false;
    const trace: string[] = [];
    try {
      for (let index = 0; index < 120 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing engine Skyhunter decision');
        expect(decision.seat).toBe(0);
        attacked ||= session.view.seats[0].life < 20;
        if (attacked) break;
        trace.push(`${decision.kind}: ${decision.prompt}`);
        const move = routineMove(decision);
        if (move === undefined) throw new Error(`Unhandled local decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        session = advanced.session;
      }
      expect(attacked, trace.join('\n')).toBe(true);
      expect(session.view.seats[0].life).toBeLessThanOrEqual(19);
      expect(session.view.seats[1].hand).toBeNull();
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  }, 180_000);
});
