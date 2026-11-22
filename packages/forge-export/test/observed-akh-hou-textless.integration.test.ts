/** Each remaining textless printing gets its own local/native casting and attack observation. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const cases = [
  { name: 'Those Who Serve', land: 'Plains', cost: 3, power: 2, toughness: 4 },
  { name: 'Ancient Crab', land: 'Island', cost: 3, power: 1, toughness: 5 },
  { name: 'Dune Beetle', land: 'Swamp', cost: 2, power: 1, toughness: 4 },
  { name: 'Hyena Pack', land: 'Mountain', cost: 4, power: 3, toughness: 4 },
  { name: 'Colossapede', land: 'Forest', cost: 5, power: 5, toughness: 5 },
  { name: 'Dutiful Servants', land: 'Plains', cost: 4, power: 2, toughness: 5 },
  { name: 'Harrier Naga', land: 'Forest', cost: 3, power: 3, toughness: 3 },
] as const;

for (const card of cases)
  for (const controller of ['local', 'engine'] as const) {
    forgeIt(
      `${controller} ${card.name} pays, resolves, waits, and deals its printed combat damage`,
      async () => {
        const table: SessionSpec = {
          content: { kind: 'printed', format: 'akh-hou' },
          seats: [
            {
              name: 'Observer',
              controller: 'local',
              deck: { name: 'lands', cards: [{ name: 'Plains', count: 60 }] },
            },
            {
              name: card.name,
              controller,
              deck: {
                name: card.name,
                cards: [
                  { name: card.land, count: 30 },
                  { name: card.name, count: 30 },
                ],
              },
            },
          ],
          seed: `akh-hou-textless-${card.name}-v1`,
          maximumTurns: 24,
        };
        const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
        if (backend === null) throw new Error('Required installed Forge is absent');
        let session: ObservedSession | undefined;
        let cast: { oid: string; turn: number } | undefined;
        let combat: { turn: number; count: number; life: number } | undefined;
        let resolved = false;
        let sickMain = false;
        let finished = false;
        let trace: readonly string[] = [];
        try {
          const opened = await backend.open(table);
          if (!opened.ok) throw new Error(opened.error.message);
          session = opened.session;
          for (let index = 0; index < 1500 && session.status === 'awaiting'; index += 1) {
            const decision = session.decision;
            if (decision === null) throw new Error('Missing decision');
            const pilot = session.view.seats[1];
            if (controller === 'engine') {
              expect(decision.seat).toBe(0);
              expect(pilot.hand).toBeNull();
            }
            const spell = session.view.stack.find((entry) => entry.name === card.name);
            if (cast === undefined && spell !== undefined) {
              expect(spell.controller).toBe(1);
              expect(session.view.turn.active).toBe(1);
              expect(['MAIN1', 'MAIN2']).toContain(session.view.turn.step);
              expect(pilot.battlefield.filter((entry) => entry.tapped)).toHaveLength(card.cost);
              expect(session.play?.manaPools?.[1]).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
              cast = { oid: spell.oid, turn: session.view.turn.number };
            }
            const creature = pilot.battlefield.find((entry) => entry.oid === cast?.oid);
            if (creature !== undefined) {
              expect(creature).toMatchObject({
                name: card.name,
                controller: 1,
                power: card.power,
                toughness: card.toughness,
              });
              resolved = true;
              if (session.view.turn.number === cast!.turn) {
                expect(creature.attacking).toBe(false);
                if (session.view.turn.step === 'MAIN2') sickMain = true;
                if (decision.kind === 'combat-attackers' && decision.seat === 1)
                  expect(
                    decision.options.some(
                      (option) =>
                        option.id.startsWith('combat-attack-add-') &&
                        option.targets.some((target) => target.oid === creature.oid),
                    ),
                  ).toBe(false);
              }
            }
            const attackers = pilot.battlefield.filter((entry) => entry.attacking);
            if (combat === undefined && attackers.length > 0 && decision.kind !== 'combat-attackers') {
              expect(resolved && sickMain).toBe(true);
              expect(attackers.some((entry) => entry.oid === cast!.oid)).toBe(true);
              expect(session.view.turn.number).toBeGreaterThan(cast!.turn);
              for (const attacker of attackers)
                expect(attacker).toMatchObject({
                  name: card.name,
                  tapped: true,
                  power: card.power,
                  toughness: card.toughness,
                });
              combat = {
                turn: session.view.turn.number,
                count: attackers.length,
                life: session.view.seats[0].life,
              };
            }
            if (
              combat !== undefined &&
              session.view.turn.number === combat.turn &&
              session.view.turn.step === 'MAIN2'
            ) {
              expect(session.view.seats[0].life).toBe(combat.life - combat.count * card.power);
              expect(pilot.life).toBe(20);
              expect(creature).toMatchObject({ tapped: true });
              finished = true;
              break;
            }
            trace = [
              ...trace.slice(-15),
              `${session.view.turn.number}/${session.view.turn.step} ${decision.seat}/${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`,
            ];
            let move: string | undefined;
            if (decision.kind === 'priority') {
              move = decision.options.find(
                (option) => option.text === `Play ${decision.seat === 1 ? card.land : 'Plains'}`,
              )?.id;
              if (decision.seat === 1 && cast === undefined)
                move ??= decision.options.find((option) => option.text.startsWith(`${card.name}:`))?.id;
            } else if (decision.kind === 'combat-attackers' && decision.seat === 1 && combat === undefined) {
              move = decision.options.find((option) => option.id.startsWith('combat-attack-add-'))?.id;
            } else if (decision.kind === 'mana-payment') {
              move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
            } else if (decision.kind === 'discard-selection') {
              move =
                decision.options.find((option) => option.id === 'discard-selection-commit')?.id ??
                decision.options[0]?.id;
            }
            move ??= decision.options.find(
              (option) =>
                ['Play first', 'Keep this hand', 'Pass priority'].includes(option.text) ||
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
