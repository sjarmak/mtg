/** Card-specific exert semantics that generic controller contracts cannot prove. */
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

function table(sourceSeat: 0 | 1, controller: 'local' | 'engine', seed: string): SessionSpec {
  return {
    content: { kind: 'printed', format: 'akh-hou' },
    seats: [
      {
        name: 'Seat zero',
        controller: sourceSeat === 0 ? controller : 'local',
        deck: { name: 'setup-zero', cards: [{ name: 'Mountain', count: 60 }] },
      },
      {
        name: 'Seat one',
        controller: sourceSeat === 1 ? controller : 'local',
        deck: { name: 'setup-one', cards: [{ name: 'Island', count: 60 }] },
      },
    ],
    seed,
    maximumTurns: 3,
  };
}

async function openScenario(spec: SessionSpec, state: unknown) {
  if (!compiled && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
    throw new Error('Installed Forge required');
  const backend = await snapshotForgeScenarioBackend(
    state,
    compiled ? { compiledBridgeClasses: compiled.classDirectory } : {},
  );
  if (backend === null) throw new Error('Installed Forge required');
  const opened = await backend.open(spec);
  if (!opened.ok) {
    await backend.shutdown?.();
    throw new Error(opened.error.message);
  }
  return { backend, session: opened.session };
}

const controllers = [
  { controller: 'local' as const, sourceSeat: 0 as const },
  { controller: 'engine' as const, sourceSeat: 1 as const },
];

describe.skipIf(!required)('Ahn-Crop Crasher target cleanup', () => {
  it.each(controllers)(
    '$controller removes a departed target from the temporary blocking restriction',
    async ({ controller, sourceSeat }) => {
      const source = {
        life: 20,
        hand: [],
        library: Array<string>(20).fill('Mountain'),
        battlefield: ['Ahn-Crop Crasher', ...Array<string>(4).fill('Grizzly Bears')],
        graveyard: [],
      };
      const defender = {
        life: 20,
        hand: ['Unsummon'],
        library: Array<string>(20).fill('Island'),
        battlefield: ['Island', 'Sacred Cat'],
        graveyard: [],
      };
      const running = await openScenario(table(sourceSeat, controller, `crasher-cleanup-${controller}`), {
        schemaVersion: 1,
        active: sourceSeat,
        phase: 'MAIN1',
        seats: sourceSeat === 0 ? [source, defender] : [defender, source],
      });
      let session: ObservedSession = running.session;
      const defenderSeat = sourceSeat === 0 ? 1 : 0;
      const sourceOid = session.view.seats[sourceSeat].battlefield.find(
        (card) => card.name === 'Ahn-Crop Crasher',
      )?.oid;
      const targetOid = session.view.seats[defenderSeat].battlefield.find(
        (card) => card.name === 'Sacred Cat',
      )?.oid;
      let payoffTargeted = false;
      let bounceCast = false;
      let bounceTargeted = false;
      let cleaned = false;
      const trace: string[] = [];
      try {
        for (let index = 0; index < 160 && session.status === 'awaiting'; index += 1) {
          const decision = session.decision;
          if (decision === null) throw new Error('Missing Crasher cleanup decision');
          trace.push(
            `${session.view.turn.number}/${session.view.turn.step} ${decision.seat} ${decision.kind}`,
          );
          if (
            bounceTargeted &&
            session.view.stack.length === 0 &&
            session.view.seats[defenderSeat].hand?.some((card) => card.oid === targetOid)
          ) {
            cleaned = true;
            break;
          }
          if (
            controller === 'engine' &&
            decision.kind === 'priority' &&
            session.view.turn.active === sourceSeat &&
            session.view.turn.step === 'COMBAT_DECLARE_ATTACKERS'
          ) {
            payoffTargeted = true;
          }
          let move: string | undefined;
          if (decision.kind === 'combat-attackers') {
            move =
              decision.seat === sourceSeat
                ? decision.options.find(
                    (option) =>
                      option.id.startsWith('combat-attack-add-') &&
                      option.targets.some((target) => target.oid === sourceOid),
                  )?.id
                : undefined;
            move ??= 'combat-attackers-commit';
          } else if (decision.kind === 'combat-exert') {
            move = decision.options.find((option) =>
              option.targets.some((target) => target.oid === sourceOid),
            )?.id;
          } else if (decision.kind === 'target-selection') {
            const target = decision.options.find((option) =>
              option.targets.some((candidate) => candidate.oid === targetOid),
            );
            expect(target).toBeDefined();
            move = target?.id;
            if (decision.seat === sourceSeat && !payoffTargeted) payoffTargeted = true;
            else if (decision.seat === defenderSeat && bounceCast) bounceTargeted = true;
          } else if (decision.kind === 'priority') {
            if (decision.seat === defenderSeat && payoffTargeted && !bounceCast) {
              move = decision.options.find((option) => option.text.startsWith('Unsummon:'))?.id;
              bounceCast = move !== undefined;
            }
            move ??= decision.options.find((option) => option.text === 'Pass priority')?.id;
          } else if (decision.kind === 'mana-payment') {
            move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
          } else if (decision.kind === 'combat-blockers') {
            move = 'combat-blockers-commit';
          }
          if (move === undefined) throw new Error(`Unhandled cleanup decision\n${trace.join('\n')}`);
          const advanced = await session.submit(move);
          if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.join('\n')}`);
          session = advanced.session;
        }
        expect({ payoffTargeted, bounceCast, bounceTargeted, cleaned }, trace.join('\n')).toEqual({
          payoffTargeted: true,
          bounceCast: true,
          bounceTargeted: true,
          cleaned: true,
        });
      } finally {
        await session.close();
        await running.backend.shutdown?.();
      }
    },
    60_000,
  );
});

describe.skipIf(!required)('Glorybringer exact damage and targets', () => {
  it.each(controllers)(
    '$controller deals four only to the opposing non-Dragon target',
    async ({ controller, sourceSeat }) => {
      const source = {
        life: 20,
        hand: [],
        library: Array<string>(20).fill('Mountain'),
        battlefield: ['Glorybringer', 'Giant Spider', ...Array<string>(4).fill('Grizzly Bears')],
        graveyard: [],
      };
      const defender = {
        life: 20,
        hand: [],
        library: Array<string>(20).fill('Island'),
        battlefield: ['Colossapede', ...(controller === 'local' ? ['Glorybringer'] : [])],
        graveyard: [],
      };
      const running = await openScenario(table(sourceSeat, controller, `glorybringer-exact-${controller}`), {
        schemaVersion: 1,
        active: sourceSeat,
        phase: 'MAIN1',
        seats: sourceSeat === 0 ? [source, defender] : [defender, source],
      });
      let session: ObservedSession = running.session;
      const defenderSeat = sourceSeat === 0 ? 1 : 0;
      const sourceOid = session.view.seats[sourceSeat].battlefield.find(
        (card) => card.name === 'Glorybringer',
      )?.oid;
      const targetOid = session.view.seats[defenderSeat].battlefield.find(
        (card) => card.name === 'Colossapede',
      )?.oid;
      const dragonOid = session.view.seats[defenderSeat].battlefield.find(
        (card) => card.name === 'Glorybringer',
      )?.oid;
      let exactDamage = false;
      const trace: string[] = [];
      try {
        for (let index = 0; index < 120 && session.status === 'awaiting'; index += 1) {
          const decision = session.decision;
          if (decision === null) throw new Error('Missing Glorybringer decision');
          trace.push(
            `${session.view.turn.number}/${session.view.turn.step} ${decision.seat} ${decision.kind}`,
          );
          const target = session.view.seats[defenderSeat].battlefield.find((card) => card.oid === targetOid);
          if (target?.damage === 4) {
            if (dragonOid !== undefined) {
              expect(
                session.view.seats[defenderSeat].battlefield.find((card) => card.oid === dragonOid)?.damage,
              ).toBe(0);
            }
            expect(
              session.view.seats[sourceSeat].battlefield.find((card) => card.name === 'Giant Spider')?.damage,
            ).toBe(0);
            exactDamage = true;
            break;
          }
          let move: string | undefined;
          if (decision.kind === 'combat-attackers') {
            move = decision.options.find(
              (option) =>
                option.id.startsWith('combat-attack-add-') &&
                option.targets.some((candidate) => candidate.oid === sourceOid),
            )?.id;
            move ??= 'combat-attackers-commit';
          } else if (decision.kind === 'combat-exert') {
            move = decision.options.find((option) =>
              option.targets.some((target) => target.oid === sourceOid),
            )?.id;
          } else if (decision.kind === 'target-selection') {
            const candidates = decision.options.flatMap((option) =>
              option.targets.map((target) => target.oid),
            );
            expect(candidates).toContain(targetOid);
            expect(
              candidates.some((oid) =>
                session.view.seats[defenderSeat].battlefield.some(
                  (card) => card.oid === oid && card.name === 'Glorybringer',
                ),
              ),
            ).toBe(false);
            expect(
              candidates.some((oid) =>
                session.view.seats[sourceSeat].battlefield.some((card) => card.oid === oid),
              ),
            ).toBe(false);
            move = decision.options.find((option) =>
              option.targets.some((target) => target.oid === targetOid),
            )?.id;
          } else if (decision.kind === 'priority') {
            move = decision.options.find((option) => option.text === 'Pass priority')?.id;
          } else if (decision.kind === 'combat-blockers') {
            move = 'combat-blockers-commit';
          }
          if (move === undefined) throw new Error(`Unhandled exact-damage decision\n${trace.join('\n')}`);
          const advanced = await session.submit(move);
          if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.join('\n')}`);
          session = advanced.session;
        }
        expect(exactDamage, trace.join('\n')).toBe(true);
      } finally {
        await session.close();
        await running.backend.shutdown?.();
      }
    },
    60_000,
  );
});
