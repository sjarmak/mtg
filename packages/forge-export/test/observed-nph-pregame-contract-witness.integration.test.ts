/** Bilateral real-Forge witnesses that the opening-hand reveal reaches the pregame-actions controller contract, on New Phyrexia's Chancellors. */
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
    content: { kind: 'printed', format: 'nph' },
    seats: [
      {
        name: 'Seat zero',
        controller: controllers[0],
        deck: { name: 'setup-zero', cards: [{ name: 'Island', count: 60 }] },
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
      'Glistener Elf',
      'Hovermyr',
      'Island',
      'Swamp',
      'Vapor Snag',
      'Chancellor of the Dross',
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

const DROSS = 'Chancellor of the Dross';
const isStop = (option: { readonly text: string }): boolean =>
  option.text === 'Choose none' || option.text === 'Done choosing';

function pregameTable(
  controllers: readonly ['local' | 'engine', 'local' | 'engine'],
  seed: string,
): SessionSpec {
  return {
    ...table(controllers, seed),
    maximumTurns: 6,
  };
}

const swamps = (count: number): string[] => Array.from({ length: count }, () => 'Swamp');
const islands = (count: number): string[] => Array.from({ length: count }, () => 'Island');

describe.skipIf(!required)('NPH pregame-actions contract witnesses', () => {
  it('asks the local seat which opening-hand Chancellor to reveal and applies the answer at its first upkeep', async () => {
    const running = await openScenario(pregameTable(['local', 'engine'], 'nph-dross-local-pregame-v1'), {
      schemaVersion: 1,
      active: 0,
      phase: 'OPENING_HAND',
      seats: [
        { life: 20, hand: [DROSS, ...swamps(6)], library: swamps(3), battlefield: [], graveyard: [] },
        { life: 20, hand: islands(6), library: islands(4), battlefield: [], graveyard: [] },
      ],
    });
    let session = running.session;
    let offered = false;
    let revealed = false;
    const trace: string[] = [];
    try {
      for (let index = 0; index < 200 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Chancellor decision');
        trace.push(`${decision.kind}: ${decision.prompt}`);
        let move: string | undefined;
        if (decision.kind === 'opening-hand-action') {
          expect(decision.seat).toBe(0);
          const reveal = decision.options.find((option) => !isStop(option) && option.text.includes(DROSS));
          offered ||= reveal !== undefined;
          move = revealed ? decision.options.find(isStop)?.id : reveal?.id;
          revealed ||= reveal !== undefined;
        } else if (session.view.turn.active === 0 && session.play?.turnStep === 'beginCombat') break;
        else move = routineMove(decision);
        if (move === undefined)
          throw new Error(`Unhandled Chancellor decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        session = advanced.session;
      }
      expect(offered, trace.join('\n')).toBe(true);
      // Revealed: at seat zero's first upkeep each opponent loses 3 life and it gains 3.
      expect([session.view.seats[0].life, session.view.seats[1].life], trace.join('\n')).toEqual([23, 17]);
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  }, 180_000);

  it('lets Forge answer an engine-seat Chancellor reveal itself without exposing the question', async () => {
    const running = await openScenario(pregameTable(['local', 'engine'], 'nph-dross-engine-pregame-v1'), {
      schemaVersion: 1,
      active: 0,
      phase: 'OPENING_HAND',
      seats: [
        { life: 20, hand: swamps(7), library: swamps(3), battlefield: [], graveyard: [] },
        { life: 20, hand: [DROSS, ...islands(6)], library: islands(4), battlefield: [], graveyard: [] },
      ],
    });
    let session = running.session;
    let asked = false;
    const trace: string[] = [];
    try {
      for (let index = 0; index < 200 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing engine Chancellor decision');
        trace.push(`${decision.kind}: ${decision.prompt}`);
        asked ||= decision.kind === 'opening-hand-action';
        if (session.view.turn.active === 1 && session.play?.turnStep === 'beginCombat') break;
        const move = routineMove(decision);
        if (move === undefined) throw new Error(`Unhandled local decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        session = advanced.session;
      }
      expect(asked, trace.join('\n')).toBe(false);
      // Forge's own AI revealed it: at its first upkeep the local seat lost 3 and Forge's gained 3.
      expect([session.view.seats[0].life, session.view.seats[1].life], trace.join('\n')).toEqual([17, 23]);
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  }, 180_000);
});
