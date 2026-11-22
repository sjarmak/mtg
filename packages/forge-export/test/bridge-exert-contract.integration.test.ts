/** Exact opportunity + real local controller. Bot strategy is a separate claim. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { compileInstalledForgeBridge } from '../src/observed/installed';
import { snapshotForgeScenarioBackend } from './support/snapshot-backend';
import { exertScenarios } from './support/exert-scenarios';

const required = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1';
let compiled: ReturnType<typeof compileInstalledForgeBridge>;
beforeAll(() => {
  if (required && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
    compiled = compileInstalledForgeBridge();
});
afterAll(() => compiled?.dispose());

describe.skipIf(!required)('single-source attack exert contract', () => {
  for (const fixture of exertScenarios) {
    it.each([false, true])(
      `${fixture.name}: exert=%s`,
      async (exert) => {
        if (!compiled && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
          throw new Error('Installed Forge required');
        const seat = { life: 40, hand: [], library: Array<string>(20).fill('Island'), graveyard: [] };
        const backend = await snapshotForgeScenarioBackend(
          {
            schemaVersion: 1,
            active: 0,
            phase: 'MAIN1',
            seats: [
              { ...seat, battlefield: [fixture.name, 'Adorned Pouncer'] },
              { ...seat, battlefield: ['Adorned Pouncer', 'Adorned Pouncer'] },
            ],
          },
          compiled ? { compiledBridgeClasses: compiled.classDirectory } : {},
        );
        if (!backend) throw new Error('Installed Forge required');
        const table: SessionSpec = {
          content: { kind: 'printed', format: fixture.format },
          seats: [
            {
              name: 'Pilot',
              controller: 'local',
              deck: { name: 'setup', cards: [{ name: 'Island', count: 60 }] },
            },
            {
              name: 'Defender',
              controller: 'local',
              deck: { name: 'setup', cards: [{ name: 'Island', count: 60 }] },
            },
          ],
          seed: 'exert-contract-v1',
          maximumTurns: 8,
        };
        let session: ObservedSession | undefined;
        const trace: string[] = [];
        try {
          const opened = await backend.open(table);
          if (!opened.ok) throw new Error(opened.error.message);
          session = opened.session;
          const source = session.view.seats[0].battlefield[0]!.oid;
          const reserve = session.view.seats[0].battlefield[1]!.oid;
          const target = session.view.seats[1].battlefield[0]!.oid;
          let exertTurn: number | undefined;
          let offered = false,
            resolved = false,
            skipped = false,
            recovered = false;
          let restrictionExpired = !fixture.preventsBlock;
          for (let index = 0; index < 240 && session.status === 'awaiting'; index++) {
            const decision = session.decision;
            if (!decision) throw new Error('Missing decision');
            trace.push(
              `${session.view.turn.number}/${session.view.turn.step}: ${decision.kind} ${decision.options.map((o) => o.id).join(',')}`,
            );
            const attacker = session.view.seats[0].battlefield.find((c) => c.oid === source);
            if (
              exertTurn !== undefined &&
              session.view.turn.active === 0 &&
              session.view.turn.step === 'UPKEEP'
            ) {
              if (session.view.turn.number === exertTurn + 2) {
                expect(attacker?.tapped).toBe(exert);
                expect(attacker?.power).toBe(fixture.power);
                expect(attacker?.toughness).toBe(fixture.toughness);
                skipped = true;
              }
              if (session.view.turn.number === exertTurn + 4) {
                expect(attacker?.tapped).toBe(false);
                recovered = true;
                break;
              }
            }
            let move: string | undefined;
            if (decision.kind === 'combat-attackers') {
              const attackWith =
                exertTurn === undefined
                  ? source
                  : fixture.preventsBlock && session.view.turn.number === exertTurn + 2
                    ? reserve
                    : undefined;
              if (decision.seat === 0 && attackWith !== undefined)
                move = decision.options.find(
                  (o) => o.id.startsWith('combat-attack-add-') && o.targets.some((t) => t.oid === attackWith),
                )?.id;
              move ??= 'combat-attackers-commit';
            } else if (decision.kind === 'combat-exert') {
              offered = true;
              const option = decision.options.find((o) => o.targets.some((t) => t.oid === source));
              if (exertTurn === undefined) {
                expect(option).toBeDefined();
                const submitted = session.submitted;
                expect(await session.submit('invented-exert')).toMatchObject({
                  ok: false,
                  error: { kind: 'unknown-move' },
                });
                expect(session.submitted).toBe(submitted);
                move = exert ? option?.id : 'combat-exert-done';
                exertTurn = session.view.turn.number;
              } else move = 'combat-exert-done';
            } else if (decision.kind === 'target-selection') {
              expect(exert && fixture.target).toBe(true);
              move = decision.options.find((o) => o.targets.some((t) => t.oid === target))?.id;
            } else if (decision.kind === 'combat-blockers') {
              if (
                fixture.preventsBlock &&
                exertTurn !== undefined &&
                session.view.turn.number === exertTurn + 2
              ) {
                expect(
                  decision.options.some(
                    (o) =>
                      o.targets.some((t) => t.oid === target) && o.targets.some((t) => t.oid === reserve),
                  ),
                ).toBe(true);
                restrictionExpired = true;
              }
              if (!resolved && exertTurn !== undefined && decision.seat === 1) {
                expect(attacker?.power).toBe(exert ? fixture.exertPower : fixture.power);
                expect(attacker?.toughness).toBe(exert ? fixture.exertToughness : fixture.toughness);
                if (exert && (fixture.name === 'Gust Walker' || fixture.name === 'Glorybringer')) {
                  expect(
                    decision.options.some(
                      (option) =>
                        option.id.startsWith('combat-block-add-') &&
                        option.targets.some((target) => target.oid === source),
                    ),
                  ).toBe(false);
                }
                if (fixture.preventsBlock) {
                  const canBlock = decision.options.some((o) => o.targets.some((t) => t.oid === target));
                  expect(canBlock).toBe(!exert);
                  expect(
                    decision.options.some((o) =>
                      o.targets.some((t) => t.name === 'Adorned Pouncer' && t.oid !== target),
                    ),
                  ).toBe(true);
                }
                expect(session.view.seats[1].graveyard.some((c) => c.oid === target)).toBe(
                  exert && fixture.killsTarget,
                );
                resolved = true;
              }
              move = 'combat-blockers-commit';
            } else if (decision.kind === 'priority') {
              if (
                !resolved &&
                !fixture.preventsBlock &&
                exertTurn !== undefined &&
                session.view.turn.step === 'COMBAT_DECLARE_BLOCKERS'
              ) {
                expect(attacker?.power).toBe(exert ? fixture.exertPower : fixture.power);
                expect(session.view.seats[1].graveyard.some((c) => c.oid === target)).toBe(
                  exert && fixture.killsTarget,
                );
                resolved = true;
              }
              move = decision.options.find((o) => o.text === 'Pass priority')?.id;
            }
            if (!move) throw new Error(`Unhandled scenario decision: ${decision.kind}`);
            const advanced = await session.submit(move);
            if (!advanced.ok) throw new Error(advanced.error.message);
            session = advanced.session;
          }
          expect({ offered, resolved, skipped, recovered, restrictionExpired }).toEqual({
            offered: true,
            resolved: true,
            skipped: true,
            recovered: true,
            restrictionExpired: true,
          });
        } catch (error) {
          throw new Error(`${String(error)}\n${trace.slice(-20).join('\n')}`, { cause: error });
        } finally {
          await session?.close();
          await backend.shutdown?.();
        }
      },
      45_000,
    );
  }
});
