/** Exact public combat deaths; native attack choices remain owned by Forge. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { seatViewOf } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const cases = [
  { name: 'Those Who Serve', land: 'Plains', power: 2, toughness: 4 },
  { name: 'Ancient Crab', land: 'Island', power: 1, toughness: 5 },
  { name: 'Dune Beetle', land: 'Swamp', power: 1, toughness: 4 },
  { name: 'Hyena Pack', land: 'Mountain', power: 3, toughness: 4 },
  { name: 'Colossapede', land: 'Forest', power: 5, toughness: 5 },
  { name: 'Dutiful Servants', land: 'Plains', power: 2, toughness: 5 },
  { name: 'Harrier Naga', land: 'Forest', power: 3, toughness: 3 },
] as const;

for (const card of cases)
  for (const controller of ['local', 'engine'] as const)
    forgeIt(
      `${controller} ${card.name} dies to lethal combat from Colossapede`,
      async () => {
        const deck = (name: string, land: string) => ({
          name,
          cards: [
            { name: land, count: 30 },
            { name, count: 30 },
          ],
        });
        const table: SessionSpec = {
          content: { kind: 'printed', format: 'akh-hou' },
          seats: [
            { name: 'Defender', controller: 'local', deck: deck('Colossapede', 'Forest') },
            { name: 'Attacker', controller, deck: deck(card.name, card.land) },
          ],
          seed: 'akh-hou-textless-lethal-v1',
          maximumTurns: 24,
        };
        const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
        if (backend === null) throw new Error('Required installed Forge is absent');
        let session: ObservedSession | undefined;
        let block:
          { source: string; blocker: string; turn: number; life: number; attackers: number } | undefined;
        let completed = false;
        let trace: readonly string[] = [];
        try {
          const opened = await backend.open(table);
          if (!opened.ok) throw new Error(opened.error.message);
          session = opened.session;
          for (let index = 0; index < 1500 && session.status === 'awaiting'; index += 1) {
            const decision = session.decision;
            if (decision === null) throw new Error('Missing decision');
            const defender = session.view.seats[0];
            const pilot = session.view.seats[1];
            if (controller === 'engine') {
              expect(decision.seat).toBe(0);
              expect(pilot.hand).toBeNull();
            }
            const completedBlock = block;
            if (
              completedBlock !== undefined &&
              session.view.turn.number === completedBlock.turn &&
              session.view.turn.step === 'MAIN2'
            ) {
              expect(pilot.graveyard.filter((entry) => entry.oid === completedBlock.source)).toHaveLength(1);
              expect(pilot.graveyard.find((entry) => entry.oid === completedBlock.source)?.name).toBe(
                card.name,
              );
              expect(pilot.battlefield.some((entry) => entry.oid === completedBlock.source)).toBe(false);
              expect(defender.life).toBe(completedBlock.life - card.power * (completedBlock.attackers - 1));
              expect(pilot.life).toBe(20);
              if (card.power === 5) {
                expect(
                  defender.graveyard.filter((entry) => entry.oid === completedBlock.blocker),
                ).toHaveLength(1);
                expect(defender.battlefield.some((entry) => entry.oid === completedBlock.blocker)).toBe(
                  false,
                );
              } else {
                expect(
                  defender.battlefield.find((entry) => entry.oid === completedBlock.blocker),
                ).toMatchObject({
                  name: 'Colossapede',
                  power: 5,
                  toughness: 5,
                  damage: card.power,
                  tapped: false,
                });
                expect(defender.graveyard.some((entry) => entry.oid === completedBlock.blocker)).toBe(false);
              }
              completed = true;
              break;
            }
            trace = [
              ...trace.slice(-19),
              `${session.view.turn.number}/${session.view.turn.step} seat${decision.seat} ${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`,
            ];
            let move: string | undefined;
            if (decision.kind === 'priority') {
              const land = decision.seat === 0 ? 'Forest' : card.land;
              const creature = decision.seat === 0 ? 'Colossapede' : card.name;
              move = decision.options.find((option) => option.text === `Play ${land}`)?.id;
              if (
                !seatViewOf(session.view, decision.seat).battlefield.some((entry) => entry.name === creature)
              )
                move ??= decision.options.find((option) => option.text.startsWith(`${creature}:`))?.id;
            } else if (decision.kind === 'combat-attackers' && decision.seat === 1 && block === undefined) {
              if (defender.battlefield.some((entry) => entry.name === 'Colossapede' && !entry.tapped))
                move = decision.options.find((option) => option.id.startsWith('combat-attack-add-'))?.id;
            } else if (decision.kind === 'combat-blockers' && decision.seat === 0 && block === undefined) {
              const option = decision.options.find((entry) => entry.id.startsWith('combat-block-add-'));
              if (option !== undefined) {
                const source = option.targets.find((entry) =>
                  pilot.battlefield.some((c) => c.oid === entry.oid),
                );
                const blocker = option.targets.find((entry) =>
                  defender.battlefield.some((c) => c.oid === entry.oid),
                );
                expect(source).toBeDefined();
                expect(blocker).toBeDefined();
                expect(pilot.battlefield.find((entry) => entry.oid === source!.oid)).toMatchObject({
                  name: card.name,
                  power: card.power,
                  toughness: card.toughness,
                  attacking: true,
                  tapped: true,
                  damage: 0,
                });
                expect(defender.battlefield.find((entry) => entry.oid === blocker!.oid)).toMatchObject({
                  name: 'Colossapede',
                  power: 5,
                  toughness: 5,
                  damage: 0,
                  tapped: false,
                });
                block = {
                  source: source!.oid,
                  blocker: blocker!.oid,
                  turn: session.view.turn.number,
                  life: defender.life,
                  attackers: pilot.battlefield.filter((entry) => entry.attacking).length,
                };
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
                ['Play first', 'Keep this hand', 'Pass priority'].includes(option.text) ||
                ['combat-attackers-commit', 'combat-blockers-commit'].includes(option.id),
            )?.id;
            if (move === undefined) throw new Error(`Unhandled decision\n${trace.join('\n')}`);
            const advanced = await session.submit(move);
            if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.join('\n')}`);
            session = advanced.session;
          }
          expect(completed, trace.join('\n')).toBe(true);
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
