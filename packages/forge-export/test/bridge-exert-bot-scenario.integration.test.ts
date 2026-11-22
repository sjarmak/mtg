/** Native AI receives a fixed opportunity; only the opposing local seat is driven. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ObservedSession, SessionSpec, SubmitResult } from '@mtg/engine';
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

describe.skipIf(!required)('native bot exert opportunities', () => {
  it.each(exertScenarios)(
    '$name: native choice, payoff and skipped untap',
    async (fixture) => {
      if (!compiled && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
        throw new Error('Installed Forge required');
      const seat = { life: 40, hand: [], library: Array<string>(20).fill('Island'), graveyard: [] };
      const backend = await snapshotForgeScenarioBackend(
        {
          schemaVersion: 1,
          active: 1,
          phase: 'MAIN1',
          seats: [
            { ...seat, battlefield: ['Sacred Cat', 'Sacred Cat'] },
            // A favorable attack, not a lone ground creature facing two lethal blockers.
            // Extra attackers give the native combat policy an actual offensive opportunity.
            { ...seat, battlefield: [fixture.name, ...Array<string>(4).fill('Grizzly Bears')] },
          ],
        },
        compiled ? { compiledBridgeClasses: compiled.classDirectory } : {},
      );
      if (!backend) throw new Error('Installed Forge required');
      const table: SessionSpec = {
        content: { kind: 'printed', format: fixture.format },
        seats: [
          {
            name: 'Local',
            controller: 'local',
            deck: { name: 'setup', cards: [{ name: 'Island', count: 60 }] },
          },
          {
            name: 'Native',
            controller: 'engine',
            deck: { name: 'setup', cards: [{ name: 'Island', count: 60 }] },
          },
        ],
        seed: 'native-exert-contract-v1',
        maximumTurns: 8,
      };
      let session: ObservedSession | undefined;
      const trace: string[] = [];
      try {
        const opened = await backend.open(table);
        if (!opened.ok) throw new Error(opened.error.message);
        session = opened.session;
        const source = session.view.seats[1].battlefield[0]!.oid;
        const blockers = session.view.seats[0].battlefield.map((c) => c.oid);
        let attackTurn: number | undefined;
        let payoff = false,
          skipped = false,
          recovered = false;
        for (let index = 0; index < 240 && session.status === 'awaiting'; index++) {
          const decision = session.decision;
          if (!decision) throw new Error('Missing decision');
          expect(decision.seat).toBe(0);
          expect(session.view.seats[1].hand).toBeNull();
          const attacker = session.view.seats[1].battlefield.find((c) => c.oid === source);
          trace.push(
            `${session.view.turn.number}/${session.view.turn.step} ${decision.kind} source=${JSON.stringify(attacker)}`,
          );
          if (attacker?.attacking) attackTurn ??= session.view.turn.number;
          if (
            attackTurn !== undefined &&
            session.view.turn.number === attackTurn &&
            session.view.turn.step === 'COMBAT_DECLARE_BLOCKERS'
          ) {
            expect(attacker?.power).toBe(fixture.exertPower);
            expect(attacker?.toughness).toBe(fixture.exertToughness);
            if (
              (fixture.name === 'Gust Walker' || fixture.name === 'Glorybringer') &&
              decision.kind === 'combat-blockers'
            ) {
              expect(
                decision.options.some(
                  (option) =>
                    option.id.startsWith('combat-block-add-') &&
                    option.targets.some((target) => target.oid === source),
                ),
              ).toBe(false);
              payoff = true;
            }
            if (fixture.preventsBlock && decision.kind === 'combat-blockers') {
              const legal = blockers.filter((oid) =>
                decision.options.some(
                  (o) => o.targets.some((t) => t.oid === oid) && o.targets.some((t) => t.oid === source),
                ),
              );
              expect(legal).toHaveLength(1);
              payoff = true;
            }
          }
          if (
            attackTurn !== undefined &&
            session.view.turn.active === 1 &&
            session.view.turn.step === 'UPKEEP'
          ) {
            if (session.view.turn.number === attackTurn + 2) {
              expect(attacker?.tapped).toBe(true);
              expect(attacker?.power).toBe(fixture.power);
              expect(attacker?.toughness).toBe(fixture.toughness);
              skipped = true;
            }
            if (session.view.turn.number === attackTurn + 4) {
              expect(attacker?.tapped).toBe(false);
              recovered = true;
              break;
            }
          }
          const move =
            decision.kind === 'priority'
              ? decision.options.find((o) => o.text === 'Pass priority')?.id
              : decision.kind === 'combat-attackers'
                ? 'combat-attackers-commit'
                : decision.kind === 'combat-blockers'
                  ? 'combat-blockers-commit'
                  : undefined;
          if (!move) throw new Error(`Unexpected local decision ${decision.kind}`);
          const advanced: SubmitResult<ObservedSession> = await session.submit(move);
          if (!advanced.ok) throw new Error(advanced.error.message);
          session = advanced.session;
        }
        expect({ payoff, skipped, recovered }, trace.slice(-10).join('\n')).toEqual({
          payoff: true,
          skipped: true,
          recovered: true,
        });
      } finally {
        await session?.close();
        await backend.shutdown?.();
      }
    },
    45_000,
  );
});
