/** Actual AKH exert: optional attack cost, target legality, and one skipped untap. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { seatViewOf } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const table: SessionSpec = {
  content: { kind: 'printed', format: 'akh-hou' },
  seats: [
    {
      name: 'Exert pilot',
      controller: 'local',
      deck: {
        name: 'crasher',
        cards: [
          { name: 'Mountain', count: 30 },
          { name: 'Ahn-Crop Crasher', count: 30 },
        ],
      },
    },
    {
      name: 'Blocker pilot',
      controller: 'local',
      deck: {
        name: 'blocker',
        cards: [
          { name: 'Plains', count: 30 },
          { name: 'Adorned Pouncer', count: 30 },
        ],
      },
    },
  ],
  seed: 'akh-hou-exert-v1',
  maximumTurns: 24,
};

forgeIt(
  'Ahn-Crop Crasher can decline exert, then stop one exact blocker and skip one untap',
  async () => {
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let sourceOid: string | undefined;
    let targetOid: string | undefined;
    let declined = false;
    let normalBlockOffered = false;
    let exertTurn: number | undefined;
    let targeted = false;
    let blockingPrevented = false;
    let skippedUntap = false;
    let untappedAgain = false;
    try {
      expect(await backend.supports(table)).toEqual([]);
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 1200 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        const pilot = session.view.seats[0];
        const defender = session.view.seats[1];
        sourceOid ??= pilot.battlefield.find((card) => card.name === 'Ahn-Crop Crasher')?.oid;
        targetOid ??= defender.battlefield.find((card) => card.name === 'Adorned Pouncer')?.oid;
        const source = pilot.battlefield.find((card) => card.oid === sourceOid);
        if (
          exertTurn !== undefined &&
          session.view.turn.active === 0 &&
          session.view.turn.step === 'UPKEEP'
        ) {
          if (session.view.turn.number === exertTurn + 2) {
            expect(source?.tapped).toBe(true);
            skippedUntap = true;
          } else if (session.view.turn.number === exertTurn + 4) {
            expect(source?.tapped).toBe(false);
            untappedAgain = true;
            break;
          }
        }
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move: string | undefined;
        if (decision.kind === 'combat-exert') {
          expect(decision.seat).toBe(0);
          const exact = decision.options.find((option) =>
            option.targets.some((target) => target.oid === sourceOid),
          );
          expect(exact).toBeDefined();
          if (!declined || exertTurn !== undefined) {
            move = 'combat-exert-done';
            declined = true;
          } else {
            expect(normalBlockOffered).toBe(true);
            await expect(session.submit('combat-exert-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            move = exact?.id;
            exertTurn = session.view.turn.number;
          }
        } else if (decision.kind === 'target-selection') {
          expect(exertTurn).toBeDefined();
          move = decision.options.find((option) =>
            option.targets.some((target) => target.oid === targetOid),
          )?.id;
          expect(move).toBeDefined();
          targeted = true;
        } else if (decision.kind === 'combat-attackers') {
          move =
            decision.seat === 0 && exertTurn === undefined && targetOid !== undefined
              ? decision.options.find(
                  (option) =>
                    option.id.startsWith('combat-attack-add-') &&
                    option.targets.some((target) => target.oid === sourceOid),
                )?.id
              : undefined;
          move ??= 'combat-attackers-commit';
        } else if (decision.kind === 'combat-blockers') {
          if (decision.seat === 1) {
            const canBlock = decision.options.some((option) =>
              option.targets.some((target) => target.oid === targetOid),
            );
            if (targeted) {
              expect(canBlock).toBe(false);
              expect(
                decision.options.some((option) =>
                  option.targets.some(
                    (target) => target.name === 'Adorned Pouncer' && target.oid !== targetOid,
                  ),
                ),
              ).toBe(true);
              blockingPrevented = true;
            } else {
              expect(canBlock).toBe(true);
              normalBlockOffered = true;
            }
          }
          move = 'combat-blockers-commit';
        } else if (decision.kind === 'priority') {
          const land = decision.seat === 0 ? 'Mountain' : 'Plains';
          const creature = decision.seat === 0 ? 'Ahn-Crop Crasher' : 'Adorned Pouncer';
          const own = seatViewOf(session.view, decision.seat);
          move = decision.options.find((option) => option.text === `Play ${land}`)?.id;
          if (
            move === undefined &&
            own.battlefield.filter((card) => card.name === creature).length < (decision.seat === 0 ? 1 : 2)
          )
            move = decision.options.find(
              (option) => option.text.startsWith(`${creature}:`) && !option.text.includes('Eternalize'),
            )?.id;
          move ??= decision.options.find((option) => option.text === 'Pass priority')?.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'discard-selection') {
          move = decision.options.find((option) =>
            option.targets.some((target) => ['Ahn-Crop Crasher', 'Adorned Pouncer'].includes(target.name)),
          )?.id;
        }
        move ??= decision.options.find((option) =>
          ['Play first', 'Keep this hand'].includes(option.text),
        )?.id;
        if (move === undefined) throw new Error(`Unhandled exert decision\n${trace.slice(-12).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-12).join('\n')}`);
        session = advanced.session;
      }
      expect(
        { declined, normalBlockOffered, targeted, blockingPrevented, skippedUntap, untappedAgain },
        trace.slice(-20).join('\n'),
      ).toEqual({
        declined: true,
        normalBlockOffered: true,
        targeted: true,
        blockingPrevented: true,
        skippedUntap: true,
        untappedAgain: true,
      });
    } finally {
      await session?.close();
      await backend.shutdown?.();
    }
  },
  180_000,
);
