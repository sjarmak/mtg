/** Bilateral real-Forge witnesses that Avacyn Restored scripts reach the reusable controller contracts. */
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
    content: { kind: 'printed', format: 'avr' },
    seats: [
      {
        name: 'Seat zero',
        controller: controllers[0],
        deck: { name: 'setup-zero', cards: [{ name: 'Swamp', count: 60 }] },
      },
      {
        name: 'Seat one',
        controller: controllers[1],
        deck: { name: 'setup-one', cards: [{ name: 'Plains', count: 60 }] },
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
    diagnosticCardNames: ['Plains', 'Swamp', 'Silverblade Paladin', 'Thraben Valiant', 'Scrapskin Drake'],
  });
  if (backend === null) throw new Error('Installed Forge required');
  const opened = await backend.open(spec);
  if (!opened.ok) {
    await backend.shutdown?.();
    throw new Error(opened.error.message);
  }
  return { backend, session: opened.session };
}

describe.skipIf(!required)('AVR controller contract witnesses', () => {
  it('lets the local Silverblade Paladin caster pair it with the only unpaired creature', async () => {
    const running = await openScenario(
      table(['local', 'engine'], 'avr-silverblade-soulbond-local-contract-v1'),
      {
        schemaVersion: 1,
        active: 0,
        phase: 'MAIN1',
        seats: [
          {
            life: 20,
            hand: ['Silverblade Paladin'],
            battlefield: ['Plains', 'Plains', 'Plains', 'Thraben Valiant'],
            library: ['Swamp'],
            graveyard: [],
          },
          { life: 20, hand: [], battlefield: [], library: ['Plains'], graveyard: [] },
        ],
      },
    );
    let session = running.session;
    let cast = false;
    let chosen = false;
    const trace: string[] = [];
    try {
      for (let index = 0; index < 100 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Silverblade Paladin decision');
        trace.push(
          `${decision.kind}: ${decision.prompt} [${decision.options.map((o) => o.text).join(' | ')}]`,
        );
        let move: string | undefined;
        if (decision.kind === 'priority') {
          move = !cast
            ? decision.options.find((option) => option.text.startsWith('Silverblade Paladin:'))?.id
            : decision.options.find((option) => option.text === 'Pass priority')?.id;
          cast ||= move !== undefined && move !== 'priority-pass';
        } else if (decision.kind === 'entity-selection' && !chosen) {
          const partner = session.view.seats[0].battlefield.find((card) => card.name === 'Thraben Valiant');
          expect(
            decision.options.map((option) => option.targets[0]?.oid),
            trace.join('\n'),
          ).toEqual([partner?.oid, undefined]);
          move = decision.options.find((option) => option.targets[0]?.oid === partner?.oid)?.id;
          chosen = true;
        } else move = routineMove(decision);
        if (move === undefined)
          throw new Error(`Unhandled Silverblade Paladin decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        session = advanced.session;
      }
      expect(cast, trace.join('\n')).toBe(true);
      expect(chosen, trace.join('\n')).toBe(true);
      // The accepted answer is the pairing itself: each creature names the other in the projected view
      // (`ObjectView.pairedWith`, `bridge-observed-pairing.integration.test.ts` asserts it clears again).
      const paladin = session.view.seats[0].battlefield.find((card) => card.name === 'Silverblade Paladin');
      const valiant = session.view.seats[0].battlefield.find((card) => card.name === 'Thraben Valiant');
      expect(paladin?.pairedWith, trace.join('\n')).toBe(valiant?.oid);
      expect(valiant?.pairedWith, trace.join('\n')).toBe(paladin?.oid);
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  }, 180_000);

  it('lets Forge attack with Scrapskin Drake while the local seat only answers its own decisions', async () => {
    const running = await openScenario(
      table(['local', 'engine'], 'dka-voiceless-spirit-engine-contract-v1'),
      {
        schemaVersion: 1,
        active: 1,
        phase: 'MAIN1',
        seats: [
          { life: 20, hand: [], battlefield: [], library: ['Swamp'], graveyard: [] },
          {
            life: 20,
            hand: [],
            battlefield: ['Scrapskin Drake'],
            library: ['Plains'],
            graveyard: [],
          },
        ],
      },
    );
    let session = running.session;
    let attacked = false;
    const trace: string[] = [];
    try {
      for (let index = 0; index < 120 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing engine Scrapskin Drake decision');
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
      expect(session.view.seats[0].life).toBeLessThanOrEqual(18);
      expect(session.view.seats[1].hand).toBeNull();
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  }, 180_000);
});
