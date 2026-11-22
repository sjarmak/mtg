import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { compileInstalledForgeBridge } from '../../src/observed/installed';
import { snapshotForgeScenarioBackend } from './snapshot-backend';

interface PrintedContractFixture {
  readonly format: string;
  readonly title: string;
  readonly spell: string;
  readonly attacker: string;
  readonly mana: readonly string[];
}

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

function table(
  format: string,
  controllers: readonly ['local' | 'engine', 'local' | 'engine'],
  seed: string,
): SessionSpec {
  return {
    content: { kind: 'printed', format },
    seats: [
      {
        name: 'Seat zero',
        controller: controllers[0],
        deck: { name: 'setup-zero', cards: [{ name: 'Forest', count: 60 }] },
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

export function printedContractWitnesses(fixture: PrintedContractFixture): void {
  const required = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1';
  let compiled: ReturnType<typeof compileInstalledForgeBridge>;

  beforeAll(() => {
    if (required && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
      compiled = compileInstalledForgeBridge();
  });
  afterAll(() => compiled?.dispose());

  async function openScenario(spec: SessionSpec, state: Parameters<typeof snapshotForgeScenarioBackend>[0]) {
    if (!compiled && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
      throw new Error('Installed Forge required');
    const backend = await snapshotForgeScenarioBackend(state, {
      ...(compiled ? { compiledBridgeClasses: compiled.classDirectory } : {}),
      diagnosticCardNames: [fixture.spell, fixture.attacker, ...fixture.mana, 'Forest', 'Swamp'],
    });
    if (backend === null) throw new Error('Installed Forge required');
    const opened = await backend.open(spec);
    if (!opened.ok) {
      await backend.shutdown?.();
      throw new Error(opened.error.message);
    }
    return { backend, session: opened.session };
  }

  describe.skipIf(!required)(`${fixture.title} controller contract witnesses`, () => {
    it(`lets the local ${fixture.spell} caster choose and destroy the only legal creature`, async () => {
      const running = await openScenario(
        table(fixture.format, ['local', 'engine'], `${fixture.format}-${fixture.spell}-local-v1`),
        {
          schemaVersion: 1,
          active: 0,
          phase: 'MAIN1',
          seats: [
            {
              life: 20,
              hand: [fixture.spell],
              battlefield: [...fixture.mana],
              library: ['Forest'],
              graveyard: [],
            },
            {
              life: 20,
              hand: [],
              battlefield: [fixture.attacker],
              library: ['Forest'],
              graveyard: [],
            },
          ],
        },
      );
      let session = running.session;
      let cast = false;
      let targeted = false;
      let stacked = false;
      const target = session.view.seats[1].battlefield[0]?.oid;
      const trace: string[] = [];
      try {
        for (let index = 0; index < 100 && session.status === 'awaiting'; index += 1) {
          const decision = session.decision;
          if (decision === null) throw new Error(`Missing ${fixture.spell} decision`);
          stacked ||= session.view.stack.some((card) => card.name === fixture.spell);
          if (stacked && session.view.stack.length === 0) break;
          trace.push(`${decision.kind}: ${decision.prompt}`);
          let move: string | undefined;
          if (decision.kind === 'priority') {
            move = !cast
              ? decision.options.find((option) => option.text.startsWith(`${fixture.spell}:`))?.id
              : decision.options.find((option) => option.text === 'Pass priority')?.id;
            cast ||= move !== undefined && move !== 'priority-pass';
          } else if (decision.kind === 'target-selection') {
            const legal = decision.options.filter((option) => option.targets.length > 0);
            expect(legal.map((option) => option.targets[0]?.oid)).toEqual([target]);
            move = legal[0]?.id;
            targeted = true;
          } else move = routineMove(decision);
          if (move === undefined) throw new Error(`Unhandled decision\n${trace.slice(-8).join('\n')}`);
          const advanced = await session.submit(move);
          if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
          session = advanced.session;
        }
        expect(cast, trace.join('\n')).toBe(true);
        expect(targeted, trace.join('\n')).toBe(true);
        expect(stacked, trace.join('\n')).toBe(true);
        expect(session.view.seats[1].battlefield).toEqual([]);
        expect(session.view.seats[1].graveyard.map((card) => card.name)).toEqual([fixture.attacker]);
        expect(session.view.seats[1].hand).toBeNull();
      } finally {
        await session.close();
        await running.backend.shutdown?.();
      }
    }, 180_000);

    it(`lets Forge attack with ${fixture.attacker} while the local seat only answers its own decisions`, async () => {
      const running = await openScenario(
        table(fixture.format, ['local', 'engine'], `${fixture.format}-${fixture.attacker}-engine-v1`),
        {
          schemaVersion: 1,
          active: 1,
          phase: 'MAIN1',
          seats: [
            { life: 20, hand: [], battlefield: [], library: ['Swamp'], graveyard: [] },
            {
              life: 20,
              hand: [],
              battlefield: [fixture.attacker, 'Forest', 'Forest'],
              library: ['Forest'],
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
          if (decision === null) throw new Error(`Missing ${fixture.attacker} decision`);
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
        expect(session.view.seats[0].life).toBeLessThan(20);
        expect(session.view.seats[1].hand).toBeNull();
      } finally {
        await session.close();
        await running.backend.shutdown?.();
      }
    }, 180_000);
  });
}
