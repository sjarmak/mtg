/** Bilateral proof that the AKH creatures with Haste can attack immediately after resolving. */
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

const cases = [
  { name: 'Ahn-Crop Crasher', controller: 'local' as const, sourceSeat: 0 as const },
  { name: 'Ahn-Crop Crasher', controller: 'engine' as const, sourceSeat: 1 as const },
  { name: 'Glorybringer', controller: 'local' as const, sourceSeat: 0 as const },
  { name: 'Glorybringer', controller: 'engine' as const, sourceSeat: 1 as const },
];

function table(sourceSeat: 0 | 1, controller: 'local' | 'engine', seed: string): SessionSpec {
  const otherController = sourceSeat === 0 ? 'engine' : 'local';
  return {
    content: { kind: 'printed', format: 'akh-hou' },
    seats: [
      {
        name: 'Seat zero',
        controller: sourceSeat === 0 ? controller : otherController,
        deck: { name: 'setup-zero', cards: [{ name: 'Mountain', count: 60 }] },
      },
      {
        name: 'Seat one',
        controller: sourceSeat === 1 ? controller : otherController,
        deck: { name: 'setup-one', cards: [{ name: 'Mountain', count: 60 }] },
      },
    ],
    seed,
    maximumTurns: 2,
  };
}

describe.skipIf(!required)('AKH/HOU haste scenarios', () => {
  it.each(cases)(
    '$name $controller can attack on the turn it resolves',
    async ({ name, controller, sourceSeat }) => {
      if (!compiled && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
        throw new Error('Installed Forge required');
      const emptySeat = {
        life: 20,
        hand: [] as string[],
        library: Array<string>(20).fill('Mountain'),
        battlefield: [] as string[],
        graveyard: [] as string[],
      };
      const sourceState = {
        ...emptySeat,
        hand: [name],
        battlefield: Array<string>(5).fill('Mountain'),
      };
      const state = {
        schemaVersion: 1 as const,
        active: sourceSeat,
        phase: 'MAIN1' as const,
        seats: sourceSeat === 0 ? [sourceState, emptySeat] : [emptySeat, sourceState],
      } as const;
      const backend = await snapshotForgeScenarioBackend(
        state,
        compiled ? { compiledBridgeClasses: compiled.classDirectory } : {},
      );
      if (backend === null) throw new Error('Installed Forge required');
      let session: ObservedSession | undefined;
      const trace: string[] = [];
      let cast = false;
      let attacked = false;
      try {
        const opened = await backend.open(table(sourceSeat, controller, `haste-${name}-${controller}`));
        if (!opened.ok) throw new Error(opened.error.message);
        session = opened.session;
        const scenarioTurn = session.view.turn.number;
        for (let index = 0; index < 120 && session.status === 'awaiting'; index += 1) {
          const decision = session.decision;
          if (decision === null) throw new Error('Missing haste decision');
          const source = session.view.seats[sourceSeat].battlefield.find((card) => card.name === name);
          cast ||= source !== undefined || session.view.stack.some((card) => card.name === name);
          if (source?.attacking) {
            expect(session.view.turn.number).toBe(scenarioTurn);
            attacked = true;
            break;
          }
          trace.push(`${session.view.turn.number}/${session.view.turn.step} ${decision.kind}`);
          let move: string | undefined;
          if (decision.kind === 'priority') {
            move =
              (controller === 'local' && !cast
                ? decision.options.find((option) => option.text.startsWith(`${name}:`))?.id
                : undefined) ?? decision.options.find((option) => option.text === 'Pass priority')?.id;
          } else if (decision.kind === 'mana-payment') {
            move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
          } else if (decision.kind === 'combat-attackers') {
            const attack = decision.options.find(
              (option) =>
                option.id.startsWith('combat-attack-add-') &&
                option.targets.some((target) => target.oid === source?.oid),
            );
            if (controller === 'local' && attack !== undefined) {
              expect(session.view.turn.number).toBe(scenarioTurn);
              move = attack.id;
            } else move = 'combat-attackers-commit';
          } else if (decision.kind === 'combat-exert') {
            move = 'combat-exert-done';
          } else if (decision.kind === 'combat-blockers') {
            move = 'combat-blockers-commit';
          }
          if (move === undefined) throw new Error(`Unhandled haste decision\n${trace.join('\n')}`);
          const advanced = await session.submit(move);
          if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.join('\n')}`);
          session = advanced.session;
        }
        expect({ cast, attacked }, trace.join('\n')).toEqual({ cast: true, attacked: true });
      } finally {
        await session?.close();
        await backend.shutdown?.();
      }
    },
    60_000,
  );
});
