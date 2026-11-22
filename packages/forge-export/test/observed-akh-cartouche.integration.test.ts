/** Trial/Cartouche interaction uses real physical Aura, trigger, and zone choices. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { seatViewOf } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
forgeIt.each(['Trial of Solidarity', 'Cartouche of Solidarity'] as const)(
  'Cartouche enchants only an owned creature and resolves %s first',
  async (firstTrigger) => {
    const table: SessionSpec = {
      content: { kind: 'printed', format: 'akh-hou' },
      seats: [
        {
          name: 'Pilot',
          controller: 'local',
          deck: {
            name: 'trial',
            cards: [
              { name: 'Plains', count: 30 },
              { name: 'Adorned Pouncer', count: 10 },
              { name: 'Trial of Solidarity', count: 10 },
              { name: 'Cartouche of Solidarity', count: 10 },
            ],
          },
        },
        {
          name: 'Observer',
          controller: 'local',
          deck: {
            name: 'observer',
            cards: [
              { name: 'Plains', count: 30 },
              { name: 'Adorned Pouncer', count: 30 },
            ],
          },
        },
      ],
      seed: 'akh-hou-cartouche-v1',
      maximumTurns: 32,
    };
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let trial: string | undefined;
    let creature: string | undefined;
    let aura: string | undefined;
    let warriorEntry: { oid: string; turn: number } | undefined;
    let pumpTurn: number | undefined;
    let targeted = false;
    let resolved = false;
    let ordered = false;
    let intermediate = false;
    let pumpedAttack = false;
    let expiredAttack = false;
    const trace: string[] = [];
    try {
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 2000 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        trial ??= pilot.battlefield.find((card) => card.name === 'Trial of Solidarity')?.oid;
        creature ??= pilot.battlefield.find((card) => card.name === 'Adorned Pouncer')?.oid;
        aura ??= session.view.stack.find((card) => card.name === 'Cartouche of Solidarity')?.oid;
        const returned = trial !== undefined && pilot.hand?.some((card) => card.oid === trial);
        const tokenExists = pilot.battlefield.some((card) => card.typeLine.includes('Warrior'));
        const warrior = pilot.battlefield.find((card) => card.typeLine.includes('Warrior'));
        if (warriorEntry === undefined && warrior !== undefined)
          warriorEntry = { oid: warrior.oid, turn: session.view.turn.number };
        if (ordered && session.view.stack.length > 0 && (returned || tokenExists)) {
          expect(Boolean(returned)).toBe(firstTrigger === 'Trial of Solidarity');
          expect(tokenExists).toBe(firstTrigger === 'Cartouche of Solidarity');
          intermediate = true;
        }
        if (trial !== undefined && !targeted && session.view.stack.length === 0 && pumpTurn === undefined) {
          expect(pilot.battlefield.find((card) => card.oid === creature)).toMatchObject({
            power: 3,
            toughness: 2,
          });
          pumpTurn = session.view.turn.number;
        }
        if (
          targeted &&
          trial !== undefined &&
          pilot.hand?.some((card) => card.oid === trial) &&
          session.view.stack.length === 0
        ) {
          expect(pilot.battlefield.some((card) => card.oid === trial)).toBe(false);
          expect(pilot.graveyard.some((card) => card.oid === trial)).toBe(false);
          const attached = pilot.battlefield.find((card) => card.oid === aura);
          expect(attached).toBeDefined();
          const token = pilot.battlefield.filter((card) => card.typeLine.includes('Warrior'));
          expect(token).toHaveLength(1);
          expect(token[0]).toMatchObject({ power: 1, toughness: 1 });
          expect(pilot.battlefield.find((card) => card.oid === creature)).toMatchObject({
            power: pumpTurn === session.view.turn.number ? 4 : 2,
            toughness: pumpTurn === session.view.turn.number ? 3 : 2,
          });
          expect(opponent.battlefield.filter((card) => card.name === 'Adorned Pouncer')).toHaveLength(1);
          resolved = true;
        }
        const attacker = pilot.battlefield.find((card) => card.oid === creature);
        if (attacker?.attacking && decision.kind !== 'combat-attackers') {
          if (session.view.turn.number === pumpTurn) {
            expect(attacker.tapped).toBe(false);
            pumpedAttack = true;
          } else if (
            resolved &&
            pumpTurn !== undefined &&
            warriorEntry !== undefined &&
            session.view.turn.number > pumpTurn &&
            session.view.turn.number > warriorEntry.turn
          ) {
            expect(attacker).toMatchObject({ power: 2, toughness: 2, tapped: true });
            expect(warrior).toMatchObject({
              oid: warriorEntry.oid,
              power: 1,
              toughness: 1,
              attacking: true,
              tapped: false,
            });
            expect(opponent.battlefield.find((card) => card.name === 'Adorned Pouncer')).toMatchObject({
              power: 1,
              toughness: 1,
            });
            expiredAttack = true;
            break;
          }
        }
        trace.push(
          `${decision.seat}/${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move: string | undefined;
        if (decision.kind === 'priority') {
          move = decision.options.find((option) => option.text === 'Play Plains')?.id;
          const seat = seatViewOf(session.view, decision.seat);
          if (!seat.battlefield.some((card) => card.name === 'Adorned Pouncer'))
            move ??= decision.options.find((option) => option.text.startsWith('Adorned Pouncer:'))?.id;
          if (decision.seat === 0 && creature !== undefined) {
            if (trial === undefined)
              move ??= decision.options.find((option) => option.text.startsWith('Trial of Solidarity:'))?.id;
            else if (!targeted && opponent.battlefield.some((card) => card.name === 'Adorned Pouncer'))
              move ??= decision.options.find((option) =>
                option.text.startsWith('Cartouche of Solidarity:'),
              )?.id;
          }
        } else if (decision.kind === 'combat-attackers' && decision.seat === 0 && pumpTurn !== undefined) {
          move = decision.options.find((option) => option.id.startsWith('combat-attack-add-'))?.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'target-selection') {
          expect(decision.seat).toBe(0);
          expect(
            new Set(decision.options.flatMap((option) => option.targets.map((target) => target.oid))),
          ).toEqual(new Set([creature]));
          move = decision.options.find((option) =>
            option.targets.some((target) => target.oid === creature),
          )?.id;
          await expect(session.submit('target-selection-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          targeted = true;
        } else if (decision.kind === 'trigger-order') {
          expect(decision.seat).toBe(0);
          expect(decision.options).toHaveLength(2);
          expect(
            new Set(decision.options.flatMap((option) => option.targets.map((target) => target.oid))),
          ).toEqual(new Set([trial, aura]));
          await expect(session.submit('trigger-order-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          move = decision.options.find((option) => option.text.includes(`Resolve ${firstTrigger} [`))?.id;
          ordered = true;
        } else if (decision.kind === 'discard-selection') {
          move =
            decision.options.find((option) => option.id === 'discard-selection-commit')?.id ??
            decision.options.find((option) => option.targets.some((target) => target.name === 'Plains'))
              ?.id ??
            decision.options[0]?.id;
        }
        move ??= decision.options.find(
          (option) =>
            ['Play first', 'Keep this hand', 'Pass priority'].includes(option.text) ||
            ['combat-attackers-commit', 'combat-blockers-commit'].includes(option.id),
        )?.id;
        if (move === undefined) throw new Error(`Unhandled decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        if (decision.kind === 'target-selection' || decision.kind === 'trigger-order')
          await expect(session.submit(move)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
        session = advanced.session;
      }
      expect(resolved, trace.slice(-10).join('\n')).toBe(true);
      expect(ordered).toBe(true);
      expect(intermediate).toBe(true);
      expect(pumpedAttack, trace.slice(-10).join('\n')).toBe(true);
      expect(expiredAttack, trace.slice(-10).join('\n')).toBe(true);
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
