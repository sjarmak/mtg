/** Pinned pool-40 topology: Dead Weight leaves an Armored Skaab at negative power before it blocks. */
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

describe.skipIf(!required)('ISD negative-power blocker combat', () => {
  it('completes the zero-damage blocker assignment from the pool-40 episode', async () => {
    const seat = { life: 20, hand: [], library: Array<string>(20).fill('Island'), graveyard: [] };
    const backend = await snapshotForgeScenarioBackend(
      {
        schemaVersion: 1,
        active: 0,
        phase: 'MAIN1',
        seats: [
          { ...seat, hand: ['Dead Weight'], battlefield: ['Swamp', 'Diregraf Ghoul'] },
          { ...seat, battlefield: ['Armored Skaab'] },
        ],
      },
      compiled ? { compiledBridgeClasses: compiled.classDirectory } : {},
    );
    if (backend === null) throw new Error('Installed Forge required');
    const table: SessionSpec = {
      content: { kind: 'printed', format: 'isd' },
      seats: [
        {
          name: 'Frozen opponent',
          controller: 'local',
          deck: { name: 'setup', cards: [{ name: 'Island', count: 60 }] },
        },
        {
          name: 'Measured deck',
          controller: 'local',
          deck: { name: 'setup', cards: [{ name: 'Island', count: 60 }] },
        },
      ],
      seed: 'isd-pool-40-negative-power-blocker-v1',
      maximumTurns: 4,
    };
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let auraResolved = false;
    let attacked = false;
    let blocked = false;
    try {
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 160 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${decision.seat} ${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`,
        );
        const attacker = session.view.seats[0].battlefield.find((card) => card.name === 'Diregraf Ghoul');
        const blocker = session.view.seats[1].battlefield.find((card) => card.name === 'Armored Skaab');
        auraResolved ||= blocker?.power === -1 && blocker.toughness === 2;
        if (blocked && session.view.turn.step === 'MAIN2') {
          expect(session.view.seats[0].battlefield.find((card) => card.oid === attacker?.oid)?.damage).toBe(
            0,
          );
          expect(session.view.seats[1].graveyard.some((card) => card.name === 'Armored Skaab')).toBe(true);
          return;
        }

        let move: string | undefined;
        if (decision.kind === 'priority') {
          move =
            (!auraResolved
              ? decision.options.find((option) => option.text.startsWith('Dead Weight:'))?.id
              : undefined) ?? decision.options.find((option) => option.text === 'Pass priority')?.id;
        } else if (decision.kind === 'target-selection') {
          move = decision.options.find((option) =>
            option.targets.some((target) => target.oid === blocker?.oid),
          )?.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'combat-attackers') {
          move =
            (!attacked && auraResolved
              ? decision.options.find(
                  (option) =>
                    option.id.startsWith('combat-attack-add-') &&
                    option.targets.some((target) => target.oid === attacker?.oid),
                )?.id
              : undefined) ?? 'combat-attackers-commit';
          attacked ||= move.startsWith('combat-attack-add-');
        } else if (decision.kind === 'combat-blockers') {
          move =
            (!blocked && attacked
              ? decision.options.find(
                  (option) =>
                    option.id.startsWith('combat-block-add-') &&
                    option.targets.some((target) => target.oid === attacker?.oid) &&
                    option.targets.some((target) => target.oid === blocker?.oid),
                )?.id
              : undefined) ?? 'combat-blockers-commit';
          blocked ||= move.startsWith('combat-block-add-');
        }
        move ??= decision.options.find((option) => option.text === 'Keep this hand')?.id;
        if (move === undefined) throw new Error(`Unhandled decision: ${decision.kind}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }
      throw new Error(`Combat did not resolve\n${trace.slice(-80).join('\n')}`);
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-80).join('\n')}`, { cause });
    } finally {
      try {
        await session?.close();
      } finally {
        await backend.shutdown?.();
      }
    }
  }, 180_000);
});
