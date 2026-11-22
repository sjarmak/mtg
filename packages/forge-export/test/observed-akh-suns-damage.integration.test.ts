/** Sweltering Suns must damage creatures on both sides, including survivors. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { seatViewOf } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const creatures = ['Defiant Khenra', 'Harrier Naga', 'Hyena Pack'] as const;
const damageSeat = (seat: 0 | 1): SessionSpec['seats'][number] => ({
  name: `Suns seat ${seat}`,
  controller: 'local' as const,
  deck: {
    name: 'damage boundaries',
    cards: [
      { name: 'Mountain', count: 20 },
      { name: 'Forest', count: 10 },
      ...creatures.map((name) => ({ name, count: seat === 0 ? 7 : 10 })),
      ...(seat === 0 ? [{ name: 'Sweltering Suns', count: 9 }] : []),
    ],
  },
});
const table: SessionSpec = {
  content: { kind: 'printed', format: 'akh-hou' },
  seats: [damageSeat(0), damageSeat(1)],
  seed: 'akh-suns-damage-boundaries-v1',
  maximumTurns: 48,
};

forgeIt(
  'Sweltering Suns kills two- and three-toughness creatures and marks four-toughness survivors on both sides',
  async () => {
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let source: string | undefined;
    let castTurn: number | undefined;
    let controls: readonly (readonly { oid: string; name: string }[])[] = [];
    let completed = false;
    try {
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 2400 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        const seats = session.view.seats;
        if (source !== undefined && seats[0].graveyard.some((card) => card.oid === source)) {
          expect(session.view.turn.number).toBe(castTurn);
          expect(session.view.stack).toHaveLength(0);
          seats.forEach((seat, seatIndex) => {
            expect(seat.life).toBe(20);
            for (const card of controls[seatIndex] ?? []) {
              if (card.name === 'Hyena Pack') {
                expect(seat.battlefield.find((entry) => entry.oid === card.oid)).toMatchObject({
                  power: 3,
                  toughness: 4,
                  damage: 3,
                });
                expect(seat.graveyard.some((entry) => entry.oid === card.oid)).toBe(false);
              } else {
                expect(seat.graveyard.some((entry) => entry.oid === card.oid)).toBe(true);
                expect(seat.battlefield.some((entry) => entry.oid === card.oid)).toBe(false);
              }
            }
          });
          expect(seats[0].exile.some((card) => card.oid === source)).toBe(false);
          completed = true;
          break;
        }
        let move: string | undefined;
        if (decision.kind === 'priority' && source === undefined) {
          move = decision.options.find((option) =>
            ['Play Mountain', 'Play Forest'].includes(option.text),
          )?.id;
          for (const name of creatures) {
            if (!seatViewOf(session.view, decision.seat).battlefield.some((card) => card.name === name)) {
              move ??= decision.options.find((option) => option.text.startsWith(`${name}:`))?.id;
            }
          }
          if (
            decision.seat === 0 &&
            move === undefined &&
            seats.every((seat) =>
              creatures.every((name) => seat.battlefield.some((card) => card.name === name)),
            )
          ) {
            const spell = decision.options.find((option) =>
              option.text.includes('deals 3 damage to each creature'),
            );
            if (spell !== undefined) {
              source = seats[0].hand?.find((card) =>
                spell.id.startsWith(`ability-${card.oid.replace(/^forge-card-/u, '')}-`),
              )?.oid;
              expect(source).toBeDefined();
              expect(seats[0].hand?.find((card) => card.oid === source)?.name).toBe('Sweltering Suns');
              for (const seat of seats) {
                for (const [name, toughness] of [
                  ['Defiant Khenra', 2],
                  ['Harrier Naga', 3],
                  ['Hyena Pack', 4],
                ] as const) {
                  expect(seat.battlefield.find((card) => card.name === name)).toMatchObject({
                    toughness,
                    damage: 0,
                  });
                }
              }
              controls = seats.map((seat) =>
                seat.battlefield
                  .filter((card) => creatures.some((name) => name === card.name))
                  .map((card) => ({ oid: card.oid, name: card.name })),
              );
              expect(controls.map((cards) => cards.length)).toEqual([3, 3]);
              castTurn = session.view.turn.number;
              move = spell.id;
            }
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
        if (move === undefined)
          throw new Error(
            `Unhandled ${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`,
          );
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }
      expect(completed).toBe(true);
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
