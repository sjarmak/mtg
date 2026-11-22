/** Haste and optional exert are observed through real cast, combat, and untap steps. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { seatViewOf } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const CRASHER = 'Ahn-Crop Crasher';
const BLOCKER = 'Adorned Pouncer';

for (const controller of ['local', 'engine'] as const) {
  forgeIt(
    `Crasher ${controller} casts and attacks with haste without exerting, then untaps normally`,
    async () => {
      const table: SessionSpec = {
        content: { kind: 'printed', format: 'akh-hou' },
        seats: [
          {
            name: 'Local blocker',
            controller: 'local',
            deck: {
              name: 'blocker',
              cards: [
                { name: 'Plains', count: 30 },
                { name: BLOCKER, count: 15 },
                { name: 'Farm // Market', count: 15 },
              ],
            },
          },
          {
            name: 'Crasher pilot',
            controller,
            deck: {
              name: 'crasher',
              cards: [
                { name: 'Mountain', count: 30 },
                { name: CRASHER, count: 30 },
              ],
            },
          },
        ],
        seed: 'akh-hou-exert-engine-v1',
        maximumTurns: 24,
      };
      const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
      if (backend === null) throw new Error('Required installed Forge is absent');
      let session: ObservedSession | undefined;
      let castTurns: Readonly<Record<string, number>> = {};
      let declined: { readonly oid: string; readonly turn: number } | undefined;
      let untappedNormally = false;
      let assignedBlockers: readonly string[] = [];
      let blockedAttackers: readonly string[] = [];
      let trace: readonly string[] = [];
      try {
        expect(await backend.supports(table)).toEqual([]);
        const opened = await backend.open(table);
        if (!opened.ok) throw new Error(opened.error.message);
        session = opened.session;
        expect(session.view.seats[1].battlefield).toHaveLength(0);
        for (let index = 0; index < 1200 && session.status === 'awaiting'; index += 1) {
          const decision = session.decision;
          if (decision === null) throw new Error('Missing decision');
          if (controller === 'engine') {
            expect(decision.seat).toBe(0);
            expect(session.view.seats[1].hand).toBeNull();
          }
          const attacker = session.view.seats[1];
          const defender = session.view.seats[0];
          for (const spell of session.view.stack) {
            if (spell.name === CRASHER && !attacker.battlefield.some((card) => card.oid === spell.oid))
              castTurns = { ...castTurns, [spell.oid]: session.view.turn.number };
          }
          if (declined === undefined && decision.kind === 'combat-blockers' && decision.seat === 0) {
            const source = attacker.battlefield.find(
              (card) =>
                card.name === CRASHER && card.attacking && castTurns[card.oid] === session?.view.turn.number,
            );
            if (source !== undefined) {
              expect(session.view.stack).toHaveLength(0);
              expect(source.tapped).toBe(true);
              const blockers = defender.battlefield.filter((card) => card.name === BLOCKER);
              expect(blockers).toHaveLength(2);
              expect(new Set(blockers.map((card) => card.oid)).size).toBe(2);
              for (const blocker of blockers) {
                expect(blocker.tapped).toBe(false);
                expect(
                  decision.options.some(
                    (option) =>
                      option.id.startsWith('combat-block-add-') &&
                      option.targets.some((target) => target.oid === blocker.oid) &&
                      option.targets.some((target) => target.oid === source.oid),
                  ),
                ).toBe(true);
              }
              declined = { oid: source.oid, turn: session.view.turn.number };
            }
          }
          const observed = declined;
          if (
            observed !== undefined &&
            session.view.turn.active === 1 &&
            session.view.turn.step === 'UPKEEP' &&
            session.view.turn.number === observed.turn + 2
          ) {
            expect(attacker.battlefield.find((card) => card.oid === observed.oid)?.tapped).toBe(false);
            untappedNormally = true;
            break;
          }
          trace = [
            ...trace.slice(-19),
            `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`,
          ];
          let move: string | undefined;
          if (decision.kind === 'priority') {
            const land = decision.seat === 0 ? 'Plains' : 'Mountain';
            const creature = decision.seat === 0 ? BLOCKER : CRASHER;
            const own = seatViewOf(session.view, decision.seat);
            move = decision.options.find((option) => option.text === `Play ${land}`)?.id;
            // Preserve the tracked source while surviving the native pilot's lethal attack.
            if (
              decision.seat === 0 &&
              observed !== undefined &&
              session.view.turn.number === observed.turn &&
              attacker.battlefield.some(
                (card) => card.attacking && card.oid !== observed.oid && !blockedAttackers.includes(card.oid),
              )
            )
              move ??= decision.options.find((option) => option.text.startsWith('Farm // Market:'))?.id;
            if (move === undefined && own.battlefield.filter((card) => card.name === creature).length < 2)
              move = decision.options.find(
                (option) => option.text.startsWith(`${creature}:`) && !option.text.includes('Eternalize'),
              )?.id;
            move ??= decision.options.find((option) => option.text === 'Pass priority')?.id;
          } else if (decision.kind === 'target-selection' && observed !== undefined) {
            move = decision.options.find((option) =>
              option.targets.some(
                (target) =>
                  target.name === CRASHER &&
                  target.oid !== observed.oid &&
                  !blockedAttackers.includes(target.oid) &&
                  attacker.battlefield.some((card) => card.oid === target.oid && card.attacking),
              ),
            )?.id;
          } else if (decision.kind === 'combat-blockers' && observed !== undefined && decision.seat === 0) {
            const block = decision.options.find(
              (option) =>
                option.id.startsWith('combat-block-add-') &&
                !option.targets.some((target) => target.oid === observed.oid) &&
                !option.targets.some((target) => blockedAttackers.includes(target.oid)) &&
                option.targets.some(
                  (target) => target.name === BLOCKER && !assignedBlockers.includes(target.oid),
                ),
            );
            move = block?.id;
            if (block !== undefined) {
              assignedBlockers = [
                ...assignedBlockers,
                ...block.targets.filter((target) => target.name === BLOCKER).map((target) => target.oid),
              ];
              blockedAttackers = [
                ...blockedAttackers,
                ...block.targets.filter((target) => target.name === CRASHER).map((target) => target.oid),
              ];
            }
          } else if (decision.kind === 'mana-payment') {
            move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
          } else if (decision.kind === 'discard-selection') {
            move = decision.options.find((option) =>
              option.targets.some((target) => [CRASHER, BLOCKER].includes(target.name)),
            )?.id;
          } else if (decision.kind === 'combat-attackers' && decision.seat === 1 && declined === undefined) {
            move = decision.options.find(
              (option) =>
                option.id.startsWith('combat-attack-add-') &&
                option.targets.some((target) => castTurns[target.oid] === session?.view.turn.number),
            )?.id;
          } else if (decision.kind === 'combat-exert') {
            expect(controller).toBe('local');
            expect(decision.seat).toBe(1);
            move = 'combat-exert-done';
          }
          move ??= decision.options.find(
            (option) =>
              ['Play first', 'Keep this hand'].includes(option.text) ||
              ['combat-attackers-commit', 'combat-blockers-commit'].includes(option.id),
          )?.id;
          if (move === undefined) throw new Error(`Unhandled local decision\n${trace.join('\n')}`);
          const advanced = await session.submit(move);
          if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.join('\n')}`);
          session = advanced.session;
        }
        expect(declined, trace.join('\n')).toBeDefined();
        expect(untappedNormally, trace.join('\n')).toBe(true);
      } finally {
        try {
          await session?.close();
        } finally {
          await backend.shutdown?.();
        }
      }
    },
    180_000,
  );
}
