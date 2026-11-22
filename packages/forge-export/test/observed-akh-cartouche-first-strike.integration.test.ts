/** Compare the same vanilla combat with and without Cartouche's granted first strike. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
forgeIt.each([false, true])(
  'Cartouche prevents return combat damage only when attached (enchanted: %s)',
  async (enchanted) => {
    const table: SessionSpec = {
      content: { kind: 'printed', format: 'akh-hou' },
      seats: [
        {
          name: 'Attacker',
          controller: 'local',
          deck: {
            name: 'vanilla aura host',
            cards: [
              { name: 'Plains', count: 30 },
              { name: 'Those Who Serve', count: 15 },
              { name: 'Cartouche of Solidarity', count: 15 },
            ],
          },
        },
        {
          name: 'Blocker',
          controller: 'local',
          deck: {
            name: 'vanilla blocker',
            cards: [
              { name: 'Mountain', count: 30 },
              { name: 'Defiant Khenra', count: 30 },
            ],
          },
        },
      ],
      seed: 'akh-hou-cartouche-first-strike-v1',
      maximumTurns: 24,
    };
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let host: string | undefined;
    let blocker: string | undefined;
    let aura: string | undefined;
    let attacked = false;
    let blocked = false;
    let verified = false;
    let trace: readonly string[] = [];
    try {
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 1600 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        host ??= pilot.battlefield.find((card) => card.name === 'Those Who Serve')?.oid;
        blocker ??= opponent.battlefield.find((card) => card.name === 'Defiant Khenra')?.oid;
        aura ??= pilot.battlefield.find((card) => card.name === 'Cartouche of Solidarity')?.oid;
        if (blocked && session.view.turn.active === 0 && session.view.turn.step === 'MAIN2') {
          expect(pilot.battlefield.find((card) => card.oid === host)).toMatchObject({
            name: 'Those Who Serve',
            power: enchanted ? 3 : 2,
            toughness: enchanted ? 5 : 4,
            damage: enchanted ? 0 : 2,
            tapped: true,
          });
          expect(opponent.graveyard.find((card) => card.oid === blocker)).toMatchObject({
            name: 'Defiant Khenra',
          });
          expect(opponent.battlefield.some((card) => card.oid === blocker)).toBe(false);
          expect(pilot.graveyard.some((card) => card.oid === host)).toBe(false);
          expect(session.view.seats.map((seat) => seat.life)).toEqual([20, 20]);
          expect(pilot.battlefield.filter((card) => card.name === 'Cartouche of Solidarity')).toHaveLength(
            enchanted ? 1 : 0,
          );
          expect(pilot.battlefield.filter((card) => card.typeLine.includes('Warrior'))).toHaveLength(
            enchanted ? 1 : 0,
          );
          verified = true;
          break;
        }
        trace = [
          ...trace.slice(-12),
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`,
        ];
        let move: string | undefined;
        if (decision.kind === 'priority') {
          const creature = decision.seat === 0 ? 'Those Who Serve' : 'Defiant Khenra';
          const land = decision.seat === 0 ? 'Plains' : 'Mountain';
          move = decision.options.find((option) => option.text === `Play ${land}`)?.id;
          if ((decision.seat === 0 ? host : blocker) === undefined)
            move ??= decision.options.find((option) => option.text.startsWith(`${creature}:`))?.id;
          if (decision.seat === 0 && enchanted && host !== undefined && aura === undefined)
            move ??= decision.options.find((option) =>
              option.text.startsWith('Cartouche of Solidarity:'),
            )?.id;
        } else if (decision.kind === 'target-selection') {
          expect(enchanted).toBe(true);
          expect(decision.seat).toBe(0);
          expect(
            new Set(decision.options.flatMap((option) => option.targets.map((target) => target.oid))),
          ).toEqual(new Set([host]));
          move = decision.options.find((option) => option.targets.some((target) => target.oid === host))?.id;
        } else if (
          decision.kind === 'combat-attackers' &&
          decision.seat === 0 &&
          !attacked &&
          blocker !== undefined &&
          (!enchanted || aura !== undefined)
        ) {
          const option = decision.options.find(
            (entry) =>
              entry.id.startsWith('combat-attack-add-') &&
              entry.targets.some((target) => target.oid === host),
          );
          if (option !== undefined) {
            expect(pilot.battlefield.find((card) => card.oid === host)?.damage).toBe(0);
            expect(opponent.battlefield.find((card) => card.oid === blocker)).toMatchObject({
              damage: 0,
              tapped: false,
            });
            move = option.id;
            attacked = true;
          }
        } else if (decision.kind === 'combat-blockers' && decision.seat === 1 && attacked && !blocked) {
          const option = decision.options.find(
            (entry) =>
              entry.id.startsWith('combat-block-add-') &&
              entry.targets.some((target) => target.oid === host) &&
              entry.targets.some((target) => target.oid === blocker),
          );
          expect(option, trace.join('\n')).toBeDefined();
          move = option!.id;
          blocked = true;
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
      expect(attacked).toBe(true);
      expect(blocked).toBe(true);
      expect(verified, trace.join('\n')).toBe(true);
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
