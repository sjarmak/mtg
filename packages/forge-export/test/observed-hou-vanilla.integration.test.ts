/** Textless creature behavior through local moves and native public-state observations. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { seatViewOf } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const CREATURE = 'Defiant Khenra';
const deck = {
  name: 'vanilla-combat',
  cards: [
    { name: 'Mountain', count: 30 },
    { name: CREATURE, count: 30 },
  ],
};

for (const controller of ['local', 'engine'] as const) {
  for (const blocked of [false, true]) {
    forgeIt(
      `${controller} Defiant Khenra casts, waits to attack, and ${blocked ? 'trades with a blocker' : 'deals unblocked combat damage'}`,
      async () => {
        const table: SessionSpec = {
          content: { kind: 'printed', format: 'akh-hou' },
          seats: [
            { name: 'Defender', controller: 'local', deck },
            { name: 'Creature pilot', controller, deck },
          ],
          seed: 'hou-vanilla-combat-v1',
          maximumTurns: 20,
        };
        const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
        if (backend === null) throw new Error('Required installed Forge is absent');
        let session: ObservedSession | undefined;
        let source: string | undefined;
        let castTurn: number | undefined;
        let resolved = false;
        let sawSickMain = false;
        let combat: { turn: number; attackers: readonly string[]; life: number } | undefined;
        let block: { source: string; blocker: string } | undefined;
        let finished = false;
        let trace: readonly string[] = [];
        try {
          const opened = await backend.open(table);
          if (!opened.ok) throw new Error(opened.error.message);
          session = opened.session;
          for (let index = 0; index < 1200 && session.status === 'awaiting'; index += 1) {
            const decision = session.decision;
            if (decision === null) throw new Error('Missing decision');
            const defender = session.view.seats[0];
            const pilot = session.view.seats[1];
            if (controller === 'engine') {
              expect(decision.seat).toBe(0);
              expect(pilot.hand).toBeNull();
            }
            const spell = session.view.stack.find((card) => card.name === CREATURE && card.controller === 1);
            if (source === undefined && spell !== undefined) {
              source = spell.oid;
              castTurn = session.view.turn.number;
              expect(session.view.turn.active).toBe(1);
              expect(['MAIN1', 'MAIN2']).toContain(session.view.turn.step);
              expect(pilot.battlefield.some((card) => card.oid === source)).toBe(false);
              expect(pilot.battlefield.filter((card) => card.tapped)).toHaveLength(2);
              expect(session.play?.manaPools?.[1]).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
            }
            const creature = pilot.battlefield.find((card) => card.oid === source);
            if (creature !== undefined) {
              expect(creature).toMatchObject({ name: CREATURE, power: 2, toughness: 2, controller: 1 });
              expect(session.view.stack.some((card) => card.oid === source)).toBe(false);
              resolved = true;
              if (session.view.turn.number === castTurn) {
                expect(creature.attacking).toBe(false);
                if (session.view.turn.step === 'MAIN2') sawSickMain = true;
                if (decision.seat === 1 && decision.kind === 'combat-attackers') {
                  expect(
                    decision.options.some(
                      (option) =>
                        option.id.startsWith('combat-attack-add-') &&
                        option.targets.some((card) => card.oid === source),
                    ),
                  ).toBe(false);
                }
              }
            }
            const attackers = pilot.battlefield.filter((card) => card.attacking);
            if (combat === undefined && attackers.length > 0 && decision.kind !== 'combat-attackers') {
              expect(resolved).toBe(true);
              expect(sawSickMain).toBe(true);
              expect(session.view.turn.number).toBeGreaterThan(castTurn!);
              for (const attacker of attackers)
                expect(attacker).toMatchObject({ name: CREATURE, power: 2, toughness: 2, tapped: true });
              combat = {
                turn: session.view.turn.number,
                attackers: attackers.map((card) => card.oid),
                life: defender.life,
              };
            }
            if (
              combat !== undefined &&
              session.view.turn.number === combat.turn &&
              session.view.turn.step === 'MAIN2'
            ) {
              expect(block !== undefined).toBe(blocked);
              expect(defender.life).toBe(combat.life - 2 * (combat.attackers.length - (blocked ? 1 : 0)));
              expect(pilot.life).toBe(20);
              const completedBlock = block;
              if (completedBlock !== undefined) {
                expect(pilot.graveyard.some((card) => card.oid === completedBlock.source)).toBe(true);
                expect(defender.graveyard.some((card) => card.oid === completedBlock.blocker)).toBe(true);
                expect(pilot.battlefield.some((card) => card.oid === completedBlock.source)).toBe(false);
                expect(defender.battlefield.some((card) => card.oid === completedBlock.blocker)).toBe(false);
              } else {
                for (const oid of combat.attackers)
                  expect(pilot.battlefield.find((card) => card.oid === oid)).toMatchObject({ tapped: true });
              }
              finished = true;
              break;
            }
            trace = [
              ...trace.slice(-19),
              `${session.view.turn.number}/${session.view.turn.step} seat${decision.seat} ${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`,
            ];
            let move: string | undefined;
            if (decision.kind === 'priority') {
              const own = seatViewOf(session.view, decision.seat);
              move = decision.options.find((option) => option.text === 'Play Mountain')?.id;
              if (
                move === undefined &&
                (decision.seat === 1 || blocked) &&
                !own.battlefield.some((card) => card.name === CREATURE)
              )
                move = decision.options.find((option) => option.text.startsWith(`${CREATURE}:`))?.id;
              move ??= decision.options.find((option) => option.text === 'Pass priority')?.id;
            } else if (decision.kind === 'combat-attackers' && decision.seat === 1 && combat === undefined) {
              move = decision.options.find((option) => option.id.startsWith('combat-attack-add-'))?.id;
            } else if (
              decision.kind === 'combat-blockers' &&
              decision.seat === 0 &&
              blocked &&
              block === undefined
            ) {
              const option = decision.options.find((entry) => entry.id.startsWith('combat-block-add-'));
              const attacker = option?.targets.find((card) =>
                pilot.battlefield.some((entry) => entry.oid === card.oid),
              );
              const blocker = option?.targets.find((card) =>
                defender.battlefield.some((entry) => entry.oid === card.oid),
              );
              if (option !== undefined && attacker !== undefined && blocker !== undefined) {
                block = { source: attacker.oid, blocker: blocker.oid };
                move = option.id;
              }
            } else if (decision.kind === 'mana-payment') {
              move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
            } else if (decision.kind === 'discard-selection') {
              move =
                decision.options.find((option) => option.id === 'discard-selection-commit')?.id ??
                decision.options[0]?.id;
            }
            move ??= decision.options.find(
              (option) =>
                ['Play first', 'Keep this hand'].includes(option.text) ||
                ['combat-attackers-commit', 'combat-blockers-commit'].includes(option.id),
            )?.id;
            if (move === undefined) throw new Error(`Unhandled decision\n${trace.join('\n')}`);
            const advanced = await session.submit(move);
            if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.join('\n')}`);
            session = advanced.session;
          }
          expect(finished, trace.join('\n')).toBe(true);
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
}
