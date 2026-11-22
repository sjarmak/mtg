/** The same blocker regains legality next combat without leaving the battlefield. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { seatViewOf } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const CRASHER = 'Ahn-Crop Crasher';
const BLOCKER = 'Adorned Pouncer';
const table: SessionSpec = {
  content: { kind: 'printed', format: 'akh-hou' },
  seats: [
    {
      name: 'Exert pilot',
      controller: 'local',
      deck: {
        name: 'crashers',
        cards: [
          { name: 'Mountain', count: 30 },
          { name: CRASHER, count: 30 },
        ],
      },
    },
    {
      name: 'Blocker pilot',
      controller: 'local',
      deck: {
        name: 'blockers',
        cards: [
          { name: 'Plains', count: 30 },
          { name: BLOCKER, count: 30 },
        ],
      },
    },
  ],
  seed: 'akh-hou-exert-v1',
  maximumTurns: 24,
};

forgeIt(
  'Crasher blocking restriction expires for the same creature by the next defensive combat',
  async () => {
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let sourceOid: string | undefined;
    let reserveOid: string | undefined;
    let targetOid: string | undefined;
    let exertTurn: number | undefined;
    let restricted = false;
    let skippedUntap = false;
    let expired = false;
    let trace: readonly string[] = [];
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
        const crashers = pilot.battlefield.filter((card) => card.name === CRASHER);
        const blockers = defender.battlefield.filter((card) => card.name === BLOCKER);
        sourceOid ??= crashers[0]?.oid;
        reserveOid ??= crashers.find((card) => card.oid !== sourceOid)?.oid;
        targetOid ??= blockers[0]?.oid;
        if (exertTurn !== undefined) {
          expect(blockers.find((card) => card.oid === targetOid)?.tapped).toBe(false);
          if (
            session.view.turn.active === 0 &&
            session.view.turn.step === 'UPKEEP' &&
            session.view.turn.number === exertTurn + 2
          ) {
            expect(crashers.find((card) => card.oid === sourceOid)?.tapped).toBe(true);
            expect(crashers.find((card) => card.oid === reserveOid)?.tapped).toBe(false);
            skippedUntap = true;
          }
        }
        trace = [
          ...trace.slice(-19),
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`,
        ];
        let move: string | undefined;
        if (decision.kind === 'combat-attackers') {
          const attacker =
            exertTurn === undefined
              ? sourceOid
              : session.view.turn.number === exertTurn + 2
                ? reserveOid
                : undefined;
          if (decision.seat === 0 && crashers.length === 2 && blockers.length === 2 && attacker !== undefined)
            move = decision.options.find(
              (option) =>
                option.id.startsWith('combat-attack-add-') &&
                option.targets.some((target) => target.oid === attacker),
            )?.id;
          move ??= 'combat-attackers-commit';
        } else if (decision.kind === 'combat-exert') {
          expect(decision.seat).toBe(0);
          if (exertTurn === undefined) {
            move = decision.options.find((option) =>
              option.targets.some((target) => target.oid === sourceOid),
            )?.id;
            expect(move).toBeDefined();
            exertTurn = session.view.turn.number;
          } else move = 'combat-exert-done';
        } else if (decision.kind === 'target-selection') {
          expect(exertTurn).toBeDefined();
          move = decision.options.find((option) =>
            option.targets.some((target) => target.oid === targetOid),
          )?.id;
          expect(move).toBeDefined();
        } else if (decision.kind === 'combat-blockers') {
          expect(decision.seat).toBe(1);
          expect(session.view.stack).toHaveLength(0);
          expect(blockers).toHaveLength(2);
          if (session.view.turn.number === exertTurn) {
            expect(
              decision.options.some(
                (option) =>
                  option.id.startsWith('combat-block-add-') &&
                  option.targets.some((target) => target.oid === targetOid),
              ),
            ).toBe(false);
            expect(
              decision.options.some(
                (option) =>
                  option.id.startsWith('combat-block-add-') &&
                  option.targets.some((target) => target.oid === sourceOid),
              ),
            ).toBe(true);
            restricted = true;
          } else {
            expect(exertTurn).toBeDefined();
            expect(session.view.turn.number).toBe((exertTurn ?? 0) + 2);
            expect(restricted && skippedUntap).toBe(true);
            expect(crashers.find((card) => card.oid === reserveOid)?.attacking).toBe(true);
            expect(crashers.find((card) => card.oid === sourceOid)?.attacking).toBe(false);
            for (const blocker of blockers)
              expect(
                decision.options.some(
                  (option) =>
                    option.id.startsWith('combat-block-add-') &&
                    option.targets.some((target) => target.oid === blocker.oid) &&
                    option.targets.some((target) => target.oid === reserveOid),
                ),
              ).toBe(true);
            expired = true;
            break;
          }
          move = 'combat-blockers-commit';
        } else if (decision.kind === 'priority') {
          const land = decision.seat === 0 ? 'Mountain' : 'Plains';
          const creature = decision.seat === 0 ? CRASHER : BLOCKER;
          move = decision.options.find((option) => option.text === `Play ${land}`)?.id;
          if (
            move === undefined &&
            seatViewOf(session.view, decision.seat).battlefield.filter((card) => card.name === creature)
              .length < 2
          )
            move = decision.options.find(
              (option) => option.text.startsWith(`${creature}:`) && !option.text.includes('Eternalize'),
            )?.id;
          move ??= decision.options.find((option) => option.text === 'Pass priority')?.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'discard-selection') {
          move = decision.options.find((option) =>
            option.targets.some((target) => [CRASHER, BLOCKER].includes(target.name)),
          )?.id;
        }
        move ??= decision.options.find((option) =>
          ['Play first', 'Keep this hand'].includes(option.text),
        )?.id;
        if (move === undefined) throw new Error(`Unhandled expiry decision\n${trace.join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.join('\n')}`);
        session = advanced.session;
      }
      expect({ restricted, skippedUntap, expired }, trace.join('\n')).toEqual({
        restricted: true,
        skippedUntap: true,
        expired: true,
      });
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
