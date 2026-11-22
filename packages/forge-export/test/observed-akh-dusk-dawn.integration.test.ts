/** Both split faces, power cutoffs, and controller scope through real decisions. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { seatViewOf } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const table: SessionSpec = {
  content: { kind: 'printed', format: 'akh-hou' },
  seats: [
    {
      name: 'Split pilot',
      controller: 'local',
      deck: {
        name: 'split faces',
        cards: [
          { name: 'Plains', count: 15 },
          { name: 'Mountain', count: 15 },
          { name: 'Dusk // Dawn', count: 6 },
          { name: 'Sweltering Suns', count: 8 },
          { name: 'Ahn-Crop Crasher', count: 8 },
          { name: 'Defiant Khenra', count: 8 },
        ],
      },
    },
    {
      name: 'Other controller',
      controller: 'local',
      deck: {
        name: 'power controls',
        cards: [
          { name: 'Mountain', count: 30 },
          { name: 'Ahn-Crop Crasher', count: 15 },
          { name: 'Defiant Khenra', count: 15 },
        ],
      },
    },
  ],
  seed: 'akh-dusk-dawn-power-v1',
  maximumTurns: 40,
};

forgeIt(
  'Dusk spares low power; Dawn excludes high power and the other graveyard',
  async () => {
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let phase: 'setup' | 'dusk' | 'suns' | 'dawn' = 'setup';
    let source: string | undefined;
    let duskResolved = false;
    let sunsCast = false;
    let dawnCast = false;
    let completed = false;
    let controls: readonly { low: string; high: string }[] = [];
    const payments: string[] = [];
    const trace: string[] = [];
    try {
      expect(await backend.supports(table)).toEqual([]);
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 2200 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        const seats = session.view.seats;
        const pilot = seats[0];
        if (phase === 'dusk' && pilot.graveyard.some((card) => card.oid === source)) {
          seats.forEach((seat, seatIndex) => {
            expect(seat.graveyard.some((card) => card.oid === controls[seatIndex]?.high)).toBe(true);
            expect(seat.battlefield.some((card) => card.oid === controls[seatIndex]?.low)).toBe(true);
          });
          expect(pilot.exile.some((card) => card.oid === source)).toBe(false);
          duskResolved = true;
          phase = 'suns';
        }
        if (
          phase === 'suns' &&
          sunsCast &&
          seats.every((seat, seatIndex) =>
            seat.graveyard.some((card) => card.oid === controls[seatIndex]?.low),
          )
        )
          phase = 'dawn';
        if (dawnCast && pilot.exile.some((card) => card.oid === source)) {
          expect(pilot.graveyard.some((card) => card.oid === source)).toBe(false);
          expect(pilot.hand?.some((card) => card.oid === controls[0]?.low)).toBe(true);
          expect(pilot.graveyard.some((card) => card.oid === controls[0]?.low)).toBe(false);
          expect(pilot.graveyard.some((card) => card.oid === controls[0]?.high)).toBe(true);
          expect(seats[1].graveyard.some((card) => card.oid === controls[1]?.low)).toBe(true);
          expect(seats[1].graveyard.some((card) => card.oid === controls[1]?.high)).toBe(true);
          completed = true;
          break;
        }
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${phase} ${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`,
        );
        let move: string | undefined;
        if (decision.kind === 'priority') {
          move = decision.options.find((option) =>
            ['Play Plains', 'Play Mountain'].includes(option.text),
          )?.id;
          if (phase === 'setup') {
            const seat = seatViewOf(session.view, decision.seat);
            for (const name of ['Defiant Khenra', 'Ahn-Crop Crasher']) {
              if (!seat.battlefield.some((card) => card.name === name)) {
                move ??= decision.options.find((option) => option.text.startsWith(`${name}:`))?.id;
              }
            }
            if (
              decision.seat === 0 &&
              move === undefined &&
              seats.every((seat) =>
                ['Defiant Khenra', 'Ahn-Crop Crasher'].every((name) =>
                  seat.battlefield.some((card) => card.name === name),
                ),
              )
            ) {
              const dusk = decision.options.find((option) =>
                option.text.includes('Destroy all creatures with power 3 or greater'),
              );
              if (dusk !== undefined) {
                source = pilot.hand?.find((card) =>
                  dusk.id.startsWith(`ability-${card.oid.replace(/^forge-card-/u, '')}-`),
                )?.oid;
                expect(source).toBeDefined();
                controls = seats.map((seat) => ({
                  low: seat.battlefield.find((card) => card.name === 'Defiant Khenra')!.oid,
                  high: seat.battlefield.find((card) => card.name === 'Ahn-Crop Crasher')!.oid,
                }));
                move = dusk.id;
                phase = 'dusk';
              }
            }
          } else if (decision.seat === 0 && move === undefined) {
            if (phase === 'suns' && !sunsCast) {
              move = decision.options.find((option) =>
                option.text.includes('deals 3 damage to each creature'),
              )?.id;
              sunsCast = move !== undefined;
            } else if (phase === 'dawn' && !dawnCast) {
              move = decision.options.find(
                (option) =>
                  option.id.startsWith(`ability-${source?.replace(/^forge-card-/u, '')}-`) &&
                  option.text.includes('Return all creature cards'),
              )?.id;
              dawnCast = move !== undefined;
            }
          }
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
          if (phase !== 'setup' && move !== undefined) payments.push(phase);
        } else if (decision.kind === 'discard-selection') {
          move = decision.options[0]?.id;
        }
        move ??= decision.options.find(
          (option) =>
            ['Play first', 'Keep this hand', 'Pass priority'].includes(option.text) ||
            ['combat-attackers-commit', 'combat-blockers-commit'].includes(option.id),
        )?.id;
        if (move === undefined) throw new Error(`Unhandled decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        session = advanced.session;
      }
      expect(completed, trace.slice(-15).join('\n')).toBe(true);
      expect(duskResolved).toBe(true);
      expect(payments.filter((phase) => phase === 'dusk')).toHaveLength(4);
      expect(payments.filter((phase) => phase === 'suns')).toHaveLength(3);
      expect(payments.filter((phase) => phase === 'dawn')).toHaveLength(5);
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
